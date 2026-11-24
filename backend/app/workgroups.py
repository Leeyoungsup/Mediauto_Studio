"""Workgroup membership and per-account Worklist subscriptions."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import Field, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.auth import CurrentUser, Session, require_roles
from app.clinical import ClinicalInput, add_event
from app.models import AuthUser, Case, QueueSubscription, Workgroup, WorkgroupMember
from app.workgroup_policy import BUILTINS, FROZEN_QUEUE, GroupKey, get_groups, lock_group

router = APIRouter(prefix="/api/worklist", tags=["Workgroups"])


class GroupCreate(ClinicalInput):
    key: GroupKey
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class MembershipChange(ClinicalInput):
    version: int = Field(ge=0)
    member: bool


class SubscriptionChange(ClinicalInput):
    subscribed: bool


@router.get("/queues")
async def queues(user: CurrentUser, session: Session):
    groups = await get_groups(session, user)
    subscribed = set(await session.scalars(select(QueueSubscription.queue_key).where(
        QueueSubscription.organization == user.organization, QueueSubscription.user_id == user.id)))
    definitions = [{"key": key, "name": name, "group_key": key} for key, name in groups.items()]
    definitions.append({"key": FROZEN_QUEUE, "name": "Frozen Section", "priority": "frozen"})
    return [{"subscribed": row["key"] in subscribed, **row} for row in definitions]


@router.put("/queues/{key}/subscription")
async def subscribe(key: GroupKey, data: SubscriptionChange, user: CurrentUser, session: Session):
    async with session.begin():
        if key != FROZEN_QUEUE:
            await lock_group(session, user, key)
        identity = {"organization": user.organization, "user_id": user.id, "queue_key": key}
        if data.subscribed:
            await session.execute(insert(QueueSubscription).values(**identity).on_conflict_do_nothing())
        else:
            await session.execute(delete(QueueSubscription).filter_by(**identity))
    return {"subscribed": data.subscribed}


@router.get("/workgroups")
async def workgroups(user: CurrentUser, session: Session):
    require_roles(user, ("admin",))
    names = await get_groups(session, user)
    versions = dict((await session.execute(select(Workgroup.key, Workgroup.version)
                    .where(Workgroup.organization == user.organization))).all())
    members = (await session.scalars(select(WorkgroupMember).where(WorkgroupMember.organization == user.organization))).all()
    users = (await session.scalars(select(AuthUser).where(AuthUser.organization == user.organization,
        AuthUser.role != "admin").order_by(AuthUser.display_name, AuthUser.username))).all()
    return {"groups": [{"key": key, "name": name, "version": versions.get(key, 0),
                        "members": [row.user_id for row in members if row.group_key == key]} for key, name in names.items()],
            "users": [{"id": item.id, "name": item.display_name, "role": item.role, "active": item.active} for item in users]}


@router.post("/workgroups", status_code=201)
async def create_group(data: GroupCreate, user: CurrentUser, session: Session):
    require_roles(user, ("admin",))
    if data.key in BUILTINS or data.key == FROZEN_QUEUE:
        raise HTTPException(409, "This workgroup key is reserved.")
    async with session.begin():
        group = await session.scalar(insert(Workgroup).values(
            organization=user.organization, created_by=str(user.id), **data.model_dump(),
        ).on_conflict_do_nothing(index_elements=["organization", "key"]).returning(Workgroup))
        if not group:
            raise HTTPException(409, "A workgroup with this key already exists.")
        session.info["user"] = user
        add_event(session, group, "workgroup_created", {}, {"key": group.key, "name": group.name}, source="ims")
        return {"key": group.key, "name": group.name, "version": group.version, "members": []}


@router.put("/workgroups/{key}/members/{user_id}")
async def change_membership(key: GroupKey, user_id: UUID, data: MembershipChange, user: CurrentUser, session: Session):
    require_roles(user, ("admin",))
    async with session.begin():
        existed = await session.scalar(select(Workgroup.id).where(Workgroup.organization == user.organization,
                                                                  Workgroup.key == key)) is not None
        group = await lock_group(session, user, key)
        account = await session.scalar(select(AuthUser).where(AuthUser.organization == user.organization,
                                                              AuthUser.id == user_id, AuthUser.role != "admin"))
        if account is None or data.member and not account.active:
            raise HTTPException(404, "Eligible workgroup account not found.")
        stored = await session.get(WorkgroupMember, (user.organization, key, user_id))
        if (stored is not None) == data.member:
            return {"member": data.member, "version": group.version}
        # Version zero represents a built-in group before its first authorized write.
        if data.version != group.version and not (not existed and data.version == 0 and group.version == 1):
            raise HTTPException(409, "The workgroup has changed. Reload the roster and try again.")
        if data.member:
            session.add(WorkgroupMember(organization=user.organization, group_key=key, user_id=user_id))
        else:
            pending = await session.scalar(select(Case.id).where(Case.organization == user.organization,
                Case.group_key == key, Case.assigned_to == user_id, Case.status != "reviewed").limit(1))
            if pending is not None:
                raise HTTPException(409, "Reassign the user's open cases in this workgroup before removing membership.")
            await session.delete(stored)
            await session.execute(delete(QueueSubscription).filter_by(
                organization=user.organization, user_id=user_id, queue_key=key))
        group.version += 1
        session.info["user"] = user
        add_event(session, group, "workgroup_membership_changed",
                  {"user_id": str(user_id), "member": not data.member},
                  {"user_id": str(user_id), "member": data.member}, source="ims")
        return {"member": data.member, "version": group.version}
