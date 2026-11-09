"""Parse the LLM output and apply Hawkim's rule-based checks.

Checks
- output is a JSON object with the required fields
- label is one of the four permitted labels (common variants are normalised)
- in topk_select mode, requirement_id is one of the candidates (or NONE)
- evidence grounding: is the quoted SOP / requirement evidence really in the source text?
"""
from __future__ import annotations

import json
import re

LABELS = ["COMPLIANT", "PARTIAL", "CONFLICT", "NOT_ADDRESSED"]
NON_COMPLIANT_PRED = {"PARTIAL", "CONFLICT", "NOT_ADDRESSED"}

LABEL_ALIASES = {
    "COMPLIANT": "COMPLIANT", "FULLY_COMPLIANT": "COMPLIANT",
    "PARTIAL": "PARTIAL", "PARTIALLY_COMPLIANT": "PARTIAL", "PARTIAL_COMPLIANCE": "PARTIAL",
    "CONFLICT": "CONFLICT", "CONFLICTING": "CONFLICT", "CONTRADICTION": "CONFLICT",
    "NOT_ADDRESSED": "NOT_ADDRESSED", "NOTADDRESSED": "NOT_ADDRESSED",
}

REQUIRED_FIELDS = ["label", "sop_evidence", "justification"]   # requirement_evidence is optional (no longer asked for)


def normalize_label(value) -> str | None:
    if not isinstance(value, str):
        return None
    key = re.sub(r"[\s\-]+", "_", value.strip().upper())
    return LABEL_ALIASES.get(key)


def parse_json_object(text: str):
    """Extract the first JSON object from model text (handles code fences / extra prose)."""
    if not text:
        return None, "empty response"
    t = re.sub(r"```(?:json)?", "", text).strip()
    try:
        obj = json.loads(t)
        return (obj, None) if isinstance(obj, dict) else (None, "JSON is not an object")
    except Exception:
        pass
    start = t.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(t)):
            ch = t[i]
            if in_str:
                esc = (ch == "\\" and not esc)
                if ch == '"' and not esc:
                    in_str = False
                elif ch != "\\":
                    esc = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(t[start:i + 1])
                        if isinstance(obj, dict):
                            return obj, None
                    except Exception:
                        break
                    break
        start = t.find("{", start + 1)
    return None, "no valid JSON object found"


def _norm(s: str) -> str:
    s = s.lower().replace("…", " ").replace("...", " ")
    s = re.sub(r"[\"'“”‘’•]", "", s)
    return " ".join(s.split())


def is_grounded(evidence: str, source: str, min_token_recall: float = 0.8):
    """True if the evidence is (almost) literally present in the source; None if no evidence."""
    if not evidence or not str(evidence).strip():
        return None
    e, s = _norm(str(evidence)), _norm(source)
    if e in s:
        return True
    tokens = re.findall(r"\w+", e)
    if not tokens:
        return None
    src_tokens = set(re.findall(r"\w+", s))
    return sum(t in src_tokens for t in tokens) / len(tokens) >= min_token_recall


def validate(raw_text: str, mode: str, candidate_ids: list[str], sop_text: str,
             requirement_texts: dict[str, str]) -> dict:
    obj, err = parse_json_object(raw_text)
    result = {"valid": False, "errors": [], "notes": [], "label": None, "requirement_id": None,
              "sop_evidence": None, "requirement_evidence": None, "missing_or_conflicting_elements": None,
              "recommended_action": None,
              "justification": None, "sop_evidence_grounded": None, "req_evidence_grounded": None}
    if obj is None:
        result["errors"].append(err)
        return result

    for f in REQUIRED_FIELDS:
        if f not in obj:
            result["errors"].append(f"missing field: {f}")
    label = normalize_label(obj.get("label"))
    if label is None:
        result["errors"].append(f"invalid label: {obj.get('label')!r}")
    result["label"] = label
    for f in ("sop_evidence", "requirement_evidence", "missing_or_conflicting_elements", "justification",
              "recommended_action"):
        v = obj.get(f)
        result[f] = v if isinstance(v, str) else (json.dumps(v, ensure_ascii=False) if v is not None else None)

    if mode == "topk_select":
        rid = str(obj.get("requirement_id", "")).strip()
        if rid.upper() == "NONE":
            rid = "NONE"
            if label not in (None, "NOT_ADDRESSED"):
                result["errors"].append("requirement_id is NONE but label is not NOT_ADDRESSED")
        elif rid not in candidate_ids:
            result["errors"].append(f"requirement_id {rid!r} is not one of the candidates")
        result["requirement_id"] = rid
    else:
        result["requirement_id"] = candidate_ids[0] if candidate_ids else None

    result["sop_evidence_grounded"] = is_grounded(result["sop_evidence"] or "", sop_text)
    req_text = requirement_texts.get(result["requirement_id"] or "", " ".join(requirement_texts.values()))
    result["req_evidence_grounded"] = is_grounded(result["requirement_evidence"] or "", req_text)

    result["valid"] = not result["errors"]
    return result
