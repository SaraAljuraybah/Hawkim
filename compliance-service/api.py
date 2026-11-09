"""Hawkim AI compliance service (HTTP API for the website backend).

Run:   uvicorn api:app --host 127.0.0.1 --port 8100
Docs:  http://127.0.0.1:8100/docs

Endpoints
  GET  /api/health                 engine, models, GVP index
  POST /api/compliance/scope       upload SOP -> suggested GVP modules (fast, no LLM)
  POST /api/compliance/check       upload SOP (+ optional confirmed modules) -> findings (JSON)
  POST /api/compliance/report      upload SOP -> readable compliance report (HTML, printable to PDF)
  GET  /                           simple upload page for trying the report in a browser

A full check makes one LLM call per procedure step (often 15-25 per SOP), so the website
backend should call /check from a background job and store the JSON result.
"""
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.concurrency import run_in_threadpool

from hawkim.report_html import render_report
from hawkim.service import ComplianceService

ALLOWED = {".docx", ".pdf", ".txt"}
service: ComplianceService | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global service
    service = ComplianceService(os.environ.get("HAWKIM_CONFIG", "config.yaml"))
    yield


app = FastAPI(title="Hawkim AI compliance service", version="1.0", lifespan=lifespan)


async def _save(upload: UploadFile) -> Path:
    ext = Path(upload.filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(400, f"Unsupported file type {ext or '(none)'}; use {sorted(ALLOWED)}")
    folder = Path(tempfile.mkdtemp(prefix="hawkim_"))
    path = folder / Path(upload.filename).name     # keep the name: chunk IDs are built from it
    with open(path, "wb") as f:
        shutil.copyfileobj(upload.file, f)
    return path


@app.get("/api/health")
def health():
    return {"status": "ok", **service.info()}


@app.post("/api/compliance/scope")
async def scope(file: UploadFile = File(...)):
    path = await _save(file)
    try:
        return await run_in_threadpool(service.suggest_scope, path)
    finally:
        shutil.rmtree(path.parent, ignore_errors=True)


@app.post("/api/compliance/check")
async def check(file: UploadFile = File(...),
                modules: str | None = Form(None, description="Confirmed GVP modules, e.g. 'I,IV'. Empty = matrix suggestion")):
    path = await _save(file)
    confirmed = [m.strip().upper() for m in modules.split(",") if m.strip()] if modules else None
    try:
        return await run_in_threadpool(service.check, path, confirmed)
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        shutil.rmtree(path.parent, ignore_errors=True)


@app.post("/api/compliance/report", response_class=HTMLResponse)
async def report(file: UploadFile = File(...),
                 modules: str | None = Form(None, description="Confirmed GVP modules, e.g. 'I,IV'. Empty = matrix suggestion")):
    path = await _save(file)
    confirmed = [m.strip().upper() for m in modules.split(",") if m.strip()] if modules else None
    try:
        result = await run_in_threadpool(service.check, path, confirmed)
        return HTMLResponse(render_report(result))
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        shutil.rmtree(path.parent, ignore_errors=True)


UPLOAD_PAGE = """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Hawkim – SOP compliance check</title>
<style>body{font-family:"Segoe UI",Arial,sans-serif;background:#f4f6f8;color:#1f2328;margin:0}
.box{max-width:560px;margin:60px auto;background:#fff;border:1px solid #d8dde3;border-radius:10px;padding:32px}
h1{font-size:22px;margin:0 0 6px}p{color:#5d6670}label{display:block;font-weight:600;margin:18px 0 6px}
input[type=text]{width:100%;padding:8px;border:1px solid #d8dde3;border-radius:6px}
button{margin-top:22px;background:#1d4f7a;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:15px;cursor:pointer}
button:disabled{background:#8aa4bb}.small{font-size:13px}</style></head><body><div class="box">
<h1>SOP compliance check</h1><p>Upload an SOP (Word or PDF). Hawkim checks its Procedures section against the SFDA GVP
and opens the compliance report in a new tab.</p>
<form action="/api/compliance/report" method="post" enctype="multipart/form-data" target="_blank"
 onsubmit="var b=document.getElementById('go');b.disabled=true;b.textContent='Checking… (about a minute)';setTimeout(function(){b.disabled=false;b.textContent='Check compliance'},90000)">
<label for="file">SOP file</label><input id="file" type="file" name="file" accept=".docx,.pdf,.txt" required>
<label for="modules">GVP modules (optional)</label>
<input id="modules" type="text" name="modules" placeholder="Leave empty to use the expert matrix, or e.g. I,IV">
<p class="small">The report is a preliminary AI-generated assessment and must be reviewed by an authorised person.</p>
<button id="go" type="submit">Check compliance</button></form></div></body></html>"""


@app.get("/", response_class=HTMLResponse)
def upload_page():
    return HTMLResponse(UPLOAD_PAGE)
