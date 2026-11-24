import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase

from app.her2 import INTENSITY, MEMBRANE, MODEL, clinical_display, source_contract


class Her2Test(TestCase):
    def test_base_weighted_intensity_is_distinct_from_pattern_composite(self):
        raw = {"her2_score": {"score_type": "HER2", "score": 2.0, "total_tumor": 4}}
        self.assertEqual(source_contract(raw, MODEL, [1, 0, 1, 2])["score_schema"], INTENSITY)
        with self.assertRaises(ValueError):
            source_contract(raw, MODEL, [0, 1, 1, 2])
        with self.assertRaises(ValueError):
            source_contract({**raw, "score_schema": MEMBRANE}, MODEL, [1, 0, 1, 2, 0])

    def test_pattern_composite_requires_exact_baseline_and_original(self):
        context = {"specimen_ref": "QA", "histology": "invasive_breast_carcinoma", "stain": "HER2", "clone": "QA",
                   "platform": "QA", "protocol": "QA", "region_ref": "QA"}
        source = {"id": "a" * 64, "model": "test.pt", "analysis_version": "qa-v1",
                  "checkpoint_sha256": "b" * 64, "source_digest": "a" * 64, "original_counts": [1, 2, 3, 4, 5],
                  **source_contract({"score_schema": MEMBRANE, "input_context": context,
                                     "her2_score": {"score_type": "HER2 Composite", "composite": 17.4,
                                                    "unit": "index", "total_tumor": 15}}, "test.pt", [1, 2, 3, 4, 5])}
        evidence = {**source, "snapshot_id": source["id"], "schema": MEMBRANE, "context": context,
                    "reference": "SYNTHETIC", "reviewed_by": "QA",
                    "reference_result": {"value": 17.4, "unit": "index",
                                         "counts": {str(i): i + 1 for i in range(5)}}}
        with TemporaryDirectory() as root:
            folder = Path(root)
            record = folder / "validation-evidence.json"
            snapshot = folder / source["id"]
            self.assertIsNone(clinical_display(snapshot, "her2", source, None, True)["aggregate"])
            record.write_text(json.dumps([evidence]))
            result = clinical_display(snapshot, "her2", source, None, True)
            self.assertEqual(result["aggregate"]["value"], 17.4)
            self.assertIsNone(clinical_display(snapshot, "her2", source, SimpleNamespace(action="edit"), True)["aggregate"])
            self.assertEqual(clinical_display(snapshot, "her2", source, SimpleNamespace(action="restore"), True), result)
            self.assertIsNone(clinical_display(snapshot, "her2", source, None, False)["aggregate"])
            self.assertIsNone(clinical_display(snapshot, "pr", source, None, True)["aggregate"])
            drift = {**evidence, "reference_result": {**evidence["reference_result"], "unit": "percent"}}
            record.write_text(json.dumps([drift]))
            self.assertIsNone(clinical_display(snapshot, "her2", source, None, True)["aggregate"])
