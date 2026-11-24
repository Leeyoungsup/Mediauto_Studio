import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from app.import_prostate import import_result
from app.prostate_results import Archive, Reference, archives_for, display_archive, result_root


class ProstateResultsTest(TestCase):
    def setUp(self):
        self.source = {"filename": "synthetic.svs", "size": 8, "quickhash": "a" * 64, "dimensions": [500, 300]}
        self.binding = {key: str(uuid4()) for key in ("case_id", "specimen_id", "block_id", "slide_id")}
        self.payload = {"schema_version": "prostate-core-level-v1", "source": self.source, "binding": self.binding,
                        "input": {"organ": "prostate", "specimen_type": "needle_biopsy", "stain": "H&E", "protocol": "QA"},
                        "model": {"name": "Synthetic", "version": "1", "checkpoint_sha256": "b" * 64},
                        "analysis_version": "x", "analyzed_at": "2026-01-01T00:00:00Z",
                        "capabilities": ["tissue_region", "tumor_length", "grade_group"],
                        "core_levels": [{"core_id": "A", "level_id": "1",
                                         "regions": [{"id": "T", "kind": "tissue",
                                                      "points": [[10, 10], [15, 10], [15, 25]]}],
                                         "findings": {"tumor_length": {"value": 750, "unit": "um", "method": "single_focus"}}}]}
        self.id = "c" * 64
        self.reference = {"archive_id": self.id, "checkpoint_sha256": "b" * 64, "model_version": "1",
                          "analysis_version": "x", "core_id": "A", "level_id": "1", "reference": "QA",
                          "review_version": "r1", "reviewed_by": "Synthetic QA", "reviewed_at": "2026-01-02T00:00:00Z",
                          "findings": {"tumor_length": {"value": 0.75, "unit": "mm", "method": "single_focus"}}}

    def test_field_scope_missing_and_exact_reference(self):
        archive = Archive.model_validate(self.payload)
        ref = Reference.model_validate(self.reference)
        data = display_archive(self.id, archive, [ref])["core_levels"][0]["findings"]
        self.assertEqual(data["pni"]["status"], "unsupported")
        self.assertEqual(data["grade_group"]["status"], "not_reported")
        self.assertEqual(data["tumor_length"]["value"]["mm"], 0.75)
        self.assertEqual(data["tumor_length"]["evidence"]["review_version"], "r1")
        for refs in ([], [ref, ref], [ref.model_copy(update={"core_id": "B"})],
                     [ref.model_copy(update={"level_id": "2"})], [ref.model_copy(update={"analysis_version": "y"})],
                     [ref.model_copy(update={"checkpoint_sha256": "d" * 64})],
                     [ref.model_copy(update={"model_version": "2"})],
                     [Reference.model_validate({**self.reference, "findings": {"tumor_length": {
                         "value": 0.75, "unit": "mm", "method": "sum_of_foci"}}})],
                     [ref.model_copy(update={"reviewed_at": archive.analyzed_at.replace(year=2025)})]):
            with self.subTest(refs=refs):
                output = display_archive(self.id, archive, refs)["core_levels"][0]["findings"]["tumor_length"]
                self.assertEqual(output, {"status": "unverified", "value": None, "evidence": None})

    def test_rejects_duplicate_ids_and_invalid_coordinates_and_unsupported_fields(self):
        row = self.payload["core_levels"][0]
        for rows in ([row, row],
                     [{**row, "regions": [{**row["regions"][0], "points": [[10, 10], [600, 10], [15, 25]]}]}],
                     [{**row, "regions": [{**row["regions"][0], "points": [[10, 10], [12, 10], [15, 10]]}]}],
                     [{**row, "findings": {"pni": "not_identified"}}],
                     [{**row, "findings": {"grade_group": 0}}]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                Archive.model_validate({**self.payload, "core_levels": rows})

    def test_archive_import_checks_wsi_and_current_binding_and_digest(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            slide = root / self.source["filename"]
            slide.write_bytes(b"test WSI")
            exported = root / "source.json"
            raw = json.dumps(self.payload).encode()
            exported.write_bytes(raw)
            with patch("app.import_prostate.DATA_ROOT", root), patch("app.import_prostate.slide_signature", return_value=self.source), \
                 patch("app.prostate_results.scan_signature", return_value=self.source), \
                 patch.dict("os.environ", {"MEDIAUTO_PROSTATE_ROOT": str(root / "registry")}):
                archive_id = import_result("local", slide.name, exported)
                self.assertEqual(archive_id, hashlib.sha256(raw).hexdigest())
                self.assertEqual(import_result("local", slide.name, exported), archive_id)
                binding = Archive.model_validate(self.payload).binding
                self.assertEqual(archives_for(slide, "local", binding)[0]["id"], archive_id)
                self.assertFalse(archives_for(slide, "other", binding))
                self.assertFalse(archives_for(slide, "local", binding.model_copy(update={"case_id": uuid4()})))
                exported.write_text(json.dumps({**self.payload, "source": {**self.source, "quickhash": "e" * 64}}))
                with self.assertRaisesRegex(ValueError, "does not match the slide"):
                    import_result("local", slide.name, exported)
                target = result_root("local", self.source) / (archive_id + ".json")
                target.write_bytes(raw + b" ")
                with self.assertRaisesRegex(ValueError, "digest"):
                    archives_for(slide, "local", binding)
