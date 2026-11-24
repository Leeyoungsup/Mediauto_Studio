from copy import deepcopy
from pathlib import Path
from unittest import TestCase
from uuid import uuid4

from fastapi import HTTPException

from app.skin_archive import Archive, Reference, area_mm2
from app.skin_review import AddCandidate, DecideCandidate, PlaceWindow, SkinContext, apply_change, display, initial_state


class SkinReviewTest(TestCase):
    def setUp(self):
        self.source_id = "a" * 64
        self.raw = {"schema_version": "skin-review-v1", "stain": "H&E", "scope": "cutaneous_melanoma",
                    "source": {"filename": "fixture.svs", "size": 500, "quickhash": "b" * 64, "dimensions": [16000, 12000]},
                    "binding": {key: str(uuid4()) for key in ("case_id", "specimen_id", "slide_id", "block_id")},
                    "model": {"name": "Synthetic", "version": "v1", "checkpoint_sha256": "c" * 64},
                    "analysis_version": "a1", "analyzed_at": "2026-01-01T00:00:00Z",
                    "capabilities": ["epidermal_orientation", "count_fields", "mitosis_candidates", "candidate_heatmap"],
                    "orientation": [{"id": "edge", "start": [100, 200], "surface": [100, 100]}],
                    "windows": [{"id": "field", "bounds": [1000, 1000, 3000, 5000]}],
                    "candidates": [{"id": "A", "point": [1000, 1000], "confidence": 0.9},
                                   {"id": "B", "point": [3000, 1000], "confidence": 0.7}],
                    "heatmap": [{"bounds": [1000, 1000, 3000, 5000], "density": 1}],
                    "heatmap_unit": "candidates_per_mm2", "mpp": [0.25, 0.5]}
        self.archive = Archive.model_validate(self.raw)
        self.context = SkinContext(self.archive.binding, [16000, 12000], (0.25, 0.5), "manual-" + "d" * 64, uuid4(),
                                   Path("/tmp"), {self.source_id: self.archive})
        self.options = {"expected_version": 0, "request_key": uuid4(), "reason": "Synthetic review"}

    def test_assessed_counts_and_density_separate_from_model_heatmap(self):
        state = initial_state()
        data = display(self.context, self.source_id, self.archive, state, [])
        self.assertEqual(data["windows"][0]["area_mm2"], 1)
        self.assertEqual(data["windows"][0]["counts"], {"confirmed": 0, "rejected": 0, "pending": 1})
        body = DecideCandidate(action="decide", candidate_id="A", window_id="field", status="confirmed", **self.options)
        self.assertEqual(apply_change(body, self.context, self.archive, state)["before"], "pending")
        mark = AddCandidate(action="add", point=[1200, 1250], window_id="field", **self.options)
        apply_change(mark, self.context, self.archive, state)
        with self.assertRaises(HTTPException):
            apply_change(mark, self.context, self.archive, state)
        baseline = Reference(archive_id=self.source_id, model_version="v1", checkpoint_sha256="c" * 64,
                             analysis_version="a1", window_id="field", reference="QA", review_version="r1",
                             reviewed_at="2026-01-02T00:00:00Z", area_mm2=1, count=1)
        output = display(self.context, self.source_id, self.archive, state, [baseline])
        self.assertEqual(output["windows"][0]["review_density"], 2)
        self.assertEqual(output["windows"][0]["reference"]["difference"], 1)
        self.assertEqual(output["heatmap"][0]["density"], 1)
        no_ref = display(self.context, self.source_id, self.archive, state, [baseline.model_copy(update={"analysis_version": "a2"})])
        self.assertIsNone(no_ref["windows"][0]["reference"])
        self.context.mpp = (0.3, 0.5)
        self.assertEqual(display(self.context, self.source_id, self.archive, state, [baseline])["heatmap"], [])

    def test_calibrated_manual_windows_and_uncalibrated_scan(self):
        state = initial_state()
        for area in (0.2, 1.0):
            request = PlaceWindow(action="window", point=[8000, 6000], area=area, **{**self.options, "request_key": uuid4()})
            change = apply_change(request, self.context, None, state)
            self.assertAlmostEqual(area_mm2(state["windows"][change["window_id"]], self.context.mpp), area)
        with self.assertRaises(HTTPException):
            apply_change(request.model_copy(update={"point": (1, 1)}), self.context, None, state)
        self.context.mpp = None
        with self.assertRaises(HTTPException):
            apply_change(request, self.context, None, state)

    def test_rejects_invalid_source_geometry_and_capabilities(self):
        invalid = (
            {"orientation": [{"id": "edge", "start": [100, 200], "surface": [100, 200]}]},
            {"windows": [{"id": "outside", "bounds": [0, 0, 20000, 20000]}]},
            {"mpp": None}, {"capabilities": ["mitosis_candidates"]},
            {"candidates": [{"id": "manual-fake", "point": [0, 0]}]},
        )
        for change in invalid:
            with self.subTest(change=change), self.assertRaises(ValueError):
                Archive.model_validate({**deepcopy(self.raw), **change})
