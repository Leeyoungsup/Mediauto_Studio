"""Worklist routing groups complement existing case ACLs."""

from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import StringConstraints
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.models import AuthUser, Workgroup, WorkgroupMember

GroupKey = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,47}$")]
Priority = Literal["routine", "urgent", "frozen"]
BUILTINS = {"breast": "Breast", "cytology": "Cytology"}
FROZEN_QUEUE = "frozen-section"


async def get_groups(session, user):
    base = select(Workgroup).where(Workgroup.organization == user.organization)
    if user.role != "admin":
        base = base.join(WorkgroupMember, (WorkgroupMember.organization == Workgroup.organization)
                         & (WorkgroupMember.group_key == Workgroup.key)).where(WorkgroupMember.user_id == user.id)
    groups = {group.key: group.name for group in await session.scalars(base.order_by(Workgroup.name, Workgroup.key))}
    return {**BUILTINS, **groups} if user.role == "admin" else groups


async def lock_group(session, user, key):
    if key in BUILTINS and user.role == "admin":
        await session.execute(insert(Workgroup).values(organization=user.organization, key=key, name=BUILTINS[key],
            created_by=str(user.id)).on_conflict_do_nothing(index_elements=["organization", "key"]))
    group = await session.scalar(select(Workgroup).where(
        Workgroup.organization == user.organization, Workgroup.key == key).with_for_update())
    if group is None or (user.role != "admin" and not await session.get(WorkgroupMember, (user.organization, key, user.id))):
        raise HTTPException(404, "Workgroup not found.")
    return group


def member_filter(organization, key):
    return AuthUser.id.in_(select(WorkgroupMember.user_id).where(
        WorkgroupMember.organization == organization, WorkgroupMember.group_key == key))


async def group_member(session, organization, key, actor_id):
    return await session.get(WorkgroupMember, (organization, key, actor_id)) is not None
