"""Rule-based check for number conflicts between an SOP step and a GVP requirement.

Agreed rule (Hawkim expert): an SOP that is stricter than the GVP is compliant for that element;
an SOP that is less strict is a conflict. Example: GVP "within 30 days" -> SOP "within 15 days" is
compliant, SOP "within 35 days" is a conflict.

Two kinds of numbers are checked:
- deadlines   ("within 15 days", "no later than 12 months", "within 7 calendar days")
              -> a LONGER deadline in the SOP is less strict
- retention   ("retained ... for at least 10 years", "kept for 5 years")
              -> a SHORTER retention period in the SOP is less strict

The check is deliberately conservative. It only compares when the requirement states exactly one
value of a kind and the SOP step states exactly one value of the same kind, and it skips deadlines
counted in different ways (working days vs calendar days). Frequencies ("every 6 months") are not
checked until the expert confirms the rule for them.
"""
from __future__ import annotations

import re

_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
          "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fourteen": 14, "fifteen": 15,
          "twenty": 20, "twenty-one": 21, "thirty": 30, "sixty": 60, "seventy": 70, "ninety": 90}
_NUM = r"(\d+|" + "|".join(sorted((re.escape(w) for w in _WORDS), key=len, reverse=True)) + r")"
_TO_DAYS = {"hour": 1 / 24, "day": 1, "week": 7, "month": 30, "year": 365}

DEADLINE_RE = re.compile(
    r"\b(?:within|no\s+later\s+than|not\s+later\s+than|no\s+more\s+than|not\s+more\s+than|at\s+the\s+latest)\s+"
    r"(?:a\s+maximum\s+of\s+|the\s+next\s+)?" + _NUM + r"\s*(?:\(\d+\)\s*)?"
    r"(calendar\s+|working\s+|business\s+)?(hour|day|week|month|year)s?\b", re.I)
RETENTION_RE = re.compile(
    r"\b(?:retain(?:ed)?|kept|keep|stored?|archived?|preserved?|retention)\b[^.;]{0,120}?"
    r"\b(?:for\s+)?(?:at\s+least\s+|a\s+minimum\s+of\s+|minimum\s+of\s+|not\s+less\s+than\s+)?(?:further\s+)?"
    + _NUM + r"\s*(?:\(\d+\)\s*)?(year|month)s?\b", re.I)


def _value(token: str) -> int:
    t = token.lower()
    return int(t) if t.isdigit() else _WORDS[t]


def deadlines(text: str) -> list[dict]:
    """Deadlines in a text, as {"days", "count", "phrase"} (count = calendar or working)."""
    out = []
    for m in DEADLINE_RE.finditer(text or ""):
        kind = (m.group(2) or "calendar").strip().lower()
        out.append({"days": _value(m.group(1)) * _TO_DAYS[m.group(3).lower()],
                    "count": "working" if kind in ("working", "business") else "calendar",
                    "phrase": m.group(0).strip()})
    return out


def retentions(text: str) -> list[dict]:
    out = []
    for m in RETENTION_RE.finditer(text or ""):
        num = re.search(_NUM + r"\s*(?:\(\d+\)\s*)?(year|month)s?\b", m.group(0), re.I)
        out.append({"days": _value(m.group(1)) * _TO_DAYS[m.group(2).lower()],
                    "phrase": num.group(0).strip() if num else m.group(0).strip()})
    return out


def _distinct(values: list[dict]) -> list[dict]:
    seen, out = set(), []
    for v in values:
        key = (v["days"], v.get("count"))
        if key not in seen:
            seen.add(key)
            out.append(v)
    return out


def check(sop_text: str, requirement_text: str) -> dict:
    """Compare the numbers in one SOP step with the numbers in its chosen requirement.

    Returns {"conflicts": [...], "stricter": [...]}; each item names the kind and both phrases.
    "conflicts" = the SOP is less strict (possible CONFLICT); "stricter" = the SOP is stricter (compliant
    for that element). Equal values are not reported.
    """
    result = {"conflicts": [], "stricter": []}
    # Deadlines: only when each text has exactly one distinct deadline, counted the same way.
    r_d, s_d = _distinct(deadlines(requirement_text)), _distinct(deadlines(sop_text))
    if len(r_d) == 1 and len(s_d) == 1 and r_d[0]["count"] == s_d[0]["count"]:
        r, s = r_d[0], s_d[0]
        item = {"kind": "deadline", "sop": s["phrase"], "requirement": r["phrase"]}
        if s["days"] > r["days"]:
            result["conflicts"].append(item)
        elif s["days"] < r["days"]:
            result["stricter"].append(item)
    # Retention: only when each text has exactly one distinct retention period.
    r_r, s_r = _distinct(retentions(requirement_text)), _distinct(retentions(sop_text))
    if len(r_r) == 1 and len(s_r) == 1:
        r, s = r_r[0], s_r[0]
        item = {"kind": "retention", "sop": s["phrase"], "requirement": r["phrase"]}
        if s["days"] < r["days"]:
            result["conflicts"].append(item)
        elif s["days"] > r["days"]:
            result["stricter"].append(item)
    return result


def describe(item: dict, conflict: bool) -> str:
    if item["kind"] == "deadline":
        how = "a longer deadline" if conflict else "a shorter deadline"
    else:
        how = "a shorter retention period" if conflict else "a longer retention period"
    return (f"the SOP sets {how} (\"{item['sop']}\") than the GVP requirement (\"{item['requirement']}\")")
