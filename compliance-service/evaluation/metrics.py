"""Metrics for the Hawkim evaluation: reads a results folder (+ filled labels) and writes tables.

    python evaluation/metrics.py                                # latest results folder
    python evaluation/metrics.py --results evaluation/results/<run id> --run 1

Inputs
    results/<run id>/*.json          from run_eval.py
    labels/labels.xlsx               from make_labels.py, filled in by the team / expert (optional)
    labels/gvp_manual.xlsx           manual GVP requirement list for sample sections (optional)
Output
    results/<run id>/metrics/<table>.csv and metrics.md (all tables)

"Requires Human Review" (RHR) is an abstention, never mapped to a label. Expert metrics are reported as
coverage, on answered steps only, and strict (every RHR step counts as wrong).
Gap detection recall: expert label PARTIAL, CONFLICT or NOT_ADDRESSED, pipeline verdict PARTIAL or CONFLICT.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path

from eval_common import (FORMATS, GAP_LABELS, GOLD_LABELS, LABELS_DIR, MANUAL_STEP_COUNTS, RHR, VERDICTS,
                         latest_results_dir, load_results, md_table, norm_text)
from hawkim.metrics import parse_gold_ids, requirement_matches

PRED_COLS = [*GOLD_LABELS, RHR]


# ------------------------------------------------------------------ helpers

def pct(a, b):
    return round(100 * a / b, 1) if b else None


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.fmean(xs), 3) if xs else None


def median(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 3) if xs else None


def base_key(step_key: str) -> str:
    return step_key.split("#")[0]


def norm_label(v) -> str | None:
    s = re.sub(r"[\s\-]+", "_", str(v or "").strip().upper())
    if s in ("", "N/A", "NA", "N_A", "NONE"):
        return None
    return {"PARTIALLY_COMPLIANT": "PARTIAL", "NOTADDRESSED": "NOT_ADDRESSED"}.get(s, s)


def yes_no(v):
    s = str(v or "").strip().upper()
    return True if s in ("Y", "YES", "TRUE", "1") else False if s in ("N", "NO", "FALSE", "0") else None


def read_sheet(path: Path, sheet: str | None = None) -> list[dict]:
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    head = [str(h).strip() if h is not None else "" for h in rows[0]]
    return [dict(zip(head, r)) for r in rows[1:] if any(c not in (None, "") for c in r)]


class Gvp:
    def __init__(self, units: list[dict]):
        self.units = units
        self.section = {u["id"]: u["section"] for u in units}

    def matches(self, unit_id: str, tokens: list[str]) -> bool:
        return requirement_matches(unit_id, self.section.get(unit_id), tokens)

    def n_relevant(self, tokens: list[str]) -> int:
        return sum(self.matches(u["id"], tokens) for u in self.units if not u.get("excluded_sfda_duty"))


# ------------------------------------------------------------------ labels

def load_labels(path: Path) -> dict[tuple, dict]:
    if not path.exists():
        return {}
    out = {}
    for r in read_sheet(path, "labels"):
        out[(str(r.get("sop_id")), str(r.get("step_id")))] = {
            "is_true_step": yes_no(r.get("is_true_step")),
            "relevant": parse_gold_ids(r.get("relevant_requirement_ids")),
            "expert_verdict": norm_label(r.get("expert_verdict")),
            "expert_relevant": parse_gold_ids(r.get("expert_relevant_requirement_ids")),
            "rating": _num(r.get("justification_rating_1to5")),
            "step_text": r.get("step_text"),
        }
    return out


def _num(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def labels_for(res: dict, labels: dict, docx_by_key: dict) -> dict[str, dict]:
    """Labels per step_id of this result. Labels were made on the docx run; a pdf step gets the label of the
    docx step with the same step number and the same text."""
    out = {}
    for s in res["steps"]:
        if res["format"] == "docx":
            lab = labels.get((res["sop_id"], s["step_id"]))
        else:
            d = docx_by_key.get((res["sop_id"], s["step_key"]))
            lab = labels.get((res["sop_id"], d["step_id"])) if d and norm_text(d["text"]) == norm_text(s["text"]) else None
        if lab:
            out[s["step_id"]] = lab
    return out


# ------------------------------------------------------------------ tables

def t_step_extraction(results, labels, docx_by_key):
    rows = []
    for r in results:
        labs = labels_for(r, labels, docx_by_key)
        marked = [(s, labs[s["step_id"]]["is_true_step"]) for s in r["steps"]
                  if s["step_id"] in labs and labs[s["step_id"]]["is_true_step"] is not None]
        true_keys = {base_key(s["step_key"]) for s, y in marked if y}
        manual = MANUAL_STEP_COUNTS.get(r["sop_id"])
        n = len(r["steps"])
        rows.append({"sop": r["sop_id"], "format": r["format"], "extracted": n,
                     "numbered_steps": sum(s["chunk_type"] == "step" for s in r["steps"]), "manual_count": manual,
                     "count_ratio": round(n / manual, 3) if manual else None, "labelled": len(marked),
                     "true_steps": sum(y for _, y in marked) if marked else None,
                     "precision": round(sum(y for _, y in marked) / len(marked), 3) if marked else None,
                     "recall": round(len(true_keys) / manual, 3) if marked and manual else None})
    return rows


def t_gvp_extraction(gvp: Gvp, manual_path: Path, min_overlap: float):
    if not manual_path.exists():
        return [], None
    words = lambda t: set(re.findall(r"\w+", (t or "").lower()))
    manual = [{"section": str(r.get("section") or "").strip(), "text": str(r.get("requirement_text") or "")}
              for r in read_sheet(manual_path) if r.get("section") and r.get("requirement_text")]
    rows, tot = [], Counter()
    for sec in sorted({m["section"] for m in manual}):
        reqs = [m for m in manual if m["section"] == sec]
        units = [u for u in gvp.units if u["section"] == sec]

        def ok(m, u):
            w = words(m["text"])
            return bool(w) and len(w & words(u["text"])) / len(w) >= min_overlap
        found = sum(any(ok(m, u) for u in units) for m in reqs)
        correct = sum(any(ok(m, u) for m in reqs) for u in units)
        tot.update(manual=len(reqs), found=found, units=len(units), correct=correct)
        rows.append({"section": sec, "manual_requirements": len(reqs), "extracted_units": len(units),
                     "manual_found": found, "units_matching": correct,
                     "recall": round(found / len(reqs), 3) if reqs else None,
                     "precision": round(correct / len(units), 3) if units else None})
    rows.append({"section": "ALL", "manual_requirements": tot["manual"], "extracted_units": tot["units"],
                 "manual_found": tot["found"], "units_matching": tot["correct"],
                 "recall": round(tot["found"] / tot["manual"], 3) if tot["manual"] else None,
                 "precision": round(tot["correct"] / tot["units"], 3) if tot["units"] else None})
    return rows, len(manual)


def t_retrieval(results, labels, docx_by_key, gvp: Gvp):
    agg = defaultdict(list)
    for r in results:
        labs = labels_for(r, labels, docx_by_key)
        for s in r["steps"]:
            lab = labs.get(s["step_id"])
            if not lab or not lab["relevant"]:
                continue
            ids = [h["id"] for h in s["retrieval"]["top5"]][:5]
            rel = [gvp.matches(i, lab["relevant"]) for i in ids]
            tokens_hit = sum(any(gvp.matches(i, [t]) for i in ids) for t in lab["relevant"])
            first = next((k for k, x in enumerate(rel, start=1) if x), None)
            dcg = sum(1 / math.log2(k + 1) for k, x in enumerate(rel, start=1) if x)
            ideal = min(5, max(1, gvp.n_relevant(lab["relevant"])))
            idcg = sum(1 / math.log2(k + 1) for k in range(1, ideal + 1))
            m = {"hit5": float(any(rel)), "hit3": float(any(rel[:3])), "recall5": tokens_hit / len(lab["relevant"]),
                 "rr": 1 / first if first else 0.0, "ndcg5": dcg / idcg}
            agg[r["format"]].append(m)
            agg["all"].append(m)
    return [{"format": f, "steps": len(v), "Recall@5": mean([m["recall5"] for m in v]),
             "Hit@5": mean([m["hit5"] for m in v]), "Hit@3 (shown to LLM)": mean([m["hit3"] for m in v]),
             "MRR": mean([m["rr"] for m in v]), "nDCG@5": mean([m["ndcg5"] for m in v])}
            for f, v in agg.items() if v]


def t_validation(all_results):
    rows, reasons = [], Counter()
    groups = defaultdict(list)
    for r in all_results:
        groups[r["format"]].append(r)
        groups["all"].append(r)
    for g, rs in groups.items():
        steps = [s for r in rs for s in r["steps"]]
        called = [s for s in steps if s["llm"]["called"] and not s["llm"]["llm_error"]]
        rhr = [s for s in steps if s["final"]["requires_human_review"]]
        if g == "all":
            reasons.update(s["final"]["rhr_reason"] for s in rhr)
        rows.append({"format": g, "steps": len(steps), "llm_answers": len(called),
                     "valid_json_first_try_%": pct(sum(s["llm"]["valid_first_try"] for s in called), len(called)),
                     "pure_json_%": pct(sum(s["llm"]["strict_json"] for s in called), len(called)),
                     "llm_call_errors": sum(bool(s["llm"]["llm_error"]) for s in steps),
                     "human_review_%": pct(len(rhr), len(steps)),
                     "coverage_%": pct(len(steps) - len(rhr), len(steps))})
    total_rhr = sum(reasons.values())
    reason_rows = [{"reason": k, "steps": v, "share_of_human_review_%": pct(v, total_rhr)}
                   for k, v in reasons.most_common()]
    return rows, reason_rows


def t_consistency(all_results):
    by_file = defaultdict(dict)
    for r in all_results:
        by_file[(r["sop_id"], r["format"])][r["run"]] = r
    rows, tot = [], Counter()
    for (sop, fmt), runs in sorted(by_file.items()):
        if len(runs) < 2:
            continue
        per_run = [{s["step_id"]: s for s in r["steps"]} for r in runs.values()]
        common = set.intersection(*(set(p) for p in per_run))
        same_v = sum(len({p[i]["final"]["verdict"] for p in per_run}) == 1 for i in common)
        same_r = sum(len({p[i]["final"]["requirement_id"] for p in per_run}) == 1 for i in common)
        tot.update(steps=len(common), same_v=same_v, same_r=same_r)
        rows.append({"sop": sop, "format": fmt, "runs": len(runs), "steps_in_all_runs": len(common),
                     "same_verdict_%": pct(same_v, len(common)), "same_requirement_%": pct(same_r, len(common))})
    if rows:
        rows.append({"sop": "ALL", "format": "", "runs": max(r["runs"] for r in rows), "steps_in_all_runs": tot["steps"],
                     "same_verdict_%": pct(tot["same_v"], tot["steps"]),
                     "same_requirement_%": pct(tot["same_r"], tot["steps"])})
    return rows


def t_efficiency(all_results):
    stage_rows, file_rows = [], []
    for g in (*FORMATS, "all"):
        rs = [r for r in all_results if g == "all" or r["format"] == g]
        if not rs:
            continue
        steps = [s for r in rs for s in r["steps"]]
        for stage in ("extraction", "embedding", "retrieval", "llm"):
            per_step = [s["timing_sec"][stage] for s in steps]
            per_file = [r["timing_sec"][stage] for r in rs if not r["failed"]]
            stage_rows.append({"format": g, "stage": stage, "per_step_mean_s": mean(per_step),
                               "per_step_median_s": median(per_step), "per_file_mean_s": mean(per_file),
                               "per_file_median_s": median(per_file)})
        totals = [r["timing_sec"]["file_total"] for r in rs if not r["failed"]]
        stage_rows.append({"format": g, "stage": "TOTAL (file)", "per_step_mean_s": mean(
            [r["timing_sec"]["file_total"] / len(r["steps"]) for r in rs if r["steps"]]), "per_step_median_s": None,
            "per_file_mean_s": mean(totals), "per_file_median_s": median(totals)})
        mem = [r["memory"] for r in rs]
        file_rows.append({"format": g, "file_runs": len(rs), "failed_file_runs": sum(r["failed"] for r in rs),
                          "failure_rate_%": pct(sum(r["failed"] for r in rs), len(rs)),
                          "steps": len(steps), "llm_call_errors": sum(bool(s["llm"]["llm_error"]) for s in steps),
                          "peak_rss_harness_gb": max((m["peak_rss_harness_gb"] or 0) for m in mem),
                          "peak_rss_ollama_gb": max((m["peak_rss_ollama_gb"] or 0) for m in mem),
                          "min_free_ram_gb": min((m["min_system_available_gb"] for m in mem
                                                  if m["min_system_available_gb"] is not None), default=None)})
    return stage_rows, file_rows


def t_format(all_results):
    by = {(r["sop_id"], r["format"], r["run"]): r for r in all_results}
    rows = []
    for sop, run in sorted({(r["sop_id"], r["run"]) for r in all_results}):
        d, p = by.get((sop, "docx", run)), by.get((sop, "pdf", run))
        if not d or not p:
            continue
        ds, ps = {s["step_key"]: s for s in d["steps"]}, {s["step_key"]: s for s in p["steps"]}
        keys = set(ds) | set(ps)
        both = set(ds) & set(ps)
        rows.append({
            "sop": sop, "run": run, "docx_steps": len(ds), "pdf_steps": len(ps),
            "identical_text_%": pct(sum(norm_text(ds[k]["text"]) == norm_text(ps[k]["text"]) for k in both), len(keys)),
            "identical_text_exact_%": pct(sum(ds[k]["text"] == ps[k]["text"] for k in both), len(keys)),
            "identical_top5_%": pct(sum([h["id"] for h in ds[k]["retrieval"]["top5"]] ==
                                        [h["id"] for h in ps[k]["retrieval"]["top5"]] for k in both), len(keys)),
            "same_verdict_%": pct(sum(ds[k]["final"]["verdict"] == ps[k]["final"]["verdict"] for k in both), len(keys)),
            "docx_extraction_s": d["timing_sec"]["extraction"], "pdf_extraction_s": p["timing_sec"]["extraction"]})
    return rows


def prf(gold, pred, cls):
    tp = sum(g == cls and p == cls for g, p in zip(gold, pred))
    fp = sum(g != cls and p == cls for g, p in zip(gold, pred))
    fn = sum(g == cls and p != cls for g, p in zip(gold, pred))
    pr = tp / (tp + fp) if tp + fp else None
    rc = tp / (tp + fn) if tp + fn else None
    f1 = 2 * pr * rc / (pr + rc) if pr and rc else (0.0 if (pr is not None and rc is not None) else None)
    return pr, rc, f1, tp + fn


def kappa(gold, pred):
    n = len(gold)
    if not n:
        return None
    po = sum(g == p for g, p in zip(gold, pred)) / n
    cg, cp = Counter(gold), Counter(pred)
    pe = sum(cg[c] * cp[c] for c in set(cg) | set(cp)) / n ** 2
    return round((po - pe) / (1 - pe), 3) if pe < 1 else None


def t_expert(results, labels, docx_by_key, gvp: Gvp):
    summary, per_class, confusion, errors, ratings = [], [], [], [], []
    for fmt in FORMATS:
        rs = [r for r in results if r["format"] == fmt]
        items = []
        for r in rs:
            labs = labels_for(r, labels, docx_by_key)
            for s in r["steps"]:
                lab = labs.get(s["step_id"])
                if lab and lab["expert_verdict"] in GOLD_LABELS:
                    items.append((s, lab))
                if lab and fmt == "docx" and lab["rating"] is not None:
                    ratings.append(lab["rating"])
        if not items:
            continue
        gold = [l["expert_verdict"] for _, l in items]
        pred = [s["final"]["verdict"] for s, _ in items]
        ans = [(g, p) for g, p in zip(gold, pred) if p != RHR]
        ag, ap = [g for g, _ in ans], [p for _, p in ans]
        gap = [i for i, g in enumerate(gold) if g in GAP_LABELS]
        gap_ans = [i for i in gap if pred[i] != RHR]
        for mode, g_, p_ in (("answered only", ag, ap), ("strict (RHR = wrong)", gold, pred)):
            f1s = []
            for c in GOLD_LABELS:
                pr, rc, f1, support = prf(g_, p_, c)
                if support:
                    f1s.append(f1 or 0.0)
                per_class.append({"format": fmt, "scoring": mode, "class": c, "support": support,
                                  "precision": None if pr is None else round(pr, 3),
                                  "recall": None if rc is None else round(rc, 3),
                                  "f1": None if f1 is None else round(f1, 3)})
            gi = gap_ans if mode == "answered only" else gap
            summary.append({"format": fmt, "scoring": mode, "labelled_steps": len(gold), "scored_steps": len(g_),
                            "coverage_%": pct(len(ans), len(gold)),
                            "accuracy": round(sum(a == b for a, b in zip(g_, p_)) / len(g_), 3) if g_ else None,
                            "macro_f1": round(statistics.fmean(f1s), 3) if f1s else None,
                            "gap_detection_recall": round(sum(pred[i] in ("PARTIAL", "CONFLICT") for i in gi) / len(gi), 3)
                            if gi else None,
                            "cohens_kappa": kappa(g_, p_)})
        for g in GOLD_LABELS:
            row = {"format": fmt, "expert \\ pipeline": g}
            row.update({p: sum(a == g and b == p for a, b in zip(gold, pred)) for p in PRED_COLS})
            confusion.append(row)
        # Wrong steps: was the correct requirement retrieved (top 5)?
        cnt = Counter()
        for (s, lab), g, p in zip(items, gold, pred):
            if g == p:
                continue
            rel = lab["expert_relevant"] or lab["relevant"]
            ids = [h["id"] for h in s["retrieval"]["top5"]]
            kind = "answered" if p != RHR else "human review"
            if not rel:
                cnt[(kind, "unknown (no relevant ids)")] += 1
            elif not any(gvp.matches(i, rel) for i in ids):
                cnt[(kind, "retrieval error")] += 1
            elif any(gvp.matches(i, rel) for i in s["retrieval"]["llm_candidates"]):
                cnt[(kind, "LLM error (correct requirement shown to LLM)")] += 1
            else:
                cnt[(kind, "LLM error (correct requirement at rank 4-5, not shown)")] += 1
        for (kind, cause), v in sorted(cnt.items()):
            errors.append({"format": fmt, "wrong_step_type": kind, "cause": cause, "steps": v})
    rating_rows = ([{"rated_steps": len(ratings), "mean_rating": mean(ratings), "median_rating": median(ratings),
                     **{f"n_{k}": sum(r == k for r in ratings) for k in range(1, 6)}}] if ratings else [])
    return summary, per_class, confusion, errors, rating_rows


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", type=Path, help="results folder (default: latest)")
    ap.add_argument("--run", type=int, default=1, help="run used for extraction, retrieval and expert tables")
    ap.add_argument("--labels", type=Path, default=LABELS_DIR / "labels.xlsx")
    ap.add_argument("--gvp-manual", type=Path, default=LABELS_DIR / "gvp_manual.xlsx")
    ap.add_argument("--min-overlap", type=float, default=0.8, help="word overlap for the GVP extraction match")
    args = ap.parse_args()

    rdir = args.results or latest_results_dir()
    meta = json.loads((rdir / "run_meta.json").read_text(encoding="utf-8"))
    gvp = Gvp(json.loads((rdir / "gvp_requirements.json").read_text(encoding="utf-8")))
    all_results = load_results(rdir)
    results = [r for r in all_results if r["run"] == args.run]
    labels = load_labels(args.labels)
    docx_by_key = {(r["sop_id"], s["step_key"]): s for r in results if r["format"] == "docx" for s in r["steps"]}
    labelled_flags = Counter()
    for lab in labels.values():
        labelled_flags.update(k for k in ("is_true_step", "expert_verdict", "rating") if lab[k] is not None)
        labelled_flags.update(["relevant"] if lab["relevant"] else [])

    tables = {}
    tables["1_step_extraction"] = t_step_extraction(results, labels, docx_by_key)
    tables["2_gvp_extraction"], n_manual = t_gvp_extraction(gvp, args.gvp_manual, args.min_overlap)
    tables["3_retrieval"] = t_retrieval(results, labels, docx_by_key, gvp)
    tables["4_output_validation"], tables["4b_human_review_reasons"] = t_validation(all_results)
    tables["5_consistency"] = t_consistency(all_results)
    tables["6_efficiency_stages"], tables["6b_efficiency_files"] = t_efficiency(all_results)
    tables["7_format_comparison"] = t_format(all_results)
    (tables["8_expert_summary"], tables["8b_expert_per_class"], tables["8c_confusion_matrix"],
     tables["8d_error_attribution"], tables["8e_justification_rating"]) = t_expert(results, labels, docx_by_key, gvp)

    out = rdir / "metrics"
    out.mkdir(exist_ok=True)
    for name, rows in tables.items():
        with open(out / f"{name}.csv", "w", newline="", encoding="utf-8-sig") as f:
            if rows:
                w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                w.writeheader()
                w.writerows(rows)

    notes = {
        "1_step_extraction": "precision = true steps / labelled steps; recall = distinct true step numbers / manual "
                             "count. Empty until is_true_step is filled. pdf steps inherit the docx label when step "
                             "number and text match.",
        "2_gvp_extraction": f"{'no labels/gvp_manual.xlsx yet' if n_manual is None else f'{n_manual} manual requirements'}; "
                            f"match = same section and >= {args.min_overlap:.0%} of the manual text's words.",
        "3_retrieval": "Uses relevant_requirement_ids (team). A section code counts every unit in that section. "
                       "Binary relevance; Hit@3 = a relevant requirement is among the 3 shown to the LLM.",
        "4_output_validation": "valid JSON first try = the pipeline's validator accepted its single answer (it allows "
                               "code fences / extra text); pure JSON = the raw answer is only a JSON object.",
        "5_consistency": "Needs --runs >= 2." if not tables["5_consistency"] else "Verdict includes Requires Human Review.",
        "6_efficiency_stages": "Embedding and retrieval run once per file; per-step values = file time / steps. "
                               f"Model loading ({meta.get('model_load_sec')} s) and the LLM warm-up are not included.",
        "7_format_comparison": "Steps matched by step number; % over all step numbers seen in either format.",
        "8_expert_summary": "Requires Human Review is an abstention. Gap detection recall: expert PARTIAL/CONFLICT/"
                            "NOT_ADDRESSED, pipeline PARTIAL/CONFLICT. Macro-F1 over the expert classes present.",
    }
    md = [f"# Hawkim evaluation metrics: {rdir.name}", "",
          f"- Commit {meta['git']['commit'][:10]} ({'uncommitted changes' if meta['git']['uncommitted_changes_in_compliance_service'] else 'clean'}), "
          f"LLM {meta['models']['llm']} (temperature {meta['temperature']}), embedding {meta['models']['embedding']}, "
          f"top-k {meta['top_k']}, {meta['llm_candidates']} candidates to the LLM",
          f"- GVP {meta['gvp']['version']} ({meta['gvp']['index_meta'].get('n_units')} units, "
          f"{Path(meta['gvp']['index_meta'].get('gvp_file', '')).name}), runs: {meta['runs']}, "
          f"file runs: {len(all_results)}, tables 1/3/8 use run {args.run}",
          f"- Labels: {args.labels.name if labels else 'none yet'}"
          + (f" ({', '.join(f'{k}: {v}' for k, v in labelled_flags.items())})" if labels else ""), ""]
    for name, rows in tables.items():
        md += [f"## {name.replace('_', ' ')}", ""]
        if name in notes:
            md += [f"_{notes[name]}_", ""]
        md += [md_table(rows), ""]
    (out / "metrics.md").write_text("\n".join(md), encoding="utf-8")
    print(f"[metrics] {len(tables)} tables -> {out / 'metrics.md'}")


if __name__ == "__main__":
    main()
