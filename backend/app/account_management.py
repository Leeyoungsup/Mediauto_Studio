"""Organization-scoped account administration and audit views."""

from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import Boolean, String, case, cast, delete, func, literal, or_, select, union_all
from sqlalchemy.orm import aliased

from app.auth import CurrentUser, Session, require_roles, user_view
from app.models import AccountRegistrationRequest, AuthSession, AuthUser, ClinicalEvent, Workgroup
from app.registration import PAGE_SIZE

router = APIRouter(prefix="/api/auth", tags=["Account management"])


class AccessChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["admin", "doctor", "labeler", "viewer"]
    active: bool
    version: Annotated[int, Field(ge=0)]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]


def access_version():
    return (select(func.coalesce(func.max(ClinicalEvent.version), 0))
            .where(ClinicalEvent.organization == AuthUser.organization, ClinicalEvent.record_type == "auth_users",
                   ClinicalEvent.record_id == AuthUser.id).correlate(AuthUser).scalar_subquery())


def account_view(account, version):
    return {**user_view(account), "active": account.active, "version": version,
            "can_manage": account.role != "admin"}


@router.get("/accounts")
async def accounts(user: CurrentUser, session: Session, offset: Annotated[int, Query(ge=0)] = 0,
                   q: Annotated[str, Query(max_length=120)] = ""):
    require_roles(user, ("admin",))
    query = select(AuthUser, access_version()).where(AuthUser.organization == user.organization)
    if q := q.strip():
        query = query.where(or_(AuthUser.username.icontains(q, autoescape=True), AuthUser.display_name.icontains(q, autoescape=True)))
    rows = (await session.execute(query.order_by(AuthUser.username, AuthUser.id)
                                  .offset(offset).limit(PAGE_SIZE + 1))).all()
    return {"rows": [account_view(account, version) for account, version in rows[:PAGE_SIZE]],
            "has_more": len(rows) > PAGE_SIZE}


@router.patch("/accounts/{account_id}/access")
async def change_access(account_id: UUID, data: AccessChange, user: CurrentUser, session: Session):
    require_roles(user, ("admin",))
    async with session.begin():
        account = await session.scalar(select(AuthUser).where(
            AuthUser.organization == user.organization, AuthUser.id == account_id,
        ).with_for_update())
        if account is None:
            raise HTTPException(404, "Account not found.")
        if account.role == "admin":
            raise HTTPException(403, "Administrator accounts cannot be changed here.")
        version = await session.scalar(select(access_version()).select_from(AuthUser).where(AuthUser.id == account_id))
        if data.version != version:
            raise HTTPException(409, "This account changed. Refresh the directory and review the current access.")
        if data.role == "admin" and not data.active:
            raise HTTPException(422, "Set the account to Active to grant Administrator access.")
        before = {"role": account.role, "active": account.active}
        after = {"role": data.role, "active": data.active}
        if before == after:
            return account_view(account, version)
        account.role, account.active = data.role, data.active
        await session.execute(delete(AuthSession).where(AuthSession.user_id == account.id))
        session.add(ClinicalEvent(
            organization=user.organization, record_type="auth_users", record_id=account.id, version=version + 1,
            action="account_access_changed", actor=str(user.id), source="account_management",
            before=before, after={**after, "username": account.username}, reason=data.reason, transaction_id=uuid4(),
        ))
    return account_view(account, version + 1)


@router.get("/account-audit")
async def account_audit(user: CurrentUser, session: Session, offset: Annotated[int, Query(ge=0)] = 0,
                        username: Annotated[str, Query(max_length=80)] = "",
                        category: Literal["all", "authentication", "account_changes"] = "all"):
    require_roles(user, ("admin",))
    event = ClinicalEvent
    registration = AccountRegistrationRequest
    member = aliased(AuthUser)
    no_group = (literal(None, String()).label("group_name"),
                literal(None, Boolean()).label("previous_member"),
                literal(None, Boolean()).label("member"))
    no_ip = literal(None, String()).label("ip_address")
    changes = select(
        event.id, event.occurred_at, event.actor.label("actor_id"), event.after["username"].as_string().label("username"),
        event.action, event.before["role"].as_string().label("previous_role"), event.after["role"].as_string().label("role"),
        event.before["active"].as_boolean().label("previous_active"), event.after["active"].as_boolean().label("active"),
        event.reason, *no_group, no_ip,
    ).where(event.organization == user.organization, event.record_type == "auth_users", event.action == "account_access_changed")
    applications = select(
        registration.id, registration.reviewed_at, cast(registration.reviewer_id, String), registration.username,
        case((registration.state == "approved", "registration_approved"), else_="registration_rejected"),
        literal(None), registration.role, literal(None),
        case((registration.state == "approved", True), else_=None),
        literal(None), *no_group, no_ip,
    ).where(registration.organization == user.organization, registration.reviewed_at.is_not(None))
    memberships = select(
        event.id, event.occurred_at, event.actor, member.username, event.action,
        literal(None), literal(None), literal(None), literal(None), event.reason, Workgroup.name,
        event.before["member"].as_boolean(), event.after["member"].as_boolean(), no_ip,
    ).select_from(event).join(Workgroup, (Workgroup.id == event.record_id) & (Workgroup.organization == event.organization)).join(
        member, (cast(member.id, String) == event.after["user_id"].as_string()) & (member.organization == event.organization),
    ).where(event.organization == user.organization, event.record_type == "workgroups", event.action == "workgroup_membership_changed")
    authentication = select(
        event.id, event.occurred_at, event.actor.label("actor_id"), event.after["username"].as_string().label("username"),
        event.action, literal(None, String()).label("previous_role"), literal(None, String()).label("role"),
        literal(None, Boolean()).label("previous_active"), literal(None, Boolean()).label("active"),
        event.reason, *no_group, event.after["ip_address"].as_string().label("ip_address"),
    ).where(event.organization == user.organization, event.record_type == "auth_events")
    sources = {
        "all": union_all(changes, applications, memberships, authentication),
        "account_changes": union_all(changes, applications, memberships),
        "authentication": authentication,
    }
    audit = sources[category].subquery()
    query = (select(*audit.c, AuthUser.username.label("actor"))
             .outerjoin(AuthUser, (cast(AuthUser.id, String) == audit.c.actor_id) & (AuthUser.organization == user.organization)))
    if username := username.strip().casefold():
        query = query.where(audit.c.username == username)
    rows = (await session.execute(query.order_by(audit.c.occurred_at.desc(), audit.c.id.desc())
                                  .offset(offset).limit(PAGE_SIZE + 1))).mappings().all()
    return {"rows": [dict(row) for row in rows[:PAGE_SIZE]], "has_more": len(rows) > PAGE_SIZE}
