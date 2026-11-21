"""Shared test set-up (pytest): the tests write worker log lines to a temporary file, never to worker.log."""
import pytest

import worker


@pytest.fixture(autouse=True)
def temporary_worker_log(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "LOG_FILE", tmp_path / "worker.log")
    return tmp_path / "worker.log"
