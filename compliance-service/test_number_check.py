"""Tests for the deadline / retention conflict rule (python -m pytest test_number_check.py)."""
from hawkim.number_check import check

REQ_15 = ("Information on lack of efficacy, such as the development of a newly resistant strain of a "
          "bacterium previously regarded as susceptible, should be reported within 15 days.")
REQ_30 = "the SFDA could demand for a faster distribution that should be completed within 30 days."
REQ_RET = ("documents for individual authorized medicinal products shall be retained as long as the product "
           "is authorized and for at least 10 years after the marketing authorization has ceased to exist.")
REQ_7CAL = "The notification shall be done within 7 calendar days."


def kinds(r, key):
    return [i["kind"] for i in r[key]]


def test_expert_rule_30_days():
    assert kinds(check("Complete the distribution within 15 days.", REQ_30), "stricter") == ["deadline"]
    assert kinds(check("Complete the distribution within 35 days.", REQ_30), "conflicts") == ["deadline"]
    assert check("Complete the distribution within 30 days.", REQ_30) == {"conflicts": [], "stricter": []}


def test_deadline_units_and_words():
    assert kinds(check("Report the case within one month.", REQ_15), "conflicts") == ["deadline"]
    assert kinds(check("Report the case no later than 72 hours after receipt.", REQ_15), "stricter") == ["deadline"]
    assert kinds(check("Report it within fifteen (15) days.", REQ_15), "conflicts") == []


def test_retention():
    assert kinds(check("Safety records are retained for 5 years after withdrawal.", REQ_RET), "conflicts") == ["retention"]
    assert kinds(check("Records shall be kept for a minimum of 15 years.", REQ_RET), "stricter") == ["retention"]


def test_conservative_cases():
    # working days vs calendar days: not compared
    assert check("Notify within 10 working days.", REQ_7CAL) == {"conflicts": [], "stricter": []}
    # two different deadlines in the step: not compared
    assert check("Send within 15 days, and the follow-up within 90 days.", REQ_30) == {"conflicts": [], "stricter": []}
    # no number in the step
    assert check("Report serious cases promptly to the SFDA.", REQ_15) == {"conflicts": [], "stricter": []}


class _Index:
    by_id = {"VI.B.5.4#6": {"id": "VI.B.5.4#6", "text": REQ_15}}


def _run(action, label, step):
    from hawkim.engine import Engine
    eng = Engine.__new__(Engine)
    eng.number_action, eng.index = action, _Index()
    v = {"valid": True, "label": label, "requirement_id": "VI.B.5.4#6", "justification": "Model reason.",
         "missing_or_conflicting_elements": "", "recommended_action": ""}
    flags = []
    eng._number_check(v, step, flags)
    return v, flags


def test_engine_flag_keeps_label():
    v, flags = _run("flag", "COMPLIANT", "Report the case to the SFDA within 30 days.")
    assert v["label"] == "COMPLIANT" and flags == ["possible_conflict_deadline"]
    assert "Rule check" in v["justification"]


def test_engine_override_sets_conflict_with_matching_reason():
    v, flags = _run("override", "PARTIAL", "Report the case to the SFDA within 30 days.")
    assert v["label"] == "CONFLICT" and "label_set_by_rule_check" in flags and v["recommended_action"]
    assert "Model reason" not in v["justification"] and "conflict" in v["justification"]


def test_engine_stricter_disagreement_goes_to_review():
    for label in ("PARTIAL", "CONFLICT"):
        v, flags = _run("override", label, "Report the case to the SFDA within 7 days.")
        assert v["label"] == "NOT_ADDRESSED" and "model_and_rule_disagree" in flags
        assert "Model reason" in v["justification"] and "reviewer should decide" in v["justification"]


def test_engine_agreement_unchanged():
    v, flags = _run("override", "COMPLIANT", "Report the case to the SFDA within 7 days.")
    assert v["label"] == "COMPLIANT" and v["justification"] == "Model reason." and flags == []
    v, flags = _run("override", "CONFLICT", "Report the case to the SFDA within 30 days.")
    assert v["label"] == "CONFLICT" and v["justification"] == "Model reason."


def test_engine_off():
    assert _run("off", "COMPLIANT", "within 30 days.")[1] == []
