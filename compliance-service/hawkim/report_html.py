"""Readable compliance report (HTML) from a ComplianceService.check() result.

The page is self-contained and print-ready: open it in a browser and use
Print > Save as PDF to keep a PDF copy.
"""
from __future__ import annotations

import datetime as dt
from html import escape

MODULES = {
    "I": "Pharmacovigilance systems and their quality systems",
    "II": "Pharmacovigilance system master file",
    "III": "Pharmacovigilance inspections",
    "IV": "Pharmacovigilance audits",
    "V": "Risk management systems",
    "VI": "Collection, management and submission of reports of suspected adverse reactions",
    "VII": "Periodic benefit-risk evaluation report / PSUR",
    "VIII": "Post-authorization safety studies",
    "IX": "Signal management",
    "X": "Additional monitoring",
    "XV": "Safety communication",
    "XVI": "Risk minimisation measures",
}
# Shown in the report, most important first. NOT_ADDRESSED (the model's label) is shown as
# "Requires human review".
LABELS = [
    ("CONFLICT", "Conflict", "The SOP contradicts the requirement."),
    ("NOT_ADDRESSED", "Requires human review",
     "These steps need a reviewer's assessment: either the model could not determine compliance from the SOP text, "
     "or the matched requirement may not apply to this SOP."),
    ("PARTIAL", "Partially compliant", "The requirement is addressed, but essential elements are missing."),
    ("COMPLIANT", "Compliant", "The SOP covers the essential elements of the requirement."),
]
FLAG_TEXT = {
    "best_overall_match_outside_scope": "The closest GVP text lies outside the SOP's assigned modules.",
    "below_similarity_threshold": "No sufficiently similar requirement was found; not assessed by the model.",
    "no_requirement_in_scope": "No GVP requirement is available in the SOP's scope.",
    "multiple_process_modules": "The Purpose points to more than one GVP module.",
    "quality_supporting": "Quality-management keywords were treated as supporting.",
    "purpose_procedure_mismatch": "Most procedure steps match GVP text outside the modules suggested by the Purpose.",
    "manual_classification_required": "The scope could not be assigned automatically; the whole GVP was searched.",
    "only_general_terms": "The Purpose contains only general terms.",
    "requirement_may_not_apply": "The matched GVP requirement is outside the modules suggested for this SOP and may not apply; it was not assessed by the model.",
    "model_reported_conflict": "The model indicated a possible contradiction with the requirement.",
}

CSS = """
:root{--ink:#1f2328;--muted:#5d6670;--line:#d8dde3;--paper:#fff;--bg:#f4f6f8;
--conflict:#a3262e;--conflict-bg:#fbe9ea;--partial:#8a5300;--partial-bg:#fdf1dc;
--na:#55508a;--na-bg:#ecebf7;--ok:#22703f;--ok-bg:#e3f3e8;--accent:#1d4f7a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font-family:"Segoe UI",Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5}
.page{max-width:900px;margin:24px auto;background:var(--paper);border:1px solid var(--line);
border-radius:10px;padding:36px 40px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 12px;padding-bottom:6px;
border-bottom:2px solid var(--line)}h3{font-size:15px;margin:0}
.sub{color:var(--muted);margin:0 0 20px}
.meta{display:grid;grid-template-columns:170px 1fr;gap:4px 16px;margin:0}
.meta dt{color:var(--muted)}.meta dd{margin:0}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:8px 0 12px}
.card{border-radius:8px;padding:12px 14px;border:1px solid var(--line)}
.card b{display:block;font-size:26px;line-height:1.1}.card span{font-size:13px}
.c-CONFLICT{background:var(--conflict-bg);color:var(--conflict)}
.c-PARTIAL{background:var(--partial-bg);color:var(--partial)}
.c-NOT_ADDRESSED{background:var(--na-bg);color:var(--na)}
.c-COMPLIANT{background:var(--ok-bg);color:var(--ok)}
.badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600}
.finding{border:1px solid var(--line);border-radius:8px;padding:16px 18px;margin:0 0 14px;
break-inside:avoid}
.fhead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}
.small{font-size:12.5px;color:var(--muted)}
.box{background:var(--bg);border-radius:6px;padding:10px 12px;margin:6px 0 10px}
.label{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.review{color:var(--conflict);font-weight:600;font-size:12.5px}
ul.flags{margin:6px 0 0 18px;padding:0;color:var(--muted);font-size:12.5px}
.note{border-left:4px solid var(--accent);background:#eef4fa;padding:10px 14px;border-radius:4px;margin:16px 0}
.warn{border-left-color:var(--partial);background:var(--partial-bg)}
footer{margin-top:28px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:10px}
.printbtn{float:right;border:1px solid var(--line);background:#fff;border-radius:6px;padding:6px 12px;cursor:pointer}
@media print{body{background:#fff}.page{border:0;margin:0;max-width:none;padding:0}.printbtn{display:none}
h2{break-after:avoid}}
@media (max-width:700px){.page{padding:20px}.cards{grid-template-columns:repeat(2,1fr)}.meta{grid-template-columns:1fr}}
"""


def _e(x) -> str:
    return escape("" if x is None else str(x))


def _modules(codes) -> str:
    return "<br>".join(f"Module {_e(m)}: {_e(MODULES.get(m, ''))}" for m in codes or []) or "Not assigned"


def render_report(res: dict) -> str:
    labels = res.get("summary", {}).get("labels", {})
    scope = res.get("scope") or {}
    eng = res.get("engine", {})
    checked = res.get("checked_at") or dt.datetime.now().isoformat(timespec="seconds")
    title = res.get("title") or res.get("sop_file")

    cards = "".join(
        f'<div class="card c-{k}"><b>{labels.get(k, 0)}</b><span>{name}</span></div>' for k, name, _ in LABELS)
    flags = list(dict.fromkeys((scope.get("flags") or []) + (res.get("scope_flags") or [])))
    flag_html = "".join(f"<li>{_e(FLAG_TEXT.get(f.split(':')[0], f))}</li>" for f in flags)

    sections = []
    findings = res.get("findings", [])
    for key, name, meaning in LABELS:
        items = [f for f in findings if f.get("label") == key]
        if not items:
            continue
        blocks = []
        for f in items:
            req = f.get("requirement") or {}
            fl = "".join(f"<li>{_e(FLAG_TEXT.get(x, x))}</li>" for x in f.get("flags") or [])
            missing = f.get("missing_or_conflicting_elements") or ""
            blocks.append(f"""
<div class="finding">
 <div class="fhead"><div><h3>{_e(f.get('heading'))}</h3>
  <div class="small">Page {_e(f.get('page'))} · {_e('Numbered step' if f.get('chunk_type') == 'step' else 'Sub-section introduction')}</div></div>
  <span class="badge c-{key}">{name}</span></div>
 <div class="label">SOP text</div><div class="box">{_e(f.get('text'))}</div>
 <div class="label">GVP requirement {_e(req.get('id'))} · {_e(req.get('section'))} {_e(req.get('section_title'))}</div>
 <div class="box">{_e(req.get('text'))}</div>
 {f'<div class="label">Missing or conflicting elements</div><p>{_e(missing)}</p>' if missing.strip() else ''}
 <div class="label">Justification</div><p>{_e(f.get('justification'))}</p>
 {f'<div class="label">Recommended action</div><p>{_e(f.get("recommended_action"))}</p>' if (f.get('recommended_action') or '').strip() and key != 'COMPLIANT' else ''}
 <div class="small">Similarity of the retrieved requirement: {_e(f.get('similarity'))}</div>
 {(f'<div class="label">Notes</div><ul class="flags">{fl}</ul>') if fl else ''}
</div>""")
        sections.append(f'<h2>{name} ({len(items)})</h2><p class="sub">{meaning}</p>' + "".join(blocks))
    invalid = [f for f in findings if not f.get("label")]
    if invalid:
        sections.append(f"<h2>Not assessed ({len(invalid)})</h2>" + "".join(
            f'<div class="finding"><h3>{_e(f.get("heading"))}</h3><p class="small">{_e(f.get("error"))}</p></div>'
            for f in invalid))

    warns = "".join(f'<div class="note warn">{_e(w)}</div>' for w in res.get("warnings") or [])
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Compliance report – {_e(title)}</title><style>{CSS}</style></head><body><div class="page">
<button class="printbtn" onclick="window.print()">Print / Save as PDF</button>
<h1>SOP Compliance Report</h1>
<p class="sub">{_e(title)}</p>
<dl class="meta">
 <dt>File</dt><dd>{_e(res.get('sop_file'))}</dd>
 <dt>Checked on</dt><dd>{_e(checked.replace('T', ' '))}</dd>
 <dt>Regulation</dt><dd>SFDA Guideline on Good Pharmacovigilance Practices ({_e((eng.get('gvp_index') or {}).get('file'))})</dd>
 <dt>GVP modules checked</dt><dd>{'All modules (the whole guideline was searched)' if eng.get('scope_mode') != 'matrix' else _modules(scope.get('scope_modules'))}</dd>
 {f"<dt>Suggested by the mapping matrix</dt><dd>{_modules(scope.get('scope_modules'))}<br><span class='small'>For information only; not used to limit the search.</span></dd>" if eng.get('scope_mode') != 'matrix' and scope.get('scope_modules') else ''}
 <dt>Steps checked</dt><dd>{_e(res.get('summary', {}).get('chunks_checked'))} (Procedures section)</dd>
</dl>
<h2>Summary</h2><div class="cards">{cards}</div>
{f'<div class="note"><b>Scope notes</b><ul class="flags">{flag_html}</ul></div>' if flag_html else ''}
{warns}
<div class="note"><b>Important.</b> {_e(res.get('disclaimer') or 'Decision support only. Findings must be reviewed by an authorised person.')}
This report is a preliminary, AI-generated assessment.</div>
{''.join(sections)}
<footer>Generated by Hawkim · {_e(eng.get('llm'))} · {_e(eng.get('embedding'))} · scope: {_e(eng.get('scope_mode'))}
{(' · ' + _e(eng.get('matrix_version'))) if eng.get('matrix_version') else ''}</footer>
</div></body></html>"""
