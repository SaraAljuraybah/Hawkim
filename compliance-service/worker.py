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
import json
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
        self.download_object(BUCKET, storage_path, dest, what="the SOP file")

    def download_object(self, bucket: str, path: str, dest: Path, what: str = "a file", optional: bool = False) -> bool:
        r = requests.get(f"{self.url}/storage/v1/object/{bucket}/{path}", headers=self.headers, timeout=300)
        if optional and r.status_code in (400, 404):
            return False
        if r.status_code >= 300:
            raise RuntimeError(f"Could not download {what}: HTTP {r.status_code} {r.text[:200]}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(r.content)
        return True

    def upload_object(self, bucket: str, path: str, data: bytes, content_type: str = "application/octet-stream",
                      attempts: int = 3):
        """Uploads with up to `attempts` tries (a slow connection can time out) and a long time limit."""
        headers = {**self.headers, "Content-Type": content_type, "x-upsert": "true"}
        for attempt in range(1, attempts + 1):
            try:
                r = requests.post(f"{self.url}/storage/v1/object/{bucket}/{path}", data=data, headers=headers,
                                  timeout=(30, 900))
            except requests.RequestException:
                if attempt == attempts:
                    raise
                print(f"[worker] upload of {path} failed (try {attempt} of {attempts}); trying again")
                time.sleep(10 * attempt)
                continue
            if r.status_code >= 300:
                raise RuntimeError(f"Could not upload {path}: HTTP {r.status_code} {r.text[:200]}")
            return


# GVP versions added on the website: their PDFs and their indexes.
GUIDELINE_FILES_BUCKET = "guideline-files"
GUIDELINE_INDEX_BUCKET = "guideline-indexes"
INDEX_CACHE = HERE / "index"      # a version's index is kept in index/versions/<id>/ after the first use


def local_index(sb: "Supabase", index_path: str) -> Path:
    """The folder of a GVP version's index, downloaded from storage the first time it is needed."""
    folder = INDEX_CACHE / index_path
    if not (folder / "meta.json").exists():
        print(f"[worker] downloading the GVP index {index_path}")
        tmp = folder.with_name(folder.name + ".part")
        shutil.rmtree(tmp, ignore_errors=True)
        for name in ("units.jsonl", "meta.json"):
            sb.download_object(GUIDELINE_INDEX_BUCKET, f"{index_path}/{name}", tmp / name, what=f"the GVP index ({name})")
        for name in ("embeddings.npy", "tfidf.pkl"):   # one of them, depending on the embedding backend
            sb.download_object(GUIDELINE_INDEX_BUCKET, f"{index_path}/{name}", tmp / name, optional=True)
        shutil.rmtree(folder, ignore_errors=True)
        tmp.rename(folder)
    return folder


class GuidelineProcessingError(RuntimeError):
    """A failure the admin can act on; its text is shown on the version's page."""


MEMORY_MESSAGE = ("The computer running the compliance service ran out of memory. Close other programs on it "
                  "(for example Ollama or a browser with many tabs) and try again.")
UPLOAD_MESSAGE = ("The requirements were prepared, but saving them to Hawkim timed out (slow connection). "
                  "Try again: they won't be prepared again, only saved.")


def process_guideline(job: dict, svc: ComplianceService, sb: "Supabase"):
    """Builds the index of a GVP version an admin added, uploads it and completes the version (which
    makes it current). The index is kept in index/versions/<id>/ before uploading, so a retry after a
    failed upload only uploads it again."""
    from hawkim.guidelines import build_index
    draft_id = job["id"]
    index_path = f"versions/{draft_id}"
    local = INDEX_CACHE / index_path
    print(f"[worker] GVP {job['version']}: processing {job['file_name']}")
    last = [0.0]

    def progress(stage: str, done: int, total: int):
        # At most every 3 seconds (and always at the end of a stage); a failed report is only logged.
        now = time.time()
        if stage == "embedding" and done < total and now - last[0] < 3:
            return
        last[0] = now
        try:
            sb.rpc("report_guideline_progress", {"p_id": draft_id, "p_stage": stage, "p_done": done, "p_total": total})
        except Exception as e:
            print(f"[worker] progress report failed: {e}")

    t0 = time.time()
    report_file = local / "report.json"
    if (local / "meta.json").exists() and report_file.exists():
        # Prepared before (the upload failed then): don't embed again.
        print(f"[worker] GVP {job['version']}: reusing the requirements prepared earlier")
        report = json.loads(report_file.read_text(encoding="utf-8"))
    else:
        work = Path(tempfile.mkdtemp(prefix="hawkim_gvp_"))
        try:
            pdf = work / Path(job["file_name"]).name
            sb.download_object(GUIDELINE_FILES_BUCKET, job["storage_path"], pdf, what="the guideline PDF")
            built = work / "index"
            try:
                _, _, report = build_index(svc.cfg, pdf, built, svc.embedder, log=print, progress=progress)
            except MemoryError as e:
                raise GuidelineProcessingError(MEMORY_MESSAGE) from e
            except RuntimeError as e:
                if "not enough memory" in str(e).lower() or "out of memory" in str(e).lower():
                    raise GuidelineProcessingError(MEMORY_MESSAGE) from e
                raise
            shutil.rmtree(local, ignore_errors=True)
            local.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(built, local)
            report_file.write_text(json.dumps(report), encoding="utf-8")
        finally:
            shutil.rmtree(work, ignore_errors=True)

    progress("saving", 0, 0)
    try:
        for f in sorted(local.iterdir()):
            if f.is_file() and f.name != "report.json":
                sb.upload_object(GUIDELINE_INDEX_BUCKET, f"{index_path}/{f.name}", f.read_bytes())
    except requests.RequestException as e:
        raise GuidelineProcessingError(UPLOAD_MESSAGE) from e
    report["seconds"] = round(time.time() - t0, 1)
    sb.rpc("complete_guideline_processing", {"p_id": draft_id, "p_index_path": index_path, "p_report": report})
    print(f"[worker] GVP {job['version']}: done and current, {report['requirements']} requirements "
          f"in {report['sections']} sections ({report['seconds']} s)")


def process(job: dict, svc: ComplianceService, sb: Supabase, scfg: dict):
    check_id = job["check_id"]
    print(f"[worker] check {check_id}: {job['file_name']} (SOP version {job['sop_version']})")
    # The check's GVP version: its own index (added on the website), or the local index (e.g. GVP 4.0).
    if job.get("guideline_index_path"):
        engine = svc.engine_for(local_index(sb, job["guideline_index_path"]))
    elif str(job.get("guideline_version")) == str(scfg.get("guideline_version")):
        engine = None
    else:
        raise RuntimeError(f"GVP {job.get('guideline_version')} has no processed index; the service's local index "
                           f"is for version {scfg.get('guideline_version')}")
    folder = Path(tempfile.mkdtemp(prefix="hawkim_check_"))
    try:
        # Keep the original file name: chunk IDs are built from it.
        path = folder / Path(job["file_name"]).name
        sb.download(job["storage_path"], path)
        t0 = time.time()
        result = svc.check(path, engine=engine)
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
            # No check waiting: process a GVP version an admin added, if one is waiting.
            drafts = sb.rpc("claim_guideline_processing", {}) or []
            if drafts:
                draft = drafts[0]
                try:
                    process_guideline(draft, svc, sb)
                except Exception as e:  # the version is marked failed, the worker keeps running
                    traceback.print_exc()
                    try:
                        sb.rpc("fail_guideline_processing", {"p_id": draft["id"], "p_error": str(e)[:500]})
                    except Exception:
                        traceback.print_exc()
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
