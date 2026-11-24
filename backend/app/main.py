import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from starlette.staticfiles import StaticFiles

from app.auth import load_auth_key, router as auth_router
from app.case_editor import router as case_editor_router
from app.case_requests import router as case_requests_router
from app.clinical import router as clinical_router
from app.database import database_url
from app.intake import router as intake_router
from app.integration import router as integration_router
from app.integration_service import poll_inbox
from app.patient_history import router as patient_history_router
from app.pdl1 import router as pdl1_router
from app.models import ApplicationSetting, IntegrationConnection
from app.viewer_records import router as viewer_records_router
from app.worklist import router as worklist_router
from app.worklist_views import router as worklist_views_router
from app.workflow import router as workflow_router
from app.workgroups import router as workgroups_router
from app.viewer_preferences import router as viewer_preferences_router
from app.wsi import router as wsi_router

logger = logging.getLogger(__name__)
EmrState = Literal["unconfigured", "disabled", "connected", "unavailable", "unknown"]


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["connected", "unavailable"]
    emr: EmrState
    emr_mode: Literal["mock", "disabled", "not_configured"] | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.auth_key = load_auth_key()
    app.state.wsi_slots = asyncio.Semaphore(4)
    engine = create_async_engine(
        database_url(),
        pool_pre_ping=True,
        pool_timeout=3,
        connect_args={"timeout": 3, "command_timeout": 3},
    )
    app.state.engine = engine
    inbox = asyncio.create_task(poll_inbox(engine))
    try:
        yield
    finally:
        inbox.cancel()
        with suppress(asyncio.CancelledError):
            await inbox
        await engine.dispose()


app = FastAPI(title="Mediauto Studio", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(case_editor_router)
app.include_router(case_requests_router)
app.include_router(clinical_router)
app.include_router(workflow_router)
app.include_router(intake_router)
app.include_router(integration_router)
app.include_router(worklist_views_router)
app.include_router(workgroups_router)
app.include_router(worklist_router)
app.include_router(wsi_router)
app.include_router(viewer_records_router)
app.include_router(viewer_preferences_router)
app.include_router(pdl1_router)
app.include_router(patient_history_router)


@app.get("/api/health", responses={503: {"model": Health}})
async def health(request: Request, response: Response) -> Health:
    response.headers["Cache-Control"] = "no-store"
    engine: AsyncEngine = request.app.state.engine
    try:
        async with engine.connect() as connection:
            integration = (await connection.execute(select(IntegrationConnection.state, IntegrationConnection.mode)
                .where(IntegrationConnection.organization == "local", IntegrationConnection.channel == "emr"))).one_or_none()
            setting = None if integration else await connection.scalar(
                select(ApplicationSetting.value).where(ApplicationSetting.key == "emr")
            )
    except (SQLAlchemyError, OSError, TimeoutError) as error:
        logger.warning("Database health query failed (%s)", type(error).__name__)
        response.status_code = 503
        return Health(status="degraded", database="unavailable", emr="unknown")

    if integration:
        state, mode = integration
        public = {"not_configured": "unconfigured", "configured": "unconfigured",
                  "connected": "connected", "degraded": "unavailable", "disabled": "disabled"}
        return Health(status="ok", database="connected", emr=public.get(state, "unknown"), emr_mode=mode)
    state = setting.get("state") if isinstance(setting, dict) else None
    if state not in ("unconfigured", "disabled", "connected", "unavailable"):
        logger.warning("EMR setting is missing or invalid")
        response.status_code = 503
        return Health(status="degraded", database="connected", emr="unknown")

    return Health(status="ok", database="connected", emr=state)


frontend = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if (frontend / "index.html").is_file():
    app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
