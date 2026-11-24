import asyncio
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from jose import JWTError, jwt
from pydantic import BaseModel, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuthSession, AuthUser

ROLES = ("admin", "doctor", "labeler", "viewer")
WRITERS = ("admin", "labeler")
COOKIE = "mediauto_session"
ISSUER = "mediauto-studio"
SESSION_SECONDS = 15 * 60
DUMMY_HASH = bcrypt.hashpw(b"nonexistent-account", bcrypt.gensalt(rounds=12))
router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def load_auth_key() -> bytes:
    default = Path(__file__).resolve().parents[2] / ".runtime" / "auth.key"
    path = Path(os.environ.get("MEDIAUTO_AUTH_SECRET_FILE", default))
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
            stream.write(secrets.token_bytes(32))
    except FileExistsError:
        pass
    if path.stat().st_mode & 0o077:
        raise RuntimeError("The auth key must be readable only by its owner")
    key = path.read_bytes()
    if len(key) != 32:
        raise RuntimeError("The auth key must have 32 bytes")
    return key


def password_material(password: str, key: bytes) -> bytes:
    return hmac.digest(key, password.encode(), hashlib.sha256)


def hash_password(password: str, key: bytes) -> str:
    return bcrypt.hashpw(password_material(password, key), bcrypt.gensalt(rounds=12)).decode()


class Login(BaseModel):
    organization: Annotated[str, StringConstraints(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")] = "local"
    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    password: Annotated[str, StringConstraints(min_length=1, max_length=256)]


def user_view(user: AuthUser) -> dict:
    return {"id": str(user.id), "organization": user.organization, "username": user.username,
            "display_name": user.display_name, "role": user.role}


def same_origin(request: Request) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    origin = request.headers.get("origin")
    if origin and origin != f"{request.url.scheme}://{request.url.netloc}":
        raise HTTPException(403, "다른 출처에서 보낸 요청입니다.")


async def session_for(request: Request):
    async with AsyncSession(request.app.state.engine, expire_on_commit=False) as session:
        yield session


Session = Annotated[AsyncSession, Depends(session_for)]


def access_error() -> HTTPException:
    return HTTPException(401, "로그인이 필요합니다.", headers={"WWW-Authenticate": "Bearer", "Cache-Control": "no-store"})


async def current_user(request: Request, response: Response) -> AuthUser:
    same_origin(request)
    response.headers["Cache-Control"] = "no-store"
    scheme, _, bearer = request.headers.get("authorization", "").partition(" ")
    token = bearer if scheme.lower() == "bearer" else request.cookies.get(COOKIE)
    if not token:
        raise access_error()
    try:
        claims = jwt.decode(token, request.app.state.auth_key.hex(), algorithms=["HS256"], issuer=ISSUER,
                            options={"require_exp": True, "require_sub": True, "require_iss": True})
        if claims.get("type") != "access":
            raise ValueError
        user_id, session_id = UUID(claims["sub"]), UUID(claims["jti"])
    except (JWTError, ValueError, KeyError, TypeError) as exc:
        raise access_error() from exc
    async with AsyncSession(request.app.state.engine, expire_on_commit=False) as session:
        user = await session.scalar(select(AuthUser).join(AuthSession, AuthSession.user_id == AuthUser.id).where(
            AuthUser.id == user_id, AuthUser.active.is_(True), AuthSession.id == session_id,
            AuthSession.expires_at > datetime.now(timezone.utc),
        ))
    if not user:
        raise access_error()
    request.state.auth_session_id = session_id
    return user


CurrentUser = Annotated[AuthUser, Depends(current_user)]


def require_organization(user: AuthUser, organization: str) -> None:
    if user.organization != organization:
        raise HTTPException(403, "이 기관에 대한 권한이 없습니다.")


def require_roles(user: AuthUser, roles: tuple[str, ...]) -> None:
    if user.role not in roles:
        raise HTTPException(403, "이 작업에 대한 권한이 없습니다.")


@router.post("/login")
async def login(data: Login, request: Request, response: Response, session: Session):
    same_origin(request)
    response.headers["Cache-Control"] = "no-store"
    key = request.app.state.auth_key
    now = datetime.now(timezone.utc)
    identity = None
    async with session.begin():
        user = await session.scalar(select(AuthUser).where(
            AuthUser.organization == data.organization, AuthUser.username == data.username.casefold(),
        ).with_for_update())
        locked = bool(user and user.locked_until and user.locked_until > now)
        hash_value = user.password_hash.encode() if user and user.active and not locked else DUMMY_HASH
        matches = await asyncio.to_thread(bcrypt.checkpw, password_material(data.password, key), hash_value)
        if user and user.active and not locked:
            if user.locked_until:
                user.locked_until, user.failed_attempts = None, 0
            if matches:
                user.failed_attempts = 0
                expires = now + timedelta(seconds=SESSION_SECONDS)
                session_id = uuid4()
                await session.execute(delete(AuthSession).where(AuthSession.expires_at <= now))
                session.add(AuthSession(id=session_id, user_id=user.id, expires_at=expires))
                token = jwt.encode({
                    "sub": str(user.id), "role": user.role, "type": "access", "jti": str(session_id),
                    "iss": ISSUER, "iat": now, "exp": expires,
                }, key.hex(), algorithm="HS256")
                identity = user_view(user)
            else:
                user.failed_attempts += 1
                if user.failed_attempts >= 5:
                    user.locked_until = now + timedelta(minutes=30)
    if identity is None:
        raise HTTPException(401, "계정 또는 비밀번호를 확인하세요.", headers={"Cache-Control": "no-store"})
    response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, samesite="strict",
                        secure=os.environ.get("MEDIAUTO_COOKIE_SECURE") == "1")
    return identity


@router.get("/me")
async def me(user: CurrentUser):
    return user_view(user)


@router.post("/logout")
async def logout(user: CurrentUser, request: Request, response: Response, session: Session):
    async with session.begin():
        await session.execute(delete(AuthSession).where(AuthSession.id == request.state.auth_session_id))
    response.delete_cookie(COOKIE)
    return {"ok": True}
