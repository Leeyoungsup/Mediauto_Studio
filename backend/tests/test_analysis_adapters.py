from pathlib import Path
from threading import Event
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from app.analysis_adapters import AnalysisFailure, execute


class AnalysisAdapterTest(IsolatedAsyncioTestCase):
    async def test_tps_replay_matches_model_original_and_pinned_snapshot(self):
        def archived(identifier, model, score, kind="original"):
            return {"id": identifier, "kind": kind, "score_type": score, "model": model, "model_version": "synthetic",
                    "saved_at": "2026-11-24T00:00:00Z", "analysis_version": "sandbox"}

        checkpoint = "PDL1_TPS_detection.pt"
        rows = [
            archived("a" * 64, checkpoint, "TPS"),
            archived("b" * 64, checkpoint, "TPS"),
            archived("c" * 64, checkpoint, "TPS", "edited"),
            archived("d" * 64, "PDL1_ST_CPS_detection.pt", "CPS"),
        ]
        source = {"storage_key": "synthetic.svs", "size_bytes": 10, "modified_ns": 42}
        with patch("app.analysis_adapters.verified_scan_path", return_value=(Path(source["storage_key"]), {})), \
                patch("app.analysis_adapters.snapshot_folder", return_value=Path("synthetic")), \
                patch("app.analysis_adapters.results_for_display", return_value={"results": rows}):
            run = await execute("local", "pdl1_tps_archive", "archive-v1", source, None, Event())
            self.assertEqual(run["snapshot"]["id"], "b" * 64)
            replay = await execute("local", "pdl1_tps_archive", "archive-v1", source, "a" * 64, Event())
            self.assertEqual(replay["snapshot"], {**run["snapshot"], "id": "a" * 64})
            with self.assertRaisesRegex(AnalysisFailure, "archive_unavailable"):
                await execute("local", "pdl1_tps_archive", "archive-v1", source, "c" * 64, Event())
            with self.assertRaisesRegex(AnalysisFailure, "model_unavailable"):
                await execute("local", "pdl1_tps_archive", "old-recipe", source, None, Event())
