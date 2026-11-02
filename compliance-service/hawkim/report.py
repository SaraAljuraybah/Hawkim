"""Markdown reports."""
from __future__ import annotations

from pathlib import Path

from .validation import LABELS


def _pct(x):
    return "n/a" if x is None else f"{x:.1%}"


def _f(x, d=3):
    return "n/a" if x is None else f"{x:.{d}f}"


def _ci(ci, key, pct=False):
    if key not in ci:
        return ""
    lo, hi = ci[key]
    return f" ({_pct(lo)}–{_pct(hi)})" if pct else f" ({lo:.3f}–{hi:.3f})"


def write_report(path: Path, m: dict):
    c, ci, r = m["classification"], m["classification_ci95"], m["retrieval"]
    L = [f"# Evaluation report: {m['run']}", "",
         f"- LLM: `{m['model']}` via {m['provider']}  ",
         f"- Embedding: `{m['embedding']}`  ",
         f"- Mode: {m['mode']}{' (ORACLE: gold requirement given to the LLM, retrieval bypassed)' if m['oracle'] else ''}  ",
         f"- SOP files: {m['n_files']}, assessed chunks: {m['n_predictions']}  ",
         f"- Evaluated: {m['evaluated']}", ""]
    if m["warnings"]:
        L += ["**Warnings**", ""] + [f"- {w}" for w in m["warnings"]] + [""]

    if c.get("n"):
        L += ["## Compliance classification (same metrics as Sprint 0, Table 8)", "",
              ("Scoring as in Sprint 0 (Table 6): metrics use valid outputs only, and a NOT_ADDRESSED prediction is "
               "never counted as correct; for a non-compliant case it counts as missed. " if c.get("scoring") == "sprint0"
               else "Lenient scoring: invalid outputs count as wrong and NOT_ADDRESSED counts as a detected case. ")
              + "95% bootstrap intervals in brackets; they treat chunks as independent, so the true "
              "uncertainty is larger, especially with few SOP files.", "",
              "| Metric | Value |", "|---|---|",
              f"| Annotated cases | {c['n']} |",
              f"| Valid outputs rate | {_pct(c['valid_output_rate'])} ({c['valid_outputs']}/{c['n']}) |",
              f"| Accuracy | {_pct(c['accuracy'])}{_ci(ci, 'accuracy', True)} |",
              f"| Macro F1 | {_f(c['macro_f1'])}{_ci(ci, 'macro_f1')} |",
              f"| Non-compliance precision | {_f(c['nc_precision'])}{_ci(ci, 'nc_precision')} |",
              f"| Non-compliance recall | {_f(c['nc_recall'])}{_ci(ci, 'nc_recall')} |",
              f"| Non-compliance F1 | {_f(c['nc_f1'])}{_ci(ci, 'nc_f1')} |",
              f"| Exact non-compliance type (PARTIAL/CONFLICT) | {c['exact_nc_type']}/{c['exact_nc_type_pool']} |",
              f"| False negatives (non-compliant predicted COMPLIANT) | {c['false_negatives']}/{c['n_gold_non_compliant']} |",
              f"| Non-compliant cases missed as NOT_ADDRESSED | {c['missed_as_not_addressed']}/{c['n_gold_non_compliant']} |",
              f"| False positives (compliant predicted PARTIAL or CONFLICT) | {c['false_positives']}/{c['n_gold_compliant']} |",
              f"| Compliant cases predicted NOT_ADDRESSED | {c['compliant_marked_not_addressed']}/{c['n_gold_compliant']} |",
              f"| Label usage | {', '.join(f'{k}: {v}' for k, v in sorted(c['label_usage'].items()))} |",
              f"| Gold distribution | {', '.join(f'{k}: {v}' for k, v in sorted(c['gold_distribution'].items()))} |",
              "", "### Per-class results", "", "| Label | Precision | Recall | F1 | Gold support | Predicted |",
              "|---|---|---|---|---|---|"]
        for lab in LABELS:
            pc = c["per_class"][lab]
            L.append(f"| {lab} | {_f(pc['precision'])} | {_f(pc['recall'])} | {_f(pc['f1'])} | {pc['support']} | {pc['predicted']} |")
        cols = LABELS + ["INVALID"]
        golds = [g for g in LABELS + ["MISSING"] if c["gold_distribution"].get(g)]
        L += ["", "### Confusion matrix (rows = expert label, columns = model label)", "",
              "| Gold \\ Pred | " + " | ".join(cols) + " |", "|---" * (len(cols) + 1) + "|"]
        for g in golds:
            L.append(f"| {g} | " + " | ".join(str(c["confusion"].get(f"{g}->{p}", 0)) for p in cols) + " |")
        L.append("")

    if r.get("n"):
        L += [f"## Retrieval (embedding stage: {m['embedding']})", "",
              "Share of SOP chunks whose expert-marked GVP requirement appears in the top-k retrieved units.", "",
              "| Metric | Value |", "|---|---|", f"| Chunks with gold requirement | {r['n']} |"]
        L += [f"| {k} | {_f(v)} |" for k, v in r.items() if k != "n"]
        L.append("")
    s = m["requirement_selection"]
    if s.get("n"):
        L += ["## Requirement used by the LLM", "", "| Metric | Value |", "|---|---|",
              f"| Requirement used matches expert's | {_pct(s['requirement_used_correct'])} (n={s['n']}) |",
              f"| Label AND requirement correct (strict) | {_pct(s['label_and_requirement_correct'])} |", ""]
    bt = m.get("by_chunk_type") or {}
    if bt:
        L += ["## Results by chunk type", "", "| Chunk type | Cases | Accuracy | NC recall | False negatives | False positives |",
              "|---|---|---|---|---|---|"]
        for t, v in bt.items():
            L.append(f"| {t} | {v['n']} | {_pct(v['accuracy'])} | {_f(v['nc_recall'])} | {v['false_negatives']} | {v['false_positives']} |")
        L.append("")
    tr = m.get("scope_tracking") or {}
    if tr:
        L += [f"## Scope and retrieval tracking (scope mode: {m.get('scope_mode', 'none')}, {m.get('matrix_version') or 'no matrix'})", "",
              "\"Best match inside scope\" = share of chunks whose best match in the whole GVP (no restriction) falls inside "
              "the modules the matrix assigned to the SOP. Low values mean the procedures and the purpose point to different "
              "parts of the GVP.", "",
              "| SOP | Title | Scope decision | Modules | Flags | Best match inside scope | Most used sections | Review required |",
              "|---|---|---|---|---|---|---|---|"]
        for f, v in tr.items():
            secs = ", ".join(f"{k} ({n})" for k, n in list(v["sections_used"].items())[:4])
            L.append(f"| {f} | {v.get('title') or ''} | {v.get('scope_decision') or '-'} | {' '.join(v.get('scope_modules') or []) or '-'} "
                     f"| {'; '.join(v.get('scope_flags') or []) or '-'} | {_pct(v.get('best_overall_match_inside_scope'))} "
                     f"| {secs} | {v['review_required']}/{v['chunks']} |")
        L.append("")
    g = m["grounding"]
    L += ["## Explainability checks", "", "| Metric | Value |", "|---|---|",
          f"| SOP evidence found in the SOP text | {_pct(g['sop_evidence_grounded_rate'])} (n={g['sop_evidence_n']}) |",
          f"| Requirement evidence found in the requirement text | {_pct(g['req_evidence_grounded_rate'])} (n={g['req_evidence_n']}) |", ""]
    if m["per_file"]:
        L += ["## Per file", "", "| File | Cases | Accuracy | NC recall | False negatives | Recall@1 |",
              "|---|---|---|---|---|---|"]
        for f, pf in m["per_file"].items():
            L.append(f"| {f} | {pf['n']} | {_pct(pf['accuracy'])} | {_f(pf['nc_recall'])} | "
                     f"{pf['false_negatives']}/{pf['n_gold_non_compliant']} | {_f(pf.get('recall@1'))} |")
        L.append("")
    lat, tok = m["latency"], m["tokens"]
    if lat:
        L += ["## Cost and speed", "", f"- Latency per call: mean {lat['mean_sec']:.1f}s, median {lat['median_sec']:.1f}s, "
              f"max {lat['max_sec']:.1f}s (cached calls excluded)",
              f"- Tokens: {tok['prompt']:,} prompt, {tok['completion']:,} completion", ""]
    L += ["## How to read this", "",
          "- Look at `per_case.csv`, filter `error_type = FALSE_NEGATIVE` first: these are compliance gaps the model missed.",
          "- If retrieval recall is low, many classification errors are caused by the wrong requirement, not by the LLM. "
          "Run the same files with `--oracle` to measure the LLM alone.",
          "- Results on a few documents are a pilot evaluation, not a general accuracy claim.", ""]
    path.write_text("\n".join(L), encoding="utf-8")


def write_comparison(path: Path, items: list[dict]) -> str:
    def g(m, *keys):
        x = m
        for k in keys:
            x = (x or {}).get(k) if isinstance(x, dict) else None
        return x
    def frac(m, key, total_key):
        a, b = g(m, "classification", key), g(m, "classification", total_key)
        return "n/a" if a is None or b is None else f"{a}/{b}"

    def track(m):
        return list((m.get("scope_tracking") or {}).values())

    def labels(m, lab):
        return sum((t.get("labels") or {}).get(lab, 0) for t in track(m))

    def inside(m):
        ts = [t for t in track(m) if t.get("best_overall_match_inside_scope") is not None]
        n = sum(t["chunks"] for t in ts)
        return _pct(sum(t["best_overall_match_inside_scope"] * t["chunks"] for t in ts) / n) if n else "n/a"

    rows = [
        ("LLM", lambda m: m["model"]), ("Embedding", lambda m: m["embedding"]),
        ("Mode", lambda m: m["mode"] + (" (oracle)" if m["oracle"] else "")),
        ("Scope", lambda m: m.get("scope_mode", "none")),
        ("Chunks assessed", lambda m: m.get("n_predictions")),
        ("COMPLIANT", lambda m: labels(m, "COMPLIANT")),
        ("PARTIAL", lambda m: labels(m, "PARTIAL")),
        ("CONFLICT", lambda m: labels(m, "CONFLICT")),
        ("NOT_ADDRESSED", lambda m: labels(m, "NOT_ADDRESSED")),
        ("Review required", lambda m: sum(t.get("review_required", 0) for t in track(m))),
        ("Best match (whole GVP) inside SOP scope", inside),
        ("Labelled cases (ground truth)", lambda m: g(m, "classification", "n") or 0),
        ("Valid outputs", lambda m: _pct(g(m, "classification", "valid_output_rate"))),
        ("Accuracy", lambda m: _pct(g(m, "classification", "accuracy"))),
        ("Macro F1", lambda m: _f(g(m, "classification", "macro_f1"))),
        ("NC precision", lambda m: _f(g(m, "classification", "nc_precision"))),
        ("NC recall", lambda m: _f(g(m, "classification", "nc_recall"))),
        ("NC F1", lambda m: _f(g(m, "classification", "nc_f1"))),
        ("False negatives", lambda m: frac(m, "false_negatives", "n_gold_non_compliant")),
        ("Missed as NOT_ADDRESSED", lambda m: frac(m, "missed_as_not_addressed", "n_gold_non_compliant")),
        ("False positives", lambda m: frac(m, "false_positives", "n_gold_compliant")),
        ("Exact NC type", lambda m: frac(m, "exact_nc_type", "exact_nc_type_pool")),
        ("Recall@1", lambda m: _f(g(m, "retrieval", "recall@1"))),
        ("Recall@3", lambda m: _f(g(m, "retrieval", "recall@3"))),
        ("Recall@5", lambda m: _f(g(m, "retrieval", "recall@5"))),
        ("MRR", lambda m: _f(g(m, "retrieval", "mrr"))),
        ("Req. used correct", lambda m: _pct(g(m, "requirement_selection", "requirement_used_correct"))),
        ("SOP evidence grounded", lambda m: _pct(g(m, "grounding", "sop_evidence_grounded_rate"))),
        ("Mean latency (s)", lambda m: _f(g(m, "latency", "mean_sec"), 1)),
    ]
    L = ["# Run comparison", "", "| Metric | " + " | ".join(m["run"] for m in items) + " |",
         "|---" * (len(items) + 1) + "|"]
    for label, fn in rows:
        vals = []
        for m in items:
            try:
                vals.append(str(fn(m)))
            except Exception:
                vals.append("n/a")
        L.append(f"| {label} | " + " | ".join(vals) + " |")
    L += ["", "Rows from \"Labelled cases\" downward need data/ground_truth.csv; without it they show n/a. "
          "Compare runs only when they used the same SOP files and the same ground truth."]
    text = "\n".join(L)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text
