"""Same-case collaborative review with revocable participation and one camera driver."""

from datetime import timedelta
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import Field
from sqlalchemy import select, update
from sqlalchemy.orm.attributes import set_committed_value

from app.auth import require_roles
from app.clinical import ClinicalInput, Organization, Session, add_event, find, write
from app.integration_service import now
from app.models import AuthUser, Case, ReviewParticipant, ReviewRoom, Slide, SlideScan, Specimen
from app.scan_quality import BLOCKED_QC
from app.wsi import PRIVATE, scan_response, verified_scan_path

router = APIRouter(prefix="/api/clinical/{organization}/cases/{case_id}/review-room", tags=["Collaborative review"])
ROLES = ("admin", "doctor")
ONLINE_FOR = timedelta(seconds=12)
HEARTBEAT = timedelta(seconds=2)
Client = Annotated[UUID, Header(alias="X-Review-Client")]
Coordinate = Annotated[float, Field(ge=0, le=1_000_000_000, allow_inf_nan=False)]
Epoch = Annotated[int, Field(ge=1)]


class Invitation(ClinicalInput):
    active: bool


class FollowInput(ClinicalInput):
    follow: bool


class DriveInput(ClinicalInput):
    epoch: Epoch
    driver_id: UUID


class CameraInput(ClinicalInput):
    epoch: Epoch
    sequence: Annotated[int, Field(ge=0)]
    scan_id: UUID
    x: Coordinate
    y: Coordinate
    zoom: Annotated[float, Field(gt=0, le=64, allow_inf_nan=False)]


def room_query(case):
    return select(ReviewRoom).where(ReviewRoom.organization == case.organization,
                                    ReviewRoom.case_id == case.id, ReviewRoom.closed_at.is_(None))


async def room_for(session, case, room_id):
    room = await session.scalar(room_query(case).where(ReviewRoom.id == room_id))
    if room is None:
        raise HTTPException(404, "Review session is no longer available.")
    return room


def participant_filter(room, user_id):
    return (ReviewParticipant.organization == room.organization, ReviewParticipant.room_id == room.id,
            ReviewParticipant.user_id == user_id)


async def participant_for(session, room, user_id):
    return await session.scalar(select(ReviewParticipant).where(*participant_filter(room, user_id)))


def connected(member, client):
    return bool(member and member.revoked_at is None and member.client_id == client)


def online(member, time):
    return bool(member and member.revoked_at is None and member.client_id and member.last_seen
                and member.last_seen >= time - ONLINE_FOR)


def allowed_accounts(case):
    roles = AuthUser.role == "admin"
    if case.assigned_to:
        roles = roles | ((AuthUser.role == "doctor") & (AuthUser.id == case.assigned_to))
    return select(AuthUser).where(AuthUser.organization == case.organization, AuthUser.active.is_(True), roles)


async def members(session, case, room):
    accounts = (await session.scalars(allowed_accounts(case).order_by(AuthUser.display_name, AuthUser.id))).all()
    roster = (await session.scalars(select(ReviewParticipant).where(ReviewParticipant.organization == room.organization,
        ReviewParticipant.room_id == room.id, ReviewParticipant.revoked_at.is_(None),
        ReviewParticipant.user_id.in_([account.id for account in accounts])))).all()
    return accounts, {member.user_id: member for member in roster}


async def can_replace_orphan(session, case, room, user):
    if user.role != "admin" or user.id == room.owner_id:
        return False
    if await session.scalar(allowed_accounts(case).where(AuthUser.id == room.owner_id)):
        return False
    driver = await participant_for(session, room, room.driver_id)
    return not online(driver, now()) or not await session.scalar(allowed_accounts(case).where(AuthUser.id == room.driver_id))


def eligible_scan(case, scan_id):
    return (select(SlideScan).join(Slide, Slide.id == SlideScan.slide_id).join(Specimen, Specimen.id == Slide.specimen_id)
            .where(SlideScan.organization == case.organization, Specimen.case_id == case.id,
                   SlideScan.id == scan_id, SlideScan.status == "registered", SlideScan.qc_status.not_in(BLOCKED_QC)))


def frame_view(frame):
    return {key: frame[key] for key in ("scan_id", "x", "y", "zoom")} if frame else None


async def active_participant(session, room, user, client):
    member = await participant_for(session, room, user.id)
    if member is None or member.revoked_at is not None:
        raise HTTPException(404, "Review session is no longer available.")
    if not connected(member, client):
        raise HTTPException(409, "This browser must join the review session.")
    return member


def participant_event(session, room, member, action):
    add_event(session, member, action, {},
              {"room_id": str(room.id), "participant_id": str(member.user_id), "follow": member.follow},
              source="collaboration", case_id=room.case_id)


def changed_driver(session, room, user_id):
    previous = room.driver_id
    room.driver_id, room.drive_epoch = user_id, room.drive_epoch + 1
    room.version += 1
    add_event(session, room, "review_drive_changed", {"driver_id": str(previous)},
              {"driver_id": str(user_id), "epoch": room.drive_epoch}, source="collaboration")


@router.get("")
async def review_state(organization: Organization, case_id: UUID, client: Client, session: Session, response: Response):
    user = session.info["user"]
    require_roles(user, ROLES)
    case = await find(session, Case, organization, case_id)
    room = await session.scalar(room_query(case))
    response.headers.update(PRIVATE)
    if room is None:
        return {"state": "available", "room": None}
    member = await participant_for(session, room, user.id)
    if member is None or member.revoked_at is not None:
        state = "available" if await can_replace_orphan(session, case, room, user) else "unavailable"
        return {"state": state, "room": None}
    accounts, roster = await members(session, case, room)
    time = now()
    attached = connected(member, client)
    if attached and (not member.last_seen or member.last_seen < time - HEARTBEAT):
        renewed = await session.scalar(update(ReviewParticipant).where(
            *participant_filter(room, user.id), ReviewParticipant.client_id == client, ReviewParticipant.revoked_at.is_(None),
        ).values(last_seen=time).returning(ReviewParticipant.last_seen).execution_options(synchronize_session=False))
        if renewed:
            set_committed_value(member, "last_seen", renewed)
    frame = room.frame if attached else None
    if frame:
        scan = await session.scalar(eligible_scan(case, UUID(frame["scan_id"])))
        if scan is None or frame["file"] != [scan.size_bytes, scan.modified_ns]:
            frame = None
    owner = room.owner_id == user.id
    data = {"state": "joined" if attached else "invited", "room": {
        "id": room.id, "driver_id": room.driver_id, "epoch": room.drive_epoch, "sequence": room.frame_seq,
        "driver_online": online(roster.get(room.driver_id), time), "is_owner": owner,
        "you": user.id, "follow": member.follow, "frame": frame_view(frame),
        "participants": [{"id": account.id, "name": account.display_name, "online": online(roster[account.id], time),
                          "follow": roster[account.id].follow} for account in accounts if account.id in roster],
        "candidates": [{"id": account.id, "name": account.display_name} for account in accounts if account.id not in roster] if owner else [],
    }}
    await session.commit()
    return data


@router.post("", status_code=201)
async def create_review_room(organization: Organization, case_id: UUID, client: Client, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        current = await session.scalar(room_query(case))
        if current:
            existing = await participant_for(session, current, user.id)
            if current.owner_id == user.id and connected(existing, client):
                return {"id": current.id}
            if not await can_replace_orphan(session, case, current, user):
                raise HTTPException(409, "A review session already exists for this case.")
            current.closed_at, current.frame = now(), None
            current.version += 1
            add_event(session, current, "review_room_ended", {}, {}, "Session ownership no longer has case access.",
                      source="collaboration")
            await session.flush()
        room = ReviewRoom(organization=organization, case_id=case.id, owner_id=user.id, driver_id=user.id, created_by=str(user.id))
        session.add(room)
        await session.flush()
        member = ReviewParticipant(organization=organization, room_id=room.id, user_id=user.id, client_id=client,
                                   last_seen=now(), follow=False, created_by=str(user.id))
        session.add(member)
        await session.flush()
        add_event(session, room, "review_room_started", {}, {"driver_id": str(user.id)}, source="collaboration")
        return {"id": room.id}


@router.put("/{room_id}/participants/{participant_id}")
async def invite_review_participant(organization: Organization, case_id: UUID, room_id: UUID, participant_id: UUID,
                                    data: Invitation, client: Client, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        room = await room_for(session, case, room_id)
        await active_participant(session, room, user, client)
        if room.owner_id != user.id:
            raise HTTPException(403, "Only the session owner can manage invitations.")
        if participant_id == user.id:
            raise HTTPException(422, "The session owner already has access.")
        existing = await participant_for(session, room, participant_id)
        if data.active:
            if not await session.scalar(allowed_accounts(case).where(AuthUser.id == participant_id)):
                raise HTTPException(404, "Select an active user with access to this case.")
            if existing is None:
                existing = ReviewParticipant(organization=organization, room_id=room.id, user_id=participant_id,
                                             follow=False, created_by=str(user.id))
                session.add(existing)
                await session.flush()
            elif existing.revoked_at is None:
                return {"ok": True}
            else:
                existing.revoked_at = None
                existing.version += 1
            participant_event(session, room, existing, "review_participant_invited")
        elif existing and not existing.revoked_at:
            existing.revoked_at, existing.client_id, existing.follow = now(), None, False
            existing.version += 1
            participant_event(session, room, existing, "review_participant_revoked")
            if room.driver_id == participant_id:
                changed_driver(session, room, room.owner_id)
        return {"ok": True}


@router.post("/{room_id}/join")
async def join_review_room(organization: Organization, case_id: UUID, room_id: UUID, client: Client, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        room = await room_for(session, case, room_id)
        member = await participant_for(session, room, user.id)
        if not member or member.revoked_at is not None:
            raise HTTPException(404, "Review session is no longer available.")
        if member.client_id != client:
            member.client_id = client
            member.version += 1
            participant_event(session, room, member, "review_participant_joined")
            if room.driver_id == user.id:
                room.drive_epoch += 1
        member.last_seen = now()
        return {"ok": True}


@router.post("/{room_id}/leave")
async def leave_review_room(organization: Organization, case_id: UUID, room_id: UUID, client: Client, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        room = await room_for(session, case, room_id)
        member = await active_participant(session, room, user, client)
        member.client_id, member.last_seen = None, None
        member.version += 1
        participant_event(session, room, member, "review_participant_left")
        if room.driver_id == user.id and room.owner_id != user.id:
            owner = await participant_for(session, room, room.owner_id)
            if online(owner, now()):
                changed_driver(session, room, room.owner_id)
        return {"ok": True}


@router.put("/{room_id}/follow")
async def follow_review_room(organization: Organization, case_id: UUID, room_id: UUID, data: FollowInput, client: Client, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        room = await room_for(session, case, room_id)
        member = await active_participant(session, room, user, client)
        if room.driver_id == user.id:
            raise HTTPException(409, "The current Driver cannot follow.")
        if member.follow != data.follow:
            member.follow = data.follow
            member.version += 1
            participant_event(session, room, member, "review_follow_changed")
        return {"ok": True}


@router.put("/{room_id}/drive")
async def transfer_review_drive(organization: Organization, case_id: UUID, room_id: UUID, data: DriveInput, client: Client, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        room = await room_for(session, case, room_id)
        await active_participant(session, room, user, client)
        if data.epoch != room.drive_epoch:
            raise HTTPException(409, "The Driver changed. Refresh the session before retrying.")
        _, roster = await members(session, case, room)
        current = roster.get(room.driver_id)
        if user.id != room.driver_id and not (user.id == room.owner_id and data.driver_id == user.id and not online(current, now())):
            raise HTTPException(403, "Only the Driver can hand off. The owner can reclaim an offline Driver’s controls.")
        target = roster.get(data.driver_id)
        if not online(target, now()):
            raise HTTPException(409, "Select a connected participant with access to this case.")
        if room.driver_id != data.driver_id:
            changed_driver(session, room, data.driver_id)
        return {"epoch": room.drive_epoch}


@router.put("/{room_id}/camera")
async def publish_review_camera(organization: Organization, case_id: UUID, room_id: UUID, data: CameraInput,
                                client: Client, session: Session, request: Request):
    user = session.info["user"]
    async with write(session, ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        room = await room_for(session, case, room_id)
        member = await active_participant(session, room, user, client)
        if room.driver_id != user.id:
            raise HTTPException(403, "Only the Driver can publish camera changes.")
        if data.epoch != room.drive_epoch or data.sequence != room.frame_seq:
            raise HTTPException(409, "The shared camera changed. Refresh the session before retrying.")
        scan = await session.scalar(eligible_scan(case, data.scan_id))
        if scan is None:
            raise HTTPException(404, "This scan is unavailable for the case.")
        key = [scan.size_bytes, scan.modified_ns]
        prior = room.frame
        if prior and prior["scan_id"] == str(scan.id) and prior["file"] == key:
            dimensions = prior["dimensions"]
        else:
            path, _ = await verified_scan_path(scan.storage_key, tuple(key))
            dimensions = (await scan_response(request, path, "metadata"))["dimensions"]
        if data.x >= dimensions[0] or data.y >= dimensions[1]:
            raise HTTPException(422, "The shared camera is outside this scan.")
        room.frame = {**data.model_dump(mode="json", include={"scan_id", "x", "y", "zoom"}), "file": key, "dimensions": dimensions}
        room.frame_seq += 1
        member.last_seen = now()
        return {"sequence": room.frame_seq}


@router.post("/{room_id}/end")
async def end_review_room(organization: Organization, case_id: UUID, room_id: UUID, client: Client, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        room = await room_for(session, case, room_id)
        await active_participant(session, room, user, client)
        if room.owner_id != user.id:
            raise HTTPException(403, "Only the session owner can end the session.")
        room.closed_at, room.frame = now(), None
        room.version += 1
        add_event(session, room, "review_room_ended", {}, {}, source="collaboration")
        return {"ok": True}
