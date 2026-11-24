"""Vocabulary and state rules for institution-controlled Pap review."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field, model_validator

from app.clinical import ClinicalInput, Name, Reason
from app.pap_gallery import CategoryCode

Status = Literal["primary_draft", "submitted", "followup_draft", "returned", "completed"]
Action = Literal["save_primary", "submit_primary", "save_followup", "complete", "return", "reopen_primary", "reopen_followup"]

TRANSITIONS = {
    "not_started": {"save_primary": "primary_draft", "submit_primary": "submitted"},
    "primary_draft": {"save_primary": "primary_draft", "submit_primary": "submitted"},
    "submitted": {"save_followup": "followup_draft", "complete": "completed", "return": "returned"},
    "followup_draft": {"save_followup": "followup_draft", "complete": "completed", "return": "returned"},
    "returned": {"reopen_primary": "primary_draft"},
    "completed": {"reopen_followup": "followup_draft"},
}
PRIMARY = ("save_primary", "submit_primary", "reopen_primary")
FORM = ("save_primary", "submit_primary", "save_followup", "complete")
REASON_REQUIRED = ("return", "reopen_primary", "reopen_followup")


class Term(ClinicalInput):
    code: CategoryCode
    label: Name


class AdequacyTerm(Term):
    interpretation_required: bool = True


class OrganismTerm(Term):
    exclusive: bool = False


class Terminology(ClinicalInput):
    adequacy: Annotated[list[AdequacyTerm], Field(min_length=1, max_length=60)]
    interpretation: Annotated[list[Term], Field(min_length=1, max_length=60)]
    organisms: Annotated[list[OrganismTerm], Field(max_length=60)] = Field(default_factory=list)
    organisms_required: bool = False

    @model_validator(mode="after")
    def unique_terms(self):
        for terms in (self.adequacy, self.interpretation, self.organisms):
            if len({term.code for term in terms}) != len(terms) or len({term.label.casefold() for term in terms}) != len(terms):
                raise ValueError("Use distinct codes and labels within each Pap field.")
        if self.organisms_required and not self.organisms:
            raise ValueError("Define at least one organism term when the field is required.")
        return self


class Permissions(ClinicalInput):
    primary_reviewers: Annotated[list[UUID], Field(min_length=1, max_length=200)]
    followup_reviewers: Annotated[list[UUID], Field(min_length=1, max_length=200)]

    @model_validator(mode="after")
    def distinct_reviewers(self):
        for reviewers in (self.primary_reviewers, self.followup_reviewers):
            if len(set(reviewers)) != len(reviewers):
                raise ValueError("Select each reviewer only once for a stage.")
        if len(set(self.primary_reviewers + self.followup_reviewers)) < 2:
            raise ValueError("Select different accounts for primary and follow-up review.")
        return self


class PolicyInput(ClinicalInput):
    version: Annotated[int, Field(strict=True, ge=0)]
    name: Name
    terms: Terminology
    permissions: Permissions
    reason: Reason


class Findings(ClinicalInput):
    adequacy: CategoryCode | None = None
    interpretation: CategoryCode | None = None
    organisms: Annotated[list[CategoryCode], Field(max_length=60)] = Field(default_factory=list)
    note: Annotated[str, Field(max_length=2000)] = ""


class ReviewInput(ClinicalInput):
    expected_version: Annotated[int, Field(strict=True, ge=0)]
    terminology_id: UUID
    action: Action
    request_key: UUID
    findings: Findings | None = None
    reason: Reason | None = None

    @model_validator(mode="after")
    def action_payload(self):
        if (self.action in FORM) != (self.findings is not None):
            raise ValueError("Provide findings only for a draft, submission or completion.")
        if self.action in REASON_REQUIRED and not self.reason:
            raise ValueError("A reason is required for returning or reopening a review.")
        return self


def eligible_actions(status, user, policy, primary_actor):
    if policy is None:
        return []
    account = str(user.id)
    primary = user.role in ("labeler", "doctor") and account in policy.permissions["primary_reviewers"]
    followup = user.role == "doctor" and account != primary_actor and account in policy.permissions["followup_reviewers"]
    return [action for action in TRANSITIONS[status] if (primary if action in PRIMARY else followup)]


def checked_findings(raw, terms, final):
    adequacy = {term.code: term for term in terms.adequacy}
    interpretation = {term.code for term in terms.interpretation}
    organisms = {term.code: term for term in terms.organisms}
    if ((raw.adequacy is not None and raw.adequacy not in adequacy)
            or (raw.interpretation is not None and raw.interpretation not in interpretation)
            or any(code not in organisms for code in raw.organisms)):
        raise HTTPException(422, "Use terms from this review's published terminology version.")
    if len(raw.organisms) != len(set(raw.organisms)) or (len(raw.organisms) > 1 and any(organisms[code].exclusive for code in raw.organisms)):
        raise HTTPException(422, "Select unique organisms and use exclusive terms on their own.")
    applicable = raw.adequacy is None or adequacy[raw.adequacy].interpretation_required
    if not applicable and (raw.interpretation or raw.organisms):
        raise HTTPException(422, "This adequacy term excludes interpretation and organism entries.")
    if final and (not raw.adequacy or (applicable and (not raw.interpretation or (terms.organisms_required and not raw.organisms)))):
        raise HTTPException(422, "Complete the required Pap review fields.")
    return raw.model_dump()
