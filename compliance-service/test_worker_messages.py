"""Every way a compliance check (or a GVP version) can fail gives the user a clear message.
python -m pytest test_worker_messages.py"""
import zipfile

import pytest
import requests

import worker

SCFG = {"guideline_version": "4.0", "engine_version": "test"}


def job(**extra):
    return {"check_id": "c1", "file_name": "SOP.docx", "sop_version": 1, "storage_path": "org1/sop.docx",
            "guideline_index_path": None, "guideline_version": "4.0", "organization_id": "org1", **extra}


class FakeDB:
    def __init__(self, download_error=None):
        self.download_error, self.calls = download_error, []

    def download(self, storage_path, dest):
        if self.download_error:
            raise self.download_error
        dest.write_bytes(b"x")

    def rpc(self, name, params):
        self.calls.append(name)


class FakeService:
    def __init__(self, result=None, error=None):
        self.result, self.error = result, error

    def check(self, path, engine=None):
        if self.error:
            raise self.error
        return self.result


def run(service, db=None, **extra):
    with pytest.raises(BaseException) as failure:
        worker._process(job(**extra), service, db or FakeDB(), SCFG)
    return worker.failure_message(failure.value), failure.value


def test_wrong_organization():
    assert run(FakeService(), storage_path="other/sop.docx")[0] == worker.WRONG_ORGANIZATION


def test_gvp_version_without_index():
    assert run(FakeService(), guideline_version="9.9")[0] == worker.GVP_NOT_READY


def test_sop_file_missing_and_lost_connection_while_downloading():
    assert run(FakeService(), FakeDB(RuntimeError("Could not download the SOP file: HTTP 404")))[0] == worker.SOP_FILE_MISSING
    assert run(FakeService(), FakeDB(requests.ConnectionError()))[0] == worker.CONNECTION_LOST


def test_unsupported_file():
    assert run(FakeService(), file_name="SOP.txt")[0] == worker.UNSUPPORTED_FILE


def test_file_that_cannot_be_opened():
    assert run(FakeService(error=zipfile.BadZipFile("File is not a zip file")))[0] == worker.FILE_UNREADABLE

    class PdfReadError(Exception):
        pass
    PdfReadError.__module__ = "pypdf.errors"
    assert run(FakeService(error=PdfReadError("EOF marker not found")), file_name="SOP.pdf")[0] == worker.FILE_UNREADABLE


def test_no_text_and_no_steps():
    empty = {"findings": [], "warnings": ["No text extracted at all."]}
    assert run(FakeService(empty))[0] == worker.NO_TEXT
    assert run(FakeService({"findings": [], "warnings": []}))[0] == worker.NO_STEPS


def test_model_not_running():
    no_answer = {"findings": [{"raw_output": "", "error": "ConnectionError: localhost:11434"}] * 3, "warnings": []}
    assert run(FakeService(no_answer))[0] == worker.MODEL_UNAVAILABLE
    # one step without an answer is not a failure of the whole check
    some = {"findings": [{"raw_output": "", "error": "timeout"}, {"raw_output": "{}", "error": None}]}
    assert not worker.model_unavailable(some)


def test_out_of_memory_setup_problem_and_unexpected():
    assert run(FakeService(error=MemoryError()))[0] == worker.CHECK_OUT_OF_MEMORY
    assert run(FakeService(error=RuntimeError("CUDA out of memory")))[0] == worker.CHECK_OUT_OF_MEMORY
    with pytest.raises(worker.CheckError) as failure:   # process() turns a setup error into a failed check
        worker.process(job(), FakeService(error=SystemExit("Index was built with another model")), FakeDB(), SCFG)
    assert worker.failure_message(failure.value).startswith("The compliance checker isn't set up correctly")
    msg = run(FakeService(error=KeyError("label")))[0]
    assert msg.startswith("Something went wrong") and "KeyError" in msg


def test_gvp_processing_messages():
    assert worker.guideline_failure_message(worker.GuidelineProcessingError(worker.GVP_NO_REQUIREMENTS)) == worker.GVP_NO_REQUIREMENTS
    assert worker.guideline_failure_message(requests.ConnectionError()) == worker.GVP_CONNECTION_LOST
    assert worker.guideline_failure_message(MemoryError()) == worker.MEMORY_MESSAGE
    assert worker.guideline_failure_message(SystemExit("no model")).startswith("The compliance checker isn't set up")
    assert worker.guideline_failure_message(ValueError("x")).startswith("Something went wrong while processing")


def test_every_message_says_what_to_do():
    for name in ("CONNECTION_LOST", "WRONG_ORGANIZATION", "GVP_NOT_READY", "SOP_FILE_MISSING", "UNSUPPORTED_FILE",
                 "FILE_UNREADABLE", "NO_TEXT", "NO_STEPS", "MODEL_UNAVAILABLE", "CHECK_OUT_OF_MEMORY"):
        text = getattr(worker, name)
        assert any(w in text for w in ("run the check", "contact your administrator", "Ask your administrator")), name
