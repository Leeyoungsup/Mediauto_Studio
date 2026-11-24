"""Publish organization terminology and record immutable specimen-level Pap reviews."""

import hashlib
import json
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import String, func, select
from sqlalchemy.orm import aliased

from app.auth import CurrentUser, Session as DatabaseSession, require_roles
from app.clinical import Organization, Session, add_event
from app.intake import source_id
from app.models import AuthUser, Case, PapReviewPolicy, PapReviewRevision, SlideScan, Specimen
from app.pap_gallery import scan_binding
from app.pap_review_policy import (FORM, PRIMARY, TRANSITIONS, PolicyInput, ReviewInput, Terminology, checked_findings,
                                   eligible_actions)
from app.scan_quality import BLOCKED_QC
from app.wsi import PRIVATE, lock_scan_case, registered_file, verified_scan_path, visible_scan

router = APIRouter(tags=["Pap Review"])
Policy = PapReviewPolicy
Revision = PapReviewRevision


async def lock_policy(session, organization, *, shared):
    # Policy publication is serialized with authorization of in-flight reviews.
    key = func.hashtextextended("pap-review-policy:" + organization, 0)
    lock = func.pg_advisory_xact_lock_shared if shared else func.pg_advisory_xact_lock
    await session.execute(select(lock(key)))


async def active_policy(session, organization):
    return await session.scalar(select(Policy).where(Policy.organization == organization)
                                .order_by(Policy.version.desc()).limit(1))


def policy_view(policy):
    return {"id": policy.id, "version": policy.version, "name": policy.name, "terms": policy.terms}


def admin_policy_view(policy):
    return {**policy_view(policy), "permissions": policy.permissions, "reason": policy.reason,
            "created_at": policy.created_at, "created_by": policy.created_by}


@router.get("/api/clinical/{organization}/pap-policy")
async def settings(organization: Organization, session: Session, response: Response):
    require_roles(session.info["user"], ("admin",))
    response.headers.update(PRIVATE)
    policies = (await session.scalars(select(Policy).where(Policy.organization == organization)
                                     .order_by(Policy.version.desc()))).all()
    users = (await session.scalars(select(AuthUser).where(AuthUser.organization == organization,
        AuthUser.active.is_(True), AuthUser.role.in_(("doctor", "labeler")))
        .order_by(AuthUser.display_name, AuthUser.username))).all()
    return {"policies": [admin_policy_view(policy) for policy in policies],
            "users": [{"id": user.id, "name": user.display_name, "role": user.role} for user in users]}


@router.post("/api/clinical/{organization}/pap-policy", status_code=201)
async def publish(organization: Organization, payload: PolicyInput, session: Session, response: Response):
    user = session.info["user"]
    require_roles(user, ("admin",))
    response.headers.update(PRIVATE)
    await lock_policy(session, organization, shared=False)
    former = await active_policy(session, organization)
    if (former.version if former else 0) != payload.version:
        raise HTTPException(409, "The Pap policy changed. Reload it before publishing.")
    requested = payload.permissions
    reviewers = dict((await session.execute(select(AuthUser.id, AuthUser.role).where(
        AuthUser.organization == organization, AuthUser.active.is_(True),
        AuthUser.id.in_(set(requested.primary_reviewers + requested.followup_reviewers))))).all())
    if (any(reviewers.get(account) not in ("doctor", "labeler") for account in requested.primary_reviewers)
            or any(reviewers.get(account) != "doctor" for account in requested.followup_reviewers)):
        raise HTTPException(422, "Use active institution screening accounts for primary review and physicians for follow-up review.")
    terms = payload.terms.model_dump(mode="json")
    permissions = requested.model_dump(mode="json")
    created = Policy(id=uuid4(), organization=organization, created_by=str(user.id), version=payload.version + 1,
                     name=payload.name, terms=terms, permissions=permissions, reason=payload.reason)
    session.add(created)
    await session.flush()
    add_event(session, created, "pap_policy_published", {"version": payload.version}, {"version": created.version},
              reason=payload.reason, source="ims")
    result = admin_policy_view(created)
    await session.commit()
    return result


def reviews(user, binding):
    return select(Revision).where(Revision.organization == user.organization, Revision.case_id == binding.case_id,
                                  Revision.specimen_id == binding.specimen_id)


async def latest_primary(session, query):
    return await session.scalar(query.where(Revision.action == "submit_primary").order_by(Revision.version.desc()).limit(1))


async def pinned_policy(session, organization, current, latest):
    if current is None:
        return latest
    return await session.scalar(select(Policy).where(Policy.organization == organization, Policy.id == current.terminology_id))


async def history(session, query, before):
    # Review timestamps and actor identities are independent of the currently active policy.
    vocabulary, rule = aliased(Policy), aliased(Policy)
    columns = query.with_only_columns(
        Revision.id, Revision.version, Revision.scan_id, Revision.action, Revision.status, Revision.findings,
        Revision.reason, Revision.created_at, Revision.created_by,
        AuthUser.display_name.label("author"), vocabulary.version.label("terminology_version"), rule.version.label("policy_version"),
    ).outerjoin(AuthUser, (AuthUser.organization == Revision.organization) & (AuthUser.id.cast(String) == Revision.created_by)).join(
        vocabulary, (vocabulary.id == Revision.terminology_id) & (vocabulary.organization == Revision.organization)).join(
        rule, (rule.id == Revision.policy_id) & (rule.organization == Revision.organization))
    if before:
        columns = columns.where(Revision.version < before)
    rows = [dict(row) for row in (await session.execute(columns.order_by(Revision.version.desc()).limit(31))).mappings()]
    return rows[:30], rows[29]["version"] if len(rows) > 30 else None


@router.get("/api/wsi/clinical/{scan_id}/pap-review")
async def read_review(scan_id: UUID, response: Response, user: CurrentUser, session: DatabaseSession, before: Annotated[int, Query(ge=1)] | None = None):
    response.headers.update(PRIVATE)
    await registered_file("clinical", scan_id, user, session)
    binding = await scan_binding(session, user, scan_id)
    if binding is None:
        return {"availability": "stain_unverified", "actions": [], "history": []}
    policy = await active_policy(session, user.organization)
    query = reviews(user, binding)
    current = await session.scalar(query.order_by(Revision.version.desc()).limit(1))
    terminology = await pinned_policy(session, user.organization, current, policy)
    primary = await latest_primary(session, query)
    status = current.status if current else "not_started"
    rows, next_cursor = await history(session, query, before)
    return {"availability": "available" if terminology else "not_configured",
            "version": current.version if current else 0, "status": status, "scope": "specimen",
            "terminology": policy_view(terminology) if terminology else None,
            "active_policy_version": policy.version if policy else None, "history": rows, "next_before": next_cursor,
            "primary": {"version": primary.version, "findings": primary.findings} if primary else None,
            "draft": current.findings if status in ("primary_draft", "followup_draft") else None,
            "actions": eligible_actions(status, user, policy, primary.created_by if primary else None)}


@router.post("/api/wsi/clinical/{scan_id}/pap-review/revisions")
async def save_review(scan_id: UUID, payload: ReviewInput, response: Response, user: CurrentUser, session: DatabaseSession):
    response.headers.update(PRIVATE)
    path, fingerprint = await registered_file("clinical", scan_id, user, session)
    case_id = await lock_scan_case(session, user, scan_id)
    # Lock the specimen for all serial Pap slides before reading/writing history.
    binding = await scan_binding(session, user, scan_id, case_id, lock_specimen=True)
    if binding is None:
        raise HTTPException(422, "Pap review requires a registered Papanicolaou scan.")
    scan = await session.scalar(visible_scan(user, scan_id, SlideScan).where(Case.id == case_id)
                                .with_for_update(read=True, of=SlideScan))
    if scan is None or scan.qc_status in BLOCKED_QC:
        raise HTTPException(409, "The registered Pap scan changed.")
    validated, meta = await verified_scan_path(scan.storage_key, (scan.size_bytes, scan.modified_ns))
    if validated != path or UUID(source_id(meta["storage_key"], meta["size_bytes"], meta["modified_ns"])) != fingerprint:
        raise HTTPException(409, "The registered Pap scan changed.")
    await lock_policy(session, user.organization, shared=True)
    policy = await active_policy(session, user.organization)
    query = reviews(user, binding)
    primary = await latest_primary(session, query)
    actor = str(user.id)
    # Validate active stage permissions even when retrying a previously successful request.
    if not eligible_actions("primary_draft" if payload.action in PRIMARY else "followup_draft",
                            user, policy, primary.created_by if primary else None):
        raise HTTPException(403, "You are not an authorized reviewer for this stage.")
    key = hashlib.sha256(json.dumps(payload.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()
    old = await session.scalar(query.where(Revision.created_by == actor, Revision.request_key == payload.request_key))
    if old:
        if old.request_hash != key:
            raise HTTPException(409, "This Pap request key is already in use.")
        return {"version": old.version, "status": old.status}
    current = await session.scalar(query.order_by(Revision.version.desc()).limit(1))
    version = current.version if current else 0
    status = current.status if current else "not_started"
    if payload.expected_version != version:
        raise HTTPException(409, "The Pap review changed. Reload the latest revision.")
    terminology = await pinned_policy(session, user.organization, current, policy)
    if terminology is None or payload.terminology_id != terminology.id:
        raise HTTPException(409, "The Pap terminology version changed. Reload the review.")
    target = TRANSITIONS[status].get(payload.action)
    if target is None:
        raise HTTPException(409, "This action is unavailable at the current Pap review stage.")
    findings = None
    if payload.action in FORM:
        findings = checked_findings(payload.findings, Terminology.model_validate(terminology.terms),
                                    final=payload.action in ("submit_primary", "complete"))
    if payload.action == "reopen_primary":
        findings = primary.findings
    if payload.action == "reopen_followup":
        findings = current.findings
    row = Revision(id=uuid4(), organization=user.organization, case_id=case_id, specimen_id=binding.specimen_id, scan_id=scan_id,
                   created_by=actor, version=version + 1, action=payload.action, status=target,
                   terminology_id=terminology.id, policy_id=policy.id, findings=findings, reason=payload.reason,
                   request_key=payload.request_key, request_hash=key)
    session.add(row)
    session.info["user"] = user
    add_event(session, row, "pap_" + payload.action, {"version": version, "status": status},
              {"version": row.version, "status": target, "terminology_version": terminology.version, "policy_version": policy.version,
               "scan_id": str(scan_id), "specimen_id": str(binding.specimen_id)},
              reason=payload.reason, case_id=case_id, source="viewer")
    await session.commit()
    return {"version": row.version, "status": target}
