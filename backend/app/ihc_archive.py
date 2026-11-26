"""Immutable Quanti IHC source archives and the versioned aggregation contract."""

import hashlib
import json
import os
from bisect import bisect_left
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

from app.cell_overlay import BUCKET
from app.pdl1 import signature_key

MARKERS = {"ki67": "KI_67", "er": "ER_PR", "pr": "ER_PR", "her2": "HER2"}
RULES = {"ki67": "quanti-ki67-index-v1", "er": "quanti-allred-v1", "pr": "quanti-allred-v1"}
GRADES = range(5)


def archive_folder(organization, signature):
    root = Path(os.environ.get("MEDIAUTO_IHC_ROOT", Path(__file__).resolve().parents[2] / ".runtime" / "ihc"))
    return root / organization / signature_key(signature)


@lru_cache(maxsize=3)
def load_cells(path, modified):
    with path.open(encoding="utf-8") as stream:
        rows = [tuple(row) for row in json.load(stream)]
    buckets = defaultdict(list)
    confidences = [[] for _ in GRADES]
    for index, (x, y, grade, confidence) in enumerate(rows):
        buckets[int(x) // BUCKET, int(y) // BUCKET].append(index)
        confidences[grade].append(confidence)
    for values in confidences:
        values.sort()
    return rows, buckets, confidences


def archive_cells(folder):
    path = folder / "cells.json"
    return load_cells(path, path.stat().st_mtime_ns)


def counts_at(rows, confidences, threshold, overrides):
    counts = [len(values) - bisect_left(values, threshold) for values in confidences]
    for key, grade in overrides.items():
        _, _, original, confidence = rows[int(key)]
        counts[original] -= int(confidence >= threshold)
        counts[grade] += 1
    return counts


def aggregate(rule, counts, minimum_tumor_cells):
    negative, weak, moderate, strong, _other = counts
    positive = weak + moderate + strong
    total = negative + positive
    if not total or total < minimum_tumor_cells:
        return None
    percent = round(100 * positive / total, 2)
    if rule == RULES["ki67"]:
        return {"kind": "ki67", "percent": percent, "positive": positive, "total": total}
    proportion = (1 + sum(100 * positive >= boundary * total for boundary in (1, 10, 33, 66))) if positive else 0
    weighted_twice = 2 * (weak + 2 * moderate + 3 * strong)
    intensity = sum(weighted_twice >= boundary * positive for boundary in (1, 3, 5)) if positive else 0
    return {"kind": "allred", "percent": percent, "positive": positive, "total": total,
            "proportion": proportion, "intensity": intensity, "score": proportion + intensity}


def approved_rule(organization, stain, original, threshold, overrides):
    path = os.environ.get("MEDIAUTO_IHC_VALIDATION_FILE")
    if not path or stain not in RULES or stain != original["marker"] or not original.get("checkpoint_sha256"):
        return None
    try:
        entries = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(entries, list):
        return None
    fields = ("marker", "model_version", "analysis_version", "checkpoint_sha256")
    for entry in entries:
        if not isinstance(entry, dict) or not (
            entry.get("organization") == organization and entry.get("source_id") == original["id"]
            and all(entry.get(field) == original[field] for field in fields)
            and entry.get("rule") == RULES[stain]
        ):
            continue
        texts = ("reference", "clone", "platform", "protocol", "scoring_scope")
        minimum = entry.get("minimum_tumor_cells")
        thresholds = entry.get("confidence_thresholds")
        if (all(isinstance(entry.get(key), str) and 0 < len(entry[key].strip()) <= 256 for key in texts)
            and type(minimum) is int and minimum > 0 and isinstance(thresholds, list)
            and any(type(value) in (int, float) and threshold == value for value in thresholds)
            and (not overrides or entry.get("allow_cell_overrides") is True)):
            return entry
    return None


def digest(data):
    return hashlib.sha256(data).hexdigest()
