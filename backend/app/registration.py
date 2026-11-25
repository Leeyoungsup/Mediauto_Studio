"""Institution-admin review of locally submitted registration requests."""

import asyncio
import hmac
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID, uuid4

import bcrypt
from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from app.auth import CurrentUser, DUMMY_HASH, Login, Session, hash_password, password_material, require_roles, same_origin
from app.models import AuthUser, AccountRegistrationRequest

router = APIRouter(prefix="/api/auth", tags=["Account registration"])
StaffRole = Literal["doctor", "labeler", "viewer"]
PAGE_SIZE = 30


class Register(Login):
    model_config = ConfigDict(extra="forbid")
    username: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$")]
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    password: Annotated[str, StringConstraints(min_length=12, max_length=256)]


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["approve", "reject"]
    role: StaffRole | None = None
    code: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[a-fA-F0-9]{20}$")] | None = None


def confirmation_code(key, request_id):
    return hmac.digest(key, b"registration-review:" + request_id.bytes, "sha256").hex()[:20].upper()


def registration_view(row):
    return {field: getattr(row, field) for field in (
        "id", "username", "display_name", "state", "role", "created_at", "reviewed_at", "reviewer_id",
    )}


@router.post("/register", status_code=202)
async def register(data: Register, request: Request, response: Response, session: Session):
    same_origin(request)
    response.headers["Cache-Control"] = "no-store"
    key = request.app.state.auth_key
    username = data.username.casefold()
    provisional_id = uuid4()
    async with request.app.state.registration_slots, session.begin():
        active_admin = await session.scalar(select(AuthUser.id).where(
            AuthUser.organization == data.organization, AuthUser.role == "admin", AuthUser.active.is_(True),
        ).limit(1))
        existing_user = await session.scalar(select(AuthUser.id).where(
            AuthUser.organization == data.organization, AuthUser.username == username,
        ))
        if active_admin and not existing_user:
            existing = await session.scalar(select(AccountRegistrationRequest).where(
                AccountRegistrationRequest.organization == data.organization, AccountRegistrationRequest.username == username,
                AccountRegistrationRequest.state == "pending",
            ))
            if existing:
                matches = await asyncio.to_thread(
                    bcrypt.checkpw, password_material(data.password, key), existing.password_hash.encode(),
                )
                if matches:
                    provisional_id = existing.id
            else:
                password_hash = await asyncio.to_thread(hash_password, data.password, key)
                created = await session.scalar(insert(AccountRegistrationRequest).values(
                    id=provisional_id, organization=data.organization, username=username,
                    display_name=data.display_name, password_hash=password_hash, state="pending",
                ).on_conflict_do_nothing(
                    index_elements=["organization", "username"],
                    index_where=text("state = 'pending'"),
                ).returning(AccountRegistrationRequest.id))
                if not created:
                    # A concurrent identical application can recover the original code.
                    winner = await session.scalar(select(AccountRegistrationRequest).where(
                        AccountRegistrationRequest.organization == data.organization, AccountRegistrationRequest.username == username,
                        AccountRegistrationRequest.state == "pending",
                    ))
                    if winner and await asyncio.to_thread(
                        bcrypt.checkpw, password_material(data.password, key), winner.password_hash.encode(),
                    ):
                        provisional_id = winner.id
        else:
            await asyncio.to_thread(bcrypt.checkpw, password_material(data.password, key), DUMMY_HASH)
    return {"code": confirmation_code(key, provisional_id)}


@router.get("/registration-requests")
async def registrations(user: CurrentUser, session: Session, state: Literal["pending", "reviewed"] = "pending",
                        offset: Annotated[int, Query(ge=0)] = 0):
    require_roles(user, ("admin",))
    rows = (await session.scalars(select(AccountRegistrationRequest).where(
        AccountRegistrationRequest.organization == user.organization,
        AccountRegistrationRequest.state == "pending" if state == "pending" else AccountRegistrationRequest.state != "pending",
    ).order_by(AccountRegistrationRequest.created_at.desc(), AccountRegistrationRequest.id.desc()).offset(offset).limit(PAGE_SIZE + 1))).all()
    return {"rows": [registration_view(row) for row in rows[:PAGE_SIZE]], "has_more": len(rows) > PAGE_SIZE}


@router.post("/registration-requests/{registration_id}/decision")
async def decide(registration_id: UUID, data: Decision, request: Request, user: CurrentUser, session: Session):
    require_roles(user, ("admin",))
    async with session.begin():
        row = await session.scalar(select(AccountRegistrationRequest).where(
            AccountRegistrationRequest.id == registration_id, AccountRegistrationRequest.organization == user.organization,
        ).with_for_update())
        if row is None:
            raise HTTPException(404, "Registration request not found.")
        if row.state != "pending":
            raise HTTPException(409, "This registration request has already been reviewed.")
        if data.action == "approve":
            if not data.role or not data.code or not hmac.compare_digest(
                data.code.upper(), confirmation_code(request.app.state.auth_key, row.id),
            ):
                raise HTTPException(422, "Select a role and enter the applicant’s confirmation code.")
            account_id = await session.scalar(insert(AuthUser).values(
                id=uuid4(), organization=row.organization, username=row.username, display_name=row.display_name,
                role=data.role, password_hash=row.password_hash, active=True,
            ).on_conflict_do_nothing(index_elements=["organization", "username"]).returning(AuthUser.id))
            if not account_id:
                raise HTTPException(409, "That username already has an account in this organization.")
            row.state, row.role = "approved", data.role
        else:
            row.state = "rejected"
        row.password_hash = None
        row.reviewer_id = user.id
        row.reviewed_at = datetime.now(timezone.utc)
    return registration_view(row)
