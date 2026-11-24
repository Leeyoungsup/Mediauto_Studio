import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException

from app.import_pap import import_result
from app.pap_gallery import Archive, Context, archives, find_archive, folder_for, resume_pointer


class PapGalleryTest(TestCase):
    def setUp(self):
        self.source = {"filename": "qa.svs", "size": 1, "quickhash": "a" * 64, "dimensions": [10000, 10000]}
        self.binding = {key: str(uuid4()) for key in ("case_id", "specimen_id", "slide_id", "block_id")}
        self.row = {"id": "candidate-1", "category": "high_nc_ratio", "bounds": [500, 600, 700, 800], "confidence": 0.9}
        self.raw = {"schema_version": "pap-candidates-v1", "source": self.source, "binding": self.binding,
                    "scope": "cervical_cytology", "preparation": "liquid_based", "analysis_version": "qa-analysis",
                    "model": {"name": "Synthetic", "version": "qa-model", "checkpoint_sha256": "b" * 64},
                    "exported_at": "2026-01-01T00:00:00Z",
                    "categories": [{"code": "high_nc_ratio", "label": "High N/C Ratio"}, {"code": "clusters", "label": "Clusters"}],
                    "candidates": [self.row]}

    def test_rejects_bad_category_bounds_and_candidate_specific_scan(self):
        for rows in ([{**self.row, "category": "missing"}], [self.row, self.row],
                     [{**self.row, "bounds": [0, 0, 10001, 1]}], [{**self.row, "bounds": [0, 0, 4097, 1]}],
                     [{**self.row, "bounds": [1, 2, 1, 3]}], [{**self.row, "scan_id": str(uuid4())}]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                Archive.model_validate({**self.raw, "candidates": rows})

    def test_import_selection_resume_and_tamper(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            slide = root / self.source["filename"]
            slide.write_bytes(b"x")
            export = root / "incoming.json"
            populated = {**self.raw, "candidates": [{**self.row, "id": f"p-{i}"} for i in range(22)]}
            raw = json.dumps(populated).encode()
            export.write_bytes(raw)
            with patch.dict("os.environ", {"MEDIAUTO_PAP_ROOT": str(root / "results")}), \
                 patch("app.import_pap.DATA_ROOT", root), patch("app.import_pap.slide_signature", return_value=self.source):
                key = import_result("local", slide.name, export)
                self.assertEqual(key, hashlib.sha256(raw).hexdigest())
                context = Context(slide, uuid4(), Archive.model_validate(populated).binding, self.source, folder_for("local", self.source))
                manifest, failed = archives(context)
                self.assertFalse(failed)
                self.assertEqual([cat["count"] for cat in manifest[0]["categories"]], [22, 0])
                cursor = SimpleNamespace(archive_id=key, candidate_id="p-21")
                self.assertEqual(resume_pointer(context, cursor)["page"], 2)
                mismatch = Context(slide, uuid4(), context.binding.model_copy(update={"specimen_id": uuid4()}),
                                   self.source, context.folder)
                self.assertEqual(archives(mismatch), ([], False))
                self.assertIsNone(resume_pointer(mismatch, cursor))
                export.write_text(json.dumps({**populated, "source": {**self.source, "quickhash": "f" * 64}}))
                with self.assertRaisesRegex(ValueError, "does not match"):
                    import_result("local", slide.name, export)
                (context.folder / (key + ".json")).write_bytes(raw + b" ")
                self.assertEqual(archives(context), ([], True))
                with self.assertRaises(HTTPException) as failure:
                    find_archive(context, key)
                self.assertEqual(failure.exception.status_code, 503)
