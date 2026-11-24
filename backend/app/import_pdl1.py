"""Import a Quanti PD-L1 cache or approved edit export as an immutable IMS snapshot."""

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from app.intake import DATA_ROOT
from app.pdl1 import slide_signature, snapshot_directory
from app.pdl1_policy import HEX_DIGEST, SUPPORTED, valid_context
MAX_INPUT_BYTES = 256 * 1024 * 1024


def bounded_text(value, limit=256):
    return value.strip() if isinstance(value, str) and 0 < len(value.strip()) <= limit else None


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def parse_cells(raw, width, height, class_names):
    if not isinstance(raw, list):
        raise ValueError("Saved cells must be a list")
    for cell in raw:
        if isinstance(cell, dict):
            x, y, category = (cell.get(key) for key in ("x", "y", "class_id"))
            hidden = cell.get("hidden", False)
        elif isinstance(cell, list) and len(cell) >= 4:
            x, y, category = cell[:3]
            hidden = len(cell) >= 9 and cell[8]
        else:
            raise ValueError("Unsupported saved cell encoding")
        if hidden:
            continue
        if not (number(x) and number(y) and 0 <= x < width and 0 <= y < height):
            raise ValueError("Saved cell is outside the level-0 slide")
        if type(category) is not int or str(category) not in class_names:
            raise ValueError("Saved cell class is absent from the source legend")
        yield [x, y, category]


def time_value(raw):
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        raise ValueError("Audit timestamps must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat()


def source_events(path):
    if path is None:
        return []
    entries = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(entries, list) or len(entries) > 1000:
        raise ValueError("Expected up to 1000 exported audit events")
    result = []
    for entry in entries:
        action, actor = bounded_text(entry.get("action")), bounded_text(entry.get("actor"))
        if not action or not actor:
            raise ValueError("Source audit action and actor are required")
        result.append({"action": action, "actor": actor, "occurred_at": time_value(entry["occurred_at"]),
                       "source": "exported", "reference": bounded_text(entry.get("reference"))})
    return sorted(result, key=lambda entry: entry["occurred_at"])


def import_snapshot(args):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", args.organization):
        raise ValueError("Invalid institution code")
    slide = (DATA_ROOT.resolve() / args.slide).resolve(strict=True)
    if not slide.is_relative_to(DATA_ROOT.resolve()) or slide.suffix.lower() not in (".ndpi", ".svs"):
        raise ValueError("Slide must be an NDPI or SVS under data/")
    if args.result.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError("Result exceeds maximum import size")
    payload = args.result.read_bytes()
    data = json.loads(payload)
    signature = slide_signature(slide)
    source = data.get("source") or {}
    if any(source.get(key) != value for key, value in signature.items()):
        raise ValueError("Result does not match the WSI filename, size, quickhash and dimensions")
    variant = data.get("tissue_type")
    score_data = data.get("pd_score") or {}
    score = score_data.get("score")
    if variant not in SUPPORTED or score_data.get("score_type") != SUPPORTED[variant]:
        raise ValueError("Unrecognized saved PD-L1 variant or score type")
    if not number(score) or not 0 <= score <= 100:
        raise ValueError("Saved score outside supported range")
    counts = score_data.get("class_counts") or {}
    if not isinstance(counts, dict) or any(type(value) is not int or value < 0 for value in counts.values()):
        raise ValueError("Invalid saved class counts")
    class_names = data.get("class_names") or {}
    class_colors = data.get("class_colors") or {}
    if not class_names or any(not re.fullmatch(r"[0-9]+", key) or not bounded_text(name)
                              for key, name in class_names.items()):
        raise ValueError("Invalid saved cell legend")
    classes = {key: {"label": name, "color": color if isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color)
                    else "#828b9b"} for key, name in class_names.items() for color in [class_colors.get(key)]}
    points = list(parse_cells(data.get("cells"), *signature["dimensions"], class_names))
    digest = hashlib.sha256(payload).hexdigest()
    folder = snapshot_directory(args.organization, signature)
    original = args.original
    analysis_version = bounded_text(data.get("analysis_version") or data.get("global_dedup_version"))
    saved_at = time_value(args.saved_at) if args.saved_at else None
    audit = source_events(args.audit)
    metadata = data.get("model_runtime") or {}
    score_schema = bounded_text(score_data.get("class_schema") or metadata.get("class_schema"))
    context_path = getattr(args, "validation_context", None)
    input_context = checkpoint = None
    if context_path is not None:
        checked = json.loads(context_path.read_text(encoding="utf-8"))
        input_context = checked["input"]
        checkpoint = checked["checkpoint_sha256"]
        if checked["source_digest"] != digest or not valid_context(input_context):
            raise ValueError("Validation context does not describe this PD-L1 source result")
        if not isinstance(checkpoint, str) or not HEX_DIGEST.fullmatch(checkpoint):
            raise ValueError("A verified checkpoint SHA-256 is required")
        if score_schema and score_schema != checked["score_schema"]:
            raise ValueError("Validation context class schema differs from the saved result")
        score_schema = checked["score_schema"]
    if original:
        if not re.fullmatch(r"[a-f0-9]{64}", original) or not bounded_text(args.editor):
            raise ValueError("An edit requires the original snapshot ID and a verified editor label")
        parent = json.loads((folder / original / "summary.json").read_text(encoding="utf-8"))
        if parent["kind"] != "original" or parent["variant"] != variant:
            raise ValueError("An edit must reference the original for the same scan and model variant")
        for key, version in (("model", bounded_text(metadata.get("filename"))), ("analysis_version", analysis_version)):
            if version and parent[key] and version != parent[key]:
                raise ValueError("Edited snapshot version differs from its original")
    elif args.editor:
        raise ValueError("An editor requires an original snapshot ID")
    # The base save operation can preserve a stale pd_score after replacing the cells.
    score_confirmed = not original
    identity = [digest, original, args.editor, saved_at, audit, score_confirmed]
    if input_context is not None:
        identity.extend((input_context, checkpoint, score_schema))
    snapshot_id = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    summary = {
        "id": snapshot_id, "kind": "edited" if original else "original", "original_id": original,
        "variant": variant, "score_type": SUPPORTED[variant], "score": score if score_confirmed else None,
        "counts": counts if score_confirmed else {},
        "classes": classes, "point_count": len(points), "dimensions": signature["dimensions"],
        "model": bounded_text(metadata.get("filename")), "model_version": bounded_text(metadata.get("version")),
        "architecture": bounded_text(metadata.get("architecture")), "model_bytes": metadata["size"] if type(metadata.get("size")) is int else None,
        "model_mtime_ns": str(metadata["mtime_ns"]) if type(metadata.get("mtime_ns")) is int else None,
        "analysis_version": analysis_version,
        "input_context": input_context, "checkpoint_sha256": checkpoint, "score_schema": score_schema,
        "source_digest": digest, "editor": args.editor, "saved_at": saved_at, "audit": audit,
    }
    summary["audit"].append({"action": "snapshot_imported", "actor": bounded_text(args.importer) or "IMS",
                             "occurred_at": datetime.now(timezone.utc).isoformat(), "source": "ims"})
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=".import-", dir=folder))
    try:
        (temp / "summary.json").write_text(json.dumps(summary, ensure_ascii=False), encoding="utf-8")
        (temp / "cells.json").write_text(json.dumps(points, separators=(",", ":")), encoding="utf-8")
        try:
            temp.rename(folder / snapshot_id)
        except OSError:
            if not (folder / snapshot_id / "summary.json").is_file():
                raise
    finally:
        if temp.exists():
            shutil.rmtree(temp)
    return {"id": snapshot_id, "kind": summary["kind"], "type": summary["score_type"], "points": len(points)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--organization", default="local")
    parser.add_argument("--slide", required=True, help="Path relative to data/")
    parser.add_argument("--result", required=True, type=Path)
    parser.add_argument("--original")
    parser.add_argument("--editor")
    parser.add_argument("--saved-at")
    parser.add_argument("--audit", type=Path)
    parser.add_argument("--validation-context", type=Path)
    parser.add_argument("--importer", default="IMS")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(import_snapshot(args)))
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        parser.exit(1, f"PD-L1 import failed: {error}\n")


if __name__ == "__main__":
    main()
