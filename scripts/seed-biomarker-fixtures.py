"""Synthetic evidence for an explicit HER2 pattern export and PD-L1 comparison."""

import argparse
import hashlib
import json
import os
from pathlib import Path

from app.her2 import MEMBRANE
from app.ihc_archive import archive_folder
from app.import_ihc import import_result
from app.import_pdl1 import DATA_ROOT, import_snapshot, slide_signature
from app.pdl1 import snapshot_directory
from app.pdl1_policy import MODELS, SCHEMAS


def save(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def evidence(meta, schema, context, reference, value, counts, **extra):
    return {**{key: meta[key] for key in ("source_digest", "checkpoint_sha256", "analysis_version", "model")},
            "snapshot_id": meta["id"], "context": context, "schema": schema, "reference": reference,
            "reviewed_by": "Synthetic QA", "reference_result": {"value": value, "counts": counts, **extra}}


def main(scratch):
    context = {"specimen_ref": "QA-01", "histology": "invasive_breast_carcinoma", "stain": "HER2", "clone": "QA",
               "platform": "QA", "protocol": "QA", "region_ref": "QA-ROI"}
    path = scratch / "biomarker-source.json"
    slide = "CODIPAI-BRCA-SS-00194-I-HR-01.svs"
    signature = slide_signature(DATA_ROOT / slide)
    x, y = (value // 2 for value in signature["dimensions"])
    counts = dict.fromkeys(map(str, range(5)), 1)
    save(path, {"source": signature, "marker": "HER2", "score_schema": MEMBRANE, "analysis_version": "QA-HER2-v1",
                "input_context": context, "score_conf_threshold": 0.3,
                "model_runtime": {"filename": "synthetic-pattern.pt", "version": "QA", "checkpoint_sha256": "a" * 64},
                "her2_score": {"score_type": "HER2 Composite", "total_tumor": 5, "composite": 12.5,
                               "unit": "index", "class_counts": counts},
                "cells": [[x + grade * 100, y, grade, 0.7, x, y, x + grade * 100 + 1, y + 1] for grade in range(5)]})
    source = import_result(argparse.Namespace(organization="local", marker="her2", slide=slide, result=path))
    save(archive_folder("local", signature) / "validation-evidence.json",
         [evidence(source, MEMBRANE, context, "SYNTH-HER2", 12.5, counts, unit="index")])

    slide = "CODIPAI-BRCA-SS-00194-S-TP-01.svs"
    signature = slide_signature(DATA_ROOT / slide)
    context = {**context, "histology": "synthetic_fixture", "stain": "PD-L1"}
    pair = {"context": context, "reviewed_by": "Synthetic QA", "reference": "SYNTH-PAIR-V1", "evidence_version": 1}
    records = []
    folder = snapshot_directory("local", signature)
    for variant, output, score, counts in (
        ("Stomach", "CPS", 75, {"0": 3, "2": 1, "3": 2}), ("Lung", "TPS", 25, {"0": 3, "1": 1, "2": 0}),
    ):
        schema = SCHEMAS[output]
        save(path, {"source": signature, "tissue_type": variant, "analysis_version": "QA-" + output,
                    "pd_score": {"score_type": output, "score": score, "class_counts": counts, "class_schema": schema},
                    "model_runtime": {"filename": MODELS[output], "version": "QA"},
                    "class_names": {key: "Synthetic Class " + key for key in counts}, "cells": [[20, 30, 0, 0.9]]})
        context_path = scratch / "pdl1-evidence-context.json"
        save(context_path, {"source_digest": hashlib.sha256(path.read_bytes()).hexdigest(),
                            "input": context, "checkpoint_sha256": "b" * 64, "score_schema": schema})
        args = argparse.Namespace(organization="local", slide=slide, result=path, original=None, editor=None,
                                  saved_at=None, audit=None, importer="QA", validation_context=context_path)
        original = import_snapshot(args)["id"]
        meta = json.loads((folder / original / "summary.json").read_text())
        reference = "SYNTH-" + output
        pair.update({output.lower() + "_snapshot_id": original, output.lower() + "_reference": reference})
        records.append(evidence(meta, schema, context, reference, score, counts))
        if output == "CPS":
            args.original, args.editor = original, "Synthetic Reviewer"
            import_snapshot(args)
    save(folder / "validation-evidence.json", records)
    save(folder / "comparison-validation.json", pair)
    save(scratch / "biomarker-evidence-location.json", {"pdl1": str(folder / "validation-evidence.json")})


if __name__ == "__main__":
    main(Path(os.environ["MEDIAUTO_BIOMARKER_TEST_DIR"]))
