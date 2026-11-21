"""Hawkim evaluation harness: runs the compliance pipeline on the test SOPs from a script.

No website, no worker queue. The database is only read (which GVP version to use). The pipeline code
is not changed: the harness calls ComplianceService.check(), the path the website uses, and only wraps
the pipeline's own functions with timers while it runs.

    python evaluation/run_eval.py                 # every file in evaluation/data, once
    python evaluation/run_eval.py --runs 3        # consistency test
    python evaluation/run_eval.py --files SOP-PV-001 --runs 1

Output: evaluation/results/<run id>/  (git-ignored)
    run_meta.json              commit, models, top-k, temperature, GVP version, memory, ...
    gvp_requirements.json      every GVP requirement unit of the index (id, section, text)
    <SOP>_<format>_run<k>.json one per file and run: steps, retrieval, LLM, verdicts, timing, memory
    pipeline_verdicts.xlsx     the pipeline's verdicts (keep away from the expert until blind labelling is done)
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import platform
import sys
import time
import traceback
from pathlib import Path

from eval_common import (RESULTS_DIR, RHR, SERVICE_DIR, VERDICTS, MemorySampler, ReadOnlyDB, StageTimer, load_results,
                         free_ram_gb, git_info, load_env, ram_guard, step_number, test_files, worker_running)


def sha1(path: Path) -> str:
    h = hashlib.sha1()
    h.update(path.read_bytes())
    return h.hexdigest()


def strict_json(text: str) -> bool:
    """The raw answer is one JSON object and nothing else (no code fence, no extra prose)."""
    try:
        return isinstance(json.loads((text or "").strip()), dict)
    except Exception:
        return False


def raw_model_label(text: str):
    """The label the model wrote, before the number check (None if it can't be read)."""
    from hawkim.validation import normalize_label, parse_json_object
    obj, _ = parse_json_object(text or "")
    return normalize_label(obj.get("label")) if obj else None


def rhr_reason(finding: dict, record: dict) -> str | None:
    """Why a step ends as Requires Human Review (None if it has a real verdict)."""
    if finding["label"] in VERDICTS:
        return None
    flags = finding.get("flags") or []
    if record.get("llm_error"):
        return "model_call_failed"
    if "model_answer_invalid" in flags or not record.get("valid"):
        return "invalid_answer"
    if "no_candidate_applies" in flags:
        return "no_candidate_applies"
    if "model_and_rule_disagree" in flags:
        return "model_and_rule_check_disagree"
    if record.get("decided_by") == "rule":
        return "no_llm_call"
    return "model_said_not_addressed"


# ------------------------------------------------------------------ GVP version

def resolve_gvp(cfg: dict, version: str) -> dict:
    """Reads the GVP version row from the database (read-only) and finds its local index."""
    from hawkim.engine import index_folder
    rows = ReadOnlyDB().select("guideline_versions",
                               f"select=id,organization_id,name,version,index_path,added_at&version=eq.{version}")
    if not rows:
        raise SystemExit(f"GVP version {version} was not found in the database")
    if len(rows) > 1:
        raise SystemExit(f"GVP version {version} exists in {len(rows)} organizations; this harness expects one")
    row = rows[0]
    if row["index_path"]:
        folder = SERVICE_DIR / "index" / row["index_path"]
        if not (folder / "meta.json").exists():
            raise SystemExit(f"The index of GVP {version} is not downloaded to {folder}. Run a check with it on "
                             f"the website once (the worker downloads it), or use --gvp-version 4.0.")
    elif str(cfg["service"].get("guideline_version")) == str(version):
        folder = index_folder(cfg)
    else:
        raise SystemExit(f"GVP {version} has no index in the database and is not the service's local version")
    return {"db_row": row, "index_dir": folder}


# ------------------------------------------------------------------ one file

def run_file(case: dict, run_no: int, svc, engine, timer: StageTimer, sampler: MemorySampler) -> dict:
    captured = {}
    original_assess = type(engine).assess_file

    def assess_and_capture(*a, **kw):
        res = original_assess(engine, *a, **kw)
        captured["res"] = res
        return res

    engine.assess_file = assess_and_capture
    timer.reset()
    sampler.reset()
    out = {"sop_id": case["sop_id"], "format": case["format"], "file": case["path"].name,
           "file_sha1": sha1(case["path"]), "run": run_no, "started": dt.datetime.now().isoformat(timespec="seconds"),
           "failed": False, "error": None, "traceback": None}
    t0 = time.perf_counter()
    try:
        result = svc.check(case["path"], engine=engine)
    except Exception as e:
        out.update(failed=True, error=f"{type(e).__name__}: {e}", traceback=traceback.format_exc())
        result = None
    finally:
        del engine.assess_file
    total = time.perf_counter() - t0
    out["memory"] = sampler.snapshot()

    calls = timer.calls
    res = captured.get("res")
    records = res["records"] if res else []
    n = len(records)
    extraction = timer.total("extraction")
    embedding, retrieval = timer.total("embedding"), timer.total("retrieval")
    llm_calls = list(calls.get("llm", []))
    out["timing_sec"] = {
        "extraction": round(extraction, 4),
        "extraction_text": round(timer.total("extract_document"), 4),
        "extraction_chunking": round(timer.total("chunk_sop"), 4),
        "embedding": round(embedding, 4), "retrieval": round(retrieval, 4),
        "llm": round(sum(llm_calls), 4), "llm_calls": len(llm_calls),
        "file_total": round(total, 4),
        "note": "embedding and retrieval run once per file for all steps; per-step values are file time / steps",
    }
    if res:
        out.update(title=res["title"], n_chunks_total=res["n_chunks_total"], n_steps=res["n_chunks_checked"],
                   warnings=res["warnings"], notes=res["notes"])
    findings = {f["chunk_id"]: f for f in (result or {}).get("findings", [])}

    units = engine.index.by_id
    steps, used_ids = [], []
    llm_iter = iter(llm_calls)
    seen_numbers: dict[str, int] = {}
    for i, r in enumerate(records, start=1):
        f = findings.get(r["chunk_id"], {})
        num = step_number(r["heading"])
        key = num or f"pos{i}"
        seen_numbers[key] = seen_numbers.get(key, 0) + 1
        step_key = key if seen_numbers[key] == 1 else f"{key}#{seen_numbers[key]}"   # a long step split in pieces
        called = r["decided_by"] == "llm"
        llm_t = next(llm_iter, None) if called else None
        verdict_label = f.get("label")
        reason = rhr_reason(f, r) if f else "not_in_service_result"
        top5 = [{"rank": k, "id": h["id"], "section": h["section"], "score": h["score"]}
                for k, h in enumerate(r["retrieved"], start=1)]
        used_ids += [h["id"] for h in top5]
        steps.append({
            "step_id": r["chunk_id"], "position": i, "step_number": num, "step_key": step_key,
            "heading": r["heading"], "chunk_type": r["chunk_type"], "page": r["page_start"],
            "text": r["text"], "text_hash": r["text_hash"],
            "retrieval": {"top5": top5, "llm_candidates": r["llm_candidates"]},
            "llm": {"called": called, "raw_answer": r["raw_output"], "valid_first_try": bool(r["valid"]) if called else None,
                    "strict_json": strict_json(r["raw_output"]) if called else None,
                    "validation_errors": r["validation_errors"], "llm_error": r["llm_error"],
                    "model_label_raw": raw_model_label(r["raw_output"]) if called else None,
                    "label_after_validation": r["label"], "model_requirement_id": r["requirement_used"],
                    "flags": r["flags"]},
            "final": {"verdict": verdict_label if reason is None else RHR,
                      "requires_human_review": reason is not None, "rhr_reason": reason,
                      "label_in_service_result": verdict_label,
                      "requirement_id": (f.get("requirement") or {}).get("id"),
                      "justification": f.get("justification")},
            "timing_sec": {"extraction": round(extraction / n, 4) if n else None,
                           "embedding": round(embedding / n, 4) if n else None,
                           "retrieval": round(retrieval / n, 4) if n else None,
                           "llm": round(llm_t, 4) if llm_t is not None else None},
        })
    out["steps"] = steps
    out["gvp_requirements_used"] = [{"id": u, "section": units[u]["section"], "text": units[u]["text"]}
                                    for u in dict.fromkeys(used_ids) if u in units]
    rhr = sum(s["final"]["requires_human_review"] for s in steps)
    out["summary"] = {"steps": n, "requires_human_review": rhr,
                      "verdicts": {v: sum(s["final"]["verdict"] == v for s in steps) for v in (*VERDICTS, RHR)},
                      "llm_errors": sum(bool(s["llm"]["llm_error"]) for s in steps)}
    if not out["failed"] and n == 0:
        out.update(failed=True, error="no steps were extracted")
    return out


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--runs", type=int, default=1, help="run each file N times (3 for the consistency test)")
    ap.add_argument("--gvp-version", default="4.0", help="GVP version number in the database (default 4.0)")
    ap.add_argument("--files", nargs="*", help="only these SOP ids / formats / file names")
    ap.add_argument("--min-ram-gb", type=float, default=7.0, help="stop if less RAM than this is free before "
                    "the models are loaded")
    ap.add_argument("--min-ram-after-load-gb", type=float, default=2.0, help="stop before a file if less RAM than "
                    "this is free once the models are loaded (they hold several GB)")
    ap.add_argument("--run-id", help="results folder name (default: date_time_runsN)")
    args = ap.parse_args()

    cases = test_files(args.files)
    if not cases:
        raise SystemExit("No test files found in evaluation/data")
    pids = worker_running()
    if pids:
        raise SystemExit(f"[eval] worker.py is running (PID {', '.join(map(str, pids))}); stop it first")
    ram_guard(args.min_ram_gb, "before loading the models")

    load_env()
    from hawkim.service import ComplianceService
    from hawkim import engine as engine_mod

    run_id = args.run_id or f"{dt.datetime.now():%Y%m%d_%H%M}_runs{args.runs}"
    out_dir = RESULTS_DIR / run_id
    # Files can be run one call at a time into the same folder; a result is never overwritten.
    taken = [f"{c['sop_id']}_{c['format']}_run{k}.json" for k in range(1, args.runs + 1) for c in cases
             if (out_dir / f"{c['sop_id']}_{c['format']}_run{k}.json").exists()]
    if taken:
        raise SystemExit(f"[eval] {out_dir.name} already has {', '.join(taken)}; results are never overwritten")
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"[eval] {len(cases)} files x {args.runs} run(s) -> {out_dir}")

    sampler = MemorySampler().start()
    timer = StageTimer()
    t_load = time.perf_counter()
    svc = ComplianceService(str(SERVICE_DIR / "config.yaml"))
    gvp = resolve_gvp(svc.cfg, args.gvp_version)
    engine = svc.engine_for(None if gvp["index_dir"] == engine_mod.index_folder(svc.cfg) else gvp["index_dir"])
    # The LLM cache would replay earlier answers (runs 2..N identical, LLM time ~0): off for this process only.
    engine.lc["cache"] = False
    llm = engine._llm()
    llm.use_cache, llm.cache = False, {}
    load_sec = time.perf_counter() - t_load
    print(f"[eval] GVP {gvp['db_row']['version']} ({len(engine.index.units)} units) from {gvp['index_dir']}")

    t0 = time.perf_counter()
    warm = llm.chat("You are a test.", "Reply with the word OK.")
    warmup = {"sec": round(time.perf_counter() - t0, 3), "error": warm["error"]}
    if warm["error"]:
        raise SystemExit(f"[eval] the model is not reachable: {warm['error']}")
    print(f"[eval] models loaded in {load_sec:.1f} s, LLM warm-up {warmup['sec']} s (not counted)")

    # Timers around the pipeline's own functions (for this process only; the code is unchanged).
    engine_mod.extract_document = timer.wrap("extract_document", engine_mod.extract_document)
    engine_mod.chunk_sop = timer.wrap("chunk_sop", engine_mod.chunk_sop)
    engine.prepare = timer.wrap("extraction", engine.prepare)
    engine.index.encode = timer.wrap("embedding", engine.index.encode)
    engine.index.search = timer.wrap("retrieval", engine.index.search)
    llm.chat = timer.wrap("llm", llm.chat)

    lc, cfg = engine.lc, svc.cfg
    meta = {
        "run_id": run_id, "started": dt.datetime.now().isoformat(timespec="seconds"), "runs": args.runs,
        "files": [c["path"].name for c in cases], "git": git_info(),
        "models": {"llm": f"{lc['provider']}:{lc['model']}", "embedding": f"{cfg['embedding']['backend']}:"
                   f"{cfg['embedding'].get('model')}"},
        "top_k": engine.top_k, "llm_candidates": int(lc["candidates_for_llm"]), "llm_mode": engine.mode,
        "temperature": lc.get("temperature"), "max_tokens": lc.get("max_tokens"), "llm_cache": False,
        "number_check": engine.number_action, "scope_mode": engine.scope_mode,
        "excluded_sections": cfg["scope"].get("exclude_sections"), "excluded_units": int(engine.excluded.sum()),
        "gvp": {**gvp["db_row"], "index_dir": str(gvp["index_dir"]), "index_meta": engine.index.meta},
        "model_load_sec": round(load_sec, 2), "llm_warmup": warmup, "min_ram_gb": args.min_ram_gb,
        "min_ram_after_load_gb": args.min_ram_after_load_gb,
        "machine": {"platform": platform.platform(), "python": sys.version.split()[0],
                    "ram_free_at_start_gb": round(free_ram_gb(), 2)},
        "config_file": str(SERVICE_DIR / "config.yaml"),
        "config_sha1": {p.name: sha1(p) for p in (SERVICE_DIR / "config.yaml", Path(lc["system_prompt_file"]),
                                                   Path(lc["user_prompt_top1_file"]), Path(lc["user_prompt_topk_file"]))},
    }
    session = {"started": meta["started"], "files": meta["files"], "runs": args.runs,
               "model_load_sec": meta["model_load_sec"], "llm_warmup": warmup,
               "ram_free_at_start_gb": meta["machine"]["ram_free_at_start_gb"]}
    meta_path = out_dir / "run_meta.json"
    if meta_path.exists():
        # A later call into the same folder: everything that affects the results must be the same.
        first = json.loads(meta_path.read_text(encoding="utf-8"))
        now = json.loads(json.dumps(meta, default=str))
        diff = [k for k in SAME_SETTINGS if _get(first, k) != _get(now, k)]
        if diff:
            raise SystemExit("[eval] not the same setup as the first call in " + out_dir.name + ": " + "; ".join(
                f"{k}: {_get(first, k)} -> {_get(now, k)}" for k in diff))
        meta = first
        meta["sessions"].append(session)
        meta["files"] = list(dict.fromkeys(meta["files"] + session["files"]))
        meta["runs"] = max(meta["runs"], args.runs)
    else:
        meta["sessions"] = [session]
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    excluded = engine.excluded
    if not (out_dir / "gvp_requirements.json").exists():
        (out_dir / "gvp_requirements.json").write_text(json.dumps(
            [{"id": u["id"], "section": u["section"], "section_title": u.get("section_title"), "page": u.get("page"),
              "excluded_sfda_duty": bool(excluded[i]), "text": u["text"]} for i, u in enumerate(engine.index.units)],
            ensure_ascii=False, indent=1), encoding="utf-8")

    done, failed = [], 0
    try:
        for run_no in range(1, args.runs + 1):
            for case in cases:
                free = ram_guard(args.min_ram_after_load_gb, f"before {case['path'].name} (run {run_no}, models loaded)")
                print(f"[eval] run {run_no}/{args.runs} {case['sop_id']} {case['format']} (free RAM {free:.1f} GB)")
                res = run_file(case, run_no, svc, engine, timer, sampler)
                res["free_ram_before_gb"] = round(free, 2)
                path = out_dir / f"{case['sop_id']}_{case['format']}_run{run_no}.json"
                path.write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
                failed += res["failed"]
                done.append(res)
                s = res.get("summary", {})
                print(f"        {'FAILED: ' + res['error'] if res['failed'] else 'ok'}  steps={s.get('steps')} "
                      f"review={s.get('requires_human_review')} {res['timing_sec']['file_total']:.0f} s  "
                      f"peak RSS {res['memory']['peak_rss_harness_gb']} GB")
    finally:
        sampler.stop()
        session.update(finished=dt.datetime.now().isoformat(timespec="seconds"), file_runs=len(done),
                       failed_file_runs=failed)
        everything = load_results(out_dir)   # every file run in the folder, from all calls
        meta.update(finished=session["finished"], file_runs=len(everything),
                    failed_file_runs=sum(r["failed"] for r in everything))
        (out_dir / "run_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False, default=str),
                                               encoding="utf-8")
        write_verdicts(out_dir, everything)
    print(f"[eval] done: {len(done)} file runs, {failed} failed -> {out_dir}")


# Everything that affects the results; a later call into the same results folder must match the first.
SAME_SETTINGS = ["git.commit", "git.uncommitted_changes_in_compliance_service", "models", "top_k", "llm_candidates",
                 "llm_mode", "temperature", "max_tokens", "llm_cache", "number_check", "scope_mode",
                 "excluded_sections", "excluded_units", "gvp.id", "gvp.version", "gvp.index_dir",
                 "gvp.index_meta.gvp_sha1", "gvp.index_meta.n_units", "config_sha1"]


def _get(d: dict, dotted: str):
    for part in dotted.split("."):
        d = d.get(part) if isinstance(d, dict) else None
    return d


def write_verdicts(out_dir: Path, results: list[dict]):
    """The pipeline's verdicts, separate from the expert's blind labelling sheet."""
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "pipeline_verdicts"
    cols = ["run", "sop_id", "format", "step_id", "step_number", "heading", "verdict", "rhr_reason",
            "requirement_id", "justification", "model_label_raw", "valid_first_try"]
    ws.append(cols)
    for res in results:
        for s in res.get("steps", []):
            ws.append([res["run"], res["sop_id"], res["format"], s["step_id"], s["step_number"], s["heading"],
                       s["final"]["verdict"], s["final"]["rhr_reason"], s["final"]["requirement_id"],
                       s["final"]["justification"], s["llm"]["model_label_raw"], s["llm"]["valid_first_try"]])
    wb.save(out_dir / "pipeline_verdicts.xlsx")


if __name__ == "__main__":
    main()
