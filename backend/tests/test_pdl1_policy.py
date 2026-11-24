from copy import deepcopy
from unittest import TestCase

from app.pdl1_policy import MODELS, display_policy, score_from_counts


class Pdl1PolicyTest(TestCase):
    def setUp(self):
        self.context = {"specimen_ref": "SYNTHETIC", "histology": "synthetic_fixture", "stain": "PD-L1",
                        "clone": "qa-clone", "platform": "qa-platform", "protocol": "qa-protocol",
                        "region_ref": "qa-region"}
        self.cps = {
            "id": "a" * 64, "variant": "Stomach", "kind": "original", "score_type": "CPS",
            "score": 75, "counts": {"0": 3, "2": 1, "3": 2}, "model": MODELS["CPS"],
            "score_schema": "pdl1_flat_5class", "checkpoint_sha256": "b" * 64,
            "analysis_version": "qa-cps-1", "input_context": self.context,
        }
        self.tps = {
            "id": "c" * 64, "variant": "Lung", "kind": "original", "score_type": "TPS",
            "score": 25, "counts": {"0": 3, "1": 1, "2": 55}, "model": MODELS["TPS"],
            "score_schema": "tps_3class", "checkpoint_sha256": "d" * 64,
            "analysis_version": "qa-tps-1", "input_context": self.context,
        }
        self.evidence = {"context": self.context, "cps_snapshot_id": self.cps["id"], "tps_snapshot_id": self.tps["id"],
                         "reference": "SYNTH-PAIR", "reviewed_by": "SYNTH-REVIEWER",
                         "cps_reference": "SYNTH-CPS", "tps_reference": "SYNTH-TPS"}

    def test_reference_counts_and_invalid_denominator(self):
        self.assertEqual(score_from_counts("CPS", self.cps["counts"]), 75)
        self.assertEqual(score_from_counts("TPS", self.tps["counts"]), 25)
        self.assertEqual(score_from_counts("CPS", {"0": 1, "2": 1, "3": 5}), 100)
        self.assertEqual(score_from_counts("TPS", {"0": 3, "1": 0, "2": 4}), 0)
        self.assertIsNone(score_from_counts("CPS", {"0": 0, "2": 0, "3": 2}))
        self.assertIsNone(score_from_counts("TPS", {"0": 0, "1": 0, "2": 5}))
        self.assertIsNone(score_from_counts("TPS", {"0": 4, "1": True}))
        self.assertIsNone(score_from_counts("CPS", {"0": 4, "2": 1}))
        self.assertIsNone(score_from_counts("TPS", {"0": 4, "1": 1, "3": 2}))

    def test_same_scan_alone_does_not_permit_two_scores(self):
        single = display_policy([{**self.cps, "input_context": None}], None)
        self.assertEqual(single["results"][0]["score_status"], "archived")
        self.assertEqual(single["results"][0]["score"], 75)
        without_evidence = display_policy(
            [{**row, "input_context": None} for row in (self.cps, self.tps)], None,
        )
        self.assertEqual(without_evidence["comparison"], {"status": "validation_required", "pair": None})
        self.assertEqual([item["score"] for item in without_evidence["results"]], [None, None])
        stomach = {**self.context, "histology": "gastric_adenocarcinoma"}
        native_only = display_policy([{**row, "input_context": stomach} for row in (self.cps, self.tps)], None)
        self.assertEqual([item["score"] for item in native_only["results"]], [75, None])
        nsclc = {**self.context, "histology": "nsclc"}
        native_only = display_policy([{**row, "input_context": nsclc} for row in (self.cps, self.tps)], None)
        self.assertEqual([item["score"] for item in native_only["results"]], [None, 25])
        conflicting = display_policy([{**self.cps, "input_context": stomach},
                                      {**self.tps, "input_context": nsclc}], None)
        self.assertEqual([item["score"] for item in conflicting["results"]], [None, None])

    def test_exact_evidence_allows_only_bound_originals(self):
        result = display_policy([self.cps, self.tps], self.evidence)
        self.assertEqual(result["comparison"]["pair"]["reference"], "SYNTH-PAIR")
        self.assertEqual([item["score"] for item in result["results"]], [75, 25])
        for field in ("specimen_ref", "histology", "stain", "clone", "platform", "protocol", "region_ref"):
            with self.subTest(field=field):
                other_context = {**self.context, field: "different"}
                different = display_policy([self.cps, {**self.tps, "input_context": other_context}], self.evidence)
                self.assertIsNone(different["comparison"]["pair"])
        for field, value in {
            "id": "1" * 64, "checkpoint_sha256": None, "analysis_version": None,
            "score": 26, "model": MODELS["CPS"], "score_schema": "wrong", "kind": "edited",
        }.items():
            with self.subTest(field=field):
                blocked = display_policy([self.cps, {**self.tps, field: value}], self.evidence)
                self.assertIsNone(blocked["comparison"]["pair"])
                self.assertIsNone(blocked["results"][1]["score"])
        incomplete = deepcopy(self.evidence)
        del incomplete["tps_reference"]
        self.assertIsNone(display_policy([self.cps, self.tps], incomplete)["comparison"]["pair"])
