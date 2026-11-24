"""Build a synthetic model archive and area reference on an isolated test WSI."""

import json
import math
import sys
from pathlib import Path

from app.import_skin import DATA_ROOT, import_result
from app.skin_archive import folder_for, slide_context

directory = Path(sys.argv[1])
record = json.loads(sys.argv[2])
signature, mpp = slide_context(DATA_ROOT / record["file"])
assert mpp
x, y = (value // 2 for value in signature["dimensions"])
dx, dy = (math.sqrt(0.2) * 500 / scale for scale in mpp)
bounds = [x - dx, y - dy, x + dx, y + dy]
raw = {"schema_version": "skin-review-v1", "source": signature, "binding": record["binding"],
       "scope": "cutaneous_melanoma", "stain": "H&E", "analyzed_at": "2026-01-01T00:00:00Z",
       "model": {"name": "Synthetic Skin Adapter", "version": "qa-model-1", "checkpoint_sha256": "a" * 64},
       "analysis_version": "qa-skin-run-1",
       "capabilities": ["epidermal_orientation", "tissue_regions", "count_fields", "mitosis_candidates", "candidate_heatmap"],
       "mpp": mpp, "heatmap_unit": "candidates_per_mm2",
       "orientation": [{"id": "Epidermal-A", "start": [x, y], "surface": [x, y - dy]}],
       "regions": [{"id": "Outline-A", "kind": "epidermis", "points":
                    [[x - dx, y - dy], [x + dx, y - dy], [x + dx, y - dy * .5]]}],
       "windows": [{"id": "Hotspot-A", "bounds": bounds}],
       "candidates": [{"id": "Mitosis-A", "point": [x - dx * .5, y], "confidence": 0.88},
                      {"id": "Mitosis-B", "point": [x + dx * .6, y], "confidence": 0.52}],
       "heatmap": [{"bounds": bounds, "density": 10}]}
source = directory / "skin-qa-source.json"
source.write_text(json.dumps(raw), encoding="utf8")
handle = import_result("local", record["file"], source)
validation = folder_for("local", signature) / "validation-evidence.json"
validation.write_text(json.dumps([{"archive_id": handle, "model_version": "qa-model-1", "checkpoint_sha256": "a" * 64,
                                  "analysis_version": "qa-skin-run-1", "window_id": "Hotspot-A", "reference": "SYNTH-SKIN-1",
                                  "review_version": "qa-reference-1", "reviewed_at": "2026-01-02T00:00:00Z",
                                  "area_mm2": 0.2, "count": 1}]), encoding="utf8")
print(json.dumps({"id": handle, "validation": str(validation), "archive": str(validation.parent / (handle + ".json"))}))
