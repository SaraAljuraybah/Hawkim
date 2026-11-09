"""Embedding backends and a simple in-memory vector index.

Backends
- sentence-transformers: BAAI/bge-m3 (dense), Qwen/Qwen3-Embedding-0.6B, or any ST model
- tfidf: lexical baseline with scikit-learn (no model download)
"""
from __future__ import annotations

import json
import pickle
import re
from pathlib import Path

import numpy as np


def model_slug(backend: str, model: str | None) -> str:
    name = model if backend != "tfidf" else "tfidf"
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name or backend)


class Embedder:
    def __init__(self, cfg: dict):
        self.backend = cfg["backend"]
        self.model_name = cfg.get("model")
        self.batch_size = int(cfg.get("batch_size", 16))
        self.query_prompt = cfg.get("query_prompt")
        self._model = None
        self._vectorizer = None
        if self.backend == "sentence-transformers":
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError as e:
                raise SystemExit("sentence-transformers is not installed: pip install sentence-transformers") from e
            print(f"  loading embedding model {self.model_name} (first time downloads it) ...")
            self._model = SentenceTransformer(self.model_name, device=cfg.get("device"))
            if cfg.get("max_seq_length"):
                self._model.max_seq_length = int(cfg["max_seq_length"])
        elif self.backend != "tfidf":
            raise ValueError(f"Unknown embedding backend: {self.backend}")

    # -- documents (GVP units)
    def fit_encode_documents(self, texts: list[str]):
        if self.backend == "tfidf":
            from sklearn.feature_extraction.text import TfidfVectorizer
            self._vectorizer = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=1,
                                               stop_words="english")
            return self._vectorizer.fit_transform(texts)  # sparse, L2-normalised
        return self._model.encode(texts, batch_size=self.batch_size, normalize_embeddings=True,
                                  show_progress_bar=True, convert_to_numpy=True)

    # -- queries (SOP chunks)
    def encode_queries(self, texts: list[str]):
        if self.backend == "tfidf":
            return self._vectorizer.transform(texts)
        kwargs = {"prompt": self.query_prompt} if self.query_prompt else {}
        return self._model.encode(texts, batch_size=self.batch_size, normalize_embeddings=True,
                                  show_progress_bar=len(texts) > 32, convert_to_numpy=True, **kwargs)


class VectorIndex:
    """Holds GVP units and their vectors; cosine similarity search."""

    def __init__(self, units: list[dict], vectors, embedder: Embedder, meta: dict):
        self.units = units
        self.vectors = vectors
        self.embedder = embedder
        self.meta = meta
        self.by_id = {u["id"]: u for u in units}

    def encode(self, query_texts: list[str]):
        return self.embedder.encode_queries(query_texts)

    def search(self, query_texts: list[str], k: int, allowed=None, encoded=None) -> list[list[tuple[int, float]]]:
        """Top-k units per query. `allowed` is an optional boolean array over units (scope restriction);
        `encoded` lets callers reuse query vectors for several searches."""
        q = encoded if encoded is not None else self.embedder.encode_queries(query_texts)
        if self.embedder.backend == "tfidf":
            sims = (q @ self.vectors.T).toarray()
        else:
            sims = np.asarray(q) @ np.asarray(self.vectors).T
        if allowed is not None:
            sims = np.where(np.asarray(allowed)[None, :], sims, -np.inf)
            k = min(k, int(np.asarray(allowed).sum()))
        results = []
        for row in sims:
            k_eff = min(k, len(row))
            if k_eff <= 0:
                results.append([])
                continue
            top = np.argpartition(-row, k_eff - 1)[:k_eff]
            top = top[np.argsort(-row[top])]
            results.append([(int(i), float(row[i])) for i in top])
        return results

    # -- persistence
    def save(self, folder: Path):
        folder.mkdir(parents=True, exist_ok=True)
        with open(folder / "units.jsonl", "w", encoding="utf-8") as f:
            for u in self.units:
                f.write(json.dumps(u, ensure_ascii=False) + "\n")
        if self.embedder.backend == "tfidf":
            with open(folder / "tfidf.pkl", "wb") as f:
                pickle.dump({"vectorizer": self.embedder._vectorizer, "matrix": self.vectors}, f)
        else:
            np.save(folder / "embeddings.npy", np.asarray(self.vectors, dtype=np.float32))
        (folder / "meta.json").write_text(json.dumps(self.meta, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, folder: Path, embed_cfg: dict, embedder: "Embedder | None" = None) -> "VectorIndex":
        """Loads an index. `embedder`: an already-loaded model to reuse (one BGE-M3 for every GVP version)."""
        if not (folder / "meta.json").exists():
            raise SystemExit(f"No index found in {folder}. Run: python run.py index")
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        if meta["backend"] != embed_cfg["backend"] or (
                embed_cfg["backend"] != "tfidf" and meta["model"] != embed_cfg.get("model")):
            raise SystemExit(f"Index in {folder} was built with {meta['backend']}/{meta['model']}, "
                             f"config asks for {embed_cfg['backend']}/{embed_cfg.get('model')}. Re-run index.")
        units = [json.loads(l) for l in open(folder / "units.jsonl", encoding="utf-8")]
        reuse = (embedder is not None and embed_cfg["backend"] != "tfidf"
                 and embedder.backend == embed_cfg["backend"] and embedder.model_name == embed_cfg.get("model"))
        embedder = embedder if reuse else Embedder(embed_cfg)
        if embedder.backend == "tfidf":
            with open(folder / "tfidf.pkl", "rb") as f:
                obj = pickle.load(f)
            embedder._vectorizer = obj["vectorizer"]
            vectors = obj["matrix"]
        else:
            vectors = np.load(folder / "embeddings.npy")
        return cls(units, vectors, embedder, meta)
