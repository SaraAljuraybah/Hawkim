"""A step whose model answer can't be used gets a plain justification on the website: the real error is
only in the audit copy (python -m pytest test_service_justification.py). No model is loaded."""
from types import SimpleNamespace

from hawkim.service import MODEL_ANSWER_UNUSABLE, ComplianceService

TIMEOUT = "ReadTimeout: HTTPConnectionPool(host='localhost', port=11434): Read timed out. (read timeout=600)"
INVALID = ["invalid JSON: Expecting value: line 1 column 1 (char 0)", "label 'MAYBE' is not allowed"]


def record(chunk, llm_error=None, validation_errors=(), raw_output=""):
    return {"chunk_id": f"SOP::{chunk:03d}", "chunk_type": "step", "heading": f"5 Procedures > 5-1 > 5-1-{chunk}",
            "page_start": 4, "text": "5-1-1. The PV Manager shall report within 15 days.", "decided_by": "llm",
            "requirement_used": None, "justification": None, "flags": [], "label": None, "valid": False,
            "llm_error": llm_error, "validation_errors": list(validation_errors), "raw_output": raw_output,
            "recommended_action": None, "missing_or_conflicting_elements": None, "sop_evidence": "",
            "sop_evidence_grounded": None, "review_required": True, "llm_candidates": None,
            "retrieved": [{"id": "VI.B.1#1", "score": 0.71}, {"id": "VI.B.2#1", "score": 0.65}]}


def check(records):
    unit = {"id": "VI.B.1#1", "section": "VI.B.1", "section_title": "Reporting", "page": 10, "text": "Report."}
    engine = SimpleNamespace(
        assess_file=lambda path, scope_override=None, log=None: {
            "records": records, "sop_file": "SOP.pdf", "title": "SOP", "scope": None, "scope_flags": [],
            "n_chunks_checked": len(records), "warnings": []},
        index=SimpleNamespace(by_id={"VI.B.1#1": unit}))
    svc = ComplianceService.__new__(ComplianceService)   # no __init__: no config, no model
    svc.engine, svc.info = engine, lambda e=None: {}
    return svc.check("SOP.pdf")["findings"]


def test_unusable_answer_has_a_plain_justification_and_keeps_the_error_in_the_audit_copy():
    findings = check([record(1, llm_error=TIMEOUT),
                      record(2, validation_errors=INVALID, raw_output="Sure! The step is MAYBE compliant.")])
    timeout, invalid = sorted(findings, key=lambda f: f["chunk_id"])
    for f in (timeout, invalid):
        assert f["justification"] == MODEL_ANSWER_UNUSABLE
        assert "model_answer_invalid" in f["flags"]
        assert f["label"] == "NOT_ADDRESSED" and f["requirement"]["id"] == "VI.B.1#1"
    # the exception text never reaches the justification ...
    for text in ("ReadTimeout", "11434", "timed out", "invalid JSON", "Expecting value", "MAYBE"):
        assert text not in timeout["justification"] and text not in invalid["justification"]
    # ... it stays in the audit fields
    assert timeout["llm_error"] == TIMEOUT and timeout["error"] == TIMEOUT
    assert invalid["llm_error"] is None and invalid["error"] == "; ".join(INVALID)
