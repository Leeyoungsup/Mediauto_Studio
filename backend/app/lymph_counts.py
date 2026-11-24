"""Manual, specimen-level lymph node counts with immutable corrections."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import Field
from sqlalchemy import select

from app.auth import CurrentUser, Session, require_roles
from app.case_activity import attempt_id
from app.clinical import ClinicalInput, Reason, add_event
from app.models import LymphNodeCount, Specimen
from app.wsi import PRIVATE, lock_scan_case, registered_file, visible_scan

router = APIRouter(prefix="/api/wsi/clinical/{scan_id}/lymph-node-counts", tags=["Manual lymph node counts"])
COUNT_ROLES = ("admin", "doctor")
NonNegative = Annotated[int, Field(strict=True, ge=0, le=10000)]


class CountInput(ClinicalInput):
    version: Annotated[int, Field(ge=0)]
    positive: NonNegative
    total: NonNegative
    reason: Reason | None = None


def count_history(organization, specimen_id):
    return select(LymphNodeCount).where(
        LymphNodeCount.organization == organization, LymphNodeCount.specimen_id == specimen_id,
    ).order_by(LymphNodeCount.version.desc())


def count_view(row):
    return {"id": str(row.id), "scan_id": str(row.scan_id), "specimen_id": str(row.specimen_id), "version": row.version,
            "positive": row.positive, "total": row.total, "reason": row.reason, "created_at": row.created_at.isoformat()}


@router.get("")
async def read_lymph_counts(scan_id: UUID, response: Response, user: CurrentUser, session: Session):
    require_roles(user, COUNT_ROLES)
    specimen = await session.scalar(visible_scan(user, scan_id, Specimen))
    if specimen is None:
        raise HTTPException(404, "Registered WSI not found.")
    rows = await session.scalars(count_history(user.organization, specimen.id))
    response.headers.update(PRIVATE)
    return {"specimen": specimen.specimen_number, "history": [count_view(row) for row in rows]}


@router.put("")
async def save_lymph_count(scan_id: UUID, data: CountInput, request: Request, user: CurrentUser, session: Session):
    require_roles(user, COUNT_ROLES)
    if data.positive > data.total:
        raise HTTPException(422, "Positive cannot exceed Total.")
    if bool(data.version) != bool(data.reason):
        raise HTTPException(422, "Enter a reason for a correction.")
    await registered_file("clinical", scan_id, user, session)
    session.info["user"] = user
    async with session.begin():
        case_id = await lock_scan_case(session, user, scan_id)
        # Serial stains and scan replacements can share a specimen. Serialize corrections on that specimen.
        specimen = await session.scalar(visible_scan(user, scan_id, Specimen).where(
            Specimen.case_id == case_id,
        ).with_for_update(of=Specimen))
        if specimen is None:
            raise HTTPException(409, "Reload the scan after its specimen changes.")
        current = await session.scalar(count_history(user.organization, specimen.id).limit(1))
        version = current.version if current else 0
        if version != data.version:
            if current and current.version == data.version + 1 and (
                current.positive, current.total, current.reason, current.scan_id, current.created_by
            ) == (data.positive, data.total, data.reason, scan_id, str(user.id)):
                return count_view(current)
            raise HTTPException(409, "The count changed in another session. Reload the count before saving.")
        if current and (current.positive, current.total) == (data.positive, data.total):
            raise HTTPException(422, "Change at least one count to save a correction.")
        row = LymphNodeCount(organization=user.organization, specimen_id=specimen.id, scan_id=scan_id,
                             created_by=str(user.id), version=version + 1, positive=data.positive, total=data.total,
                             reason=data.reason)
        session.add(row)
        await session.flush()
        add_event(session, row, "lymph_node_count_corrected" if current else "lymph_node_count_saved",
                  count_view(current) if current else {}, count_view(row), data.reason, source="viewer", case_id=case_id,
                  transaction_id=attempt_id(request))
        return count_view(row)
