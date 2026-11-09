"""Pipeline commands used by run.py."""
from __future__ import annotations

import csv
from collections import Counter
import datetime as dt
import hashlib
import json
import re
import string
import time
from pathlib import Path

import yaml

from .chunking import chunk_gvp, chunk_sop, short_hash
from .embeddings import Embedder, VectorIndex, model_slug
from .extract import SUPPORTED, extract_document
from .llm import LLMClient
from .metrics import (GOLD_NON_COMPLIANT, bootstrap_ci, classification_metrics, latency_stats,
                      parse_gold_ids, requirement_matches, retrieval_metrics)
from .report import write_comparison, write_report
from .validation import LABELS, NON_COMPLIANT_PRED, validate

GOLD_LABELS = set(LABELS) | {"MISSING"}


# ============================================================ config / io helpers

def load_config(path: str) -> dict:
    cfg_path = Path(path).resolve()
    cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    base = cfg_path.parent
    for k, v in cfg["paths"].items():
        cfg["paths"][k] = str((base / v).resolve()) if v else v
    for k in ("system_prompt_file", "user_prompt_top1_file", "user_prompt_topk_file"):
        cfg["llm"][k] = str((base / cfg["llm"][k]).resolve())
    sc = cfg.setdefault("scope", {})
    if sc.get("matrix_file"):
        sc["matrix_file"] = str((base / sc["matrix_file"]).resolve())
    cfg["_config_path"] = str(cfg_path)
    return cfg


def _file_sha1(path: str) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _write_csv(path: Path, rows: list[dict], fields: list[str] | None = None):
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = fields or (list(rows[0].keys()) if rows else [])
    with open(path, "w", newline="", encoding="utf-8-sig") as f:   # utf-8-sig opens cleanly in Excel
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("; ".join(map(str, v)) if isinstance(v, list) else v) for k, v in r.items()})


def _read_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def _index_folder(cfg: dict) -> Path:
    e = cfg["embedding"]
    return Path(cfg["paths"]["index_dir"]) / model_slug(e["backend"], e.get("model"))


def _sop_files(cfg: dict, only: list[str] | None = None) -> list[Path]:
    folder = Path(cfg["paths"]["sop_dir"])
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in SUPPORTED and not p.name.startswith("~$"))
    if only:
        wanted = set(only)
        files = [p for p in files if p.name in wanted or p.stem in wanted]
    if not files:
        raise SystemExit(f"No SOP files (.pdf/.docx/.txt) found in {folder}")
    return files


def _extract(cfg: dict, path) -> "Document":
    ex = cfg["extraction"]
    return extract_document(path, ex["header_footer_min_page_ratio"], ex["min_chars_per_page_warning"])


def _chunk_all_sops(cfg: dict, only=None, verbose=True):
    sc = cfg["sop_chunking"]
    all_chunks, report = [], []
    for p in _sop_files(cfg, only):
        doc = _extract(cfg, p)
        chunks, notes = chunk_sop(doc, sc["min_chunk_chars"], sc["max_chunk_chars"],
                                  sc["heading_max_chars"], sc["skip_sections"],
                                  sc.get("skip_preamble", True), sc.get("split_steps", True))
        all_chunks.extend(chunks)
        report.append({"file": p.name, "pages": doc.n_pages, "characters": doc.n_chars, "chunks": len(chunks),
                       "warnings": " | ".join(doc.warnings), "notes": " | ".join(notes)})
        if verbose:
            print(f"  {p.name}: {doc.n_pages} pages, {len(chunks)} chunks")
            for w in doc.warnings:
                print(f"    [warn] {w}")
    return all_chunks, report


# ============================================================ index

def cmd_index(cfg: dict):
    from .guidelines import build_index
    gvp = cfg["paths"]["gvp_file"]
    if not Path(gvp).exists():
        raise SystemExit(f"GVP file not found: {gvp}  (set paths.gvp_file in config.yaml)")
    print(f"[index] extracting {gvp}")
    embedder = Embedder(cfg["embedding"])
    print(f"[index] embedding with {embedder.backend} {embedder.model_name or ''}")
    folder = _index_folder(cfg)
    try:
        _, units, report = build_index(cfg, gvp, folder, embedder)
    except ValueError as e:
        raise SystemExit(str(e)) from e
    if report["missing_excluded_sections"]:
        print(f"  [warn] excluded sections not in this guideline: {', '.join(report['missing_excluded_sections'])}")
    req_rows = [{"id": u.id, "section": u.section, "section_title": u.section_title, "page": u.page,
                 "text": u.text} for u in units]
    _write_csv(folder / "gvp_requirements.csv", req_rows)
    _write_csv(Path(cfg["paths"]["work_dir"]) / "gvp_requirements.csv", req_rows)
    print(f"[index] saved to {folder}")
    print(f"        requirement list for annotators: {Path(cfg['paths']['work_dir']) / 'gvp_requirements.csv'}")


# ============================================================ chunk (+ annotation template)

def cmd_chunk(cfg: dict, only=None):
    work = Path(cfg["paths"]["work_dir"])
    print("[chunk] extracting SOP files")
    chunks, report = _chunk_all_sops(cfg, only)
    work.mkdir(parents=True, exist_ok=True)
    with open(work / "sop_chunks.jsonl", "w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps(c.to_dict(), ensure_ascii=False) + "\n")
    _write_csv(work / "extraction_report.csv", report)

    # human-readable preview to check extraction quality
    lines = ["# SOP chunks preview", "", "Check that text, headings and section boundaries look right "
             "before annotating. If not, adjust sop_chunking in config.yaml and re-run.", ""]
    current = None
    for c in chunks:
        if c.sop_file != current:
            current = c.sop_file
            lines += [f"## {current}", ""]
        lines += [f"### {c.chunk_id}  (page {c.page_start}, hash {c.text_hash})", f"**{c.heading}**", "",
                  c.text, ""]
    (work / "chunks_preview.md").write_text("\n".join(lines), encoding="utf-8")

    template = [{"chunk_id": c.chunk_id, "text_hash": c.text_hash, "sop_file": c.sop_file,
                 "heading": c.heading, "chunk_text": c.text, "gold_label": "", "gold_requirement_ids": "",
                 "annotator_notes": ""} for c in chunks]
    _write_csv(work / "ground_truth_template.csv", template)
    print(f"[chunk] {len(chunks)} chunks from {len(report)} files")
    print(f"        preview:   {work / 'chunks_preview.md'}")
    print(f"        report:    {work / 'extraction_report.csv'}")
    print(f"        template:  {work / 'ground_truth_template.csv'}  -> fill in, save as {cfg['paths']['gold_file']}")


# ============================================================ run

def _load_gold(path: str) -> dict[str, dict]:
    p = Path(path)
    if not p.exists():
        return {}
    gold = {}
    for r in _read_csv(p):
        cid = (r.get("chunk_id") or "").strip()
        if cid:
            gold[cid] = r
    return gold


def _norm_gold_label(v) -> str | None:
    s = re.sub(r"[\s\-]+", "_", str(v or "").strip().upper())
    if s in ("", "N/A", "NA", "N_A", "NONE"):
        return None
    if s == "PARTIALLY_COMPLIANT":
        s = "PARTIAL"
    return s


def cmd_run(cfg: dict, name: str | None = None, oracle: bool = False, limit: int | None = None,
            only=None, mode: str | None = None, scope_mode: str | None = None):
    from .engine import Engine
    engine = Engine(cfg, mode=mode, scope_mode=scope_mode)
    mode, smode = engine.mode, engine.scope_mode
    if oracle and mode != "top1":
        raise SystemExit("--oracle uses the gold requirement, so run it with --mode top1")
    gold = _load_gold(cfg["paths"]["gold_file"])
    if oracle and not gold:
        raise SystemExit("--oracle needs the ground-truth file with gold_requirement_ids")
    oracle_map = None
    if oracle:
        oracle_map = {cid: parse_gold_ids(g.get("gold_requirement_ids")) for cid, g in gold.items()
                      if parse_gold_ids(g.get("gold_requirement_ids")) and _norm_gold_label(g.get("gold_label"))}

    lc = engine.lc
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", lc["model"].split("/")[-1])
    emb = model_slug(cfg["embedding"]["backend"], cfg["embedding"].get("model"))
    scope_tag = "oracle" if oracle else ("scoped" if smode == "matrix" else "unscoped")
    name = name or f"{dt.datetime.now():%Y%m%d_%H%M}_{slug}_{emb}_{mode}_{scope_tag}"
    run_dir = Path(cfg["paths"]["runs_dir"]) / name
    run_dir.mkdir(parents=True, exist_ok=True)
    pred_path = run_dir / "predictions.jsonl"
    done = set()
    if pred_path.exists():
        keep = []
        for line in open(pred_path, encoding="utf-8"):
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if not rec.get("llm_error"):
                done.add(rec["chunk_id"]); keep.append(line)
        pred_path.write_text("".join(keep), encoding="utf-8")   # failed calls are retried
        if done:
            print(f"  resuming: {len(done)} chunks already done in {run_dir}")

    run_config = {"name": name, "started": dt.datetime.now().isoformat(timespec="seconds"), "mode": mode,
                  "scope_mode": smode, "oracle": oracle, "limit": limit, "only": only, "llm": lc,
                  "embedding": cfg["embedding"], "retrieval": cfg["retrieval"], "sop_chunking": cfg["sop_chunking"],
                  "scope": cfg.get("scope", {}), "matrix_version": engine.classifier.version if engine.classifier else None,
                  "excluded_units": int(engine.excluded.sum()), "index_meta": engine.index.meta,
                  "system_prompt": engine.system_prompt, "user_prompt_template": engine.user_tpl.template}
    (run_dir / "run_config.json").write_text(json.dumps(run_config, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[run] {lc['provider']}:{lc['model']}  mode={mode}  scope={smode}  -> {run_dir}")

    scopes = []
    remaining = limit
    with open(pred_path, "a", encoding="utf-8") as out:
        def write(rec):
            out.write(json.dumps(rec, ensure_ascii=False) + "\n"); out.flush()
        for f in _sop_files(cfg, only):
            if remaining is not None and remaining <= 0:
                break
            res = engine.assess_file(f, skip_ids=done, limit=remaining, oracle=oracle_map, on_record=write)
            if remaining is not None:
                remaining -= len(res["records"])
            sc = res["scope"] or {}
            print(f"  {res['sop_file']}: scope {sc.get('decision', '-')} {sc.get('scope_modules', [])} "
                  f"flags={res['scope_flags']}")
            scopes.append({k: v for k, v in res.items() if k != "records"})
    (run_dir / "scope.json").write_text(json.dumps(scopes, indent=2, ensure_ascii=False), encoding="utf-8")

    preds = [json.loads(l) for l in open(pred_path, encoding="utf-8")]
    _write_predictions_csv(run_dir / "predictions.csv", preds)
    errors = sum(1 for p in preds if p.get("llm_error"))
    if errors:
        print(f"[run] {errors} calls failed; run the same command again to retry them.")
    print(f"[run] predictions: {run_dir / 'predictions.csv'}")
    cmd_evaluate(cfg, str(run_dir))
    return run_dir


def _write_predictions_csv(path: Path, preds: list[dict]):
    rows = []
    for p in preds:
        r = p.get("retrieved") or []
        fr = p.get("retrieved_unrestricted") or []
        rows.append({
            "chunk_id": p["chunk_id"], "sop_file": p["sop_file"], "heading": p["heading"],
            "chunk_type": p.get("chunk_type"), "scope_mode": p.get("scope_mode"),
            "scope_modules": " ".join(p.get("scope_modules") or []),
            "label": p["label"], "valid": p["valid"], "decided_by": p.get("decided_by"),
            "requirement_used": p["requirement_used"], "requirement_section": p.get("requirement_used_section"),
            "top1_score": r[0]["score"] if r else None,
            "top5_retrieved": "; ".join(f"{h['id']} ({h['score']:.2f})" for h in r),
            "top5_sections": "; ".join(h["section"] for h in r),
            "best_match_without_scope": f"{fr[0]['id']} ({fr[0]['score']:.2f})" if fr else "",
            "best_match_without_scope_in_scope": p.get("top1_unrestricted_in_scope"),
            "flags": "; ".join(p.get("flags") or []), "review_required": p.get("review_required"),
            "justification": p["justification"], "sop_evidence": p["sop_evidence"],
            "missing_or_conflicting_elements": p["missing_or_conflicting_elements"],
            "validation_errors": "; ".join(p.get("validation_errors") or []), "llm_error": p.get("llm_error")})
    _write_csv(path, rows)


def cmd_scope(cfg: dict, only=None):
    """Scope classification for every SOP (no LLM calls): what the expert matrix decides."""
    from .chunking import chunk_sop
    from .scope import ScopeClassifier, sop_purpose, sop_title
    sc = cfg.get("scope", {}) or {}
    clf = ScopeClassifier(sc["matrix_file"], sc.get("include_secondary", True))
    ch = cfg["sop_chunking"]
    rows = []
    for f in _sop_files(cfg, only):
        doc = _extract(cfg, f)
        chunks, _ = chunk_sop(doc, ch["min_chunk_chars"], ch["max_chunk_chars"], ch["heading_max_chars"],
                              ch["skip_sections"], ch.get("skip_preamble", True), ch.get("split_steps", True))
        title, tsrc = sop_title(doc, f)
        purpose, psrc = sop_purpose(chunks)
        r = clf.classify(title, purpose, psrc)
        rows.append({"sop_file": f.name, "title": title, "title_source": tsrc, "decision": r.decision,
                     "primary_modules": " ".join(r.primary_modules), "secondary_modules": " ".join(r.secondary_modules),
                     "scope_modules": " ".join(r.scope_modules), "flags": "; ".join(r.flags),
                     "matched": "; ".join(f"{m['rule']}: {', '.join(m['keywords'])}" for m in r.matched_rules),
                     "purpose_source": psrc, "purpose": purpose[:600]})
        print(f"  {f.name[:45]:<45} {r.decision:<16} primary={r.primary_modules} secondary={r.secondary_modules}"
              f"{'  flags=' + str(r.flags) if r.flags else ''}")
    out = Path(cfg["paths"]["work_dir"]) / "scope_report.csv"
    _write_csv(out, rows)
    print(f"[scope] {len(rows)} SOPs -> {out}  (matrix: {clf.version})")


# ============================================================ evaluate

def _error_type(gold_label, pred_label, valid):
    if not valid:
        return "INVALID_OUTPUT"
    if pred_label == gold_label:
        return "OK"
    if gold_label in GOLD_NON_COMPLIANT and pred_label == "COMPLIANT":
        return "FALSE_NEGATIVE"
    if gold_label == "COMPLIANT" and pred_label in NON_COMPLIANT_PRED:
        return "FALSE_POSITIVE"
    return "WRONG_TYPE"


def cmd_evaluate(cfg: dict, run_dir: str, gold_file: str | None = None):
    run_dir = Path(run_dir)
    gold = _load_gold(gold_file or cfg["paths"]["gold_file"])
    if not gold:
        print(f"[evaluate] no ground truth ({gold_file or cfg['paths']['gold_file']}): only scope and retrieval "
              "tracking are reported, no accuracy metrics.")
    run_config = json.loads((run_dir / "run_config.json").read_text(encoding="utf-8"))
    preds = [json.loads(l) for l in open(run_dir / "predictions.jsonl", encoding="utf-8")]
    preds = [p for p in preds if not p.get("llm_error")]
    ev = cfg["evaluation"]

    cls_rows, ret_rows, per_case, warnings = [], [], [], []
    hash_mismatch = unknown_labels = not_annotated = 0
    for p in preds:
        g = gold.get(p["chunk_id"])
        if g is None or not (g.get("gold_label") or "").strip():   # blank label = not annotated yet
            not_annotated += 1
            continue
        if g.get("text_hash") and g["text_hash"] != p["text_hash"]:
            hash_mismatch += 1
            continue
        gl = _norm_gold_label(g.get("gold_label"))
        gold_ids = parse_gold_ids(g.get("gold_requirement_ids"))
        if gl is not None and gl not in GOLD_LABELS:
            unknown_labels += 1
            warnings.append(f"Unknown gold label {g.get('gold_label')!r} for {p['chunk_id']}")
            continue
        if gold_ids and not run_config.get("oracle"):
            ret_rows.append({"retrieved": p["retrieved"], "gold_ids": gold_ids, "sop_file": p["sop_file"]})
        used_ok = (requirement_matches(p["requirement_used"], p["requirement_used_section"], gold_ids)
                   if gold_ids and not run_config.get("oracle") else None)
        if gl is None:
            continue  # N/A chunk: only retrieval is scored (if ids given)
        row = {"gold_label": gl, "pred_label": p["label"] if p["valid"] else None, "valid": p["valid"],
               "chunk_type": p.get("chunk_type", "n/a"),
               "sop_file": p["sop_file"], "used_req_correct": used_ok}
        cls_rows.append(row)
        top_k = len(p["retrieved"])
        per_case.append({
            "chunk_id": p["chunk_id"], "sop_file": p["sop_file"], "heading": p["heading"],
            "gold_label": gl, "pred_label": p["label"], "valid": p["valid"],
            "error_type": _error_type(gl, p["label"], p["valid"]),
            "gold_requirement_ids": "; ".join(gold_ids),
            "retrieved_top1": p["retrieved"][0]["id"] if p["retrieved"] else "",
            f"gold_in_top{top_k}": (any(requirement_matches(c["id"], c["section"], gold_ids) for c in p["retrieved"])
                                    if gold_ids and not run_config.get("oracle") else ""),
            "requirement_used": p["requirement_used"], "requirement_used_correct": used_ok,
            "sop_evidence_grounded": p["sop_evidence_grounded"], "justification": p["justification"],
            "missing_or_conflicting_elements": p["missing_or_conflicting_elements"],
            "validation_errors": "; ".join(p["validation_errors"])})

    for msg, n in (("not annotated (skipped)", not_annotated), ("changed since annotation (excluded)", hash_mismatch),
                   ("with unknown gold label (excluded)", unknown_labels)):
        if n:
            warnings.append(f"{n} chunks {msg}")

    scoring = ev.get("scoring", "sprint0")
    cls = classification_metrics(cls_rows, scoring)
    ci = bootstrap_ci(cls_rows, ["accuracy", "macro_f1", "nc_recall", "nc_precision", "nc_f1"],
                      ev["bootstrap_samples"], ev["seed"], scoring) if cls_rows else {}
    top_k = int(run_config["retrieval"]["top_k"])
    ks = sorted({k for k in (1, 3, 5, top_k) if k <= top_k})
    ret = retrieval_metrics(ret_rows, ks)

    with_req = [r for r in cls_rows if r["used_req_correct"] is not None]
    strict = {"n": len(with_req),
              "requirement_used_correct": sum(1 for r in with_req if r["used_req_correct"]) / len(with_req)
              if with_req else None,
              "label_and_requirement_correct": sum(1 for r in with_req if r["used_req_correct"] and r["valid"]
                                                   and r["pred_label"] == r["gold_label"]) / len(with_req)
              if with_req else None}

    valid_preds = [p for p in preds if p["valid"]]
    def rate(key):
        vals = [p[key] for p in valid_preds if p[key] is not None]
        return (sum(vals) / len(vals), len(vals)) if vals else (None, 0)
    sop_g, sop_n = rate("sop_evidence_grounded")
    req_g, req_n = rate("req_evidence_grounded")
    grounding = {"sop_evidence_grounded_rate": sop_g, "sop_evidence_n": sop_n,
                 "req_evidence_grounded_rate": req_g, "req_evidence_n": req_n}

    per_file = {}
    for f in sorted({r["sop_file"] for r in cls_rows}):
        rows = [r for r in cls_rows if r["sop_file"] == f]
        m = classification_metrics(rows, scoring)
        rr = retrieval_metrics([r for r in ret_rows if r["sop_file"] == f], ks)
        per_file[f] = {"n": m["n"], "accuracy": m["accuracy"], "nc_recall": m["nc_recall"],
                       "false_negatives": m["false_negatives"], "n_gold_non_compliant": m["n_gold_non_compliant"],
                       "recall@1": rr.get("recall@1"), f"recall@{top_k}": rr.get(f"recall@{top_k}")}

    # results per chunk type (intro vs numbered step)
    by_type = {}
    for t in sorted({r["chunk_type"] for r in cls_rows}):
        m = classification_metrics([r for r in cls_rows if r["chunk_type"] == t], scoring)
        by_type[t] = {"n": m["n"], "accuracy": m["accuracy"], "nc_recall": m["nc_recall"],
                      "false_negatives": m["false_negatives"], "false_positives": m["false_positives"]}

    # scope tracking (works without ground truth)
    scope_info = []
    sp = run_dir / "scope.json"
    if sp.exists():
        scope_info = json.loads(sp.read_text(encoding="utf-8"))
    tracking = {}
    for f in sorted({p["sop_file"] for p in preds}):
        ps = [p for p in preds if p["sop_file"] == f]
        flags_in = [p.get("top1_unrestricted_in_scope") for p in ps if p.get("top1_unrestricted_in_scope") is not None]
        sec_counts = {}
        for p in ps:
            sec = p.get("requirement_used_section") or "-"
            sec_counts[sec] = sec_counts.get(sec, 0) + 1
        info = next((x for x in scope_info if x["sop_file"] == f), {})
        sc = info.get("scope") or {}
        tracking[f] = {"title": info.get("title"), "scope_decision": sc.get("decision"),
                       "scope_modules": sc.get("scope_modules"), "scope_flags": info.get("scope_flags"),
                       "chunks": len(ps),
                       "best_overall_match_inside_scope": (sum(flags_in) / len(flags_in)) if flags_in else None,
                       "sections_used": dict(sorted(sec_counts.items(), key=lambda kv: -kv[1])),
                       "review_required": sum(1 for p in ps if p.get("review_required")),
                       "labels": dict(Counter(p["label"] for p in ps if p["valid"]))}

    usage = [p.get("usage") or {} for p in preds]
    metrics = {
        "run": run_config["name"], "model": run_config["llm"]["model"], "provider": run_config["llm"]["provider"],
        "embedding": f"{run_config['embedding']['backend']}:{run_config['embedding'].get('model')}",
        "mode": run_config["mode"], "oracle": run_config.get("oracle", False),
        "n_predictions": len(preds), "n_files": len({p["sop_file"] for p in preds}),
        "classification": cls, "classification_ci95": ci, "retrieval": ret, "requirement_selection": strict,
        "grounding": grounding, "per_file": per_file,
        "latency": latency_stats([p["latency_sec"] for p in preds if not p.get("cached")]),
        "tokens": {"prompt": sum(u.get("prompt_tokens") or 0 for u in usage),
                   "completion": sum(u.get("completion_tokens") or 0 for u in usage)},
        "by_chunk_type": by_type, "scope_tracking": tracking,
        "scope_mode": run_config.get("scope_mode", "none"), "matrix_version": run_config.get("matrix_version"),
        "warnings": warnings, "evaluated": dt.datetime.now().isoformat(timespec="seconds"),
    }
    (run_dir / "metrics.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")
    if per_case:
        _write_csv(run_dir / "per_case.csv", per_case)
    write_report(run_dir / "report.md", metrics)

    print(f"[evaluate] {run_dir.name}")
    for w in warnings:
        print(f"  [warn] {w}")
    if cls.get("n"):
        print(f"  cases={cls['n']}  valid={cls['valid_output_rate']:.1%}  accuracy={cls['accuracy']:.1%}  "
              f"macroF1={cls['macro_f1']:.3f}  NC-recall={cls['nc_recall']:.3f}  "
              f"FN={cls['false_negatives']}/{cls['n_gold_non_compliant']}  FP={cls['false_positives']}/{cls['n_gold_compliant']}")
    if ret.get("n"):
        print("  retrieval: " + "  ".join(f"{k}={v:.3f}" for k, v in ret.items() if k != "n") + f"  (n={ret['n']})")
    print(f"  report: {run_dir / 'report.md'}")
    return metrics


# ============================================================ compare

def cmd_compare(cfg: dict, run_dirs: list[str], out: str | None = None):
    items = []
    for d in run_dirs:
        p = Path(d) / "metrics.json"
        if not p.exists():
            print(f"  [skip] {d}: no metrics.json (run evaluate first)")
            continue
        items.append(json.loads(p.read_text(encoding="utf-8")))
    if not items:
        raise SystemExit("Nothing to compare")
    out_path = Path(out) if out else Path(cfg["paths"]["runs_dir"]) / "comparison.md"
    text = write_comparison(out_path, items)
    print(text)
    print(f"[compare] saved to {out_path}")
