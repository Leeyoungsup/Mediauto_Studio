"""Technical HER2 intensity and explicit membrane-pattern archive contracts."""

import math

from app.biomarker_evidence import match_evidence, valid_input, validation_records

INTENSITY = "her2-intensity-v1"
MEMBRANE = "her2-membrane-patterns-v1"
MODEL = "Precise_IHC_HER2_detection.pt"
SCHEMAS = {
    INTENSITY: ("Intensity 0+", "Intensity 1+", "Intensity 2+", "Intensity 3+"),
    MEMBRANE: ("Absent", "Partial Weak", "Partial Strong", "Complete Weak", "Complete Strong"),
}


def source_contract(data, model, counts):
    schema = data.get("score_schema", INTENSITY)
    if not isinstance(schema, str) or schema not in SCHEMAS or (schema == INTENSITY and model != MODEL):
        raise ValueError("Unsupported HER2 model or output schema")
    values = data["her2_score"]
    total = sum(counts)
    if type(values.get("total_tumor")) is not int or values["total_tumor"] != total:
        raise ValueError("HER2 tumor population does not match the source counts")
    if schema == INTENSITY:
        expected = round(sum(grade * count for grade, count in enumerate(counts)) / total, 3) if total else 0
        score = values.get("score")
        if values.get("score_type") != "HER2" or type(score) not in (int, float) or score != expected:
            raise ValueError("HER2 weighted intensity does not match the source counts")
        unit = None
    else:
        score = values.get("composite")
        unit = values.get("unit")
        if values.get("score_type") != "HER2 Composite" or type(score) not in (float, int) or not math.isfinite(score):
            raise ValueError("An explicit finite HER2 Composite value is required")
        if unit not in ("index", "percent") or (unit == "percent" and not 0 <= score <= 100):
            raise ValueError("Invalid HER2 Composite unit or range")
    context = data.get("input_context")
    if context is not None and not valid_input(context, "HER2"):
        raise ValueError("Invalid HER2 assay and specimen context")
    return {"score_schema": schema, "input_context": context,
            "source_value": score if total else None, "source_unit": unit}


def clinical_display(folder, stain, original, revision, aligned):
    score = original["source_value"]
    context = original["input_context"]
    evidence = None
    original_state = revision is None or revision.action == "restore"
    if (original_state and aligned and stain == "her2" and valid_input(context, "HER2")
            and context["histology"] == "invasive_breast_carcinoma"):
        counts = {str(i): n for i, n in enumerate(original["original_counts"][:len(SCHEMAS[original["score_schema"]])])}
        evidence = match_evidence(validation_records(folder.parent), original, original["score_schema"], score, counts, original["source_unit"])
    status = ("edited_score_unverified" if not original_state else "source_replay_unverified" if not aligned
              else "available" if evidence else "approval_required")
    return {"status": status, "evidence": evidence, "rule": original["score_schema"], "approval": None,
            "aggregate": {"kind": original["score_schema"], "value": score,
                          "unit": original["source_unit"]} if evidence else None}
