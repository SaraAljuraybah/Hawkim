"""Chunking.

GVP  -> requirement units: one obligation sentence (plus its bullet list if the
        sentence introduces one), tagged with the GVP section code, e.g. I.B.10#3.
SOP  -> section chunks: one chunk per (sub)section, with the heading path kept
        as context. Long sections are split by sentences.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, asdict
from pathlib import Path

from .extract import Document

# ---------------------------------------------------------------- shared helpers

BULLET_RE = re.compile(r"^\s*(?:[•●▪◦■□➢►\-–\uf0b7\uf0a7\uf076\uf0d8]|\(?[a-z]\)|\(?[ivx]{1,4}\)|\d{1,2}[.)])\s+")
TOC_RE = re.compile(r"(\.{4,}|…{2,})\s*\d+\s*$")
SENT_SPLIT_RE = re.compile(r"(?<!\b[a-z]\.)(?<=[.!?])\s+(?=[A-Z•“\"(])")  # no split after "a." / "e.g."


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in SENT_SPLIT_RE.split(text) if s.strip()]


def short_hash(text: str) -> str:
    return hashlib.sha1(" ".join(text.split()).encode("utf-8")).hexdigest()[:10]


# ---------------------------------------------------------------- GVP

GVP_SECTION_RE = re.compile(
    r"^\s*([IVX]+\.(?:App\d+|\s?(?i:appendix)\s?\d+|\s?(?i:add)\.\s?[IVX]+|[A-Z](?![A-Za-z]))"
    r"(?:\.\d+)*(?:\.[a-z])?)\.?\s*([A-Z“\"(].*)$")
# a line that starts with a cross-reference mid-sentence ("...outlined in\nVI.C.4. If no other")
# is not a heading
REF_PRECEDING_WORD_RE = re.compile(r"\b(in|with|see|to|of|and|under|per|by|from)\s*$", re.I)
# sentences that only make sense with the sentence before them
ANAPHORA_RE = re.compile(r"^(this|these|such|that|those|it|they|in this context|in such cases?|in addition|furthermore|"
                         r"however|accordingly|therefore)\b", re.I)


@dataclass
class GVPUnit:
    id: str
    section: str
    section_title: str
    page: int
    text: str
    is_obligation: bool

    def embed_text(self) -> str:
        return f"{self.section} {self.section_title}: {self.text}"

    def to_dict(self):
        return asdict(self)


def _gvp_elements(lines: list[str]) -> list[tuple[str, str]]:
    """Turn section lines into ordered ('sent'|'bullet', text) elements."""
    elements: list[tuple[str, str]] = []
    prose: list[str] = []
    bullet: list[str] | None = None

    def flush_prose():
        if prose:
            for s in split_sentences(" ".join(prose)):
                elements.append(("sent", s))
            prose.clear()

    for line in lines:
        s = line.strip()
        if BULLET_RE.match(s):
            flush_prose()
            if bullet:
                elements.append(("bullet", " ".join(bullet)))
            bullet = [BULLET_RE.sub("", s, count=1)]
        elif bullet is not None:
            last = bullet[-1].rstrip()
            if last.endswith((".", ";")) and s[:1].isupper():
                elements.append(("bullet", " ".join(bullet)))
                bullet = None
                prose.append(s)
            else:
                bullet.append(s)
        else:
            prose.append(s)
    if bullet:
        elements.append(("bullet", " ".join(bullet)))
    flush_prose()
    return elements


def chunk_gvp(doc: Document, obligation_keywords: list[str], obligation_only: bool = True,
              max_unit_chars: int = 2500) -> list[GVPUnit]:
    kw_re = re.compile(r"\b(" + "|".join(re.escape(k) for k in obligation_keywords) + r")\b", re.I)

    # 1) group lines into sections
    sections: list[dict] = []
    current = None
    prev_line = ""
    for page, line in doc.lines_with_pages():
        if TOC_RE.search(line):
            continue
        m = GVP_SECTION_RE.match(line)
        if m and len(line) < 200 and not REF_PRECEDING_WORD_RE.search(prev_line):
            code = re.sub(r"\s+", "", m.group(1))
            current = {"code": code, "title": m.group(2).strip(), "page": page, "lines": []}
            sections.append(current)
            prev_line = line
            continue
        if current is not None:
            current["lines"].append(line)
        prev_line = line

    # 2) build units inside each section
    units: list[GVPUnit] = []
    seen_count: dict[str, int] = {}
    for sec in sections:
        elements = _gvp_elements(sec["lines"])
        groups: list[list[str]] = []
        i = 0
        while i < len(elements):
            kind, text = elements[i]
            if kind == "sent":
                group = [text]
                if text.rstrip().endswith(":"):
                    j = i + 1
                    while j < len(elements) and elements[j][0] == "bullet":
                        group.append("• " + elements[j][1])
                        j += 1
                    i = j
                else:
                    i += 1
                groups.append(group)
            else:  # orphan bullet
                if groups:
                    groups[-1].append("• " + text)
                else:
                    groups.append(["• " + text])
                i += 1

        # Fragments without sentence-final punctuation (table rows, sub-headings such as
        # "a. Serious ICSRs") are attached to the previous unit so that, e.g., a reporting
        # timeframe table stays with the obligation it belongs to.
        merged: list[list[str]] = []
        for group in groups:
            joined = " ".join(group).rstrip()
            if merged and not kw_re.search(joined) and not joined.endswith((".", "!", "?", ":")):
                merged[-1].extend(group)
            else:
                merged.append(group)
        groups = merged

        n = seen_count.get(sec["code"], 0)   # keeps IDs unique if a section code appears twice
        prev_lead = ""
        for group in groups:
            # "This should include third parties." -> add the previous sentence as context
            if ANAPHORA_RE.match(group[0]) and prev_lead:
                context = prev_lead if len(prev_lead) <= 500 else prev_lead[:500] + "..."
                group = [f"[Context: {context}]"] + group
                prev_lead = group[1]
            else:
                prev_lead = group[0]
            # split very long lead-in + bullet lists into parts
            parts: list[list[str]] = []
            lead, bullets = group[0], group[1:]
            cur = [lead]
            for b in bullets:
                if sum(len(x) for x in cur) + len(b) > max_unit_chars and len(cur) > 1:
                    parts.append(cur)
                    cur = [lead]
                cur.append(b)
            parts.append(cur)
            for part in parts:
                n += 1
                text = "\n".join(part)
                units.append(GVPUnit(
                    id=f"{sec['code']}#{n}", section=sec["code"], section_title=sec["title"],
                    page=sec["page"], text=text, is_obligation=bool(kw_re.search(text))))
        seen_count[sec["code"]] = n

    if obligation_only:
        units = [u for u in units if u.is_obligation]
    return units


# ---------------------------------------------------------------- SOP

# Numbered lines: "5- Procedures:", "5-1. Title", "5.1 Title", "Section 3 Title", "5-1-1. The PV Manager shall ..."
SOP_NUM_RE = re.compile(r"^\s*(##\s+)?(?:(?:section|step)\s+)?(\d{1,2}(?:[.\-]\d{1,2}){0,4})([.\-:)]?)\s+(\S.*)$", re.I)
SOP_MD_HEADING_RE = re.compile(r"^\s*##\s+(\S.*)$")


@dataclass
class SOPChunk:
    chunk_id: str
    sop_file: str
    index: int
    heading: str
    page_start: int
    text: str
    text_hash: str

    def to_dict(self):
        return asdict(self)


def _split_long(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    out, cur = [], ""
    for sent in split_sentences(text):
        if cur and len(cur) + len(sent) + 1 > max_chars:
            out.append(cur)
            cur = sent
        else:
            cur = f"{cur} {sent}".strip()
    if cur:
        out.append(cur)
    return out


def chunk_sop(doc: Document, min_chunk_chars=80, max_chunk_chars=2500, heading_max_chars=90,
              skip_sections: list[str] | None = None, skip_preamble: bool = True,
              split_steps: bool = True) -> tuple[list[SOPChunk], list[str]]:
    """One chunk per numbered procedure step (5-1-1, 5.1.1 ...) when split_steps is on,
    otherwise one chunk per (sub)section. The heading path is kept as context."""
    skip_sections = [s.lower() for s in (skip_sections or [])]
    stem = Path(doc.path).stem
    notes: list[str] = []

    # ---- 1) walk the lines and cut them into blocks (section intro or numbered step)
    blocks: list[dict] = []
    stack: list[tuple[list[int], str]] = []    # (number parts, label)
    top_sep = None                             # separator style of top-level headings, e.g. "-" in "5- Procedures:"
    last_top = 0
    current = {"heading": "(start of document)", "page": 1, "lines": [], "preamble": True}

    def heading_path():
        return " > ".join(lbl for _, lbl in stack) or "(start of document)"

    def new_block(heading, page, first_line=None, preamble=False):
        nonlocal current
        blocks.append(current)
        current = {"heading": heading, "page": page, "lines": [first_line] if first_line else [], "preamble": preamble}

    for page, raw in doc.lines_with_pages():
        line = raw.strip()
        m = SOP_NUM_RE.match(line)
        if m:
            md, num, sep, title = m.group(1), m.group(2), m.group(3), m.group(4).strip()
            parts = [int(x) for x in re.split(r"[.\-]", num)]
            depth = len(parts)
            parent = stack[-1][0] if stack else []
            short = (len(line) <= heading_max_chars and not title.endswith((".", ";", ","))
                     and title[:1].isalpha() and title[:1].isupper())
            if depth == 1:
                in_sequence = (last_top == 0 or last_top < parts[0] <= last_top + 2) and \
                              (top_sep is None or sep == top_sep)
            else:
                in_sequence = len(parent) >= depth - 1 and parent[:depth - 1] == parts[:depth - 1]
            if (short or md) and in_sequence:                       # ---- heading
                label = f"{num} {title.rstrip(':').strip()}"
                while stack and len(stack[-1][0]) >= depth:
                    stack.pop()
                stack.append((parts, label))
                if depth == 1:
                    last_top, top_sep = parts[0], (sep if top_sep is None else top_sep)
                new_block(heading_path(), page)
                continue
            if split_steps and depth >= 2 and in_sequence:          # ---- numbered step
                new_block(f"{heading_path()} > {num}", page, first_line=line)
                continue
        elif SOP_MD_HEADING_RE.match(line):                          # Word heading style, unnumbered
            title = SOP_MD_HEADING_RE.match(line).group(1).rstrip(":").strip()
            last_top += 1
            stack[:] = [([last_top], title)]
            new_block(heading_path(), page)
            continue
        current["lines"].append(line)
    blocks.append(current)

    if all(b["preamble"] for b in blocks):
        notes.append("No section headings detected; using fixed-size sentence windows instead.")
        skip_preamble = False

    # ---- 2) blocks -> chunks
    chunks: list[SOPChunk] = []
    carry, carry_heading = "", None
    for b in blocks:
        body = " ".join(b["lines"]).strip()
        if not body:
            continue
        if b["preamble"] and skip_preamble:
            notes.append(f"Skipped text before the first heading ({len(body)} chars: title page, approvals, contents)")
            continue
        if any(k in b["heading"].lower() for k in skip_sections):
            notes.append(f"Skipped section (skip list): {b['heading']}")
            continue
        if carry:
            body = f"{carry} {body}"
            heading = b["heading"] if carry_heading == b["heading"] else f"{carry_heading} + {b['heading']}"
            carry, carry_heading = "", None
        else:
            heading = b["heading"]
        if len(body) < min_chunk_chars:
            carry, carry_heading = body, heading
            continue
        for piece in _split_long(body, max_chunk_chars):
            idx = len(chunks) + 1
            chunks.append(SOPChunk(
                chunk_id=f"{stem}::{idx:03d}", sop_file=Path(doc.path).name, index=idx,
                heading=heading, page_start=b["page"], text=piece, text_hash=short_hash(piece)))
    if carry:
        if chunks:
            last = chunks[-1]
            last.text = f"{last.text} {carry}"
            last.text_hash = short_hash(last.text)
        else:
            chunks.append(SOPChunk(f"{stem}::001", Path(doc.path).name, 1, carry_heading or "", 1,
                                   carry, short_hash(carry)))
    return chunks, notes
