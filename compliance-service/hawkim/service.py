"""Website-facing service: one call per SOP, JSON result for the backend to store."""
from __future__ import annotations

import datetime as dt
from collections import Counter
from pathlib import Path

from .engine import Engine
from .pipeline import load_config

LABEL_ORDER = ["CONFLICT", "PARTIAL", "NOT_ADDRESSED", "COMPLIANT"]


class ComplianceService:
    """Load once at startup (models and index stay in memory), then call check() per SOP."""

    def __init__(self, config_path: str = "config.yaml", scope_mode: str | None = None):
        self.cfg = load_config(config_path)
        self.engine = Engine(self.cfg, scope_mode=scope_mode)

    def info(self) -> dict:
        e = self.engine
        return {"llm": f"{e.lc['provider']}:{e.lc['model']}", "mode": e.mode, "scope_mode": e.scope_mode,
                "matrix_version": e.classifier.version if e.classifier else None,
                "embedding": f"{self.cfg['embedding']['backend']}:{self.cfg['embedding'].get('model')}",
                "gvp_index": {"file": Path(e.index.meta.get("gvp_file", "")).name, "sha1": e.index.meta.get("gvp_sha1"),
                              "units": e.index.meta.get("n_units"), "excluded_authority_units": int(e.excluded.sum())},
                "modules": sorted(set(e.unit_module.tolist()), key=_roman)}

    def suggest_scope(self, sop_path: str | Path) -> dict:
        """Fast (no LLM): title, purpose and the modules the expert matrix suggests."""
        prep = self.engine.prepare(sop_path)
        sc = prep["scope"]
        return {"sop_file": Path(sop_path).name, "title": prep["title"],
                "scope": sc.to_dict() if sc else None, "chunks_to_check": len(prep["chunks"]),
                "warnings": prep["warnings"]}

    def check(self, sop_path: str | Path, confirmed_modules: list[str] | None = None) -> dict:
        res = self.engine.assess_file(sop_path, scope_override=confirmed_modules, log=None)
        units = self.engine.index.by_id
        findings = []
        for r in res["records"]:
            u = units.get(r["requirement_used"] or "")
            findings.append({
                "chunk_id": r["chunk_id"], "chunk_type": r["chunk_type"], "heading": r["heading"],
                "page": r["page_start"], "text": r["text"],
                "label": r["label"] if r["valid"] else None, "valid": r["valid"], "decided_by": r["decided_by"],
                "requirement": ({"id": u["id"], "section": u["section"], "section_title": u.get("section_title"),
                                 "page": u.get("page"), "text": u["text"]} if u else None),
                "similarity": r["retrieved"][0]["score"] if r["retrieved"] else None,
                "other_candidates": [{"id": h["id"], "score": h["score"]} for h in r["retrieved"][1:]],
                "sop_evidence": r["sop_evidence"], "sop_evidence_found_in_text": r["sop_evidence_grounded"],
                "missing_or_conflicting_elements": r["missing_or_conflicting_elements"],
                "recommended_action": r.get("recommended_action"),
                "justification": r["justification"], "flags": r["flags"], "raw_output": r.get("raw_output"),
                "review_required": r["review_required"], "error": r["llm_error"] or ("; ".join(r["validation_errors"]) or None)})
        findings.sort(key=lambda f: (LABEL_ORDER.index(f["label"]) if f["label"] in LABEL_ORDER else -1))
        counts = Counter(f["label"] or "INVALID" for f in findings)
        return {
            "sop_file": res["sop_file"], "title": res["title"],
            "checked_at": dt.datetime.now().isoformat(timespec="seconds"),
            "engine": self.info(),
            "scope": res["scope"], "scope_flags": res["scope_flags"],
            "summary": {"chunks_checked": res["n_chunks_checked"], "labels": dict(counts),
                        "review_required": sum(1 for f in findings if f["review_required"]),
                        "errors": sum(1 for f in findings if f["error"])},
            "findings": findings, "warnings": res["warnings"],
            "disclaimer": "Decision support only. Findings must be reviewed by an authorised person.",
        }


def _roman(m: str) -> int:
    vals = {"I": 1, "V": 5, "X": 10}
    total = 0
    for i, ch in enumerate(m):
        v = vals.get(ch, 0)
        total += -v if i + 1 < len(m) and vals.get(m[i + 1], 0) > v else v
    return total
