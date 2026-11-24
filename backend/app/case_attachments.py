"""Upload, render, and audit case PDFs and specimen photographs."""

import asyncio
import hashlib
from typing import Annotated, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import load_only

from app.attachment_files import FILE_LIMITS, MIB, MIME_TYPES, pdf_page, photo_preview, prepare_attachment, upload_name
from app.auth import require_roles
from app.clinical import Organization, RegistrationKey, Session, add_event, case_visibility, find, write
from app.models import AuthUser, Case, CaseAttachment, ClinicalEvent, Specimen

router = APIRouter(prefix="/api/clinical/{organization}/cases/{case_id}/attachments", tags=["Case attachments"])
Kind = Literal["pdf", "gross"]
UPLOAD_ROLES = ("admin", "labeler", "doctor")
MAX_CASE_BYTES = 100 * MIB
MAX_ATTACHMENTS = 50
PRIVATE = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
ATTACHMENT_FIELDS = tuple(getattr(CaseAttachment, name) for name in (
    "id", "specimen_id", "filename", "pages", "size_bytes", "created_at",
))


def location(case):
    return CaseAttachment.organization == case.organization, CaseAttachment.case_id == case.id


async def validate_target(session, case, kind, specimen_id):
    if (kind == "gross") != (specimen_id is not None):
        raise HTTPException(422, "Gross images require a specimen. PDF documents are attached to the case.")
    if specimen_id is not None and await session.scalar(select(Specimen.id).where(
        Specimen.id == specimen_id, Specimen.case_id == case.id, Specimen.organization == case.organization,
    )) is None:
        raise HTTPException(404, "Specimen not found in this case.")


async def attachment(session, case, kind, attachment_id, *, lock=False, content=False):
    query = select(CaseAttachment).where(*location(case), CaseAttachment.kind == kind, CaseAttachment.id == attachment_id)
    if lock:
        query = query.with_for_update()
    if not content:
        query = query.options(load_only(CaseAttachment.id))
    record = await session.scalar(query)
    if record is None:
        raise HTTPException(404, "Attachment not found in this case.")
    return record


def metadata(record):
    return {column.key: getattr(record, column.key) for column in ATTACHMENT_FIELDS}


def checked_content(record):
    if len(record.content) != record.size_bytes or hashlib.sha256(record.content).hexdigest() != record.checksum:
        raise HTTPException(422, "The stored attachment is damaged.")
    return record.content


@router.get("/{kind}")
async def list_attachments(organization: Organization, case_id: UUID, kind: Kind, session: Session):
    case = await find(session, Case, organization, case_id)
    records = (await session.execute(select(*ATTACHMENT_FIELDS)
        .where(*location(case), CaseAttachment.kind == kind)
        .order_by(CaseAttachment.created_at.desc(), CaseAttachment.id))).mappings().all()
    specimens = []
    if kind == "gross":
        specimens = (await session.execute(select(Specimen.id, Specimen.specimen_number, Specimen.description)
            .where(Specimen.organization == organization, Specimen.case_id == case_id)
            .order_by(Specimen.specimen_number, Specimen.id))).mappings().all()
    return {
        "records": [dict(row) for row in records], "specimens": [dict(row) for row in specimens],
        "can_upload": session.info["user"].role in UPLOAD_ROLES, "max_upload_bytes": FILE_LIMITS[kind],
    }


@router.post("/{kind}", status_code=201)
async def upload(
    organization: Organization, case_id: UUID, kind: Kind, request: Request, key: RegistrationKey,
    name: Annotated[str, Header(alias="X-File-Name", min_length=1, max_length=2400)],
    session: Session, specimen_id: UUID | None = None,
):
    require_roles(session.info["user"], UPLOAD_ROLES)
    case = await find(session, Case, organization, case_id)
    await validate_target(session, case, kind, specimen_id)
    await session.rollback()
    limit = FILE_LIMITS[kind]
    declared_size = request.headers.get("content-length", "")
    if declared_size.isdigit() and int(declared_size) > limit:
        raise HTTPException(413, "The file exceeds the attachment size limit.")
    data = bytearray()
    async with request.app.state.attachment_slots:
        async for chunk in request.stream():
            if len(data) + len(chunk) > limit:
                raise HTTPException(413, "The file exceeds the attachment size limit.")
            data.extend(chunk)
        content, pages = await asyncio.to_thread(prepare_attachment, kind, bytes(data))
    filename = upload_name(name, kind)
    checksum = hashlib.sha256(content).hexdigest()
    creator = str(session.info["user"].id)
    async with write(session, UPLOAD_ROLES):
        # The case lock serializes quota checks and keeps a reassignment from crossing this write.
        case = await find(session, Case, organization, case_id, lock=True)
        await validate_target(session, case, kind, specimen_id)
        record = await session.scalar(select(CaseAttachment).where(
            *location(case), CaseAttachment.created_by == creator, CaseAttachment.request_key == key,
        ).options(load_only(*ATTACHMENT_FIELDS, CaseAttachment.kind, CaseAttachment.checksum)))
        if record is not None:
            if (record.kind, record.specimen_id, record.filename, record.checksum) != (kind, specimen_id, filename, checksum):
                raise HTTPException(409, "This upload request was already used for a different attachment.")
            return metadata(record)
        totals = (await session.execute(select(func.count(), func.coalesce(func.sum(CaseAttachment.size_bytes), 0))
                 .where(*location(case)))).one()
        if totals[0] >= MAX_ATTACHMENTS or totals[1] + len(content) > MAX_CASE_BYTES:
            raise HTTPException(413, "This case has reached its attachment storage limit.")
        record = CaseAttachment(organization=organization, case_id=case_id, specimen_id=specimen_id, kind=kind,
                                filename=filename, pages=pages, content=content, size_bytes=len(content), checksum=checksum,
                                request_key=key, created_by=creator)
        session.add(record)
        await session.flush()
        add_event(session, record, "attachment_registered", {}, {
            "case_id": str(case_id), "specimen_id": str(specimen_id) if specimen_id else None, "kind": kind,
        }, source="ims")
        return metadata(record)


@router.get("/{kind}/{attachment_id}/preview")
async def preview(
    organization: Organization, case_id: UUID, kind: Kind, attachment_id: UUID, request: Request,
    session: Session, page: Annotated[int, Query(ge=1)] = 1,
):
    case = await find(session, Case, organization, case_id)
    record = await attachment(session, case, kind, attachment_id, content=True)
    if page > (record.pages or 1):
        raise HTTPException(404, "Attachment page not found.")
    content = checked_content(record)
    await session.rollback()
    async with request.app.state.attachment_slots:
        if kind == "pdf":
            content = await asyncio.to_thread(pdf_page, content, page)
        else:
            content = await asyncio.to_thread(photo_preview, content)
    return Response(content, media_type="image/png" if kind == "pdf" else "image/jpeg", headers=PRIVATE)


@router.post("/{kind}/{attachment_id}/download")
async def download(organization: Organization, case_id: UUID, kind: Kind, attachment_id: UUID, session: Session):
    async with session.begin():
        # Hold a shared case lock through the audit write so a reassignment cannot interleave.
        user = session.info["user"]
        case = await session.scalar(select(Case).where(
            Case.organization == organization, Case.id == case_id, case_visibility(Case, user),
        ).with_for_update(read=True))
        if case is None:
            raise HTTPException(404, "Record not found in this organization.")
        record = await attachment(session, case, kind, attachment_id, lock=True, content=True)
        content = checked_content(record)
        record.version += 1
        add_event(session, record, "attachment_downloaded", {}, {"case_id": str(case_id), "kind": kind}, source="ims")
        disposition = f'attachment; filename="attachment.{"pdf" if kind == "pdf" else "jpg"}"; filename*=UTF-8\'\'{quote(record.filename, safe="")}'
    return Response(content, media_type=MIME_TYPES[kind], headers={**PRIVATE, "Content-Disposition": disposition})


@router.get("/{kind}/{attachment_id}/activity")
async def activity(organization: Organization, case_id: UUID, kind: Kind, attachment_id: UUID, session: Session):
    case = await find(session, Case, organization, case_id)
    await attachment(session, case, kind, attachment_id)
    event = ClinicalEvent
    rows = (await session.execute(select(event.id, event.action, event.occurred_at, AuthUser.display_name.label("actor"))
        .outerjoin(AuthUser, (AuthUser.organization == event.organization) & (cast(AuthUser.id, String) == event.actor))
        .where(event.organization == organization, event.record_type == CaseAttachment.__tablename__,
               event.record_id == attachment_id)
        .order_by(event.version.desc()).limit(30))).mappings().all()
    return [dict(row) for row in rows]
