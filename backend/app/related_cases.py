"""Explicit, revocable correlations between Pap and tissue-biopsy cases."""

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import Field, StrictBool
from sqlalchemy import String, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.auth import require_roles
from app.case_activity import record_activity
from app.clinical import ClinicalInput, Organization, Reason, Session, add_event, case_visibility, find
from app.models import AuthUser, Case, RelatedCaseLink, Slide, SlideScan, Specimen
from app.prostate_results import DIGEST
from app.scan_quality import BLOCKED_QC
from app.wsi import PRIVATE, STAGE_DOWNSAMPLES, ScanViewEvent, scan_response, verified_scan_path

router = APIRouter(prefix="/api/clinical/{organization}", tags=["Related Pap and Biopsy Cases"])
ROLES = ("admin", "doctor")
LINK = RelatedCaseLink
Side = Literal["pap", "biopsy"]
PAP_STAINS = ("pap", "papanicolaou", "papsmear", "papanicolaoustain")
HE_STAINS = ("he", "hematoxylinandeosin")


class ReviewedScan(ClinicalInput):
    case_id: UUID
    specimen_id: UUID
    scan_id: UUID
    token: DIGEST


class Confirm(ClinicalInput):
    source: ReviewedScan
    target: ReviewedScan
    patient_confirmed: StrictBool
    biopsy_confirmed: StrictBool
    reason: Reason
    request_key: UUID


class Revoke(ClinicalInput):
    expected_version: Annotated[int, Field(strict=True, ge=1)]
    reason: Reason


def stain_kind(stain):
    normalized = re.sub(r"[^a-z]", "", (stain or "").lower())
    if normalized in PAP_STAINS:
        return "pap"
    if normalized in HE_STAINS:
        return "he"
    return None


def same_patient(left, right):
    return left.id != right.id and left.patient_id is not None and left.patient_id == right.patient_id


def scope_links(cases):
    return (LINK.pap_case_id.in_(cases), LINK.biopsy_case_id.in_(cases))


def visible_cases(organization, user):
    return select(Case.id).where(Case.organization == organization, case_visibility(Case, user))


def query_cases(organization, user, *ids):
    return select(Case).where(Case.organization == organization, Case.id.in_(ids), case_visibility(Case, user)).order_by(Case.id)


async def paired_cases(session, organization, user, first, second, lock=False):
    query = query_cases(organization, user, first, second)
    rows = (await session.scalars(query.with_for_update() if lock else query)).all()
    if len(rows) != 2:
        raise HTTPException(404, "The case pair is unavailable.")
    return {item.id: item for item in rows}


def scan_rows(organization, case_filter):
    return select(SlideScan, Slide, Specimen, Case.case_number, Case.version).select_from(SlideScan).join(
        Slide, (Slide.id == SlideScan.slide_id) & (Slide.organization == SlideScan.organization)).join(
        Specimen, (Specimen.id == Slide.specimen_id) & (Specimen.organization == Slide.organization)).join(
        Case, (Case.id == Specimen.case_id) & (Case.organization == Specimen.organization)).where(
        SlideScan.organization == organization, case_filter)


def scan_option(row):
    scan, slide, specimen, case_number, version = row
    token = hashlib.sha256(f"{version}:{specimen.version}:{slide.version}:{scan.version}:{scan.id}".encode()).hexdigest()
    return {"id": str(scan.id), "case_id": str(specimen.case_id), "case_number": case_number,
            "specimen_id": str(specimen.id), "specimen_number": specimen.specimen_number,
            "label": slide.slide_number, "stain": slide.stain, "type": stain_kind(slide.stain),
            "format": scan.format, "token": token}


def ordered_pair(link):
    return ((link.pap_case_id, link.pap_specimen_id, link.pap_scan_id, "pap"),
            (link.biopsy_case_id, link.biopsy_specimen_id, link.biopsy_scan_id, "he"))


async def matching_scans(session, organization, pairs, lock=False):
    ids = [item[2] for item in pairs]
    query = scan_rows(organization, SlideScan.id.in_(ids)).order_by(SlideScan.id)
    if lock:
        query = query.with_for_update(read=True, of=(SlideScan, Slide, Specimen))
    found = {row[0].id: row for row in (await session.execute(query)).all()}
    rows = {}
    for case_id, specimen_id, scan_id, kind in pairs:
        row = found.get(scan_id)
        if (row is None or row[2].case_id != case_id or row[2].id != specimen_id
                or row[0].qc_status in BLOCKED_QC or stain_kind(row[1].stain) != kind):
            raise HTTPException(409, "The selected specimen or scan binding is no longer valid.")
        rows[scan_id] = row
    return rows


def link_view(link, cases, names, available):
    return {
        "id": link.id, "version": link.version, "status": "revoked" if link.revoked_at else "confirmed" if available else "unavailable",
        "pap": {"case_id": link.pap_case_id, "case_number": cases[link.pap_case_id].case_number,
                "specimen_id": link.pap_specimen_id, "scan_id": link.pap_scan_id},
        "biopsy": {"case_id": link.biopsy_case_id, "case_number": cases[link.biopsy_case_id].case_number,
                   "specimen_id": link.biopsy_specimen_id, "scan_id": link.biopsy_scan_id},
        "reason": link.reason, "approved_at": link.created_at, "approved_by": names.get(link.created_by, link.created_by),
        "revoked_at": link.revoked_at, "revoked_by": names.get(link.revoked_by, link.revoked_by),
        "revoke_reason": link.revoke_reason,
    }


@router.get("/cases/{case_id}/related-cases")
async def related_cases(organization: Organization, case_id: UUID, session: Session, response: Response,
                        q: Annotated[str, Query(max_length=80)] = ""):
    user = session.info["user"]
    require_roles(user, ROLES)
    response.headers.update(PRIVATE)
    source = await find(session, Case, organization, case_id)
    visible = visible_cases(organization, user)
    links = (await session.scalars(select(LINK).where(
        LINK.organization == organization, or_(LINK.pap_case_id == case_id, LINK.biopsy_case_id == case_id),
        *scope_links(visible)).order_by(LINK.created_at.desc(), LINK.id).limit(100))).all()
    ids = {item for row in links for item in (row.pap_case_id, row.biopsy_case_id)}
    cases = {row.id: row for row in (await session.scalars(query_cases(organization, user, *ids))).all()}
    actors = {key for row in links for key in (row.created_by, row.revoked_by) if key}
    names = dict((await session.execute(select(AuthUser.id.cast(String), AuthUser.display_name).where(
        AuthUser.organization == organization, AuthUser.id.in_([UUID(actor) for actor in actors])))).all()) if actors else {}
    history = []
    for link in links:
        if link.pap_case_id not in cases or link.biopsy_case_id not in cases:
            continue
        left, right = cases[link.pap_case_id], cases[link.biopsy_case_id]
        available = not link.revoked_at and same_patient(left, right) and link.patient_id == left.patient_id
        if available:
            try:
                await matching_scans(session, organization, ordered_pair(link))
            except HTTPException:
                available = False
        history.append(link_view(link, cases, names, available))
    if not source.patient_id:
        return {"status": "patient_required", "sources": [], "candidates": [], "links": history}
    supported_stain = func.regexp_replace(func.lower(func.coalesce(Slide.stain, "")), "[^a-z]", "", "g").in_(PAP_STAINS + HE_STAINS)
    current = (await session.execute(scan_rows(organization, Case.id == source.id).where(
        SlideScan.qc_status.not_in(BLOCKED_QC), supported_stain).order_by(Specimen.specimen_number, Slide.slide_number, SlideScan.id))).all()
    entries = [scan_option(row) for row in current if stain_kind(row[1].stain)]
    statement = scan_rows(organization, (Case.id != source.id) & Case.id.in_(visible) & (Case.patient_id == source.patient_id))
    if q.strip():
        statement = statement.where(Case.case_number.icontains(q.strip(), autoescape=True))
    rows = (await session.execute(statement.where(SlideScan.qc_status.not_in(BLOCKED_QC), supported_stain)
                                  .order_by(Case.case_number, Specimen.specimen_number, Slide.slide_number, SlideScan.id)
                                  .limit(100))).all()
    candidates = [scan_option(row) for row in rows]
    return {"status": "available", "sources": entries, "candidates": candidates, "links": history}


@router.post("/cases/{case_id}/related-cases", status_code=201)
async def confirm_related_case(organization: Organization, case_id: UUID, payload: Confirm, session: Session, response: Response):
    user = session.info["user"]
    require_roles(user, ROLES)
    response.headers.update(PRIVATE)
    source, target = payload.source, payload.target
    if source.case_id != case_id or source.case_id == target.case_id or source.scan_id == target.scan_id:
        raise HTTPException(422, "Choose two distinct cases and their scans.")
    if not payload.patient_confirmed or not payload.biopsy_confirmed:
        raise HTTPException(422, "Confirm the patient identity and the selected tissue biopsy specimen.")
    both = await paired_cases(session, organization, user, source.case_id, target.case_id, lock=True)
    first, second = both[source.case_id], both[target.case_id]
    if not same_patient(first, second):
        raise HTTPException(409, "The cases are not linked to the same patient.")
    signature = hashlib.sha256(json.dumps(payload.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()
    existing = await session.scalar(select(LINK).where(LINK.organization == organization,
        LINK.created_by == str(user.id), LINK.request_key == payload.request_key))
    if existing:
        if existing.request_hash != signature:
            raise HTTPException(409, "This comparison request key is already in use.")
        return {"id": existing.id, "version": existing.version}
    scan_ids = (source.scan_id, target.scan_id)
    found = {row[0].id: row for row in (await session.execute(
        scan_rows(organization, SlideScan.id.in_(scan_ids)).order_by(SlideScan.id).with_for_update(read=True, of=(SlideScan, Slide, Specimen))
    )).all()}
    if not all(item.scan_id in found for item in (source, target)):
        raise HTTPException(404, "One selected scan is unavailable.")
    rows = [found[item.scan_id] for item in (source, target)]
    for item, row in zip((source, target), rows):
        if row[2].case_id != item.case_id or row[2].id != item.specimen_id or row[0].qc_status in BLOCKED_QC or scan_option(row)["token"] != item.token:
            raise HTTPException(409, "A selected case, specimen or scan changed. Reload and reconcile again.")
        await verified_scan_path(row[0].storage_key, (row[0].size_bytes, row[0].modified_ns))
    kinds = [stain_kind(row[1].stain) for row in rows]
    if set(kinds) != {"pap", "he"}:
        raise HTTPException(422, "Select one Papanicolaou scan and one H&E scan from a verified tissue biopsy.")
    pap, biopsy = (source, target) if kinds[0] == "pap" else (target, source)
    previous = await session.scalar(select(LINK).where(LINK.organization == organization, LINK.pap_scan_id == pap.scan_id,
                                                       LINK.biopsy_scan_id == biopsy.scan_id, LINK.revoked_at.is_(None)))
    if previous:
        raise HTTPException(409, "These scans already have a confirmed link.")
    item = LINK(id=uuid4(), organization=organization, patient_id=first.patient_id,
                pap_case_id=pap.case_id, pap_specimen_id=pap.specimen_id, pap_scan_id=pap.scan_id,
                biopsy_case_id=biopsy.case_id, biopsy_specimen_id=biopsy.specimen_id, biopsy_scan_id=biopsy.scan_id,
                version=1, reason=payload.reason, request_key=payload.request_key, request_hash=signature, created_by=str(user.id))
    session.add(item)
    add_event(session, item, "related_case_confirmed", {},
              {"status": "confirmed", "patient_confirmed": True, "biopsy_confirmed": True},
              payload.reason, case_id=item.pap_case_id)
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(409, "The relationship or request key is already in use.") from error
    return {"id": item.id, "version": item.version}


async def load_link(session, organization, user, link_id, active=True):
    require_roles(user, ROLES)
    link = await session.scalar(select(LINK).where(LINK.organization == organization, LINK.id == link_id))
    if link is None:
        raise HTTPException(404, "Related comparison unavailable.")
    cases = await paired_cases(session, organization, user, link.pap_case_id, link.biopsy_case_id)
    if active and (link.revoked_at or not same_patient(*cases.values()) or any(item.patient_id != link.patient_id for item in cases.values())):
        raise HTTPException(409, "This comparison is no longer linked to a confirmed patient match.")
    return link, cases


@router.post("/related-comparisons/{link_id}/revoke")
async def revoke_comparison(organization: Organization, link_id: UUID, payload: Revoke, session: Session, response: Response):
    user = session.info["user"]
    response.headers.update(PRIVATE)
    link, _ = await load_link(session, organization, user, link_id, active=False)
    await paired_cases(session, organization, user, link.pap_case_id, link.biopsy_case_id, lock=True)
    link = await session.scalar(select(LINK).where(LINK.id == link_id).with_for_update().execution_options(populate_existing=True))
    if link.revoked_at and link.revoked_by == str(user.id) and link.revoke_reason == payload.reason:
        return {"version": link.version}
    if link.revoked_at or link.version != payload.expected_version:
        raise HTTPException(409, "The relationship changed. Reload before unlinking.")
    link.revoked_by, link.revoked_at, link.revoke_reason = str(user.id), datetime.now(timezone.utc), payload.reason
    link.version += 1
    add_event(session, link, "related_case_revoked", {"status": "confirmed"}, {"status": "revoked"}, payload.reason, case_id=link.pap_case_id)
    await session.commit()
    return {"version": link.version}


@router.get("/related-comparisons/{link_id}")
async def comparison(organization: Organization, link_id: UUID, session: Session, response: Response):
    response.headers.update(PRIVATE)
    link, _ = await load_link(session, organization, session.info["user"], link_id)
    rows = await matching_scans(session, organization, ordered_pair(link))
    return {"id": link.id, "pap": scan_option(rows[link.pap_scan_id]), "biopsy": scan_option(rows[link.biopsy_scan_id])}


async def compare_path(session, organization, link_id, side):
    link, _ = await load_link(session, organization, session.info["user"], link_id)
    rows = await matching_scans(session, organization, ordered_pair(link))
    scan = rows[link.pap_scan_id if side == "pap" else link.biopsy_scan_id][0]
    path, _ = await verified_scan_path(scan.storage_key, (scan.size_bytes, scan.modified_ns))
    await session.rollback()
    return path


@router.get("/related-comparisons/{link_id}/wsi/{side}")
async def compare_metadata(organization: Organization, link_id: UUID, side: Side, session: Session,
                           request: Request, response: Response):
    response.headers.update(PRIVATE)
    return await scan_response(request, await compare_path(session, organization, link_id, side), "metadata")


@router.get("/related-comparisons/{link_id}/wsi/{side}/overview.jpeg")
async def compare_overview(organization: Organization, link_id: UUID, side: Side, session: Session, request: Request,
                           size: Annotated[int, Query(ge=64, le=960)] = 960):
    return await scan_response(request, await compare_path(session, organization, link_id, side), "overview", size)


@router.get("/related-comparisons/{link_id}/wsi/{side}/{stage}/{x}/{y}.jpeg")
async def compare_tile(organization: Organization, link_id: UUID, side: Side, stage: int, x: int, y: int,
                       session: Session, request: Request):
    if not 0 <= stage < len(STAGE_DOWNSAMPLES) or min(x, y) < 0:
        raise HTTPException(400, "Check the tile coordinates.")
    return await scan_response(request, await compare_path(session, organization, link_id, side), "tile", (stage, x, y))


@router.post("/related-comparisons/{link_id}/wsi/{side}/view-events", status_code=204)
async def compare_view_event(organization: Organization, link_id: UUID, side: Side, data: ScanViewEvent,
                             session: Session):
    user = session.info["user"]
    link, _ = await load_link(session, organization, user, link_id)
    await matching_scans(session, organization, ordered_pair(link))
    case, scan = ((link.pap_case_id, link.pap_scan_id) if side == "pap" else (link.biopsy_case_id, link.biopsy_scan_id))
    await record_activity(session, user, case, "scan_viewed", "scan", scan, data.attempt_id, data.result)
    await session.commit()
