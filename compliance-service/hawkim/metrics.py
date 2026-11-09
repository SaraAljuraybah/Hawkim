"""Evaluation metrics.

Classification metrics mirror Table 8 of the Sprint 0 report so PDF results can
be compared with the 36-case benchmark. Retrieval metrics measure the BGE-M3 stage.

Gold labels
  COMPLIANT, PARTIAL, CONFLICT, NOT_ADDRESSED  -> scored
  MISSING   -> scored as non-compliant; can never be matched exactly (as in Sprint 0 round 2)
  N/A or blank -> chunk has no applicable GVP requirement; excluded from classification metrics
Scoring follows Sprint 0 (Table 6) by default: see classification_metrics.
"""
from __future__ import annotations

import random
import statistics
from collections import Counter

from .validation import LABELS, NON_COMPLIANT_PRED

GOLD_NON_COMPLIANT = {"PARTIAL", "CONFLICT", "NOT_ADDRESSED", "MISSING"}
EXACT_TYPE_LABELS = {"PARTIAL", "CONFLICT"}


def parse_gold_ids(value) -> list[str]:
    if value is None:
        return []
    s = str(value).strip()
    if not s or s.upper() in ("NAN", "N/A", "NA", "NONE"):
        return []
    return [t.strip().rstrip(".") for t in s.replace(",", ";").split(";") if t.strip()]


def requirement_matches(unit_id: str | None, unit_section: str | None, gold_tokens: list[str]) -> bool:
    """A gold token can be a unit id (I.B.10#3) or a section code (I.B.10 matches I.B.10 and I.B.10.x)."""
    if not unit_id:
        return False
    for t in gold_tokens:
        if "#" in t:
            if unit_id == t:
                return True
        elif unit_section and (unit_section == t or unit_section.startswith(t + ".")):
            return True
    return False


def _safe_div(a, b):
    return a / b if b else 0.0


def _f1(p, r):
    return 2 * p * r / (p + r) if (p + r) else 0.0


def classification_metrics(rows: list[dict], scoring: str = "sprint0") -> dict:
    """rows: dicts with gold_label, pred_label (None if invalid), valid (bool).

    scoring = "sprint0" (default, as in Sprint 0 Table 6):
      - metrics use valid outputs only; invalid outputs only lower the valid outputs rate
      - a NOT_ADDRESSED prediction is never correct; for a non-compliant gold label it counts as missed
    scoring = "lenient": invalid outputs count as wrong; NOT_ADDRESSED counts as a detected (flagged) case
    """
    n_all = len(rows)
    if n_all == 0:
        return {"n": 0}
    n_valid = sum(1 for r in rows if r["valid"])
    rows_m = [r for r in rows if r["valid"]] if scoring == "sprint0" else rows
    n = len(rows_m)
    flag_labels = {"PARTIAL", "CONFLICT"} if scoring == "sprint0" else NON_COMPLIANT_PRED

    def ok(r):
        return r["valid"] and r["pred_label"] == r["gold_label"] and not (
            scoring == "sprint0" and r["pred_label"] == "NOT_ADDRESSED")

    def flagged(r):
        return r["valid"] and r["pred_label"] in flag_labels

    correct = sum(1 for r in rows_m if ok(r))
    per_class, present = {}, set()
    for lab in LABELS:
        tp = sum(1 for r in rows_m if ok(r) and r["gold_label"] == lab)
        n_pred = sum(1 for r in rows_m if r["valid"] and r["pred_label"] == lab)
        support = sum(1 for r in rows_m if r["gold_label"] == lab)
        if support or n_pred:
            present.add(lab)
        p, rc = _safe_div(tp, n_pred), _safe_div(tp, support)
        per_class[lab] = {"precision": p, "recall": rc, "f1": _f1(p, rc), "support": support, "predicted": n_pred}
    macro_f1 = _safe_div(sum(per_class[l]["f1"] for l in present), len(present))

    gold_nc = [r for r in rows_m if r["gold_label"] in GOLD_NON_COMPLIANT]
    tp = sum(1 for r in gold_nc if flagged(r))
    fp = sum(1 for r in rows_m if r["gold_label"] == "COMPLIANT" and flagged(r))
    nc_p, nc_r = _safe_div(tp, tp + fp), _safe_div(tp, len(gold_nc))
    exact_pool = [r for r in rows_m if r["gold_label"] in EXACT_TYPE_LABELS]
    exact = sum(1 for r in exact_pool if ok(r))
    confusion = Counter((r["gold_label"], r["pred_label"] if r["valid"] else "INVALID") for r in rows)
    return {
        "scoring": scoring,
        "n": n, "n_all": n_all,
        "valid_outputs": n_valid, "valid_output_rate": n_valid / n_all,
        "accuracy": _safe_div(correct, n),
        "macro_f1": macro_f1, "macro_f1_classes": sorted(present),
        "nc_precision": nc_p, "nc_recall": nc_r, "nc_f1": _f1(nc_p, nc_r),
        "n_gold_non_compliant": len(gold_nc),
        "false_negatives": sum(1 for r in gold_nc if r["valid"] and r["pred_label"] == "COMPLIANT"),
        "missed_as_not_addressed": sum(1 for r in gold_nc if r["valid"] and r["pred_label"] == "NOT_ADDRESSED"),
        "false_negatives_invalid": sum(1 for r in gold_nc if not r["valid"]),
        "n_gold_compliant": sum(1 for r in rows_m if r["gold_label"] == "COMPLIANT"),
        "false_positives": fp,
        "compliant_marked_not_addressed": sum(1 for r in rows_m if r["gold_label"] == "COMPLIANT"
                                              and r["valid"] and r["pred_label"] == "NOT_ADDRESSED"),
        "exact_nc_type": exact, "exact_nc_type_pool": len(exact_pool),
        "per_class": per_class,
        "label_usage": dict(Counter(r["pred_label"] for r in rows if r["valid"])),
        "gold_distribution": dict(Counter(r["gold_label"] for r in rows_m)),
        "confusion": {f"{g}->{p}": c for (g, p), c in sorted(confusion.items())},
    }


def bootstrap_ci(rows: list[dict], metric_keys: list[str], samples: int = 2000, seed: int = 42,
                 scoring: str = "sprint0") -> dict:
    """Case-level percentile bootstrap 95% CI. Note: chunks from the same SOP are not
    independent, so these intervals are optimistic (too narrow)."""
    if len(rows) < 5 or samples <= 0:
        return {}
    rng = random.Random(seed)
    vals = {k: [] for k in metric_keys}
    for _ in range(samples):
        sample = [rows[rng.randrange(len(rows))] for _ in rows]
        m = classification_metrics(sample, scoring)
        for k in metric_keys:
            vals[k].append(m[k])
    out = {}
    for k, v in vals.items():
        v.sort()
        out[k] = [v[int(0.025 * len(v))], v[min(len(v) - 1, int(0.975 * len(v)))]]
    return out


def retrieval_metrics(rows: list[dict], ks: list[int]) -> dict:
    """rows: dicts with 'retrieved' (list of {id, section}) and 'gold_ids' (tokens)."""
    rows = [r for r in rows if r["gold_ids"]]
    if not rows:
        return {"n": 0}
    out = {"n": len(rows)}
    for k in ks:
        hits = sum(1 for r in rows if any(requirement_matches(c["id"], c["section"], r["gold_ids"])
                                          for c in r["retrieved"][:k]))
        out[f"recall@{k}"] = hits / len(rows)
    rr = []
    for r in rows:
        rank = next((i + 1 for i, c in enumerate(r["retrieved"])
                     if requirement_matches(c["id"], c["section"], r["gold_ids"])), None)
        rr.append(1 / rank if rank else 0.0)
    out["mrr"] = sum(rr) / len(rr)
    return out


def latency_stats(latencies: list[float]) -> dict:
    lat = [x for x in latencies if x is not None]
    if not lat:
        return {}
    return {"mean_sec": statistics.mean(lat), "median_sec": statistics.median(lat), "max_sec": max(lat)}
