# Hawkim evaluation harness

Evaluates the compliance pipeline as a standalone component: no website, no worker queue. The harness
calls `ComplianceService.check()` (the same path the website uses) and does not change the pipeline code.
The database is only read (the GVP version row); nothing is written to it.

| Folder | Content | In git |
|---|---|---|
| `data/` | the test SOPs (each SOP as `.docx` and `.pdf`, linked by `SOP-PV-xxx`) | no |
| `results/<run id>/` | harness output and `metrics/` | no |
| `labels/` | `labels.xlsx` (team + expert), `gvp_manual.xlsx` | no |

## Steps

Run from `compliance-service/`. Stop `worker.py` first. The harness stops if less than 7 GB of RAM is free
(`--min-ram-gb`) before loading the models and before each file.

```bash
python evaluation/run_eval.py --runs 1          # all files once (3 for the consistency test)
python evaluation/make_labels.py                # labels/labels.xlsx from run 1, docx files
python evaluation/metrics.py                    # results/<run id>/metrics/metrics.md
```

Options: `--gvp-version 4.0` (default), `--files SOP-PV-001 pdf ...`, `--run-id <name>`; for metrics,
`--results <folder>` (default: latest) and `--run <k>`.

## What is saved per file and run (`<SOP>_<format>_run<k>.json`)

1. **Steps:** id, step number, heading, type (numbered step or sub-section introduction), text.
2. **GVP requirements:** the requirements retrieved for this file (id, section, text). Every unit of the
   index is in `gvp_requirements.json`.
3. **Retrieval:** the top-5 requirement ids with cosine scores per step, and the 3 the LLM saw.
4. **LLM:** the raw answer, `valid_first_try` (the pipeline's validator accepted its single answer; there
   is no re-ask), `strict_json` (the raw text is only a JSON object), the final verdict (COMPLIANT,
   PARTIAL, CONFLICT or **Requires Human Review** with `rhr_reason`), the chosen requirement and justification.
5. **Timing and memory:** extraction, embedding, retrieval and LLM time per step and per file; peak RAM of the
   harness and of Ollama; lowest free RAM; `failed` + error.

Embedding and retrieval run once per file for all steps, so their per-step time is the file time divided
by the number of steps. Model loading and one LLM warm-up call are timed separately (`run_meta.json`).
The LLM cache is switched off for the harness process, so every run calls the model.

`run_meta.json` records the git commit, models, top-k, temperature, the GVP version row and index.

## Labelling

`labels/labels.xlsx` has no pipeline verdict, so the expert labels blind. The sheet `instructions` lists
the allowed values. The pipeline's verdicts and justifications are in `results/<run id>/pipeline_verdicts.xlsx`:
give it to the expert only after `expert_verdict` is filled, to rate the justifications.
`make_labels.py` doesn't overwrite a filled sheet unless `--force` is given.

`labels/gvp_manual.xlsx`: one row per requirement of the sample GVP sections (`section`, `requirement_text`;
template: `gvp_manual_template.xlsx`). An extracted unit matches when it is in the same section and contains
at least 80% of the manual text's words.

## Scoring notes

- **Requires Human Review** is an abstention, never mapped to a label. Expert tables give coverage, metrics on
  answered steps only, and strict metrics where every human-review step counts as wrong.
- **Gap detection recall:** expert label PARTIAL, CONFLICT or NOT_ADDRESSED, pipeline verdict PARTIAL or CONFLICT.
- **Step extraction:** the checked unit is what the pipeline assesses and the expert reviewed (sub-section
  introductions + numbered steps; manual counts 16 / 16 / 16 / 20); numbered steps alone (12 / 12 / 12 / 15)
  are a second row. precision = units marked `is_true_step = Y` / labelled units; recall = distinct true units
  / the manual count.
- **pdf steps** inherit the docx labels when the step number and text are the same.
- **Error attribution** (wrong steps): retrieval error = no relevant requirement in the top 5 (expert ids, else
  team ids); otherwise an LLM error, split by whether the relevant requirement was among the 3 the LLM saw.
