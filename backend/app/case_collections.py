"""Personal and shared case references and scoped Tumor Board agendas."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from pydantic import Field, StringConstraints
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert

from app.auth import require_roles
from app.clinical import ClinicalInput, Organization, RegistrationKey, Session, add_event, case_visibility, find, require_version, write
from app.integration_service import now
from app.models import AnalysisRun, AuthUser, Case, CaseCollection, CaseReport, CaseRequest, CollectionEntry, CollectionMember, ReportRevision, Slide, SlideScan, Specimen
from app.scan_quality import BLOCKED_QC
from app.wsi import PRIVATE

router = APIRouter(prefix="/api/clinical/{organization}/collections", tags=["Case collections and Tumor Board"])
ROLES = ("admin", "doctor")
Role = Literal["viewer", "editor"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Version = Annotated[int, Field(ge=1)]


class CollectionInput(ClinicalInput):
    kind: Literal["personal", "shared", "board"]
    title: Title


class MeetingInput(ClinicalInput):
    title: Title
    meeting_date: date


class MemberInput(ClinicalInput):
    role: Role | None


class EntryInput(ClinicalInput):
    case_id: UUID
    note: Note = ""


class EntryEdit(ClinicalInput):
    version: Version
    note: Note
    presented: bool | None = None


class MoveEntry(ClinicalInput):
    version: Version
    direction: Literal["earlier", "later"]


def member_scope(user):
    return (CollectionMember.organization == user.organization, CollectionMember.user_id == user.id)


def node_view(node, role):
    return {"id": node.id, "title": node.title, "kind": node.kind, "parent_id": node.parent_id,
            "meeting_date": node.meeting_date, "version": node.version, "role": role}


def entry_view(entry, case):
    return {"id": entry.id, "case_id": case.id, "case_number": case.case_number, "note": entry.note, "version": entry.version,
            "presented_at": entry.presented_at, "presented_by": entry.presented_by}


def entry_state(entry):
    return {"collection_id": str(entry.collection_id), "case_ref": str(entry.linked_case_id), "position": entry.position,
            "noted": bool(entry.note), "presented": entry.presented_at is not None, "removed": entry.removed_at is not None}


async def resolve(session, user, node_id, *, lock=False, edit=False):
    statement = select(CaseCollection).where(CaseCollection.organization == user.organization)
    node = await session.scalar(statement.where(CaseCollection.id == node_id))
    if node is None:
        raise HTTPException(404, "Collection not found.")
    root_query = statement.where(CaseCollection.id == (node.parent_id or node.id))
    if lock:
        root_query = root_query.with_for_update(of=CaseCollection).execution_options(populate_existing=True)
    root = await session.scalar(root_query)
    if root.owner_id == user.id:
        role = "owner"
    elif root.kind != "personal":
        role = await session.scalar(select(CollectionMember.role).where(*member_scope(user), CollectionMember.collection_id == root.id))
    else:
        role = None
    if not role:
        raise HTTPException(404, "Collection not found.")
    if edit and role not in ("owner", "editor"):
        raise HTTPException(403, "This collection is read-only for you.")
    if node.id == root.id:
        node = root
    elif lock:
        node = await session.scalar(statement.where(CaseCollection.id == node_id).with_for_update(of=CaseCollection)
                                    .execution_options(populate_existing=True))
    return node, root, role


async def root_index(session, user):
    rows = (await session.execute(select(CaseCollection, CollectionMember.role)
        .outerjoin(CollectionMember, (CollectionMember.collection_id == CaseCollection.id)
                   & (CollectionMember.organization == user.organization) & (CollectionMember.user_id == user.id))
        .where(CaseCollection.organization == user.organization, CaseCollection.parent_id.is_(None),
               or_(CaseCollection.owner_id == user.id, CollectionMember.role.is_not(None)))
        .order_by(CaseCollection.title, CaseCollection.id))).all()
    roots = [node_view(row, "owner" if row.owner_id == user.id else role) for row, role in rows]
    roles = {root["id"]: root["role"] for root in roots if root["kind"] == "board"}
    meetings = await session.scalars(select(CaseCollection).where(
        CaseCollection.organization == user.organization, CaseCollection.parent_id.in_(roles),
    ).order_by(CaseCollection.meeting_date.desc(), CaseCollection.title))
    return {"collections": roots, "meetings": [node_view(row, roles[row.parent_id]) for row in meetings], "can_create_board": user.role == "admin"}


def visible_entries(node, user):
    return (select(CollectionEntry, Case).join(Case, (Case.id == CollectionEntry.linked_case_id) & (Case.organization == CollectionEntry.organization))
            .where(CollectionEntry.organization == user.organization, CollectionEntry.collection_id == node.id,
                   CollectionEntry.removed_at.is_(None), case_visibility(Case, user)))


async def entry_for(session, node, user, entry_id):
    selected = (await session.execute(visible_entries(node, user).where(CollectionEntry.id == entry_id))).one_or_none()
    if selected is None:
        raise HTTPException(404, "Case reference not found.")
    return selected


async def create_node(session, user, organization, title, kind, key, parent=None, meeting_date=None):
    parent_id = parent.id if parent else None
    scope = (CaseCollection.organization == organization, CaseCollection.created_by == str(user.id),
             CaseCollection.request_key == key)
    node = await session.scalar(insert(CaseCollection).values(
        organization=organization, title=title, kind=kind, owner_id=parent.owner_id if parent else user.id,
        parent_id=parent_id, meeting_date=meeting_date, request_key=key, created_by=str(user.id),
    ).on_conflict_do_nothing(index_elements=["organization", "created_by", "request_key"]).returning(CaseCollection))
    if node is None:
        prior = await session.scalar(select(CaseCollection).where(*scope))
        if (prior.title, prior.kind, prior.parent_id, prior.meeting_date) != (title, kind, parent_id, meeting_date):
            raise HTTPException(409, "This creation key was already used for different details.")
        return prior
    add_event(session, node, "collection_created", {}, {"kind": kind, "parent_id": str(parent_id) if parent_id else None}, source="collections")
    return node


@router.get("")
async def collections(organization: Organization, session: Session, response: Response):
    user = session.info["user"]
    require_roles(user, ROLES)
    response.headers.update(PRIVATE)
    return await root_index(session, user)


@router.post("", status_code=201)
async def create_collection(organization: Organization, data: CollectionInput, key: RegistrationKey, session: Session):
    user = session.info["user"]
    async with write(session, ("admin",) if data.kind == "board" else ROLES):
        node = await create_node(session, user, organization, data.title, data.kind, key)
        return node_view(node, "owner")


@router.get("/{collection_id}")
async def collection_detail(organization: Organization, collection_id: UUID, session: Session, response: Response):
    user = session.info["user"]
    require_roles(user, ROLES)
    node, root, role = await resolve(session, user, collection_id)
    entries = (await session.execute(visible_entries(node, user).order_by(CollectionEntry.position, CollectionEntry.id))).all()
    meetings, members, candidates = [], [], []
    if node.kind == "board":
        meetings = [node_view(row, role) for row in await session.scalars(select(CaseCollection).where(
            CaseCollection.organization == organization, CaseCollection.parent_id == node.id)
            .order_by(CaseCollection.meeting_date.desc(), CaseCollection.title, CaseCollection.id))]
    can_manage_members = node.id == root.id and role == "owner" and root.kind in ("shared", "board")
    if can_manage_members:
        roster = (await session.execute(select(CollectionMember, AuthUser).join(AuthUser, AuthUser.id == CollectionMember.user_id)
                  .where(CollectionMember.organization == organization, CollectionMember.collection_id == root.id)
                  .order_by(AuthUser.display_name, AuthUser.id))).all()
        members = [{"id": account.id, "name": account.display_name, "role": member.role} for member, account in roster]
        candidates = [{"id": account.id, "name": account.display_name, "username": account.username}
            for account in await session.scalars(select(AuthUser).where(AuthUser.organization == organization,
                AuthUser.role.in_(ROLES), AuthUser.active.is_(True), AuthUser.id != root.owner_id)
                .order_by(AuthUser.display_name, AuthUser.username))]
    response.headers.update(PRIVATE)
    return {**node_view(node, role), "parent_title": root.title if node.parent_id else None,
            "entries": [entry_view(row, case) for row, case in entries], "meetings": meetings,
            "can_manage_members": can_manage_members, "members": members, "candidates": candidates}


@router.post("/{collection_id}/meetings", status_code=201)
async def create_meeting(organization: Organization, collection_id: UUID, data: MeetingInput, key: RegistrationKey, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        node, _, role = await resolve(session, user, collection_id, lock=True, edit=True)
        if node.kind != "board":
            raise HTTPException(422, "Choose a Tumor Board to create a meeting.")
        meeting = await create_node(session, user, organization, data.title, "meeting", key, node, data.meeting_date)
        return node_view(meeting, role)


@router.put("/{collection_id}/members/{user_id}")
async def change_collection_member(organization: Organization, collection_id: UUID, user_id: UUID, data: MemberInput, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        node, root, role = await resolve(session, user, collection_id, lock=True)
        if role != "owner" or node.id != root.id or root.kind not in ("shared", "board"):
            raise HTTPException(403, "Only the shared collection or Board owner can manage members.")
        if user_id == root.owner_id:
            raise HTTPException(422, "The owner already has access.")
        member = await session.scalar(select(CollectionMember).where(CollectionMember.organization == organization,
            CollectionMember.collection_id == node.id, CollectionMember.user_id == user_id))
        before = {"role": member.role} if member else {}
        if data.role is None:
            if member:
                member.version += 1
                add_event(session, member, "collection_member_revoked", before, {"user_id": str(user_id), "collection_id": str(node.id)}, source="collections")
                await session.delete(member)
        else:
            eligible = await session.scalar(select(AuthUser.id).where(AuthUser.organization == organization,
                AuthUser.id == user_id, AuthUser.role.in_(ROLES), AuthUser.active.is_(True)))
            if eligible is None:
                raise HTTPException(404, "Select an active member from this organization.")
            if not member or member.role != data.role:
                if member:
                    member.role, member.version = data.role, member.version + 1
                else:
                    member = CollectionMember(organization=organization, collection_id=node.id, user_id=user_id,
                                              role=data.role, created_by=str(user.id))
                    session.add(member)
                    await session.flush()
                add_event(session, member, "collection_member_updated", before, {"role": data.role, "user_id": str(user_id),
                          "collection_id": str(node.id)}, source="collections")
        return {"ok": True}


@router.post("/{collection_id}/entries", status_code=201)
async def add_collection_entry(organization: Organization, collection_id: UUID, data: EntryInput, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        node, _, _ = await resolve(session, user, collection_id, lock=True, edit=True)
        if node.kind == "board":
            raise HTTPException(422, "Choose a Board meeting to add a case.")
        case = await find(session, Case, organization, data.case_id, lock=True)
        entry = await session.scalar(select(CollectionEntry).where(CollectionEntry.organization == organization,
            CollectionEntry.collection_id == node.id, CollectionEntry.linked_case_id == case.id))
        if entry and entry.removed_at is None:
            if entry.note != data.note:
                raise HTTPException(409, "This case is already in the list. Edit its existing note.")
            return entry_view(entry, case)
        position = await session.scalar(select(func.coalesce(func.max(CollectionEntry.position), 0)).where(
            CollectionEntry.collection_id == node.id, CollectionEntry.removed_at.is_(None)))
        before = entry_state(entry) if entry else {}
        if entry:
            entry.note, entry.position, entry.removed_at = data.note, position + 1, None
            entry.presented_at, entry.presented_by, entry.version = None, None, entry.version + 1
        else:
            entry = CollectionEntry(organization=organization, collection_id=node.id, linked_case_id=case.id,
                                    position=position + 1, note=data.note, created_by=str(user.id))
            session.add(entry)
            await session.flush()
        node.version += 1
        add_event(session, entry, "collection_case_added", before, entry_state(entry), source="collections")
        return entry_view(entry, case)


@router.patch("/{collection_id}/entries/{entry_id}")
async def edit_collection_entry(organization: Organization, collection_id: UUID, entry_id: UUID, data: EntryEdit, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        node, _, _ = await resolve(session, user, collection_id, lock=True, edit=True)
        entry, case = await entry_for(session, node, user, entry_id)
        require_version(entry, data.version)
        if data.presented is not None and node.kind != "meeting":
            raise HTTPException(422, "Presented applies to Board meeting agenda items.")
        changed = data.presented is not None and data.presented != (entry.presented_at is not None)
        note_changed = entry.note != data.note
        if note_changed or changed:
            before = entry_state(entry)
            entry.note = data.note
            if changed:
                entry.presented_at = now() if data.presented else None
                entry.presented_by = user.id if data.presented else None
            entry.version += 1
            add_event(session, entry, "collection_case_presented" if changed else "collection_note_updated",
                      before, {**entry_state(entry), "note_changed": note_changed}, source="collections")
        return entry_view(entry, case)


@router.post("/{collection_id}/entries/{entry_id}/move")
async def move_collection_entry(organization: Organization, collection_id: UUID, entry_id: UUID, data: MoveEntry, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        node, _, _ = await resolve(session, user, collection_id, lock=True, edit=True)
        require_version(node, data.version)
        rows = (await session.execute(visible_entries(node, user).order_by(CollectionEntry.position, CollectionEntry.id))).all()
        index = next((index for index, (entry, _) in enumerate(rows) if entry.id == entry_id), None)
        if index is None:
            raise HTTPException(404, "Case reference not found.")
        neighbor = index + (-1 if data.direction == "earlier" else 1)
        if 0 <= neighbor < len(rows):
            left, right = rows[index][0], rows[neighbor][0]
            before = entry_state(left)
            left.position, right.position = right.position, left.position
            node.version += 1
            add_event(session, node, "collection_order_updated", before,
                      {**entry_state(left), "swapped_with": str(right.id)}, source="collections")
        return {"version": node.version}


@router.delete("/{collection_id}/entries/{entry_id}")
async def remove_collection_entry(organization: Organization, collection_id: UUID, entry_id: UUID, version: Version, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        node, _, _ = await resolve(session, user, collection_id, lock=True, edit=True)
        entry, _ = await entry_for(session, node, user, entry_id)
        require_version(entry, version)
        before = entry_state(entry)
        entry.removed_at, entry.version = now(), entry.version + 1
        node.version += 1
        add_event(session, entry, "collection_case_removed", before, entry_state(entry), source="collections")
        return {"ok": True}


@router.get("/{collection_id}/entries/{entry_id}/links")
async def collection_links(organization: Organization, collection_id: UUID, entry_id: UUID, session: Session, response: Response):
    user = session.info["user"]
    require_roles(user, ROLES)
    node, _, _ = await resolve(session, user, collection_id)
    _, case = await entry_for(session, node, user, entry_id)
    scans = (await session.execute(select(SlideScan.id, Slide.slide_number, Slide.stain, SlideScan.format)
        .select_from(SlideScan).join(Slide, Slide.id == SlideScan.slide_id).join(Specimen, Specimen.id == Slide.specimen_id)
        .where(Specimen.case_id == case.id, SlideScan.organization == organization, SlideScan.status == "registered",
               SlideScan.qc_status.not_in(BLOCKED_QC)).order_by(Slide.slide_number, SlideScan.id))).all()
    requests = await session.scalars(select(CaseRequest).where(CaseRequest.organization == organization,
        CaseRequest.case_id == case.id, CaseRequest.status == "completed", CaseRequest.kind.in_(("consult", "ai")))
        .order_by(CaseRequest.updated_at.desc(), CaseRequest.id))
    runs = await session.scalars(select(AnalysisRun).where(AnalysisRun.organization == organization,
        AnalysisRun.case_id == case.id, AnalysisRun.status == "completed").order_by(AnalysisRun.finished_at.desc(), AnalysisRun.id))
    report = await session.scalar(select(CaseReport.id).join(ReportRevision, (ReportRevision.report_id == CaseReport.id)
        & (ReportRevision.organization == CaseReport.organization) & (ReportRevision.version == CaseReport.version))
        .where(CaseReport.organization == organization, CaseReport.case_id == case.id, ReportRevision.status == "approved"))
    response.headers.update(PRIVATE)
    return {"scans": [{"id": row.id, "label": row.slide_number, "stain": row.stain, "format": row.format} for row in scans],
            "requests": [{"id": row.id, "kind": row.kind, "scan_id": row.scan_id, "snapshot": row.snapshot.get("id") if row.snapshot else None} for row in requests],
            "runs": [{"id": row.id, "request_id": row.request_id, "attempt": row.attempt, "model": row.model_key,
                      "scan_id": row.scan_id, "snapshot": (row.result or {}).get("snapshot", {}).get("id")} for row in runs],
            "has_approved_report": report is not None}
