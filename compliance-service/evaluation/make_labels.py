"""Builds the blind labelling sheet evaluation/labels/labels.xlsx from a results folder (the docx files of run 1).

    python evaluation/make_labels.py                       # latest results folder
    python evaluation/make_labels.py --results evaluation/results/<run id> --force

One row per step: SOP, step id, step text and the 5 retrieved requirements (id + text). The pipeline's
verdict and justification are NOT in this sheet, so the expert labels blind; they are in the results
folder's pipeline_verdicts.xlsx. Also writes labels/gvp_manual_template.xlsx (section, requirement_text)
for the manual GVP requirement list.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

from eval_common import GOLD_LABELS, LABELS_DIR, latest_results_dir, load_results

EMPTY_COLS = ["is_true_step", "relevant_requirement_ids", "expert_verdict", "expert_relevant_requirement_ids",
              "justification_rating_1to5", "expert_comment"]

INSTRUCTIONS = [
    ("Column", "Who", "Allowed values / meaning"),
    ("is_true_step", "team", "Y = this row is a real checked unit of the Procedures section (a sub-section "
                             "introduction or a numbered step); N = not a real unit (e.g. text from another section, "
                             "a fragment wrongly cut from a step, or two units merged)"),
    ("relevant_requirement_ids", "team", "GVP requirement ids this step must meet, separated by ';' (e.g. "
                                         "I.B.7#4; VI.C.2.2#1). A section code (e.g. I.B.7) counts every unit in "
                                         "that section. Look up ids outside the top 5 in the sheet gvp_requirements. "
                                         "Leave empty / N/A if no GVP requirement applies."),
    ("expert_verdict", "expert", ", ".join(GOLD_LABELS) + ", or N/A (no GVP requirement applies)"),
    ("expert_relevant_requirement_ids", "expert", "As relevant_requirement_ids, in the expert's view"),
    ("justification_rating_1to5", "expert", "1 (wrong / useless) to 5 (correct and complete). Rate only AFTER "
                                            "expert_verdict is filled, using pipeline_verdicts.xlsx, which holds "
                                            "the justification (it reveals the pipeline's verdict)."),
    ("expert_comment", "expert", "Free text"),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", type=Path, help="results folder (default: latest)")
    ap.add_argument("--run", type=int, default=1, help="which run to take the steps from (default 1)")
    ap.add_argument("--force", action="store_true", help="overwrite an existing labels.xlsx")
    args = ap.parse_args()

    results_dir = args.results or latest_results_dir()
    target = LABELS_DIR / "labels.xlsx"
    if target.exists() and not args.force:
        raise SystemExit(f"{target} exists (it may already be filled in). Use --force to overwrite it.")
    res = [r for r in load_results(results_dir) if r["format"] == "docx" and r["run"] == args.run]
    if not res:
        raise SystemExit(f"No docx results for run {args.run} in {results_dir}")
    gvp = json.loads((results_dir / "gvp_requirements.json").read_text(encoding="utf-8"))
    text_of = {u["id"]: u["text"] for u in gvp}

    wb = Workbook()
    ws = wb.active
    ws.title = "labels"
    cols = ["sop_id", "step_id", "step_number", "heading", "step_text"]
    for k in range(1, 6):
        cols += [f"retrieved_{k}_id", f"retrieved_{k}_text"]
    cols += EMPTY_COLS
    ws.append(cols)
    for r in sorted(res, key=lambda r: r["sop_id"]):
        for s in r["steps"]:
            row = [r["sop_id"], s["step_id"], s["step_number"], s["heading"], s["text"]]
            top = s["retrieval"]["top5"]
            for k in range(5):
                rid = top[k]["id"] if k < len(top) else None
                row += [rid, text_of.get(rid)]
            ws.append(row + [None] * len(EMPTY_COLS))

    head_fill, label_fill = PatternFill("solid", fgColor="DDDDDD"), PatternFill("solid", fgColor="FFF2CC")
    for c, name in enumerate(cols, start=1):
        cell = ws.cell(row=1, column=c)
        cell.font = Font(bold=True)
        cell.fill = label_fill if name in EMPTY_COLS else head_fill
        letter = cell.column_letter
        ws.column_dimensions[letter].width = 60 if name.endswith("text") else 24
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    ws.freeze_panes = "C2"
    n = ws.max_row
    col = {name: ws.cell(row=1, column=i).column_letter for i, name in enumerate(cols, start=1)}
    for name, values in (("is_true_step", "Y,N"), ("expert_verdict", ",".join(GOLD_LABELS) + ",N/A"),
                         ("justification_rating_1to5", "1,2,3,4,5")):
        dv = DataValidation(type="list", formula1=f'"{values}"', allow_blank=True)
        ws.add_data_validation(dv)
        dv.add(f"{col[name]}2:{col[name]}{n}")

    g = wb.create_sheet("gvp_requirements")
    g.append(["id", "section", "section_title", "page", "excluded_sfda_duty", "text"])
    for u in gvp:
        g.append([u["id"], u["section"], u.get("section_title"), u.get("page"), u.get("excluded_sfda_duty"), u["text"]])
    g.column_dimensions["F"].width = 100

    ins = wb.create_sheet("instructions")
    for line in INSTRUCTIONS:
        ins.append(line)
    ins.append(())
    ins.append(("Source", "", f"{results_dir.name}, run {args.run}, docx files"))
    ins.column_dimensions["A"].width, ins.column_dimensions["C"].width = 32, 120

    LABELS_DIR.mkdir(parents=True, exist_ok=True)
    wb.save(target)
    print(f"[labels] {n - 1} steps -> {target}")

    manual = LABELS_DIR / "gvp_manual_template.xlsx"
    if not manual.exists():
        mw = Workbook()
        mw.active.title = "gvp_manual"
        mw.active.append(["section", "requirement_text"])
        mw.save(manual)
        print(f"[labels] template for the manual GVP list -> {manual} (fill in, save as gvp_manual.xlsx)")


if __name__ == "__main__":
    main()
