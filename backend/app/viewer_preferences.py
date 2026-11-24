"""Per-user viewer defaults, independent of case and Worklist records."""

from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert

from app.auth import CurrentUser, Session
from app.models import ViewerPreference

router = APIRouter(prefix="/api/viewer/preferences", tags=["Viewer preferences"])


class ViewerSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tray_orientation: Literal["vertical", "horizontal"] = "vertical"
    tray_visible: bool = True
    gallery: bool = False
    show_label: bool = False
    show_overview: bool = False
    show_minimap: bool = True
    dynamic_minimap: bool = False
    shortcuts: bool = True
    autopan_speed: Literal[60, 120, 240] = 120
    autopan_direction: Literal["right", "left", "down", "up"] = "right"


class ViewerPreferenceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Annotated[int, Field(ge=0)]
    settings: ViewerSettings


def preference(record):
    return ViewerPreferenceUpdate(
        version=record.version if record else 0,
        settings=ViewerSettings.model_validate(record.settings) if record else ViewerSettings(),
    )


@router.get("")
async def get_preferences(user: CurrentUser, session: Session):
    return preference(await session.get(ViewerPreference, (user.organization, user.id)))


@router.put("")
async def save_preferences(data: ViewerPreferenceUpdate, user: CurrentUser, session: Session):
    identity = {"organization": user.organization, "user_id": user.id}
    values = {"settings": data.settings.model_dump(), "version": data.version + 1}
    if data.version == 0:
        statement = insert(ViewerPreference).values(**identity, **values).on_conflict_do_nothing()
    else:
        statement = update(ViewerPreference).filter_by(**identity, version=data.version).values(**values)
    async with session.begin():
        saved = await session.scalar(statement.returning(ViewerPreference))
        if saved is None:
            raise HTTPException(409, "Viewer settings changed in another session. Reload your saved settings.")
        return preference(saved)
