"""Scope classification: which GVP modules does an SOP have to comply with?

Implements the expert's GVP mapping matrix (config/gvp_mapping_matrix.yaml):
the SOP title and Purpose/Objective are matched against keyword clusters,
a primary module is proposed, and the decision rules decide whether the
result can be used or must go to manual classification.

Decisions
  assigned        one clear process module
  multiple        several process modules; primary kept, others listed for verification
  supporting_only no process keyword, but a supporting keyword (e.g. training -> I)
  manual          no reliable match, or only general terms ("safety", "compliance")
Flags
  multiple_process_modules, quality_supporting, reporting_type_unspecified,
  reference_not_in_index, purpose_procedure_mismatch (added after retrieval)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from pathlib import Path

import yaml

# "The SFDA shall/should/will..." = obligation of the authority, never of the company
AUTHORITY_RE = re.compile(r"^(?:\[Context:.*?\]\s*)?(?:the\s+)?SFDA(?:'s)?\s+(?:shall|should|will|may|must|can|is|are)\b",
                          re.I | re.S)


def is_authority_unit(text: str) -> bool:
    return bool(AUTHORITY_RE.match(text.strip()))


def module_of(section: str | None) -> str:
    return (section or "").split(".")[0]


def _norm(s: str) -> str:
    s = s.lower().replace("–", "-").replace("—", "-")
    s = re.sub(r"(?<=[a-z])is(ation|e|ed|es|ing)\b", r"iz\1", s)   # British -> American spelling
    s = s.replace("programme", "program")
    return re.sub(r"\s+", " ", s)


def _find(keywords: list[str], text: str) -> list[str]:
    hits = []
    for k in keywords:
        if re.search(r"(?<![a-z0-9])" + re.escape(_norm(k)) + r"(?![a-z0-9])", text):
            hits.append(k)
    return hits


@dataclass
class ScopeResult:
    decision: str
    primary_modules: list[str]
    secondary_modules: list[str]
    scope_modules: list[str]                 # what retrieval is restricted to
    matched_rules: list[dict] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    source_text: str = ""
    source: str = ""
    matrix_version: str = ""

    def to_dict(self):
        return asdict(self)


class ScopeClassifier:
    def __init__(self, matrix_file: str | Path, include_secondary: bool = True):
        self.path = Path(matrix_file)
        m = yaml.safe_load(self.path.read_text(encoding="utf-8"))
        self.version = m.get("matrix_version", "")
        self.process = m.get("process_rules", [])
        self.supporting = m.get("supporting_rules", [])
        self.general = m.get("general_terms", [])
        self.include_secondary = include_secondary

    def classify(self, title: str, purpose: str, source: str = "purpose") -> ScopeResult:
        text = _norm(f"{title}. {purpose}")
        flags: list[str] = []
        matched = []

        proc_hits = []
        claimed: set[str] = set()   # keywords already used by a more specific rule
        for r in self.process:
            kws = r.get("keywords", []) + r.get("synonyms_added_by_hawkim", [])
            hits = [h for h in _find(kws, text) if not any(_norm(h) in _norm(c) for c in claimed)]
            if not hits:
                continue
            claimed.update(hits)
            proc_hits.append((r, hits))
            matched.append({"rule": r["name"], "keywords": hits, "type": "process",
                            "primary": r.get("primary", []), "secondary": r.get("secondary", [])})
            if r.get("not_in_index"):
                flags.append(f"reference_not_in_index: {r['not_in_index']}")
        sup_hits = []
        for r in self.supporting:
            hits = _find(r.get("keywords", []) + r.get("synonyms_added_by_hawkim", []), text)
            if hits:
                sup_hits.append((r, hits))
                matched.append({"rule": r["name"], "keywords": hits, "type": "supporting", "modules": r.get("modules", [])})
        general = _find(self.general, text)

        # score process modules by keyword hits; the quality cluster only supports another process (rule 4)
        proc_score: dict[str, int] = {}
        qual_score: dict[str, int] = {}
        for r, hits in proc_hits:
            target = qual_score if r.get("quality_cluster") else proc_score
            for mdl in r.get("primary", []):
                target[mdl] = target.get(mdl, 0) + len(hits)
        secondary: list[str] = []
        if proc_score:
            ranked = sorted(proc_score, key=lambda m: -proc_score[m])
            extra_quality = [m for m in qual_score if m not in proc_score]
            if extra_quality:
                flags.append("quality_supporting")
                secondary += extra_quality
        else:
            ranked = sorted(qual_score, key=lambda m: -qual_score[m])

        if ranked:
            primary = [ranked[0]]
            others = ranked[1:]
            decision = "assigned"
            if others:
                decision = "multiple"
                flags.append("multiple_process_modules")
                secondary += others
            for r, _ in proc_hits:
                if ranked[0] in r.get("primary", []) or r.get("quality_cluster"):
                    secondary += r.get("secondary", [])
            for r, _ in sup_hits:
                secondary += r.get("modules", [])
        elif sup_hits and any(r.get("modules") for r, _ in sup_hits):
            mods = []
            for r, _ in sup_hits:
                mods += r.get("modules", [])
            primary = [mods[0]]
            secondary = mods[1:]
            decision = "supporting_only"
            # a "not in index" process rule may still give secondary candidates
            for r, _ in proc_hits:
                secondary += r.get("secondary", [])
        else:
            primary = []
            for r, _ in proc_hits:          # e.g. pregnancy (P.III): only secondary modules exist
                secondary += r.get("secondary", [])
            decision = "manual"
            if general and not proc_hits:
                flags.append("only_general_terms")
        if any(r.get("reporting_without_type") for r, _ in sup_hits) and not ranked:
            flags.append("reporting_type_unspecified")

        secondary = [m for i, m in enumerate(secondary) if m not in primary and m not in secondary[:i]]
        scope = primary + (secondary if self.include_secondary else [])
        if decision == "manual":
            scope = []          # manual classification required: do not restrict
        return ScopeResult(decision=decision, primary_modules=primary, secondary_modules=secondary,
                           scope_modules=scope, matched_rules=matched, flags=flags,
                           source_text=purpose[:1500], source=source, matrix_version=self.version)


# ------------------------------------------------------------------ SOP title / purpose

def sop_title(doc, path: str | Path) -> tuple[str, str]:
    """Title from the repeated page header ('Company | Title | Page 1 of 6'), else from the file name."""
    for line in getattr(doc, "removed_header_footer_lines", []):
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 3 and re.search(r"page\s*\d", parts[-1], re.I):
            return parts[-2], "page header"
    stem = Path(path).stem
    stem = re.sub(r"^SOP-[A-Z]+-\d+(-v\d+)?_?", "", stem, flags=re.I)
    return stem.replace("_", " ").strip(), "file name"


def sop_purpose(all_chunks) -> tuple[str, str]:
    """Purpose/Objective text from the chunks (falls back to Scope, then the first chunk)."""
    for key in ("purpose", "objective"):
        txt = " ".join(c.text for c in all_chunks if key in c.heading.split(" > ")[0].lower())
        if txt.strip():
            return txt, key
    txt = " ".join(c.text for c in all_chunks if "scope" in c.heading.split(" > ")[0].lower())
    if txt.strip():
        return txt, "scope (no purpose section found)"
    return (all_chunks[0].text if all_chunks else ""), "first chunk (no purpose or scope found)"
