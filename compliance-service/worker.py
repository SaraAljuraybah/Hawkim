#!/usr/bin/env python3
"""Hawkim compliance worker: finishes the compliance checks started on the website.

How it works (see supabase/migrations/20261031120000_compliance_service.sql):
  1. Every 30 s it tells the database it is online (service_heartbeat). While it is online,
     the website's "Compliance Check" button starts checks with engine 'hawkim' instead of 'sample'.
  2. It claims the oldest running 'hawkim' check (claim_compliance_check), downloads the SOP
     version from the sop-files bucket, and runs the pipeline on it.
  3. It writes one finding per GVP requirement and completes the check
     (complete_compliance_check), or marks it failed with the reason (fail_compliance_check).

Run:  python worker.py            (stop with Ctrl+C)
Needs .env (see .env.example) with SUPABASE_URL, SUPABASE_SECRET_KEY and, for OpenRouter,
OPENROUTER_API_KEY. The secret key gives full database access: keep it on this machine only.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from hawkim.aggregate import findings_for_database  # noqa: E402
from hawkim.service import ComplianceService  # noqa: E402

BUCKET = "sop-files"


def load_env(path: Path):
    """Minimal .env reader (KEY=value lines); real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class Supabase:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):            # legacy service_role JWT
            self.headers["Authorization"] = f"Bearer {key}"

    def rpc(self, name: str, params: dict):
        r = requests.post(f"{self.url}/rest/v1/rpc/{name}", json=params, headers=self.headers, timeout=60)
        if r.status_code >= 300:
            raise RuntimeError(f"{name} failed: HTTP {r.status_code} {r.text[:400]}")
        return r.json() if r.text else None

    def download(self, storage_path: str, dest: Path):
        r = requests.get(f"{self.url}/storage/v1/object/{BUCKET}/{storage_path}", headers=self.headers, timeout=120)
        if r.status_code >= 300:
            raise RuntimeError(f"Could not download the SOP file: HTTP {r.status_code} {r.text[:200]}")
        dest.write_bytes(r.content)


def process(job: dict, svc: ComplianceService, sb: Supabase, scfg: dict):
    check_id = job["check_id"]
    print(f"[worker] check {check_id}: {job['file_name']} (SOP version {job['sop_version']})")
    if str(job.get("guideline_version")) != str(scfg.get("guideline_version")):
        raise RuntimeError(f"The service's GVP index is for version {scfg.get('guideline_version')}, "
                           f"but the check uses version {job.get('guideline_version')}")
    folder = Path(tempfile.mkdtemp(prefix="hawkim_check_"))
    try:
        # Keep the original file name: chunk IDs are built from it.
        path = folder / Path(job["file_name"]).name
        sb.download(job["storage_path"], path)
        t0 = time.time()
        result = svc.check(path)
        findings, stats = findings_for_database(result)
        if not findings:
            raise RuntimeError("No procedure step could be assessed in this SOP"
                               + (f" ({'; '.join(result.get('warnings') or [])})" if result.get("warnings") else ""))
        metadata = {
            "seconds": round(time.time() - t0, 1), **stats,
            "llm": result["engine"]["llm"], "embedding": result["engine"]["embedding"],
            "scope_mode": result["engine"]["scope_mode"], "gvp_index": result["engine"]["gvp_index"],
            "suggested_scope": (result.get("scope") or {}).get("scope_modules"),
            "scope_flags": result.get("scope_flags"), "warnings": result.get("warnings"),
            # Audit copy: everything the pipeline produced for every step (retrieved requirement and
            # other candidates, the model's raw answer, validation, flags). The website does not read it.
            "raw_results": [{k: f.get(k) for k in (
                "chunk_id", "chunk_type", "heading", "page", "text", "label", "valid", "decided_by", "requirement",
                "similarity", "other_candidates", "sop_evidence", "sop_evidence_found_in_text",
                "missing_or_conflicting_elements", "recommended_action", "justification", "flags",
                "review_required", "error", "raw_output")} for f in result.get("findings", [])],
        }
        sb.rpc("complete_compliance_check", {"p_check_id": check_id, "p_findings": findings,
                                             "p_engine_version": scfg.get("engine_version"), "p_metadata": metadata})
        print(f"[worker] check {check_id}: completed, {stats['requirements']} requirements "
              f"{stats['results']} in {metadata['seconds']} s")
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description="Hawkim compliance worker")
    ap.add_argument("--config", default=str(HERE / "config.yaml"))
    ap.add_argument("--once", action="store_true", help="process at most one check, then exit")
    args = ap.parse_args()

    load_env(HERE / ".env")
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SECRET_KEY in compliance-service/.env (see .env.example)")

    svc = ComplianceService(args.config)
    scfg = svc.cfg.get("service", {})
    engine, version = scfg.get("engine_name", "hawkim"), scfg.get("engine_version")
    poll, beat = float(scfg.get("poll_seconds", 5)), float(scfg.get("heartbeat_seconds", 30))
    sb = Supabase(url, key)
    print(f"[worker] online as '{engine}' ({version}); waiting for checks. Ctrl+C to stop.")

    def heartbeat():   # in its own thread, so it continues while a long check runs
        while True:
            try:
                sb.rpc("service_heartbeat", {"p_engine": engine, "p_engine_version": version})
            except Exception as e:
                print(f"[worker] heartbeat failed: {e}")
            time.sleep(beat)
    sb.rpc("service_heartbeat", {"p_engine": engine, "p_engine_version": version})   # fail fast on bad keys
    threading.Thread(target=heartbeat, daemon=True).start()

    while True:
        try:
            rows = sb.rpc("claim_compliance_check", {"p_engine": engine}) or []
            if rows:
                job = rows[0]
                try:
                    process(job, svc, sb, scfg)
                except Exception as e:  # the check fails, the worker keeps running
                    traceback.print_exc()
                    try:
                        sb.rpc("fail_compliance_check", {"p_check_id": job["check_id"], "p_message": str(e)[:1000]})
                    except Exception:
                        traceback.print_exc()
                if args.once:
                    return
                continue
            if args.once:
                return
        except KeyboardInterrupt:
            raise
        except Exception:
            traceback.print_exc()
        time.sleep(poll)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[worker] stopped")
