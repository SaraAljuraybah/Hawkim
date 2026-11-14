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
import hashlib
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

from hawkim.aggregate import findings_for_database, requirement_passage  # noqa: E402
from hawkim.organization_paths import guideline_index_path, require_in_organization  # noqa: E402
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

    def select(self, table: str, query: str) -> list:
        r = requests.get(f"{self.url}/rest/v1/{table}?{query}", headers=self.headers, timeout=60)
        if r.status_code >= 300:
            raise RuntimeError(f"Reading {table} failed: HTTP {r.status_code} {r.text[:400]}")
        return r.json()

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
                      attempts: int = 3, timeout: tuple = (30, 900)):
        """Uploads with up to `attempts` tries (a slow connection can time out)."""
        headers = {**self.headers, "Content-Type": content_type, "x-upsert": "true"}
        for attempt in range(1, attempts + 1):
            try:
                r = requests.post(f"{self.url}/storage/v1/object/{bucket}/{path}", data=data, headers=headers,
                                  timeout=timeout)
            except requests.RequestException:
                if attempt == attempts:
                    raise
                print(f"[worker] upload of {path} failed (try {attempt} of {attempts}); trying again")
                time.sleep(10 * attempt)
                continue
            if r.status_code >= 300:
                raise RuntimeError(f"Could not upload {path}: HTTP {r.status_code} {r.text[:200]}")
            return

    def remove_objects(self, bucket: str, paths: list[str]):
        """Deletes these objects (one that is already gone is no error)."""
        if not paths:
            return
        r = requests.delete(f"{self.url}/storage/v1/object/{bucket}", json={"prefixes": paths}, headers=self.headers,
                            timeout=60)
        if r.status_code >= 300:
            raise RuntimeError(f"Could not delete from {bucket}: HTTP {r.status_code} {r.text[:200]}")

    def remove_folder(self, bucket: str, folder: str):
        """Deletes every object directly in `folder` (an index folder has no subfolders)."""
        while True:
            r = requests.post(f"{self.url}/storage/v1/object/list/{bucket}", json={"prefix": folder, "limit": 1000},
                              headers=self.headers, timeout=60)
            if r.status_code >= 300:
                raise RuntimeError(f"Could not list {bucket}/{folder}: HTTP {r.status_code} {r.text[:200]}")
            names = [item["name"] for item in r.json() if item.get("id")]   # folders have no id
            if not names:
                return
            self.remove_objects(bucket, [f"{folder}/{name}" for name in names])


# GVP versions added on the website: their PDFs and their indexes.
GUIDELINE_FILES_BUCKET = "guideline-files"
GUIDELINE_INDEX_BUCKET = "guideline-indexes"
INDEX_CACHE = HERE / "index"      # a version's index is kept in index/<its index_path>/ after the first use
                                  # (<organization>/versions/<id>, or versions/<id> without organizations)


# Large index files (embeddings.npy is about 6 MB) are stored in pieces of this size: an unstable connection
# that drops a long upload still manages short ones, and each piece is retried on its own.
INDEX_PART_BYTES = 512 * 1024


def index_uploads(file: Path) -> int:
    """How many objects upload_index_file stores for this file."""
    size = file.stat().st_size
    return 1 if size <= INDEX_PART_BYTES else -(-size // INDEX_PART_BYTES) + 1


def upload_index_file(sb: "Supabase", index_path: str, file: Path, before_upload=None):
    """Uploads one index file; a large one as '<name>.part0000', … then '<name>.parts' (the list, last).
    `before_upload()`: optional, called before each object is uploaded."""
    before = before_upload or (lambda: None)
    data = file.read_bytes()
    if len(data) <= INDEX_PART_BYTES:
        before()
        sb.upload_object(GUIDELINE_INDEX_BUCKET, f"{index_path}/{file.name}", data)
        return
    parts = [data[start:start + INDEX_PART_BYTES] for start in range(0, len(data), INDEX_PART_BYTES)]
    for number, part in enumerate(parts):
        before()
        sb.upload_object(GUIDELINE_INDEX_BUCKET, f"{index_path}/{file.name}.part{number:04d}", part,
                         attempts=5, timeout=(30, 120))
        print(f"[worker] saved {file.name}: part {number + 1} of {len(parts)}")
    manifest = {"parts": len(parts), "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    before()
    sb.upload_object(GUIDELINE_INDEX_BUCKET, f"{index_path}/{file.name}.parts", json.dumps(manifest).encode(),
                     content_type="application/json", attempts=5, timeout=(30, 120))


def download_index_file(sb: "Supabase", index_path: str, name: str, dest: Path, optional: bool = False) -> bool:
    """Downloads one index file, joining its pieces when it was uploaded in pieces (and checking it)."""
    listing = dest.with_name(dest.name + ".parts")
    if sb.download_object(GUIDELINE_INDEX_BUCKET, f"{index_path}/{name}.parts", listing, optional=True):
        manifest = json.loads(listing.read_bytes())
        listing.unlink()
        chunks = []
        for number in range(int(manifest["parts"])):
            piece = dest.with_name(f"{dest.name}.part{number:04d}")
            sb.download_object(GUIDELINE_INDEX_BUCKET, f"{index_path}/{name}.part{number:04d}", piece,
                               what=f"the GVP index ({name}, part {number + 1})")
            chunks.append(piece.read_bytes())
            piece.unlink()
        data = b"".join(chunks)
        if len(data) != manifest["size"] or hashlib.sha256(data).hexdigest() != manifest["sha256"]:
            raise RuntimeError(f"The GVP index file {name} is incomplete; process the version again")
        dest.write_bytes(data)
        return True
    return sb.download_object(GUIDELINE_INDEX_BUCKET, f"{index_path}/{name}", dest,
                              what=f"the GVP index ({name})", optional=optional)


def local_index(sb: "Supabase", index_path: str) -> Path:
    """The folder of a GVP version's index, downloaded from storage the first time it is needed."""
    folder = INDEX_CACHE / index_path
    if not (folder / "meta.json").exists():
        print(f"[worker] downloading the GVP index {index_path}")
        tmp = folder.with_name(folder.name + ".part")
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True, exist_ok=True)
        for name in ("units.jsonl", "meta.json"):
            download_index_file(sb, index_path, name, tmp / name)
        for name in ("embeddings.npy", "tfidf.pkl"):   # one of them, depending on the embedding backend
            download_index_file(sb, index_path, name, tmp / name, optional=True)
        shutil.rmtree(folder, ignore_errors=True)
        tmp.rename(folder)
    return folder


# Requirement passages sent per call (about 0.5 KB each).
PASSAGES_PER_CALL = 200


def read_passages(index_folder: Path) -> list[dict]:
    """The requirement passages of an index folder (units.jsonl), as guideline_requirements rows."""
    lines = (index_folder / "units.jsonl").read_text(encoding="utf-8").splitlines()
    return [requirement_passage(json.loads(line)) for line in lines if line.strip()]


def backfill_requirements(sb: "Supabase", cfg: dict, scfg: dict):
    """One time: gives every published GVP version all its requirement passages in guideline_requirements,
    from its index files (until now only the passages that findings referred to were there). Versions
    with no index here (e.g. sample data) are skipped. Safe to run again: it upserts."""
    from hawkim.engine import index_folder
    for version in sb.select("guideline_versions", "select=id,name,version,index_path&order=added_at"):
        name = f"{version['name']} {version['version']}"
        if version.get("index_path"):
            folder = local_index(sb, version["index_path"])
        elif str(version["version"]) == str(scfg.get("guideline_version")):
            folder = index_folder(cfg)
            folder = folder if folder.is_absolute() else HERE / folder
        else:
            print(f"[backfill] {name}: skipped (no index for this version here)")
            continue
        if not (folder / "units.jsonl").exists():
            print(f"[backfill] {name}: skipped (no units.jsonl in {folder})")
            continue
        passages = read_passages(folder)
        for start in range(0, len(passages), PASSAGES_PER_CALL):
            sb.rpc("backfill_guideline_requirements",
                   {"p_version_id": version["id"], "p_passages": passages[start:start + PASSAGES_PER_CALL]})
        print(f"[backfill] {name}: {len(passages)} requirement passages saved")


class GuidelineProcessingError(RuntimeError):
    """A failure the admin can act on; its text is shown on the version's page."""


MEMORY_MESSAGE = ("The computer running the compliance service ran out of memory. Close other programs on it "
                  "(for example Ollama or a browser with many tabs) and try again.")
UPLOAD_MESSAGE = ("The requirements were prepared, but saving them to Hawkim timed out (slow connection). "
                  "Try again: they won't be prepared again, only saved.")


class GuidelineCancelled(BaseException):
    """An admin deleted the version while it was being processed. A BaseException, like
    KeyboardInterrupt, so the `except Exception` fallbacks on the way (e.g. pdfplumber's) let it through."""

    def __init__(self, missing: bool):
        super().__init__("missing" if missing else "cancelled")
        self.missing = missing   # the row is gone already (deleted with its file)


class GuidelineProgress:
    """The heartbeat of a version being processed: every `seconds` a background thread saves the
    latest overall percent (report_guideline_progress, which also sets last_progress_at) and learns
    whether the version was cancelled. check(), run after every page, before each new group of
    embedding batches and before each upload, then stops the work. The percent never goes down."""

    def __init__(self, sb: "Supabase", draft_id: str, seconds: float = 2.0):
        from hawkim.guidelines import STAGE_READING
        self.sb, self.draft_id, self.seconds = sb, draft_id, seconds
        self.percent, self.stage, self.detail = 0, STAGE_READING, None
        self.lock = threading.Lock()
        self.state = "continue"                   # or 'cancelled' / 'missing'
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self.thread.start()   # first, so stop() always has the thread to stop
        self.sync()
        self.check()

    def stop(self):
        self.stopped.set()
        if self.thread.is_alive():
            self.thread.join(timeout=self.seconds + 60)

    def update(self, percent: int, stage: str, detail: str | None):
        with self.lock:
            self.percent = max(self.percent, min(100, int(percent)))
            self.stage, self.detail = stage, detail
        self.check()

    def check(self):
        if self.state != "continue":
            raise GuidelineCancelled(missing=self.state == "missing")

    def sync(self) -> str:
        """Saves the progress now and returns the version's state (a failed report is only logged)."""
        with self.lock:
            params = {"p_id": self.draft_id, "p_percent": self.percent, "p_stage": self.stage, "p_detail": self.detail}
        try:
            state = self.sb.rpc("report_guideline_progress", params)
        except Exception as e:
            print(f"[worker] progress report failed: {e}")
            return self.state
        if state in ("cancelled", "missing"):
            self.state = state
        return self.state

    def _run(self):
        while not self.stopped.wait(self.seconds):
            self.sync()


def cancel_guideline(job: dict, sb: "Supabase", missing: bool):
    """Removes everything processing wrote for a cancelled version, its PDF, then its row (one transaction).
    If a step fails the row stays (cancelled, hidden from the website) and the next claim finishes it."""
    draft_id = job["id"]
    index_path = guideline_index_path(job)
    require_in_organization(job, index_path, job.get("storage_path"))   # never another organization's files
    shutil.rmtree(INDEX_CACHE / index_path, ignore_errors=True)          # the requirement units and embeddings
    sb.remove_folder(GUIDELINE_INDEX_BUCKET, index_path)                  # any already uploaded
    if not missing:   # a missing row was deleted with its file
        sb.remove_objects(GUIDELINE_FILES_BUCKET, [job["storage_path"]])
        sb.rpc("finish_guideline_cancellation", {"p_id": draft_id})
    print(f"[worker] GVP {job['version']}: cancelled; its requirements, file and version were deleted")


def process_guideline(job: dict, svc: ComplianceService, sb: "Supabase"):
    """Processes a GVP version an admin added (build_guideline), or stops and deletes it when an admin
    deleted it meanwhile. A cancelled version is never completed: complete_guideline_processing refuses
    it too."""
    print(f"[worker] GVP {job['version']}: processing {job['file_name']}")
    tracker = GuidelineProgress(sb, job["id"])
    try:
        try:
            tracker.start()
            build_guideline(job, svc, sb, tracker)
            return
        except GuidelineCancelled as e:
            missing = e.missing
        except Exception:
            # Cancelled just as something failed (or as it completed): clean up instead of failing.
            state = tracker.sync()
            if state == "continue":
                raise
            missing = state == "missing"
        # The heartbeat goes on while cleaning up, so the version isn't taken for stuck meanwhile.
        cancel_guideline(job, sb, missing)
    finally:
        # Every path (completed, failed, cancelled, interrupted) stops the heartbeat thread.
        tracker.stop()


def build_guideline(job: dict, svc: ComplianceService, sb: "Supabase", tracker: GuidelineProgress):
    """Builds the index of a GVP version an admin added, uploads it and completes the version (which
    makes it current). The index is kept in index/<index path>/ before uploading, so a retry after a
    failed upload only uploads it again."""
    from hawkim.guidelines import EMBEDDING_PERCENT, STAGE_SAVING, build_index, stage_percent
    draft_id = job["id"]
    # The version's own organization's folder (the database refuses any other in complete_guideline_processing).
    index_path = guideline_index_path(job)
    require_in_organization(job, index_path, job["storage_path"])
    local = INDEX_CACHE / index_path
    progress = tracker.update

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

    files = [f for f in sorted(local.iterdir()) if f.is_file() and f.name != "report.json"]
    total = sum(index_uploads(f) for f in files)
    saved = [0]
    saving = (EMBEDDING_PERCENT[1], 100)

    def before_upload():
        progress(stage_percent(saving, saved[0], total), STAGE_SAVING, f"part {saved[0] + 1} of {total}")
        saved[0] += 1

    try:
        for f in files:
            upload_index_file(sb, index_path, f, before_upload)
    except requests.RequestException as e:
        raise GuidelineProcessingError(UPLOAD_MESSAGE) from e
    # Its requirement passages, which publishing copies into guideline_requirements.
    passages = read_passages(local)
    for start in range(0, len(passages), PASSAGES_PER_CALL):
        tracker.check()
        sb.rpc("save_guideline_passages", {"p_id": draft_id, "p_passages": passages[start:start + PASSAGES_PER_CALL],
                                           "p_first": start == 0})
    progress(100, STAGE_SAVING, f"{len(passages)} requirement passages")
    # The last word on cancelling before completing (complete_guideline_processing also refuses it).
    tracker.sync()
    tracker.check()
    report["seconds"] = round(time.time() - t0, 1)
    sb.rpc("complete_guideline_processing", {"p_id": draft_id, "p_index_path": index_path, "p_report": report})
    print(f"[worker] GVP {job['version']}: done and current, {report['requirements']} requirements "
          f"in {report['sections']} sections ({report['seconds']} s)")


def process(job: dict, svc: ComplianceService, sb: Supabase, scfg: dict):
    check_id = job["check_id"]
    print(f"[worker] check {check_id}: {job['file_name']} (SOP version {job['sop_version']})")
    # The SOP file and the GVP index must be the check's own organization's.
    require_in_organization(job, job["storage_path"], job.get("guideline_index_path"))
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


LOCK_FILE = HERE / "worker.lock"
ALREADY_RUNNING = ("[worker] Another worker.py is already running on this machine. "
                   "Stop it first (Ctrl+C in its window), then start this one again.")


def single_instance():
    """Holds an OS lock on worker.lock while this worker runs, so only one worker.py runs at a time on
    this machine. The OS releases it when the process ends, also after a crash, so it never goes stale.
    Returns the open lock file: keep it open until the worker stops."""
    lock = open(LOCK_FILE, "a+")
    try:
        if os.name == "nt":
            import msvcrt
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        raise SystemExit(ALREADY_RUNNING)
    return lock


def main():
    ap = argparse.ArgumentParser(description="Hawkim compliance worker")
    ap.add_argument("--config", default=str(HERE / "config.yaml"))
    ap.add_argument("--once", action="store_true", help="process at most one check, then exit")
    ap.add_argument("--backfill-requirements", action="store_true",
                    help="one time: save every requirement passage of the published GVP versions, then exit")
    args = ap.parse_args()
    lock = single_instance()   # before loading the model: a second worker exits at once  # noqa: F841

    load_env(HERE / ".env")
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SECRET_KEY in compliance-service/.env (see .env.example)")

    if args.backfill_requirements:   # reads index files only: no model is loaded
        from hawkim.pipeline import load_config
        cfg = load_config(args.config)
        backfill_requirements(Supabase(url, key), cfg, cfg.get("service", {}))
        return

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
