"""GVP versions: build the requirement index of a guideline PDF (used by `run.py index` and by the
worker when an admin adds a GVP version on the website)."""
from __future__ import annotations

import datetime as dt
import hashlib
import time
from pathlib import Path

from .chunking import chunk_gvp
from .embeddings import Embedder, VectorIndex
from .extract import extract_document

# The files of an index folder (VectorIndex.save), uploaded to and downloaded from storage.
INDEX_FILES = ("units.jsonl", "embeddings.npy", "meta.json")


def _sha1(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def build_index(cfg: dict, gvp_path: str | Path, folder: str | Path, embedder: Embedder,
                log=print, progress=None) -> tuple[VectorIndex, list, dict]:
    """Extracts the guideline, splits it into requirement units, embeds them and saves the index in
    `folder`. Returns the index, the units and a report for the admin. Raises ValueError when no
    requirement could be found (e.g. a scanned PDF). `progress(stage, done, total)`: optional, called
    while reading ('reading') and embedding ('embedding', in batches)."""
    gvp_path, folder = Path(gvp_path), Path(folder)
    report_progress = progress or (lambda stage, done, total: None)
    report_progress("reading", 0, 0)
    ex = cfg["extraction"]
    doc = extract_document(gvp_path, ex["header_footer_min_page_ratio"], ex["min_chars_per_page_warning"])
    for w in doc.warnings:
        log(f"  [warn] {w}")
    gc = cfg["gvp_chunking"]
    units = chunk_gvp(doc, gc["obligation_keywords"], gc["obligation_only"], gc["max_unit_chars"])
    if not units:
        raise ValueError("No GVP requirements were found in this PDF. Is it a scanned document?")
    sections = {u.section for u in units}
    log(f"  {doc.n_pages} pages -> {len(units)} requirement units in {len(sections)} sections")
    t0 = time.time()
    def on_batches(done: int, total: int):
        log(f"  embedding {done}/{total} batches")
        report_progress("embedding", done, total)
    vectors = embedder.fit_encode_documents([u.embed_text() for u in units],
                                            on_progress=on_batches if embedder.backend != "tfidf" else None)
    meta = {"backend": embedder.backend, "model": embedder.model_name, "gvp_file": str(gvp_path),
            "gvp_sha1": _sha1(gvp_path), "n_units": len(units), "n_sections": len(sections),
            "gvp_chunking": gc, "created": dt.datetime.now().isoformat(timespec="seconds"),
            "embedding_seconds": round(time.time() - t0, 1)}
    index = VectorIndex([u.to_dict() for u in units], vectors, embedder, meta)
    index.save(folder)

    # Section codes the configuration excludes (SFDA duties) that this guideline no longer has:
    # a warning for the admin, since the exclusion would no longer apply.
    excluded = [s.strip() for s in ((cfg.get("scope") or {}).get("exclude_sections") or [])]
    missing = [e for e in excluded if not any(s == e or s.startswith(e + ".") for s in sections)]
    report = {"requirements": len(units), "sections": len(sections), "pages": doc.n_pages,
              "warnings": list(doc.warnings), "missing_excluded_sections": missing,
              "embedding_seconds": meta["embedding_seconds"], "model": embedder.model_name or embedder.backend}
    return index, units, report
