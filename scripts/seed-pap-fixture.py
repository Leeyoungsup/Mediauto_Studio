"""Generate synthetic Pap candidate exports on isolated WSI backgrounds."""

import json
import sys
from pathlib import Path

from app.import_pap import DATA_ROOT, import_result, slide_signature
from app.pap_gallery import folder_for

directory = Path(sys.argv[1])
records = json.loads(sys.argv[2])
results = []
for index, record in enumerate(records):
    source = slide_signature(DATA_ROOT / record["file"])
    x, y = (value // 2 for value in source["dimensions"])
    rows = [{"id": f"Cell-{n:02d}", "category": "high_nc_ratio",
             "bounds": [x + 600 + n * 15, y - 1500 - n * 13, x + 780 + n * 15, y - 1340 - n * 13],
             "confidence": 0.91} for n in range(1, 22)] if index == 0 else []
    if rows:
        rows.append({"id": "Cluster-01", "category": "clusters", "bounds": [x - 900, y + 1200, x - 700, y + 1400]})
    content = {"schema_version": "pap-candidates-v1", "source": source, "binding": record["binding"],
               "scope": "cervical_cytology", "preparation": "liquid_based", "exported_at": "2026-01-01T00:00:00Z",
               "model": {"name": "Synthetic Pap Adapter", "version": "qa-model-1", "checkpoint_sha256": "a" * 64},
               "analysis_version": "qa-pap-run-1",
               "categories": [{"code": "high_nc_ratio", "label": "High N/C Ratio"}, {"code": "clusters", "label": "Clusters"},
                              {"code": "organisms", "label": "Organisms"},
                              {"code": "transformation_zone", "label": "Transformation Zone"}],
               "candidates": rows}
    export = directory / f"pap-source-{index}.json"
    export.write_text(json.dumps(content), encoding="utf8")
    handle = import_result("local", record["file"], export)
    results.append({"id": handle, "file": str(folder_for("local", source) / (handle + ".json"))})
print(json.dumps(results))
