import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from starlette.staticfiles import StaticFiles

from app.database import database_url
from app.intake import router as intake_router
from app.models import ApplicationSetting

logger = logging.getLogger(__name__)
EmrState = Literal["unconfigured", "disabled", "connected", "unavailable", "unknown"]


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["connected", "unavailable"]
    emr: EmrState


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine = create_async_engine(
        database_url(),
        pool_pre_ping=True,
        pool_timeout=3,
        connect_args={"timeout": 3, "command_timeout": 3},
    )
    app.state.engine = engine
    try:
        yield
    finally:
        await engine.dispose()


app = FastAPI(title="Mediauto Studio", lifespan=lifespan)
app.include_router(intake_router)


@app.get("/api/health", responses={503: {"model": Health}})
async def health(request: Request, response: Response) -> Health:
    response.headers["Cache-Control"] = "no-store"
    engine: AsyncEngine = request.app.state.engine
    try:
        async with engine.connect() as connection:
            setting = await connection.scalar(
                select(ApplicationSetting.value).where(ApplicationSetting.key == "emr")
            )
    except (SQLAlchemyError, OSError, TimeoutError) as error:
        logger.warning("Database health query failed (%s)", type(error).__name__)
        response.status_code = 503
        return Health(status="degraded", database="unavailable", emr="unknown")

    state = setting.get("state") if isinstance(setting, dict) else None
    if state not in ("unconfigured", "disabled", "connected", "unavailable"):
        logger.warning("EMR setting is missing or invalid")
        response.status_code = 503
        return Health(status="degraded", database="connected", emr="unknown")

    return Health(status="ok", database="connected", emr=state)


frontend = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if (frontend / "index.html").is_file():
    app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
