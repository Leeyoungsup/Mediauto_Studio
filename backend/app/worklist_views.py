"""Institution-scoped saved views and user-specific Worklist startup settings."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field, StringConstraints, field_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from app.auth import CurrentUser, Session, require_roles
from app.clinical import ClinicalInput
from app.models import WorklistPreference, WorklistView

router = APIRouter(prefix="/api/worklist", tags=["Worklist settings"])
Scope = Literal["all", "mine", "unassigned"]
CaseStatus = Literal["registered", "assigned", "in_review", "reviewed"]
SortField = Literal["created_at", "case_number", "status", "assignee", "slide_count"]
Column = Literal["specimen", "assignee", "status", "slides", "received", "patient", "mrn", "sex", "birth", "age",
                 "slideState", "group", "lis", "storage", "tags", "created", "comments", "requests", "notes"]
Visibility = Literal["private", "shared"]
Version = Annotated[int, Field(ge=1)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class SortTerm(ClinicalInput):
    field: SortField
    direction: Literal["asc", "desc"]


class ColumnSetting(ClinicalInput):
    id: Column
    visible: bool


Columns = Annotated[list[ColumnSetting], Field(max_length=19)]


def ensure_unique(values, attribute):
    if len({getattr(value, attribute) for value in values}) != len(values):
        raise ValueError("Duplicate settings")
    return values


class ViewConfig(ClinicalInput):
    scope: Scope = "all"
    q: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = ""
    status: CaseStatus | None = None
    assigned_to: UUID | None = None
    order: list[SortTerm] = Field(min_length=1, max_length=3)
    columns: Columns | None = None

    @field_validator("order")
    @classmethod
    def unique_order(cls, value):
        return ensure_unique(value, "field")

    @field_validator("columns")
    @classmethod
    def unique_columns(cls, value):
        return ensure_unique(value, "id") if value is not None else value


class ViewDraft(ClinicalInput):
    name: Name
    configuration: ViewConfig


class ViewCreate(ViewDraft):
    visibility: Visibility


class ViewUpdate(ViewDraft):
    version: Version


class PreferenceUpdate(ClinicalInput):
    default_view_id: UUID | None
    columns: Columns | None
    version: int = Field(ge=0)

    @field_validator("columns")
    @classmethod
    def unique_columns(cls, value):
        return ensure_unique(value, "id") if value is not None else value


def readable(user):
    return select(WorklistView).where(WorklistView.organization == user.organization,
        or_(WorklistView.owner_id == user.id, WorklistView.visibility == "shared"))


def can_edit(view, user):
    return user.role == "admin" if view.visibility == "shared" else view.owner_id == user.id


def show(view, user):
    return {"id": view.id, "name": view.name, "visibility": view.visibility, "configuration": view.configuration,
            "version": view.version, "updated_at": view.updated_at, "can_edit": can_edit(view, user)}


async def find_view(session, user, view_id, lock=False):
    query = readable(user).where(WorklistView.id == view_id)
    view = await session.scalar(query.with_for_update() if lock else query)
    if view is None:
        raise HTTPException(404, "Saved view not found.")
    return view


def check_edit(view, user, expected):
    if not can_edit(view, user):
        raise HTTPException(403, "You do not have permission to change shared views.")
    if view.version != expected:
        raise HTTPException(409, "The view changed in another session. Refresh the list.")


@router.get("/views")
async def list_views(user: CurrentUser, session: Session):
    rows = await session.scalars(readable(user).order_by(WorklistView.visibility, WorklistView.name, WorklistView.id))
    return [show(view, user) for view in rows]


@router.post("/views", status_code=201)
async def create_view(data: ViewCreate, user: CurrentUser, session: Session):
    if data.visibility == "shared":
        require_roles(user, ("admin",))
    async with session.begin():
        view = WorklistView(organization=user.organization, owner_id=user.id, version=1,
                            **data.model_dump(mode="json"))
        session.add(view)
        await session.flush()
        return show(view, user)


@router.put("/views/{view_id}")
async def update_view(view_id: UUID, data: ViewUpdate, user: CurrentUser, session: Session):
    async with session.begin():
        view = await find_view(session, user, view_id, lock=True)
        check_edit(view, user, data.version)
        view.name = data.name
        view.configuration = data.configuration.model_dump(mode="json")
        view.version += 1
        view.updated_at = func.now()
        await session.flush()
        await session.refresh(view, ["updated_at"])
        return show(view, user)


@router.delete("/views/{view_id}")
async def delete_view(view_id: UUID, user: CurrentUser, session: Session, version: Annotated[int, Query(ge=1)]):
    async with session.begin():
        view = await find_view(session, user, view_id, lock=True)
        check_edit(view, user, version)
        await session.delete(view)
    return {"ok": True}


def preference_view(preference):
    if preference is None:
        return {"default_view_id": None, "columns": None, "version": 0}
    return {"default_view_id": preference.default_view_id, "columns": preference.columns, "version": preference.version}


@router.get("/preferences")
async def preferences(user: CurrentUser, session: Session):
    return preference_view(await session.get(WorklistPreference, (user.organization, user.id)))


@router.put("/preferences")
async def save_preferences(data: PreferenceUpdate, user: CurrentUser, session: Session):
    async with session.begin():
        if data.default_view_id is not None:
            view = await session.scalar(readable(user).where(WorklistView.id == data.default_view_id)
                                        .with_for_update(read=True, key_share=True))
            if view is None:
                raise HTTPException(404, "The view you selected as a default could not be found.")
        values = {"default_view_id": data.default_view_id, "version": data.version + 1,
                  "columns": [item.model_dump() for item in data.columns] if data.columns is not None else None}
        identity = {"organization": user.organization, "user_id": user.id}
        if data.version == 0:
            statement = insert(WorklistPreference).values(**identity, **values).on_conflict_do_nothing()
        else:
            statement = update(WorklistPreference).filter_by(**identity, version=data.version).values(**values)
        result = await session.scalar(statement.returning(WorklistPreference))
        if result is None:
            raise HTTPException(409, "Default settings changed in another session. Refresh the list.")
        return preference_view(result)
