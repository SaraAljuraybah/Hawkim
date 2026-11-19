"""Tests for how the worker handles a lost internet connection (python -m pytest test_worker_connection.py)."""
import requests

import worker


class FakeDB:
    """Answers RPCs; fails with a connection error for the first `down` calls."""

    def __init__(self, down=0, alive=True):
        self.down, self.alive, self.calls = down, alive, []

    def rpc(self, name, params):
        self.calls.append(name)
        if self.down > 0:
            self.down -= 1
            raise requests.ConnectionError("no internet")
        return self.alive if name == "compliance_check_alive" else None


def test_connection_errors_are_recognised_also_as_cause():
    assert worker.is_connection_error(requests.ConnectionError())
    assert worker.is_connection_error(requests.Timeout())
    try:
        try:
            raise requests.ConnectionError()
        except requests.ConnectionError as e:
            raise RuntimeError("Could not download the SOP") from e
    except RuntimeError as wrapped:
        assert worker.is_connection_error(wrapped)
    assert not worker.is_connection_error(RuntimeError("No procedure step could be assessed"))


def test_failure_message_is_clear_for_connection_errors():
    assert worker.failure_message(requests.ConnectionError()) == worker.CONNECTION_LOST
    assert worker.failure_message(RuntimeError("other reason")) == "other reason"


def test_rpc_is_tried_again_until_the_connection_is_back(monkeypatch):
    monkeypatch.setattr(worker.time, "sleep", lambda s: None)
    db = FakeDB(down=2)
    worker.rpc_with_retry(db, "complete_compliance_check", {}, seconds=90)
    assert db.calls == ["complete_compliance_check"] * 3


def test_rpc_gives_up_after_its_time(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(worker.time, "time", lambda: clock[0])
    monkeypatch.setattr(worker.time, "sleep", lambda s: clock.__setitem__(0, clock[0] + s))
    db = FakeDB(down=100)
    try:
        worker.rpc_with_retry(db, "complete_compliance_check", {}, seconds=30, wait=10)
        raise AssertionError("should have given up")
    except requests.ConnectionError:
        pass
    assert len(db.calls) == 4   # at 0, 10, 20 and 30 s


def test_report_failure_sends_the_clear_message(monkeypatch):
    sent = {}
    monkeypatch.setattr(worker, "rpc_with_retry", lambda sb, name, params, seconds, wait: sent.update(params))
    worker.report_failure(FakeDB(), "c1", requests.ConnectionError())
    assert sent == {"p_check_id": "c1", "p_message": worker.CONNECTION_LOST}


def test_check_alive_signals_and_notices_a_closed_check():
    db = FakeDB(alive=False)
    with worker.CheckAlive(db, "c1", seconds=0.01) as alive:
        pass
    assert "compliance_check_alive" in db.calls and alive.closed


def test_check_alive_survives_no_connection():
    db = FakeDB(down=1)
    with worker.CheckAlive(db, "c1", seconds=60) as alive:   # the first signal fails: no crash
        pass
    assert not alive.closed
