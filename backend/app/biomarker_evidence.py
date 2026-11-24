"""Match operator-maintained reference results to immutable biomarker archives."""

import json
import math
import re

INPUT_FIELDS = ("specimen_ref", "histology", "stain", "clone", "platform", "protocol", "region_ref")
HEX_DIGEST = re.compile(r"[a-f0-9]{64}")


def has_text(value):
    return isinstance(value, str) and 0 < len(value.strip()) <= 256


def valid_input(context, stain):
    return (isinstance(context, dict) and set(context) == set(INPUT_FIELDS)
            and all(has_text(context[key]) for key in INPUT_FIELDS) and context["stain"] == stain)


def validation_records(folder):
    if folder is None:
        return []
    try:
        entries = json.loads((folder / "validation-evidence.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return entries if isinstance(entries, list) else []


def match_evidence(entries, original, schema, value, counts, unit=None):
    """Return a reference only for the exact original, input, model and expected output."""
    if (original.get("kind", "original") != "original" or value is None
            or not HEX_DIGEST.fullmatch(original.get("checkpoint_sha256") or "")
            or not HEX_DIGEST.fullmatch(original.get("source_digest") or "")
            or not all(has_text(original.get(field)) for field in ("model", "analysis_version"))):
        return None
    identity = {field: original[field] for field in ("model", "checkpoint_sha256", "analysis_version", "source_digest")}
    identity.update(snapshot_id=original["id"], schema=schema, context=original.get("input_context"))
    if identity["context"] is None:
        return None
    matches = [entry for entry in entries if isinstance(entry, dict)
               and all(entry.get(field) == expected for field, expected in identity.items())]
    if len(matches) != 1:
        return None
    entry = matches[0]
    expected = entry.get("reference_result")
    if not all(has_text(entry.get(field)) for field in ("reference", "reviewed_by")) or not isinstance(expected, dict):
        return None
    score, baseline = expected.get("value"), expected.get("counts")
    if (not isinstance(baseline, dict) or any(type(n) is not int for n in baseline.values())
            or baseline != counts or expected.get("unit") != unit or type(score) not in (int, float)
            or not math.isclose(score, value, rel_tol=0, abs_tol=1e-7)):
        return None
    return {"reference": entry["reference"], "reviewed_by": entry["reviewed_by"],
            "reference_result": {"value": score, "counts": baseline, "unit": unit}}
