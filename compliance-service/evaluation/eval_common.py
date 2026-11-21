"""Shared helpers for the Hawkim evaluation harness (run_eval.py, make_labels.py, metrics.py).

Nothing here changes the pipeline: it only locates files, reads the database (GET requests only),
guards memory and measures time.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
SERVICE_DIR = EVAL_DIR.parent
DATA_DIR = EVAL_DIR / "data"
RESULTS_DIR = EVAL_DIR / "results"
LABELS_DIR = EVAL_DIR / "labels"

if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

SOP_ID_RE = re.compile(r"(SOP-PV-\d{3})", re.I)
STEP_TOKEN_RE = re.compile(r"^\d+(?:[.\-]\d+)+$")
FORMATS = ("docx", "pdf")
VERDICTS = ("COMPLIANT", "PARTIAL", "CONFLICT")
RHR = "Requires Human Review"
GOLD_LABELS = ("COMPLIANT", "PARTIAL", "CONFLICT", "NOT_ADDRESSED")
# Gap detection: the expert's label says the step does not fully meet its requirement.
GAP_LABELS = {"PARTIAL", "CONFLICT", "NOT_ADDRESSED"}

# Manual counts per SOP (Procedures section), given by the team. The checked unit is what the pipeline
# assesses and the expert reviewed: sub-section introductions + numbered steps. Numbered steps alone are
# reported as a second row.
MANUAL_UNIT_COUNTS = {"SOP-PV-001": 16, "SOP-PV-002": 16, "SOP-PV-004": 16, "SOP-PV-010": 20}
MANUAL_STEP_COUNTS = {"SOP-PV-001": 12, "SOP-PV-002": 12, "SOP-PV-004": 12, "SOP-PV-010": 15}


# ------------------------------------------------------------------ files

def sop_id_of(name: str) -> str | None:
    m = SOP_ID_RE.search(name)
    return m.group(1).upper() if m else None


def test_files(only: list[str] | None = None) -> list[dict]:
    """The test cases in data/: one per file, linked by SOP id. `only`: SOP ids, formats or file names."""
    cases = []
    for p in sorted(DATA_DIR.iterdir()) if DATA_DIR.exists() else []:
        fmt = p.suffix.lower().lstrip(".")
        sid = sop_id_of(p.name)
        if fmt not in FORMATS or not sid or p.name.startswith("~$"):
            continue
        if only and not any(o.upper() in (sid, fmt.upper(), p.name.upper(), p.stem.upper()) for o in only):
            continue
        cases.append({"sop_id": sid, "format": fmt, "path": p})
    return cases


def step_number(heading: str) -> str | None:
    """The numbered step of a chunk heading ("5. Procedure > 5.1 ... > 5.1.3 ..." -> "5.1.3")."""
    last = (heading or "").split(" > ")[-1].split(" ")[0].strip().rstrip(".")
    return last.replace("-", ".") if STEP_TOKEN_RE.match(last) else None


def norm_text(s: str) -> str:
    return " ".join((s or "").split())


def latest_results_dir() -> Path:
    runs = sorted((d for d in RESULTS_DIR.iterdir() if d.is_dir() and (d / "run_meta.json").exists()),
                  key=lambda d: d.name) if RESULTS_DIR.exists() else []
    if not runs:
        raise SystemExit(f"No results in {RESULTS_DIR}; run run_eval.py first")
    return runs[-1]


def load_results(results_dir: Path) -> list[dict]:
    out = []
    for f in sorted(results_dir.glob("SOP-*_run*.json")):
        out.append(json.loads(f.read_text(encoding="utf-8")))
    return out


# ------------------------------------------------------------------ environment

def load_env(path: Path = SERVICE_DIR / ".env"):
    """KEY=value lines; real environment variables win. Values are never printed."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def git_info() -> dict:
    def run(*args):
        try:
            return subprocess.run(["git", *args], cwd=SERVICE_DIR, capture_output=True, text=True,
                                  timeout=20).stdout.strip()
        except Exception:
            return ""
    status = run("status", "--porcelain", "--", ".")
    return {"commit": run("rev-parse", "HEAD"), "branch": run("rev-parse", "--abbrev-ref", "HEAD"),
            "uncommitted_changes_in_compliance_service": bool(status)}


# ------------------------------------------------------------------ database (read-only)

class ReadOnlyDB:
    """GET requests to the Supabase REST API only. There is deliberately no write method."""

    def __init__(self):
        load_env()
        url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SECRET_KEY")
        if not url or not key:
            raise SystemExit("SUPABASE_URL / SUPABASE_SECRET_KEY are missing in compliance-service/.env")
        self.url = url.rstrip("/")
        self.headers = {"apikey": key}
        if key.startswith("eyJ"):
            self.headers["Authorization"] = f"Bearer {key}"

    def select(self, table: str, query: str) -> list:
        import requests
        r = requests.get(f"{self.url}/rest/v1/{table}?{query}", headers=self.headers, timeout=60)
        if r.status_code >= 300:
            raise RuntimeError(f"Reading {table} failed: HTTP {r.status_code} {r.text[:300]}")
        return r.json()


# ------------------------------------------------------------------ memory

def free_ram_gb() -> float:
    import psutil
    return psutil.virtual_memory().available / 2 ** 30


def worker_running() -> list[int]:
    """PIDs of a running worker.py (it would load a second copy of the models)."""
    import psutil
    pids = []
    for p in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            cmd = " ".join(p.info["cmdline"] or [])
        except Exception:
            continue
        if "python" in (p.info["name"] or "").lower() and re.search(r"worker\.py\b", cmd):
            pids.append(p.info["pid"])
    return pids


def ram_guard(min_gb: float, where: str):
    free = free_ram_gb()
    if free < min_gb:
        raise SystemExit(f"[eval] stopped {where}: only {free:.1f} GB of RAM is free (minimum {min_gb} GB). "
                         f"Close other programs and try again.")
    return free


class MemorySampler:
    """Samples memory in a background thread: peak RSS of this process and of Ollama, lowest free RAM."""

    def __init__(self, interval: float = 0.25):
        self.interval = interval
        self._stop = threading.Event()
        self._thread = None
        self.reset()

    def reset(self):
        self.peak_self = 0
        self.peak_ollama = 0
        self.min_available = None

    @staticmethod
    def _ollama_processes():
        import psutil
        # Ollama runs the model in its own runner process: "llama-server" in current versions.
        names = ("ollama", "llama-server", "llama_server")
        return [p for p in psutil.process_iter(["name"]) if (p.info["name"] or "").lower().startswith(names)]

    def _sample(self):
        # Scanning every process is slow on Windows (seconds) and would distort the timings, so the Ollama
        # processes are looked up only every 15 s; between lookups only they and this process are measured.
        import psutil
        me = psutil.Process()
        ollama, found_at = self._ollama_processes(), time.monotonic()
        while not self._stop.is_set():
            try:
                if time.monotonic() - found_at > 15:
                    ollama, found_at = self._ollama_processes(), time.monotonic()
                self.peak_self = max(self.peak_self, me.memory_info().rss)
                total = 0
                for p in ollama:
                    try:
                        total += p.memory_info().rss
                    except psutil.Error:
                        pass
                self.peak_ollama = max(self.peak_ollama, total)
                avail = psutil.virtual_memory().available
                self.min_available = avail if self.min_available is None else min(self.min_available, avail)
            except Exception:
                pass
            self._stop.wait(self.interval)

    def start(self):
        self._stop.clear()
        self._thread = threading.Thread(target=self._sample, daemon=True)
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def snapshot(self) -> dict:
        gb = lambda b: round(b / 2 ** 30, 3) if b is not None else None
        return {"peak_rss_harness_gb": gb(self.peak_self), "peak_rss_ollama_gb": gb(self.peak_ollama),
                "min_system_available_gb": gb(self.min_available)}


# ------------------------------------------------------------------ timing

class StageTimer:
    """Collects durations of wrapped calls, per stage name, for the file being processed."""

    def __init__(self):
        self.calls: dict[str, list[float]] = {}

    def reset(self):
        self.calls = {}

    def wrap(self, stage: str, fn):
        def timed(*a, **kw):
            t0 = time.perf_counter()
            try:
                return fn(*a, **kw)
            finally:
                self.calls.setdefault(stage, []).append(time.perf_counter() - t0)
        timed.__wrapped__ = fn
        return timed

    def total(self, stage: str) -> float:
        return sum(self.calls.get(stage, []))


# ------------------------------------------------------------------ small table helpers

def md_table(rows: list[dict], cols: list[str] | None = None) -> str:
    if not rows:
        return "_(no data)_\n"
    cols = cols or list(rows[0].keys())

    def fmt(v):
        if v is None:
            return "–"
        if isinstance(v, float):
            return f"{v:.3f}".rstrip("0").rstrip(".")
        return str(v).replace("|", "\\|").replace("\n", " ")
    lines = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    lines += ["| " + " | ".join(fmt(r.get(c)) for c in cols) + " |" for r in rows]
    return "\n".join(lines) + "\n"
