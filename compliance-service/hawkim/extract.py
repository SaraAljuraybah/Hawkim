"""Text extraction from PDF, DOCX and TXT files.

Output is a list of pages, each a list of cleaned text lines, plus warnings
about problems that affect the evaluation (scanned pages, Arabic text, etc.).
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

SUPPORTED = {".pdf", ".docx", ".txt"}

PAGE_NUMBER_RE = re.compile(r"^\s*(page\s*)?\d{1,4}(\s*(of|/)\s*\d{1,4})?\s*$", re.I)
ARABIC_RE = re.compile(r"[\u0600-\u06FF]")


@dataclass
class Document:
    path: str
    pages: list[list[str]]                 # pages -> lines
    warnings: list[str] = field(default_factory=list)
    removed_header_footer_lines: list[str] = field(default_factory=list)

    @property
    def n_pages(self) -> int:
        return len(self.pages)

    @property
    def n_chars(self) -> int:
        return sum(len(l) for p in self.pages for l in p)

    def lines_with_pages(self):
        for i, page in enumerate(self.pages, start=1):
            for line in page:
                yield i, line


def _pdf_pages(path: Path) -> list[str]:
    try:
        import pdfplumber
        with pdfplumber.open(str(path)) as pdf:
            return [(p.extract_text() or "") for p in pdf.pages]
    except Exception as e:  # fall back to pypdf
        from pypdf import PdfReader
        reader = PdfReader(str(path))
        print(f"  [warn] pdfplumber failed on {path.name} ({e}); using pypdf")
        return [(p.extract_text() or "") for p in reader.pages]


def _docx_pages(path: Path) -> list[str]:
    """Pages are approximated from Word's page breaks (manual breaks and the
    'last rendered page break' markers Word saves). Heading-style paragraphs get
    a '## ' prefix so the SOP chunker can recognise them."""
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    d = docx.Document(str(path))
    pages: list[list[str]] = [[]]

    def page_break_in(element) -> bool:
        xml = element.xml
        return "lastRenderedPageBreak" in xml or 'w:type="page"' in xml

    for child in d.element.body.iterchildren():
        tag = child.tag.split("}")[-1]
        if tag not in ("p", "tbl"):
            continue
        if page_break_in(child) and pages[-1]:
            pages.append([])
        if tag == "p":
            para = Paragraph(child, d)
            text = para.text.strip()
            if not text:
                continue
            style = (para.style.name or "").lower() if para.style is not None else ""
            pages[-1].append(("## " + text) if (style.startswith("heading") or style == "title") else text)
        else:
            for row in Table(child, d).rows:
                cells = []
                for c in row.cells:
                    t = " ".join(c.text.split())
                    if t and (not cells or cells[-1] != t):  # merged cells repeat text
                        cells.append(t)
                if cells:
                    pages[-1].append(" | ".join(cells))
    return ["\n".join(p) for p in pages]


def _txt_pages(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="replace").replace("\r", "")
    return text.split("\f")


def _norm_for_repeat(line: str) -> str:
    return re.sub(r"\d+", "#", line.strip().lower())


def _remove_headers_footers(pages: list[list[str]], min_ratio: float):
    """Remove lines that repeat at the top/bottom of many pages."""
    n = len(pages)
    if n < 3:
        return pages, []
    counter: Counter = Counter()
    for lines in pages:
        edge = lines[:3] + lines[-3:]
        for key in {_norm_for_repeat(l) for l in edge if l.strip()}:
            counter[key] += 1
    repeated = {k for k, c in counter.items() if c >= max(2, min_ratio * n)}
    cleaned, removed = [], set()
    for lines in pages:
        new = []
        for j, l in enumerate(lines):
            at_edge = j < 3 or j >= len(lines) - 3
            if at_edge and _norm_for_repeat(l) in repeated:
                removed.add(l.strip())
                continue
            new.append(l)
        cleaned.append(new)
    return cleaned, sorted(removed)


def extract_document(path: str | Path, header_footer_min_page_ratio: float = 0.3,
                     min_chars_per_page_warning: int = 50) -> Document:
    path = Path(path)
    ext = path.suffix.lower()
    if ext not in SUPPORTED:
        raise ValueError(f"Unsupported file type: {path.name} (supported: {sorted(SUPPORTED)})")

    if ext == ".pdf":
        raw_pages = _pdf_pages(path)
    elif ext == ".docx":
        raw_pages = _docx_pages(path)
    else:
        raw_pages = _txt_pages(path)

    pages = [[l.rstrip() for l in p.replace("\r", "").split("\n")] for p in raw_pages]
    warnings: list[str] = []

    # Scanned / empty pages
    if ext == ".pdf":
        empty = [i + 1 for i, p in enumerate(pages) if sum(len(l) for l in p) < min_chars_per_page_warning]
        if empty:
            share = len(empty) / max(1, len(pages))
            msg = f"{len(empty)} of {len(pages)} pages have almost no text (pages {empty[:10]}{'...' if len(empty) > 10 else ''})."
            if share > 0.5:
                msg += " The file is probably scanned: run OCR first, results will be unreliable."
            warnings.append(msg)

    pages, removed = _remove_headers_footers(pages, header_footer_min_page_ratio)
    # Files without page information (many DOCX/TXT files): remove long lines that repeat
    # 3+ times anywhere, e.g. a page header or copyright footer copied into the body.
    if len(pages) < 3:
        counts = Counter(_norm_for_repeat(l) for p in pages for l in p if len(l.strip()) >= 25)
        boiler = {k for k, c in counts.items() if c >= 3}
        if boiler:
            removed = sorted(set(removed) | {l.strip() for p in pages for l in p if _norm_for_repeat(l) in boiler})
            pages = [[l for l in p if _norm_for_repeat(l) not in boiler] for p in pages]
        if ext == ".docx" and len(pages) == 1:
            warnings.append("No page breaks found in this Word file, so page numbers are not available (page_start = 1).")
    # Remove bare page numbers and empty lines
    pages = [[l for l in p if l.strip() and not PAGE_NUMBER_RE.match(l)] for p in pages]

    all_text = " ".join(l for p in pages for l in p)
    if all_text:
        arabic_share = len(ARABIC_RE.findall(all_text)) / len(all_text)
        if arabic_share > 0.05:
            warnings.append(
                f"Arabic text detected ({arabic_share:.0%} of characters). PDF extraction often breaks "
                "Arabic letter order; check the extracted chunks manually before trusting results.")
    if not all_text.strip():
        warnings.append("No text extracted at all.")

    return Document(path=str(path), pages=pages, warnings=warnings, removed_header_footer_lines=removed)
