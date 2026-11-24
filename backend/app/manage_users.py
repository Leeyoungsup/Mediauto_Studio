import argparse
import asyncio
import getpass
import os
import re
import secrets
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.auth import ROLES, hash_password, load_auth_key
from app.database import database_url
from app.models import AuthUser


async def create_user(options):
    engine = create_async_engine(database_url())
    try:
        async with AsyncSession(engine) as session, session.begin():
            username = options.username.casefold()
            exists = await session.scalar(select(AuthUser.id).where(
                AuthUser.organization == options.organization, AuthUser.username == username,
            ))
            if exists:
                raise SystemExit("Account already exists")
            if options.generate_to:
                destination = Path(options.generate_to)
                if destination.exists():
                    raise SystemExit("Password file already exists")
                password = secrets.token_urlsafe(24)
            else:
                password = getpass.getpass("Password: ")
                if password != getpass.getpass("Confirm password: "):
                    raise SystemExit("Passwords do not match")
            if not 12 <= len(password) <= 256:
                raise SystemExit("Use 12–256 characters")
            session.add(AuthUser(organization=options.organization, username=username,
                                 display_name=options.display_name, role=options.role,
                                 password_hash=hash_password(password, load_auth_key())))
            await session.flush()
            if options.generate_to:
                with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
                    stream.write(password + "\n")
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--organization", default="local")
    parser.add_argument("--username", required=True)
    parser.add_argument("--display-name", required=True)
    parser.add_argument("--role", choices=ROLES, required=True)
    parser.add_argument("--generate-to")
    options = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}", options.organization):
        parser.error("Invalid organization code")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}", options.username):
        parser.error("Invalid username")
    if not options.display_name.strip() or len(options.display_name) > 120:
        parser.error("Invalid display name")
    asyncio.run(create_user(options))


if __name__ == "__main__":
    main()
