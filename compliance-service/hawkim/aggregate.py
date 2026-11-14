"""Turns the per-step results of a check into one finding per GVP requirement,
in the shape the website's compliance_findings table expects.

Grouping: every SOP step is compared with one requirement; steps compared with the
same requirement form one finding. The finding gets the most serious result among
its steps (conflict > not-addressed > partial > compliant, the website's order),
and the SOP reference lists the sections of those steps.
"""
from __future__ import annotations

import re

LABEL_TO_RESULT = {"COMPLIANT": "compliant", "PARTIAL": "partial", "CONFLICT": "conflict",
                   "NOT_ADDRESSED": "not-addressed"}
# The website's result order (frontend/src/lib/compliance.ts RESULT_ORDER): problems first.
RESULT_ORDER = ["conflict", "not-addressed", "partial", "compliant"]
_SECTION_NUM = re.compile(r"^\d+(?:[.\-]\d+)*")


def _section_ref(heading: str) -> str:
    """'5 Procedures > 5-4 Training … > 5-4-1' -> '5-4-1'; '5 Procedures > 5-4 Training …' -> '5-4'."""
    last = (heading or "").split(" > ")[-1].strip()
    m = _SECTION_NUM.match(last)
    return m.group(0) if m else last[:40]


def _module(section: str) -> str:
    return "Module " + (section or "").split(".")[0]


def requirement_passage(unit: dict) -> dict:
    """A GVP requirement unit (index units.jsonl) as a guideline_requirements row, the same way
    complete_compliance_check saves the passage a finding refers to."""
    return {
        "code": unit["id"],
        "module": _module(unit["section"]),
        "section": unit["section"],
        "section_title": (unit.get("section_title") or unit["section"])[:200],
        "short_title": (unit.get("section_title") or unit["section"])[:120],
        "page": max(1, int(unit.get("page") or 1)),
        "summary": unit["text"],
    }


def _sort_key(ref: str):
    return [int(p) for p in re.split(r"[.\-]", ref) if p.isdigit()] or [0]


def findings_for_database(check: dict) -> tuple[list[dict], dict]:
    """check: the result of ComplianceService.check(). Returns (findings, stats)."""
    groups: dict[str, list[dict]] = {}
    invalid = 0
    for f in check.get("findings", []):
        req = f.get("requirement")
        if not f.get("valid") or not f.get("label") or not req:
            invalid += 1
            continue
        groups.setdefault(req["id"], []).append(f)

    out = []
    for code, steps in groups.items():
        req = steps[0]["requirement"]
        for s in steps:
            s["_result"] = LABEL_TO_RESULT[s["label"]]
        steps.sort(key=lambda s: (RESULT_ORDER.index(s["_result"]), _sort_key(_section_ref(s["heading"]))))
        result = steps[0]["_result"]
        refs = sorted({_section_ref(s["heading"]) for s in steps}, key=_sort_key)
        reference = ("Section " if len(refs) == 1 else "Sections ") + ", ".join(refs)
        if len(steps) == 1:
            justification = steps[0]["justification"] or ""
        else:
            justification = " ".join(f"Section {_section_ref(s['heading'])}: {s['justification'] or ''}".strip()
                                     for s in steps)
        actions = []
        if result != "compliant":
            for s in steps:
                a = (s.get("recommended_action") or "").strip()
                if s["_result"] != "compliant" and a and a not in actions:
                    actions.append(a)
        passage = requirement_passage(req)
        out.append({
            "requirement_code": code,
            "module": passage["module"],
            "section": passage["section"],
            "section_title": passage["section_title"],
            "short_title": passage["short_title"],
            "page": passage["page"],
            "requirement_text": passage["summary"],
            "result": result,
            "justification": justification[:4000] or "No justification was returned.",
            "sop_reference": reference,
            "recommended_action": " ".join(actions)[:2000] if actions else None,
            "evidence": {
                "steps": [{
                    "chunk_id": s["chunk_id"], "section": _section_ref(s["heading"]), "heading": s["heading"],
                    "chunk_type": s["chunk_type"], "page": s["page"], "result": s["_result"],
                    "similarity": s["similarity"], "sop_evidence": s.get("sop_evidence"),
                    "sop_text": s.get("text"),
                    "sop_evidence_found_in_text": s.get("sop_evidence_found_in_text"),
                    "missing_or_conflicting_elements": s.get("missing_or_conflicting_elements"),
                    "justification": s.get("justification"), "flags": s.get("flags"),
                    "decided_by": s.get("decided_by"),
                } for s in steps],
                "requirement_text": req["text"],
            },
        })
    out.sort(key=lambda f: (RESULT_ORDER.index(f["result"]), f["requirement_code"]))
    stats = {"steps_checked": check.get("summary", {}).get("chunks_checked"), "steps_not_assessed": invalid,
             "requirements": len(out),
             "results": {r: sum(1 for f in out if f["result"] == r) for r in RESULT_ORDER}}
    return out, stats
