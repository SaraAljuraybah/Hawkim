"""LLM client for any OpenAI-compatible chat endpoint.

OpenRouter, Ollama (>=0.1.24), vLLM and LM Studio all expose
POST {base_url}/chat/completions, so one client covers them all.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import time
from pathlib import Path

import requests

DEFAULT_BASE_URLS = {
    "openrouter": "https://openrouter.ai/api/v1",
    "ollama": "http://localhost:11434/v1",
    "vllm": "http://localhost:8000/v1",
}


class LLMClient:
    def __init__(self, cfg: dict, cache_dir: Path):
        self.cfg = cfg
        self.provider = cfg["provider"]
        self.model = cfg["model"]
        self.base_url = (cfg.get("base_url") or DEFAULT_BASE_URLS.get(self.provider, "")).rstrip("/")
        if self.provider not in ("mock",) and not self.base_url:
            raise SystemExit(f"llm.base_url is required for provider '{self.provider}'")
        self.api_key = os.environ.get(cfg.get("api_key_env") or "", "")
        if self.provider == "openrouter" and not self.api_key:
            raise SystemExit(f"Set your OpenRouter key first, e.g.  export {cfg.get('api_key_env')}=sk-or-...")
        self.temperature = cfg.get("temperature", 0)
        self.max_tokens = int(cfg.get("max_tokens", 800))
        self.timeout = int(cfg.get("timeout_sec", 180))
        self.max_retries = int(cfg.get("max_retries", 4))
        self.delay = float(cfg.get("request_delay_sec", 0))
        self.json_mode = bool(cfg.get("json_mode", False))

        self.use_cache = bool(cfg.get("cache", True))
        self.cache_path = cache_dir / (re.sub(r"[^A-Za-z0-9._-]+", "_", f"{self.provider}_{self.model}") + ".jsonl")
        self.cache: dict[str, dict] = {}
        if self.use_cache and self.cache_path.exists():
            for line in open(self.cache_path, encoding="utf-8"):
                try:
                    rec = json.loads(line)
                    self.cache[rec["key"]] = rec
                except Exception:
                    pass

    def _key(self, system: str, user: str) -> str:
        raw = json.dumps([self.provider, self.model, self.temperature, self.max_tokens, self.json_mode, system, user])
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def chat(self, system: str, user: str) -> dict:
        """Returns {'text', 'latency_sec', 'usage', 'cached', 'error'}."""
        key = self._key(system, user)
        if self.use_cache and key in self.cache:
            rec = self.cache[key]
            return {"text": rec["text"], "latency_sec": rec.get("latency_sec"), "usage": rec.get("usage"),
                    "cached": True, "error": None}

        if self.provider == "mock":
            out = {"text": _mock_answer(user), "latency_sec": 0.0, "usage": None, "cached": False, "error": None}
        else:
            out = self._call(system, user)

        if self.use_cache and out["error"] is None:
            rec = {"key": key, "text": out["text"], "latency_sec": out["latency_sec"], "usage": out["usage"]}
            self.cache[key] = rec
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.cache_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        if self.delay and not out["cached"]:
            time.sleep(self.delay)
        return out

    def _call(self, system: str, user: str) -> dict:
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        if self.json_mode:
            payload["response_format"] = {"type": "json_object"}
        if self.provider == "openrouter" and self.cfg.get("openrouter_provider"):
            # OpenRouter provider routing, e.g. {"ignore": ["Phala"], "allow_fallbacks": true}
            payload["provider"] = self.cfg["openrouter_provider"]
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.provider == "openrouter":
            headers["X-Title"] = "Hawkim evaluation"

        last_err = None
        for attempt in range(self.max_retries + 1):
            t0 = time.time()
            try:
                r = requests.post(f"{self.base_url}/chat/completions", json=payload, headers=headers,
                                  timeout=self.timeout)
                latency = time.time() - t0
                if r.status_code == 200:
                    data = r.json()
                    if "choices" not in data:
                        err = data.get("error") if isinstance(data, dict) else None
                        last_err = (f"provider error {err.get('code')}: {err.get('message')}"
                                    if isinstance(err, dict) else f"bad response: {str(data)[:300]}")
                    else:
                        text = data["choices"][0]["message"].get("content") or ""
                        return {"text": text, "latency_sec": round(latency, 2), "usage": data.get("usage"),
                                "cached": False, "error": None}
                elif r.status_code in (408, 409, 425, 429, 500, 502, 503, 504):
                    last_err = f"HTTP {r.status_code}: {r.text[:300]}"
                else:  # not retryable (bad key, bad model name, ...)
                    return {"text": "", "latency_sec": round(latency, 2), "usage": None, "cached": False,
                            "error": f"HTTP {r.status_code}: {r.text[:500]}"}
            except requests.RequestException as e:
                last_err = f"{type(e).__name__}: {e}"
            if attempt < self.max_retries:
                wait = min(60, 2 ** attempt + random.random())
                print(f"    retry {attempt + 1}/{self.max_retries} in {wait:.0f}s ({last_err[:80]})")
                time.sleep(wait)
        return {"text": "", "latency_sec": None, "usage": None, "cached": False, "error": last_err}


def _mock_answer(user: str) -> str:
    """Fake model for testing the plumbing only. NOT a real assessment."""
    sop = user.split("SOP PASSAGE", 1)[-1]
    req = user.split("SOP PASSAGE", 1)[0]
    words = lambda t: {w for w in re.findall(r"[a-z]{4,}", t.lower())}
    s, q = words(sop), words(req)
    overlap = len(s & q) / max(1, len(q))
    label = "COMPLIANT" if overlap > 0.45 else "PARTIAL" if overlap > 0.25 else "NOT_ADDRESSED"
    ids = re.findall(r"ID: (\S+)", req)
    sop_text = sop.split("Text:", 1)[-1].strip()
    first_sent = re.split(r"(?<=[.!?])\s", sop_text)[0][:300]
    obj = {"label": label, "sop_evidence": first_sent if label != "NOT_ADDRESSED" else "",
           "requirement_evidence": "", "missing_or_conflicting_elements": "",
           "justification": f"MOCK model: word overlap {overlap:.2f}."}
    if "CANDIDATE GVP REQUIREMENTS" in user:
        obj["requirement_id"] = ids[0] if ids else "NONE"
    return json.dumps(obj)
