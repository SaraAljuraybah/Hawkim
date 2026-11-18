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
        self.scope_mode = scope_mode
        self.engine = Engine(self.cfg, scope_mode=scope_mode)
        self._engines: dict[str, Engine] = {}

    @property
    def embedder(self):
        """The loaded embedding model (BGE-M3), shared by every GVP version."""
        return self.engine.index.embedder

    def engine_for(self, index_dir: str | Path | None) -> Engine:
        """The engine for a GVP version's index folder (None: the local index). Kept in memory."""
        if index_dir is None:
            return self.engine
        key = str(Path(index_dir).resolve())
        if key not in self._engines:
            self._engines[key] = Engine(self.cfg, scope_mode=self.scope_mode, index_dir=Path(index_dir),
                                        embedder=self.embedder)
        return self._engines[key]

    def info(self, engine: Engine | None = None) -> dict:
        e = engine or self.engine
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

    def check(self, sop_path: str | Path, confirmed_modules: list[str] | None = None,
              engine: Engine | None = None) -> dict:
        """`engine`: the GVP version's engine (engine_for); default: the local index."""
        engine = engine or self.engine
        res = engine.assess_file(sop_path, scope_override=confirmed_modules, log=None)
        units = engine.index.by_id
        findings = []
        for r in res["records"]:
            chosen = r["requirement_used"] or ""
            justification = r["justification"]
            flags = list(r["flags"])
            label, valid = r["label"], r["valid"]
            error = r["llm_error"] or ("; ".join(r["validation_errors"]) or None)
            action, missing = r.get("recommended_action"), r["missing_or_conflicting_elements"]
            # The quote is shown as the step's SOP text only when it is really in the step (the model
            # sometimes copies the requirement instead); otherwise the website shows the whole step.
            evidence = r["sop_evidence"] if r["sop_evidence_grounded"] is not False else ""
            # An answer the system cannot use (invalid JSON, a requirement that was not offered, ...) must
            # not drop the step: it stays in the report as Requires Human Review, under its closest requirement.
            if not valid and r["retrieved"]:
                chosen = r["retrieved"][0]["id"]
                label, valid, evidence, action, missing = "NOT_ADDRESSED", True, "", "", ""
                justification = (f"The model's answer could not be used ({error}), so a reviewer should assess "
                                  f"this step against the closest GVP requirement.")
                flags.append("model_answer_invalid")
            # Top-3 mode: the model found that none of the candidates applies ("NONE"). The step stays in the
            # report as Requires Human Review, under its closest requirement, so a reviewer decides.
            if chosen == "NONE" and r["retrieved"]:
                closest = ", ".join(c for c in r.get("llm_candidates") or [h["id"] for h in r["retrieved"][:3]])
                chosen = r["retrieved"][0]["id"]
                justification = (f"None of the closest GVP requirements ({closest}) applies to this step, so a "
                                 f"reviewer should decide which requirement it must meet. {justification or ''}").strip()
                flags.append("no_candidate_applies")
            u = units.get(chosen)
            # The similarity of the requirement used (in top-3 mode the model may choose the 2nd or 3rd).
            score = next((h["score"] for h in r["retrieved"] if h["id"] == chosen), None)
            findings.append({
                "chunk_id": r["chunk_id"], "chunk_type": r["chunk_type"], "heading": r["heading"],
                "page": r["page_start"], "text": r["text"],
                "label": label if valid else None, "valid": valid, "decided_by": r["decided_by"],
                "requirement": ({"id": u["id"], "section": u["section"], "section_title": u.get("section_title"),
                                 "page": u.get("page"), "text": u["text"]} if u else None),
                "similarity": score,
                "other_candidates": [{"id": h["id"], "score": h["score"]} for h in r["retrieved"] if h["id"] != chosen],
                "sop_evidence": evidence, "sop_evidence_found_in_text": r["sop_evidence_grounded"],
                "missing_or_conflicting_elements": missing,
                "recommended_action": action,
                "justification": justification, "flags": flags, "raw_output": r.get("raw_output"),
                "review_required": r["review_required"] or not r["valid"], "error": error})
        findings.sort(key=lambda f: (LABEL_ORDER.index(f["label"]) if f["label"] in LABEL_ORDER else -1))
        counts = Counter(f["label"] or "INVALID" for f in findings)
        return {
            "sop_file": res["sop_file"], "title": res["title"],
            "checked_at": dt.datetime.now().isoformat(timespec="seconds"),
            "engine": self.info(engine),
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
