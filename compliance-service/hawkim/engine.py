"""The Hawkim compliance engine.

One code path for both uses:
  - evaluation   (run.py run -> predictions.jsonl -> metrics)
  - the website  (api.py -> JSON stored by the backend)

Per SOP file:
  1. extract text, chunk it, keep the Procedures section (chunk_type = intro | step)
  2. scope: read title + Purpose, apply the expert GVP mapping matrix -> GVP modules
  3. retrieval with BGE-M3: inside the scope (scope.mode = matrix) and, for tracking, without it
  4. Qwen judges each chunk against the retrieved requirement
  5. rule-based validation and review flags
"""
from __future__ import annotations

import re
import string
from pathlib import Path

import numpy as np

from .chunking import chunk_sop
from .embeddings import VectorIndex, model_slug
from .extract import extract_document
from .llm import LLMClient
from .metrics import requirement_matches
from .scope import ScopeClassifier, module_of, sop_purpose, sop_title
from .validation import validate

STEP_RE = re.compile(r"^\d+(?:[.\-]\d+){2,}$")


def index_folder(cfg: dict) -> Path:
    e = cfg["embedding"]
    return Path(cfg["paths"]["index_dir"]) / model_slug(e["backend"], e.get("model"))


def _format_requirement(u: dict) -> str:
    return f"ID: {u['id']}\nSection: {u['section']} {u.get('section_title', '')}\nText:\n{u['text']}"


class Engine:
    def __init__(self, cfg: dict, mode: str | None = None, scope_mode: str | None = None,
                 cache_dir: Path | None = None, index_dir: Path | None = None, embedder=None):
        """`index_dir`: the GVP version's index (default: the local index in paths.index_dir);
        `embedder`: an already-loaded embedding model to reuse."""
        self.cfg = cfg
        self.lc = dict(cfg["llm"])
        if mode:
            self.lc["mode"] = mode
        self.mode = self.lc["mode"]
        if self.mode not in ("top1", "topk_select"):
            raise SystemExit("llm.mode must be top1 or topk_select")

        sc = cfg.get("scope", {}) or {}
        self.scope_mode = scope_mode or sc.get("mode", "none")
        if self.scope_mode not in ("none", "matrix"):
            raise SystemExit("scope.mode must be none or matrix")
        self.classifier = None
        matrix = sc.get("matrix_file")
        if matrix and Path(matrix).exists():
            self.classifier = ScopeClassifier(matrix, sc.get("include_secondary", True))
        elif self.scope_mode == "matrix":
            raise SystemExit(f"scope.mode is matrix but the matrix file is missing: {matrix}")
        self.min_similarity = sc.get("min_similarity")
        self.mismatch_threshold = float(sc.get("mismatch_threshold", 0.5))
        # When the matched requirement lies outside the modules the matrix suggests for the SOP:
        # "review" = not assessed by the model, sent to human review (default); "assess" = assess anyway.
        self.outside_action = sc.get("outside_scope_action", "review")

        self.index = VectorIndex.load(index_dir or index_folder(cfg), cfg["embedding"], embedder)
        self.unit_module = np.array([module_of(u["section"]) for u in self.index.units])
        excl = [s.strip() for s in (sc.get("exclude_sections") or [])]
        self.excluded = np.array([any(u["section"] == e or u["section"].startswith(e + ".") for e in excl)
                                  for u in self.index.units])
        self.base_allowed = ~self.excluded
        self.top_k = int(cfg["retrieval"]["top_k"])

        self.system_prompt = Path(self.lc["system_prompt_file"]).read_text(encoding="utf-8").strip()
        key = "user_prompt_top1_file" if self.mode == "top1" else "user_prompt_topk_file"
        self.user_tpl = string.Template(Path(self.lc[key]).read_text(encoding="utf-8"))
        self.llm = None
        self.cache_dir = cache_dir or (Path(cfg["paths"]["runs_dir"]) / "_llm_cache")

    def _llm(self):
        if self.llm is None:
            self.llm = LLMClient(self.lc, self.cache_dir)
        return self.llm

    # ------------------------------------------------------------------ preparation
    def prepare(self, path: str | Path) -> dict:
        ex, ch = self.cfg["extraction"], self.cfg["sop_chunking"]
        doc = extract_document(path, ex["header_footer_min_page_ratio"], ex["min_chars_per_page_warning"])
        chunks, notes = chunk_sop(doc, ch["min_chunk_chars"], ch["max_chunk_chars"], ch["heading_max_chars"],
                                  ch["skip_sections"], ch.get("skip_preamble", True), ch.get("split_steps", True))
        include = [s.lower() for s in (ch.get("include_sections") or [])]
        warnings = list(doc.warnings)
        if include:
            sel = [c for c in chunks if any(k in c.heading.split(" > ")[0].lower() for k in include)]
            if not sel and chunks:
                warnings.append(f"No section matching {include} was found; all {len(chunks)} chunks were checked.")
                sel = chunks
        else:
            sel = chunks
        for c in sel:
            last = c.heading.split(" > ")[-1].split(" ")[0]
            c.chunk_type = "step" if STEP_RE.match(last) else "intro"
        title, title_src = sop_title(doc, path)
        purpose, purpose_src = sop_purpose(chunks)
        scope = self.classifier.classify(title, purpose, purpose_src) if self.classifier else None
        return {"doc": doc, "all_chunks": chunks, "chunks": sel, "notes": notes, "warnings": warnings,
                "title": title, "title_source": title_src, "scope": scope}

    def allowed_for(self, modules: list[str]):
        if not modules:
            return self.base_allowed
        return self.base_allowed & np.isin(self.unit_module, modules)

    def _hits(self, hits):
        return [{"id": self.index.units[i]["id"], "section": self.index.units[i]["section"],
                 "module": self.unit_module[i], "score": round(s, 4)} for i, s in hits]

    # ------------------------------------------------------------------ assessment
    def assess_file(self, path: str | Path, skip_ids=(), limit: int | None = None, oracle: dict | None = None,
                    on_record=None, log=print, scope_override: list[str] | None = None) -> dict:
        """oracle: {chunk_id: [gold requirement tokens]} to bypass retrieval (evaluation only).
        scope_override: GVP modules confirmed by a user (website); replaces the matrix suggestion."""
        prep = self.prepare(path)
        chunks, scope = prep["chunks"], prep["scope"]
        if oracle is not None:
            chunks = [c for c in chunks if c.chunk_id in oracle]
        scope_modules = scope.scope_modules if scope else []
        restrict = self.scope_mode == "matrix" and bool(scope_modules)
        if scope_override:
            known = set(self.unit_module.tolist())
            bad = [m for m in scope_override if m not in known]
            if bad:
                raise ValueError(f"Unknown GVP modules: {bad}. Known: {sorted(known)}")
            scope_modules, restrict = list(scope_override), True
            if scope is not None:
                scope.decision, scope.scope_modules = "user_confirmed", scope_modules

        queries = [f"{c.heading}: {c.text}" for c in chunks]
        enc = self.index.encode(queries) if chunks else None
        free = self.index.search(queries, self.top_k, self.base_allowed, enc) if chunks else []
        scoped = self.index.search(queries, self.top_k, self.allowed_for(scope_modules), enc) if (chunks and restrict) else free

        # purpose vs procedures (rule 6): where does unrestricted retrieval land?
        file_flags = list(scope.flags) if scope else []
        in_scope_share = None
        if scope_modules and free:
            inside = [bool(h) and self.unit_module[h[0][0]] in scope_modules for h in free]
            in_scope_share = sum(inside) / len(inside)
            if in_scope_share < self.mismatch_threshold:
                file_flags.append("purpose_procedure_mismatch")
        if scope and scope.decision == "manual":
            file_flags.append("manual_classification_required")

        records = []
        skip = set(skip_ids)
        todo = [(c, f, s) for c, f, s in zip(chunks, free, scoped) if c.chunk_id not in skip]
        if limit is not None:
            todo = todo[:limit]
        for n, (c, fh, sh) in enumerate(todo, start=1):
            used, free_hits = self._hits(sh), self._hits(fh)
            flags = []
            if oracle is not None:
                tokens = oracle[c.chunk_id]
                units = [u for u in self.index.units if requirement_matches(u["id"], u["section"], tokens)]
                text = "\n".join(u["text"] for u in units)[:6000] or "(gold requirement not found in index)"
                cands = [{"id": "ORACLE", "section": "; ".join(tokens), "section_title": "(gold requirement)", "text": text}]
            else:
                n_c = 1 if self.mode == "top1" else int(self.lc["candidates_for_llm"])
                cands = [self.index.by_id[r["id"]] for r in used[:n_c]]
            if not cands:
                flags.append("no_requirement_in_scope")
            below = (oracle is None and self.min_similarity is not None and used
                     and used[0]["score"] < float(self.min_similarity))
            if below:
                flags.append("below_similarity_threshold")
            # The best match is in a module the SOP's Purpose doesn't point to: likely a wrong match.
            # The model is not asked to judge it; the step goes to human review without a recommendation.
            outside = (oracle is None and self.outside_action == "review" and bool(scope_modules) and bool(used)
                       and used[0]["module"] not in scope_modules)
            if outside:
                flags.append("requirement_may_not_apply")

            if cands and not below and not outside:
                fields = {"sop_file": c.sop_file, "sop_heading": c.heading, "sop_text": c.text}
                if self.mode == "top1":
                    u = cands[0]
                    fields.update(req_id=u["id"], req_section=f"{u['section']} {u.get('section_title', '')}",
                                  req_text=u["text"])
                else:
                    fields["requirements"] = "\n\n".join(_format_requirement(u) for u in cands)
                resp = self._llm().chat(self.system_prompt, self.user_tpl.safe_substitute(fields))
                cand_ids = [u["id"] for u in cands]
                v = validate(resp["text"], self.mode, cand_ids, c.text, {u["id"]: u["text"] for u in cands})
                decided_by = "llm"
            else:   # no LLM call: the system does not guess
                resp = {"text": "", "latency_sec": None, "usage": None, "cached": False, "error": None}
                v = {"valid": True, "errors": [], "label": "NOT_ADDRESSED",
                     "requirement_id": used[0]["id"] if used else None, "sop_evidence": "", "requirement_evidence": "",
                     "missing_or_conflicting_elements": "", "recommended_action": "",
                     "sop_evidence_grounded": None, "req_evidence_grounded": None,
                     "justification": (
                         f"The closest GVP requirement ({used[0]['id']}) is in Module {used[0]['module']}, outside the "
                         f"modules suggested for this SOP, so it may not apply and was not assessed by the model. "
                         f"A reviewer should decide which requirement this step must meet."
                         if outside else
                         "No sufficiently similar GVP requirement was found within the SOP's scope; "
                         "flagged for human review.")}
                decided_by = "rule"
            flags.extend(v.get("notes") or [])
            used_id = v["requirement_id"]
            used_unit = self.index.by_id.get(used_id) if used_id else None
            used_section = cands[0]["section"] if oracle is not None else (used_unit["section"] if used_unit else None)
            top1_free_in_scope = (free_hits[0]["module"] in scope_modules) if (free_hits and scope_modules) else None
            if top1_free_in_scope is False and "requirement_may_not_apply" not in flags:
                flags.append("best_overall_match_outside_scope")
            review = (not v["valid"]) or v["label"] != "COMPLIANT" or bool(flags)
            rec = {"chunk_id": c.chunk_id, "text_hash": c.text_hash, "sop_file": c.sop_file, "heading": c.heading,
                   "chunk_type": c.chunk_type, "page_start": c.page_start, "text": c.text,
                   "scope_mode": self.scope_mode, "scope_modules": scope_modules,
                   "retrieved": used, "retrieved_unrestricted": free_hits,
                   "top1_unrestricted_in_scope": top1_free_in_scope,
                   "llm_candidates": [u["id"] for u in cands], "requirement_used": used_id,
                   "requirement_used_section": used_section,
                   "requirement_used_text": (cands[0]["text"] if oracle is not None and cands else
                                             (used_unit["text"] if used_unit else None)),
                   "label": v["label"], "valid": v["valid"], "validation_errors": v["errors"], "decided_by": decided_by,
                   "sop_evidence": v["sop_evidence"], "requirement_evidence": v["requirement_evidence"],
                   "missing_or_conflicting_elements": v["missing_or_conflicting_elements"],
                   "recommended_action": v.get("recommended_action"),
                   "justification": v["justification"], "sop_evidence_grounded": v["sop_evidence_grounded"],
                   "req_evidence_grounded": v["req_evidence_grounded"], "flags": flags, "review_required": review,
                   "raw_output": resp["text"], "latency_sec": resp["latency_sec"], "usage": resp["usage"],
                   "cached": resp["cached"], "llm_error": resp["error"]}
            records.append(rec)
            if on_record:
                on_record(rec)
            if log:
                status = resp["error"][:50] if resp["error"] else (v["label"] if v["valid"] else "INVALID")
                top = used[0] if used else {"id": "-", "score": 0}
                log(f"  [{n}/{len(todo)}] {c.chunk_id} -> {status:<13} {top['id']} ({top['score']:.2f})"
                    f"{' cached' if resp['cached'] else ''}{' ' + ','.join(flags) if flags else ''}")

        return {"sop_file": Path(path).name, "title": prep["title"], "title_source": prep["title_source"],
                "scope": scope.to_dict() if scope else None, "scope_flags": file_flags,
                "top1_in_scope_share": in_scope_share, "n_chunks_total": len(prep["all_chunks"]),
                "n_chunks_checked": len(chunks), "warnings": prep["warnings"], "notes": prep["notes"],
                "records": records}
