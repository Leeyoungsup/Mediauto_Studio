"""Case discussion threads with scoped participant mentions."""

import re
from collections import defaultdict
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import StringConstraints
from sqlalchemy import func, or_, select

from app.clinical import ClinicalInput, Organization, RegistrationKey, Session, add_event, find, write
from app.models import AuthUser, Case, CaseNote
from app.notification_delivery import enqueue

router = APIRouter(prefix="/api/clinical/{organization}/cases/{case_id}/notes", tags=["Case notes"])
AUTHOR_ROLES = ("admin", "doctor", "labeler")
MENTION = re.compile(r"(?<![\w@.+-])@([A-Za-z0-9][A-Za-z0-9._-]{0,79})")
PAGE_SIZE = 20


class NewNote(ClinicalInput):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    parent_id: UUID | None = None


async def participants(session, case):
    return (await session.scalars(select(AuthUser).where(
        AuthUser.organization == case.organization, AuthUser.active.is_(True),
        or_(AuthUser.role.in_(("admin", "labeler")),
            (AuthUser.id == case.assigned_to) & (AuthUser.role == "doctor")),
    ).order_by(AuthUser.username))).all()


def view(row, users):
    author = users.get(row.created_by)
    return {"id": row.id, "parent_id": row.parent_id, "body": row.body,
            "author": author.display_name if author else "Former User",
            "created_at": row.created_at, "mentions": [
                {"id": key, "name": users[key].display_name} for key in row.mentions if key in users
            ]}


@router.get("")
async def notes(organization: Organization, case_id: UUID, session: Session, offset: Annotated[int, Query(ge=0)] = 0):
    case = await find(session, Case, organization, case_id)
    base = select(CaseNote).where(CaseNote.organization == organization, CaseNote.case_id == case_id)
    roots = (await session.scalars(base.where(CaseNote.parent_id.is_(None))
        .order_by(CaseNote.created_at.desc(), CaseNote.id.desc()).offset(offset).limit(PAGE_SIZE + 1))).all()
    roots, has_more = roots[:PAGE_SIZE], len(roots) > PAGE_SIZE
    comments = (await session.scalars(base.where(CaseNote.parent_id.in_([note.id for note in roots]))
        .order_by(CaseNote.created_at, CaseNote.id))).all()
    ids = {key for item in (*roots, *comments) for key in (item.created_by, *item.mentions)}
    users = {str(user.id): user for user in await session.scalars(select(AuthUser).where(
        AuthUser.organization == organization, AuthUser.id.in_([UUID(key) for key in ids]),
    ))}
    replies = defaultdict(list)
    for row in comments:
        replies[row.parent_id].append(view(row, users))
    can_post = session.info["user"].role in AUTHOR_ROLES
    return {"notes": [{**view(row, users), "comments": replies[row.id]} for row in roots],
            "can_post": can_post, "has_more": has_more,
            "participants": [{"id": user.id, "username": user.username, "name": user.display_name}
                             for user in await participants(session, case)] if can_post else []}


@router.post("", status_code=201)
async def post_note(organization: Organization, case_id: UUID, data: NewNote, key: RegistrationKey, session: Session):
    user = session.info["user"]
    async with write(session, AUTHOR_ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        scope = (CaseNote.organization == organization, CaseNote.case_id == case_id)
        existing = await session.scalar(select(CaseNote).where(
            *scope, CaseNote.created_by == str(user.id), CaseNote.request_key == key,
        ))
        if existing is not None:
            if (existing.parent_id, existing.body) != (data.parent_id, data.body):
                raise HTTPException(409, "This submission key was used for a different note or comment.")
            return {"id": existing.id}

        parent = None
        if data.parent_id:
            parent = await session.scalar(select(CaseNote).where(*scope, CaseNote.id == data.parent_id))
            if parent is None or parent.parent_id is not None:
                raise HTTPException(404, "Note not found in this case.")
            count = await session.scalar(select(func.count()).select_from(CaseNote).where(*scope, CaseNote.parent_id == parent.id))
            if count >= 100:
                raise HTTPException(409, "This note already has 100 comments. Start a new note to continue.")

        accounts = await participants(session, case)
        handles = {account.username: account.id for account in accounts}
        mentioned = set()
        for match in MENTION.finditer(data.body):
            # Reject overlong handles instead of resolving a truncated prefix.
            if match.end() < len(data.body) and re.match(r"[A-Za-z0-9_.-]", data.body[match.end()]):
                raise HTTPException(422, "Select an eligible case participant for each mention.")
            name = match[1].casefold()
            identifier = handles.get(name) or handles.get(name.rstrip("."))
            if identifier is None:
                raise HTTPException(422, "Select an eligible case participant for each mention.")
            mentioned.add(identifier)
        if len(mentioned) > 10:
            raise HTTPException(422, "Mention up to ten people in a note or comment.")

        row = CaseNote(organization=organization, case_id=case_id, parent_id=data.parent_id,
                       body=data.body, mentions=sorted(map(str, mentioned)), request_key=key, created_by=str(user.id))
        session.add(row)
        await session.flush()
        action = "comment_created" if parent else "note_created"
        add_event(session, row, action, {}, {"parent_id": str(data.parent_id) if data.parent_id else None,
                                             "mention_count": len(mentioned)}, source="ims")
        if mentioned - {user.id}:
            await enqueue(session, organization=organization, case_id=case_id, event="mention", action="case_mention",
                          recipients={recipient: None for recipient in mentioned - {user.id}}, event_key=f"mention:{row.id}")
        if parent:
            author = UUID(parent.created_by)
            if author in handles.values() and author not in mentioned | {user.id}:
                await enqueue(session, organization=organization, case_id=case_id, event="case_comment",
                              action=action, recipients={author: None}, event_key=f"comment:{row.id}")
        return {"id": row.id}
