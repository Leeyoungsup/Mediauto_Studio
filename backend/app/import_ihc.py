"""Verify and import a base Quanti IHC cell archive against its level-0 WSI."""

import argparse
import json
import re
import tempfile
from pathlib import Path

from app.her2 import INTENSITY, SCHEMAS, source_contract
from app.ihc_archive import GRADES, MARKERS, archive_folder, digest
from app.import_pdl1 import MAX_INPUT_BYTES, bounded_text, number
from app.intake import DATA_ROOT
from app.pdl1 import slide_signature

HEX = re.compile(r"[a-f0-9]{64}")


def import_result(args):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", args.organization):
        raise ValueError("Invalid institution code")
    slide = (DATA_ROOT.resolve() / args.slide).resolve(strict=True)
    if not slide.is_relative_to(DATA_ROOT.resolve()) or slide.suffix.lower() not in (".ndpi", ".svs"):
        raise ValueError("Slide must be an NDPI or SVS under data/")
    if args.result.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError("Result exceeds maximum import size")
    payload = args.result.read_bytes()
    source_id = digest(payload)
    data = json.loads(payload)
    signature = slide_signature(slide)
    if any((data.get("source") or {}).get(key) != value for key, value in signature.items()):
        raise ValueError("Result does not match the WSI filename, size, quickhash and dimensions")
    if data.get("marker") != MARKERS[args.marker]:
        raise ValueError("The source marker pipeline does not match the declared stain")
    model = data.get("model_runtime") or {}
    filename = bounded_text(model.get("filename"))
    analysis = bounded_text(data.get("analysis_version") or data.get("global_dedup_version"))
    checkpoint = model.get("checkpoint_sha256")
    version = bounded_text(model.get("version"))
    if checkpoint is not None and (not isinstance(checkpoint, str) or not HEX.fullmatch(checkpoint)):
        raise ValueError("Invalid checkpoint digest")
    if checkpoint and not version:
        raise ValueError("Checkpoint provenance requires a recorded model version")
    if version is None and all(type(model.get(key)) is int and model[key] > 0 for key in ("size", "mtime_ns")):
        version = f'Archive: {model["size"]} bytes / mtime {model["mtime_ns"]}'
    threshold = data.get("score_conf_threshold")
    if not filename or not analysis or not version or not number(threshold) or not 0 <= threshold <= 1:
        raise ValueError("Model provenance, analysis version and a valid confidence threshold are required")

    her2 = args.marker == "her2"
    schema = data.get("score_schema", INTENSITY) if her2 else None
    if her2 and (not isinstance(schema, str) or schema not in SCHEMAS):
        raise ValueError("Unsupported HER2 output schema")
    grades = range(len(SCHEMAS[schema])) if her2 else GRADES
    scored_grades = grades if her2 else range(4)
    count_key = {"ki67": "ki67_score", "her2": "her2_score"}.get(args.marker, "allred_score")
    width, height = signature["dimensions"]
    if not isinstance(data.get("cells"), list):
        raise ValueError("Missing original cell array")
    rows = []
    for cell in data["cells"]:
        if not isinstance(cell, list) or len(cell) != 8:
            raise ValueError("Expected original Quanti IHC detections")
        x, y, grade, confidence = cell[:4]
        if not (number(x) and number(y) and 0 <= x < width and 0 <= y < height
                and type(grade) is int and grade in grades and number(confidence) and 0 <= confidence <= 1):
            raise ValueError("Invalid cell coordinates, grade or detection confidence")
        rows.append([x, y, grade, confidence])

    summary = data.get(count_key) or {}
    source_counts = summary.get("class_counts")
    if not isinstance(source_counts, dict) or any(type(source_counts.get(str(i))) is not int or source_counts[str(i)] < 0
                                                  for i in scored_grades):
        raise ValueError("Original counts are required to verify replay at the saved threshold")
    if her2 and set(source_counts) != set(map(str, scored_grades)):
        raise ValueError("HER2 counts include classes outside the declared schema")
    source_counts = [source_counts[str(i)] for i in scored_grades]
    original_counts = source_counts + [0] * (len(GRADES) - len(source_counts))
    replay_counts = [0] * len(GRADES)
    for _, _, grade, confidence in rows:
        if confidence >= threshold:
            replay_counts[grade] += 1
    record = {"id": source_id, "marker": args.marker, "dimensions": signature["dimensions"],
              "model": filename, "model_version": version, "checkpoint_sha256": checkpoint,
              "analysis_version": analysis, "default_threshold": threshold, "point_count": len(rows),
              "original_counts": original_counts, "replay_aligned": replay_counts == original_counts}
    if her2:
        record.update(source_contract(data, filename, source_counts))
        record["source_digest"] = source_id
    parent = archive_folder(args.organization, signature)
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = parent / source_id
    if target.exists():
        if json.loads((target / "manifest.json").read_text(encoding="utf-8")) != record:
            raise ValueError("Archive already exists with different marker or metadata")
        return record
    with tempfile.TemporaryDirectory(dir=parent) as scratch:
        staging = Path(scratch) / "snapshot"
        staging.mkdir(mode=0o700)
        (staging / "cells.json").write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
        (staging / "manifest.json").write_text(json.dumps(record), encoding="utf-8")
        try:
            staging.rename(target)
        except OSError:
            if not target.is_dir() or json.loads((target / "manifest.json").read_text(encoding="utf-8")) != record:
                raise
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--organization", required=True)
    parser.add_argument("--marker", choices=MARKERS, required=True)
    parser.add_argument("--slide", required=True, help="WSI path relative to data/. Declare its verified stain with --marker.")
    parser.add_argument("--result", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = import_result(args)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
