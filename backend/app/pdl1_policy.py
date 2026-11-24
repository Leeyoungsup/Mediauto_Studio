"""Display policy for saved Quanti PD-L1 results; no inference or clinical thresholds."""

import math
import re

SUPPORTED = {"Stomach": "CPS", "Lung": "TPS"}
MODELS = {"CPS": "PDL1_ST_CPS_detection.pt", "TPS": "PDL1_TPS_detection.pt"}
NATIVE_HISTOLOGY = {"CPS": {"gastric_adenocarcinoma"}, "TPS": {"nsclc"}}
INPUT_FIELDS = ("specimen_ref", "histology", "stain", "clone", "platform", "protocol", "region_ref")
HEX_DIGEST = re.compile(r"[a-f0-9]{64}")


def has_text(value):
    return isinstance(value, str) and 0 < len(value.strip()) <= 256


def valid_context(value):
    return (isinstance(value, dict) and set(value) == set(INPUT_FIELDS)
            and all(has_text(value[key]) for key in INPUT_FIELDS)
            and value["stain"] == "PD-L1")


def score_from_counts(score_type, counts):
    """Check the d3741bc flat-five CPS or three-class TPS output at stored precision."""
    if score_type not in MODELS or not isinstance(counts, dict):
        return None
    expected = set("01234") if score_type == "CPS" else set("012")
    required = set("023") if score_type == "CPS" else set("01")
    if not required <= counts.keys() <= expected or any(type(value) is not int or value < 0 for value in counts.values()):
        return None
    positive_key = "2" if score_type == "CPS" else "1"
    denominator = counts["0"] + counts[positive_key]
    if not denominator:
        return None
    numerator = counts[positive_key] + (counts["3"] if score_type == "CPS" else 0)
    return round(min(100.0, numerator / denominator * 100), 2)


def valid_saved_score(snapshot):
    kind, score_type, score = (snapshot.get(key) for key in ("kind", "score_type", "score"))
    if kind != "original" or score_type not in MODELS or SUPPORTED.get(snapshot.get("variant")) != score_type:
        return False
    if snapshot.get("model") and snapshot["model"] != MODELS[score_type]:
        return False
    schema = snapshot.get("score_schema")
    if schema and schema != ("pdl1_flat_5class" if score_type == "CPS" else "tps_3class"):
        return False
    expected = score_from_counts(score_type, snapshot.get("counts"))
    return (expected is not None and type(score) in (float, int) and 0 <= score <= 100
            and math.isclose(score, expected, rel_tol=0, abs_tol=1e-7))


def approved_pair(candidates, validation):
    if not isinstance(validation, dict) or not valid_context(validation.get("context")):
        return None
    if not all(has_text(validation.get(field)) for field in ("reference", "reviewed_by", "cps_reference", "tps_reference")):
        return None
    by_id = {item["id"]: item for item in candidates}
    pair = {}
    for score_type in ("CPS", "TPS"):
        snapshot_id = validation.get(score_type.lower() + "_snapshot_id")
        if not isinstance(snapshot_id, str) or not HEX_DIGEST.fullmatch(snapshot_id):
            return None
        item = by_id.get(snapshot_id)
        schema = "pdl1_flat_5class" if score_type == "CPS" else "tps_3class"
        if not item or item["score_type"] != score_type or item.get("input_context") != validation["context"]:
            return None
        if (item.get("model") != MODELS[score_type] or not has_text(item.get("analysis_version"))
                or not HEX_DIGEST.fullmatch(item.get("checkpoint_sha256") or "") or item.get("score_schema") != schema):
            return None
        pair[score_type.lower() + "_snapshot_id"] = snapshot_id
    return {**pair, "reference": validation["reference"]}


def display_policy(results, validation):
    numeric = [result for result in results if valid_saved_score(result)]
    types = {result["score_type"] for result in numeric}
    pair = approved_pair(numeric, validation)
    pair_ids = {pair["cps_snapshot_id"], pair["tps_snapshot_id"]} if pair is not None else set()
    scopes = {tuple(scope[key] for key in INPUT_FIELDS if key != "region_ref")
              for result in numeric if valid_context(scope := result.get("input_context"))}
    visible = []
    numeric_ids = {result["id"] for result in numeric}
    for result in results:
        score_type = result["score_type"]
        context = result.get("input_context")
        native = (valid_context(context) and context["histology"] in NATIVE_HISTOLOGY.get(score_type, ())
                  and result.get("model") == MODELS.get(score_type))
        if result["kind"] == "edited":
            status = "edited_score_unverified"
        elif result["id"] not in numeric_ids:
            status = "invalid_saved_score"
        elif result["id"] in pair_ids:
            status = "validated_pair"
        elif native and len(scopes) <= 1:
            status = "native"
        elif context is not None or len(types) > 1:
            status = "input_unverified"
        else:
            status = "archived"
        hide = status in ("edited_score_unverified", "invalid_saved_score", "input_unverified")
        visible.append({**result, "score_status": status, "score": None if hide else result["score"],
                        "counts": {} if hide else result["counts"]})
    status = "available" if pair else "validation_required" if len(types) > 1 else "insufficient_scores"
    return {"results": visible, "comparison": {"status": status, "pair": pair}}
