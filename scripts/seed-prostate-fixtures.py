"""Create isolated synthetic prostate outputs on real WSI backgrounds."""

import json
import sys
from pathlib import Path

from app.import_prostate import DATA_ROOT, import_result, slide_signature
from app.prostate_results import SCHEMA, result_root


def save(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def seed(directory, scans):
    response = {}
    reference_paths = {}
    for index, record in enumerate(scans, 1):
        sample = record["file"]
        binding = record["binding"]
        signature = slide_signature(DATA_ROOT / sample)
        x, y = (value // 2 for value in signature["dimensions"])
        level = str(index)
        tumor = {"value": 750, "unit": "um", "method": "single_focus"} if index == 1 else {
            "value": 0, "unit": "mm", "method": "sum_of_foci"}
        findings = {"tumor_length": tumor}
        capabilities = ["tissue_region", "tumor_length"]
        regions = [{"id": "Tissue-A", "kind": "tissue",
                    "points": [[x - 2000, y - 600], [x + 2000, y - 600], [x + 1800, y + 600], [x - 2000, y + 650]]}]
        if index == 1:
            findings.update(core_length={"value": 3.5, "unit": "mm", "method": "core_axis"},
                            grade_group=2, pni="not_identified")
            capabilities.extend(["tumor_region", "core_length", "grade_group", "pni"])
            regions.append({"id": "Focus-A", "kind": "tumor",
                            "points": [[x - 1000, y - 250], [x + 300, y], [x - 700, y + 200]]})
        rows = [{"core_id": "A", "level_id": level, "regions": regions, "findings": findings}]
        if index == 1:
            rows.append({"core_id": "B", "level_id": level, "regions": [{"id": "Tissue-B", "kind": "tissue",
                        "points": [[x, y + 2000], [x + 2000, y + 2000], [x + 2000, y + 2300]]}], "findings": {}})
        archive = {"schema_version": SCHEMA, "source": signature, "binding": binding,
                   "input": {"organ": "prostate", "specimen_type": "needle_biopsy", "stain": "H&E",
                             "protocol": "Synthetic QA-only"},
                   "model": {"name": "Synthetic Prostate Adapter", "version": "qa-1", "checkpoint_sha256": "e" * 64},
                   "analysis_version": "qa-analysis-1", "analyzed_at": "2026-01-01T00:00:00Z",
                   "capabilities": capabilities, "core_levels": rows}
        path = directory / f"prostate-source-{index}.json"
        save(path, archive)
        archive_id = import_result("local", sample, path)
        evidence = {"archive_id": archive_id, "checkpoint_sha256": "e" * 64, "model_version": "qa-1",
                    "analysis_version": "qa-analysis-1", "core_id": "A", "level_id": level,
                    "reference": f"SYNTH-PROSTATE-{index}", "review_version": "qa-review-1", "reviewed_by": "Synthetic QA",
                    "reviewed_at": "2026-01-02T00:00:00Z", "findings": findings}
        verification = result_root("local", signature) / "validation-evidence.json"
        save(verification, [evidence])
        reference_paths[level] = str(verification)
        response[level] = archive_id
        if index == 1:
            newer = {**archive, "analysis_version": "qa-analysis-2", "analyzed_at": "2026-01-03T00:00:00Z"}
            save(path, newer)
            response["newer"] = import_result("local", sample, path)
    print(json.dumps({"archives": response, "evidence": reference_paths}))


if __name__ == "__main__":
    seed(Path(sys.argv[1]), json.loads(sys.argv[2]))
