"""Build synthetic browser-only IHC result archives and approval records."""

import argparse
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from app.ihc_archive import MARKERS, RULES
from app.import_ihc import DATA_ROOT, import_result, slide_signature


def main():
    approvals = []
    with TemporaryDirectory() as directory:
        path = Path(directory) / "synthetic.json"
        for marker, slide_tag in (("ki67", "KI"), ("er", "HR"), ("pr", "PR")):
            sample = f"CODIPAI-BRCA-SS-00194-I-{slide_tag}-01.svs"
            source = slide_signature(DATA_ROOT / sample)
            x, y = (value // 2 for value in source["dimensions"])
            path.write_text(json.dumps({
                "source": source, "marker": MARKERS[marker], "analysis_version": "synthetic-ihc-browser",
                "model_runtime": {"filename": "synthetic.pt", "version": "qa-1", "checkpoint_sha256": "a" * 64},
                "score_conf_threshold": 0.3,
                ("ki67_score" if marker == "ki67" else "allred_score"): {
                    "class_counts": {"0": 1, "1": 0, "2": 1, "3": 1},
                },
                "cells": [[cx, y, grade, confidence, cx - 2, y - 2, cx + 2, y + 2]
                          for cx, grade, confidence in ((x, 0, 0.5), (x + 3200, 2, 0.9), (x - 3200, 3, 0.7))],
            }))
            result = import_result(argparse.Namespace(organization="local", marker=marker, slide=sample, result=path))
            if marker != "pr":
                approvals.append({
                    **result, "organization": "local", "source_id": result["id"], "rule": RULES[marker],
                    "reference": "Synthetic Browser Evidence", "clone": "QA", "platform": "QA", "protocol": "QA",
                    "scoring_scope": "Synthetic WSI Center", "minimum_tumor_cells": 2,
                    "confidence_thresholds": [0.3, 0.8], "allow_cell_overrides": marker == "ki67",
                })
    Path(os.environ["MEDIAUTO_IHC_VALIDATION_FILE"]).write_text(json.dumps(approvals))


if __name__ == "__main__":
    main()
