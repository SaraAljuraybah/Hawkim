"""SOP splitting with and without a table of contents (python -m pytest test_sop_chunking.py). No model."""
from hawkim.chunking import chunk_sop
from hawkim.extract import Document

SKIP = ["revision history", "definitions", "references", "related documents", "table of contents"]

TITLE_PAGE = ["SOP-PV-057 Healthcare Professional and Consumer Safety Communication",
              "Prepared by: PV Specialist   Approved by: QPPV   Effective date: 01-01-2025"]
# Page 2 of SOP-PV-057 as the PDF extraction reads it: "<number> <title> <page>".
CONTENTS = ["Table of Contents", "1 Purpose 3", "2 Scope 3", "3 Responsibilities 3", "4 Definitions 3",
            "5 Procedures 4-5", "6 References 6", "7 Related Documents 6", "8 Revision History 6"]
BODY = [
    "1- Purpose:",
    "1-1. To establish standardized procedures for the development and dissemination of safety communications.",
    "2- Scope:",
    "2-1. This SOP applies to all safety communication activities initiated by the company in Saudi Arabia.",
    "3- Responsibilities:",
    "3-1. The QPPV is responsible for the approval of every safety communication before it is sent.",
    "4- Definitions:",
    "DHPC: Direct Healthcare Professional Communication.",
    "5- Procedures:",
    "5-1. Identification and Assessment of Safety Communication Need",
    "5-1-1. PV Specialist shall review all new or emerging safety information from signal detection.",
    "5-1-2. PV Manager shall evaluate whether the safety information meets criteria for communication.",
    "5-2. SFDA Coordination and Approval Process",
    "5-2-1. Regulatory Affairs shall submit the draft DHPC to the SFDA via the NPC database.",
    "5-2-2. PV Manager shall track SFDA feedback and coordinate any required revisions promptly.",
    "8- Revision History:",
    "1 01-01-2025 01 First issue",
]


def split(pages):
    return chunk_sop(Document("SOP-PV-057.pdf", pages), skip_sections=SKIP)


def steps(chunks):
    return [c.heading for c in chunks if c.heading.startswith("5 Procedures > 5-")]


def test_contents_page_then_dash_headings_gives_steps():
    """a) The "hh" case: a contents page before "1- Purpose:" used to give 0 chunks."""
    chunks, notes = split([TITLE_PAGE, CONTENTS, BODY])
    assert steps(chunks) == [
        "5 Procedures > 5-1 Identification and Assessment of Safety Communication Need > 5-1-1",
        "5 Procedures > 5-1 Identification and Assessment of Safety Communication Need > 5-1-2",
        "5 Procedures > 5-2 SFDA Coordination and Approval Process > 5-2-1",
        "5 Procedures > 5-2 SFDA Coordination and Approval Process > 5-2-2"]
    assert any("Table of contents found (8 lines)" in n for n in notes)
    # The contents lines stay with the skipped text before the first heading, not in any chunk.
    assert not any("Revision History 6" in c.text or c.heading.endswith(" 6") for c in chunks)


def test_without_contents_page_steps_are_unchanged():
    """b) No contents page: the same chunks with and without the contents page, and no TOC note."""
    without, notes = split([TITLE_PAGE, BODY])
    with_toc, _ = split([TITLE_PAGE, CONTENTS, BODY])
    assert [(c.heading, c.text) for c in without] == [(c.heading, c.text) for c in with_toc]
    assert len(steps(without)) == 4
    assert not any("Table of contents" in n for n in notes)


NUMBER_STEPS = [
    "5-1-1. PV Specialist shall submit expedited reports of serious adverse reactions to the SFDA within 15",
    "5-1-2. PV Specialist shall submit reports of non-serious adverse reactions in the periodic report within 90",
    "5-1-3. QPPV shall make sure that the case documents and their source records are retained for at least 10",
]


def test_steps_ending_in_a_number_are_kept():
    """c) Steps that end in a number (also three in a row, like contents lines) are steps, not contents."""
    body = BODY[:9] + ["5-1. Reporting of Individual Case Safety Reports"] + NUMBER_STEPS
    for pages in ([TITLE_PAGE, CONTENTS, body], [TITLE_PAGE, body]):
        chunks, _ = split(pages)
        assert [c.text for c in chunks if c.heading.startswith("5 Procedures > 5-1 ")] == NUMBER_STEPS


def test_contents_like_lines_inside_a_section_are_not_removed():
    """Only a block before the first real heading is a table of contents: a numbered list of
    "<item> <number>" lines inside a step stays in the step's text."""
    table = ["1 Serious cases 15", "2 Non-serious cases 90", "3 Follow-up information 15"]
    body = BODY[:9] + ["5-1. Reporting Timelines", NUMBER_STEPS[0]] + table
    chunks, notes = split([TITLE_PAGE, body])
    assert not any("Table of contents" in n for n in notes)
    step = next(c for c in chunks if c.heading.endswith("> 5-1-1"))
    assert step.text == " ".join([NUMBER_STEPS[0]] + table)


def test_two_numbered_lines_are_not_a_contents_block():
    """Fewer than 3 "<number> <title> <page>" lines before the first heading are handled as before."""
    two = ["1 Purpose 3", "2 Scope 3"]
    chunks, notes = split([TITLE_PAGE, two + BODY])
    assert not any("Table of contents" in n for n in notes)



# ---- skip list: whole top-level section titles only (as config.yaml)

SKIP_LIST = ["revision history", "approval", "signature", "abbreviation", "definitions", "references",
             "related documents"]
STEP_5_3_1 = ("5-3-1. Regulatory Affairs shall submit the draft DHPC to the SFDA via the NPC database with the "
              "accompanying communication plan.")
HISTORY = ["6- Revision History:", "1 01-01-2025 01 First issue of this SOP, approved by the QPPV and the manager"]


def split_with(body, skip=SKIP_LIST):
    return chunk_sop(Document("SOP.pdf", [TITLE_PAGE, body]), skip_sections=skip)


def test_skip_word_inside_a_procedure_sub_heading_is_kept():
    """a) "Approval" in a sub-heading of the Procedures section is not the Approval section."""
    body = BODY[:9] + ["5-3. SFDA Coordination and Approval Process", STEP_5_3_1] + HISTORY
    chunks, notes = split_with(body)
    step = next(c for c in chunks if c.heading == "5 Procedures > 5-3 SFDA Coordination and Approval Process > 5-3-1")
    assert step.text == STEP_5_3_1
    assert not any("Approval Process" in n for n in notes)
    # the real Revision History section is still skipped
    assert "Skipped section (skip list): 6 Revision History" in notes
    assert not any("Revision History" in c.heading for c in chunks)


def test_whole_top_level_titles_are_skipped():
    """Only a top-level title that is a skip entry as a whole (plural and "A and B" allowed) is skipped."""
    for title in ("6- Approvals:", "6- Definitions and Abbreviations:", "6- References:", "6- Signatures"):
        body = BODY[:9] + ["5-3. SFDA Coordination", STEP_5_3_1, title,
                           "6-1. The QPPV, the PV Manager and the general manager approve and sign this SOP here."]
        chunks, notes = split_with(body)
        assert not any(c.heading.startswith("6 ") for c in chunks), title
    # a top-level title that only contains a skip word is checked
    body = BODY[:9] + ["5-3. SFDA Coordination", STEP_5_3_1, "6- Approval Process Management:",
                       "6-1. The QPPV shall approve each safety communication before it is sent to the SFDA."]
    chunks, notes = split_with(body)
    assert [c.heading for c in chunks if c.heading.startswith("6 ")] == ["6 Approval Process Management > 6-1"]


# ---- a 3-level number always starts a step

def test_short_three_level_line_is_a_step_not_a_sub_heading():
    """b) A PDF line break after a short first line ("... determine communication", no full stop): the step
    keeps all of its text and is not used as a sub-heading."""
    body = BODY[:9] + ["5-1. Identification and Assessment of Safety Communication Need",
                       "5-1-3. QPPV shall approve the communication need assessment and determine communication",
                       "urgency classification (immediate: within 24 hours, urgent: within 72 hours)."] + HISTORY
    chunks, _ = split_with(body)
    step = next(c for c in chunks if c.heading.endswith("> 5-1-3"))
    assert step.heading == "5 Procedures > 5-1 Identification and Assessment of Safety Communication Need > 5-1-3"
    assert step.text == ("5-1-3. QPPV shall approve the communication need assessment and determine communication "
                         "urgency classification (immediate: within 24 hours, urgent: within 72 hours).")


def test_two_level_short_line_is_still_a_sub_heading():
    """Sub-headings such as "5-1. Title" are unchanged."""
    chunks, _ = split_with(BODY)
    assert "5 Procedures > 5-1 Identification and Assessment of Safety Communication Need > 5-1-1" in [
        c.heading for c in chunks]
