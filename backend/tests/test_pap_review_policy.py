from types import SimpleNamespace
from unittest import TestCase
from uuid import uuid4

from fastapi import HTTPException

from app.pap_review_policy import Findings, ReviewInput, Terminology, checked_findings, eligible_actions


class PapReviewPolicyTest(TestCase):
    def setUp(self):
        self.terms = Terminology.model_validate({
            "adequacy": [{"code": "ok", "label": "QA Adequate"},
                         {"code": "blocked", "label": "QA Inadequate", "interpretation_required": False}],
            "interpretation": [{"code": "sample", "label": "QA Finding"}],
            "organisms": [{"code": "zero", "label": "QA None", "exclusive": True}, {"code": "found", "label": "QA Organism"}],
            "organisms_required": True,
        })

    def test_required_and_exclusive_terms_and_inapplicable_interpretation(self):
        approved = Findings(adequacy="ok", interpretation="sample", organisms=["zero"])
        self.assertEqual(checked_findings(approved, self.terms, True)["organisms"], ["zero"])
        self.assertEqual(checked_findings(Findings(adequacy="blocked"), self.terms, True)["adequacy"], "blocked")
        for values in ({"adequacy": "old"}, {"organisms": ["found", "zero"]}, {"organisms": ["found", "found"]},
                       {"adequacy": "blocked"}, {"organisms": []}):
            with self.subTest(values=values), self.assertRaises(HTTPException):
                checked_findings(approved.model_copy(update=values), self.terms, True)
        self.assertEqual(checked_findings(Findings(), self.terms, False)["organisms"], [])

    def test_permissions_separate_primary_and_followup_and_require_reason(self):
        actor = SimpleNamespace(id=uuid4(), role="doctor")
        policy = SimpleNamespace(permissions={"primary_reviewers": [str(actor.id)], "followup_reviewers": [str(actor.id)]})
        self.assertIn("reopen_primary", eligible_actions("returned", actor, policy, str(actor.id)))
        self.assertEqual(eligible_actions("submitted", actor, policy, str(actor.id)), [])
        self.assertIn("complete", eligible_actions("submitted", actor, policy, str(uuid4())))
        actor.role = "admin"
        self.assertEqual(eligible_actions("primary_draft", actor, policy, None), [])
        with self.assertRaises(ValueError):
            ReviewInput(expected_version=2, request_key=uuid4(), terminology_id=uuid4(), action="return")
