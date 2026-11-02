# Hawkim compliance service

The AI part of Hawkim. It checks the **Procedures** section of a Pharmacovigilance SOP against the
**SFDA Guideline on Good Pharmacovigilance Practices (GVP)** and writes the results to the website's
database, where the existing compliance report page shows them.

| Stage | What happens |
|---|---|
| 1. Text extraction | Word or PDF; repeated page headers and footers removed |
| 2. SOP chunking | One chunk per procedure step (Procedures section only) |
| 3. GVP requirement index | 1,505 obligation units, embedded once with BGE-M3 |
| 4. Scope classification | Title and Purpose matched with the expert's mapping matrix. **Not used to limit the search** (`scope.mode: none`); used to recognise matches that may not apply |
| 5. Retrieval | BGE-M3, cosine similarity, from the whole GVP. Sections describing SFDA duties (e.g. I.B.9.2, III.B.4.1) are excluded (`scope.exclude_sections`) |
| 6. Compliance reasoning | Qwen2.5-7B-Instruct, temperature 0, labels COMPLIANT, PARTIAL, CONFLICT or NOT_ADDRESSED, with evidence, missing elements, recommended action and justification. A step whose best match lies outside the modules suggested for the SOP is not assessed and goes to human review (`scope.outside_scope_action: review`) |
| 7. Rule-based validation | Valid JSON, allowed label, quoted evidence found in the SOP text |
| 8. Structured results | Steps grouped into **one finding per GVP requirement** with the most serious result |
| 9. Compliance report | Written to `compliance_findings`; shown on the website's report page. NOT_ADDRESSED is shown as **Requires Human Review** |

## How it connects to the website

```
Author presses the check button → start_compliance_check  (engine 'hawkim' while this service is online)
worker.py → claim_compliance_check → downloads the SOP from the sop-files bucket → runs the pipeline
          → complete_compliance_check (findings) or fail_compliance_check (reason)
Report page → reads the SOP again every 5 s while the check runs, then shows the findings
```

The database functions are in `supabase/migrations/20261103120000_compliance_service.sql`. While the
service is offline (no heartbeat for 2 minutes), the website keeps using the **sample engine** and shows
the "Sample results" banner, as before. While it is online, a version whose completed check is a
sample result can be checked again to get a real result; otherwise the rule "one completed check per
version" is unchanged.

## Setup (on the machine that runs the service)

Python 3.10+, and [Ollama](https://ollama.com) for Qwen.

```bash
cd compliance-service
pip install -r requirements.txt
ollama pull qwen2.5:7b                 # about 4.7 GB, once
cp .env.example .env                   # fill in as agreed with the database owner
```

1. **Database:** the migration is applied by the database owner (see the repository's database rules).
2. **GVP index:** put the guideline PDF in `data/gvp/Drug-GVP4.pdf` and run `python run.py index`
   (about 8 minutes on a CPU), or copy an `index/` folder built before. For this first run, set
   `HF_HUB_OFFLINE=0` so BGE-M3 can be downloaded; afterwards keep it at `1`.
3. **Ollama settings:** a 4096-token window fits every prompt and answer; flash attention and an 8-bit
   working memory use less graphics memory, so more of the model runs on the GPU (faster). On Windows,
   set them once and restart the Ollama app:
   `setx OLLAMA_CONTEXT_LENGTH 4096`, `setx OLLAMA_FLASH_ATTENTION 1`, `setx OLLAMA_KV_CACHE_TYPE q8_0`.
   While a check runs, `ollama ps` shows how much of the model is on the GPU.
4. **Start the worker** and keep it running while the website is used:

```bash
python worker.py
```

It prints each check it processes. On a laptop where the model runs partly on the CPU, a check takes
about 10–15 minutes per SOP; with a GPU that holds the whole model, about 1–2 minutes.

## Other commands

```bash
python run.py report "path/to/SOP.docx"         # HTML report for one SOP, without the website
uvicorn api:app --port 8100                     # local API with an upload page (http://127.0.0.1:8100/)
python run.py chunk / run / evaluate / compare  # evaluation on a test set (see config.yaml)
```

## Notes

- **Keys:** `.env` stays on the machine that runs the service and is never committed. The frontend
  never uses a secret key.
- **Confidential SOPs:** keep `llm.provider: ollama`. OpenRouter sends text to an external API and is
  for non-confidential test SOPs only.
- **New GVP version:** rebuild the index from the new PDF, set `service.guideline_version`, and have the
  expert review `config/gvp_mapping_matrix.yaml` and `scope.exclude_sections`.
- **Results support human review;** final decisions stay with the assigned reviewers and approvers.
  In the pilot, the model did not assign CONFLICT to any step, so conflicts rely on human review.
