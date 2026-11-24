import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from app.ihc_archive import RULES, approved_rule, aggregate, counts_at


class IhcArchiveTest(TestCase):
    def test_confirmation_uses_confidence_and_manual_decisions(self):
        rows = [(10, 20, 0, 0.4), (20, 30, 1, 0.5), (30, 40, 3, 0.6), (40, 50, 4, 0.8)]
        bins = [[0.4], [0.5], [], [0.6], [0.8]]
        self.assertEqual(counts_at(rows, bins, 0.5, {}), [0, 1, 0, 1, 1])
        reviewed = counts_at(rows, bins, 0.5, {"0": 2, "2": 4})
        self.assertEqual(reviewed, [0, 1, 1, 0, 2])
        self.assertEqual(aggregate(RULES["ki67"], reviewed, 2),
                         {"kind": "ki67", "percent": 100, "positive": 2, "total": 2})
        self.assertIsNone(aggregate(RULES["ki67"], reviewed, 3))
        self.assertIsNone(aggregate(RULES["pr"], [0, 0, 0, 0, 4], 1))

    def test_allred_boundaries_and_negative_tumor(self):
        for positive, expected in ((0, 0), (1, 1), (2, 2), (19, 2), (20, 3), (65, 3),
                                   (66, 4), (131, 4), (132, 5), (200, 5)):
            with self.subTest(positive=positive):
                result = aggregate(RULES["er"], [200 - positive, 0, 0, positive, 70], 1)
                self.assertEqual(result["proportion"], expected)
                self.assertEqual(result["intensity"], 3 if positive else 0)
                self.assertEqual(result["score"], expected + (3 if positive else 0))
        self.assertEqual(aggregate(RULES["pr"], [0, 1, 1, 0, 0], 1)["intensity"], 2)
        self.assertEqual(aggregate(RULES["pr"], [0, 0, 1, 1, 0], 1)["intensity"], 3)

    def test_approval_scope_and_missing_metadata_fail_closed(self):
        original = {"id": "d" * 64, "marker": "er", "model_version": "synthetic",
                    "analysis_version": "synthetic-v1", "checkpoint_sha256": "a" * 64}
        evidence = {**original, "organization": "synthetic", "source_id": original["id"], "rule": RULES["er"],
                    "reference": "QA", "clone": "QA", "platform": "QA", "protocol": "QA",
                    "scoring_scope": "QA ROI", "minimum_tumor_cells": 1, "confidence_thresholds": [0.3]}
        with TemporaryDirectory() as directory:
            path = Path(directory) / "approval.json"
            with patch.dict("os.environ", {"MEDIAUTO_IHC_VALIDATION_FILE": str(path)}):
                path.write_text(json.dumps([evidence]))
                self.assertEqual(approved_rule("synthetic", "er", original, 0.3, {}), evidence)
                for org, stain, source, threshold, changes in (
                    ("other", "er", original, 0.3, {}), ("synthetic", "pr", original, 0.3, {}),
                    ("synthetic", "er", original, 0.4, {}), ("synthetic", "er", original, 0.3, {"1": 3}),
                    ("synthetic", "er", {**original, "checkpoint_sha256": "0" * 64}, 0.3, {}),
                    ("synthetic", "er", {**original, "analysis_version": "other"}, 0.3, {}),
                ):
                    with self.subTest(org=org, stain=stain, threshold=threshold):
                        self.assertIsNone(approved_rule(org, stain, source, threshold, changes))
                path.write_text('invalid JSON')
                self.assertIsNone(approved_rule("synthetic", "er", original, 0.3, {}))
