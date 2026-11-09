#!/usr/bin/env python3
"""Hawkim PDF evaluation pipeline.

  python run.py index                      # 1. build the GVP requirement index (once per embedding model)
  python run.py chunk                      # 2. extract + chunk all SOPs, create the annotation template
  python run.py scope                      #    scope decision per SOP from the expert matrix (no LLM)
  python run.py run                        # 3. run on all SOP files (scope from config: matrix or none)
  python run.py run --scope none           #    baseline without scope restriction
  python run.py run --oracle               #    LLM only, with the expert's requirement (no retrieval)
  python run.py evaluate runs/<run_name>   # 4. (re)compute metrics for a run
  python run.py compare runs/a runs/b      # 5. side-by-side comparison of runs
  python run.py report data/sops/X.docx    #    compliance report (HTML) for one SOP
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hawkim.pipeline import cmd_chunk, cmd_compare, cmd_evaluate, cmd_index, cmd_run, cmd_scope, load_config  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Hawkim compliance-model evaluation on PDF/DOCX files")
    ap.add_argument("--config", default="config.yaml")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("index", help="extract and embed the GVP guideline")

    p = sub.add_parser("chunk", help="extract and chunk SOP files; write annotation template")
    p.add_argument("--files", nargs="*", help="only these SOP files (names or stems)")

    p = sub.add_parser("scope", help="scope classification per SOP with the expert matrix (no LLM)")
    p.add_argument("--files", nargs="*")

    p = sub.add_parser("run", help="run retrieval + LLM on SOP files")
    p.add_argument("--scope", choices=["none", "matrix"], help="override scope.mode")
    p.add_argument("--name", help="run folder name (default: timestamp_model_embedding_mode)")
    p.add_argument("--files", nargs="*", help="only these SOP files (names or stems)")
    p.add_argument("--limit", type=int, help="only the first N chunks (quick test)")
    p.add_argument("--mode", choices=["top1", "topk_select"], help="override llm.mode")
    p.add_argument("--oracle", action="store_true", help="give the LLM the expert-marked requirement")
    p.add_argument("--provider", help="override llm.provider")
    p.add_argument("--model", help="override llm.model")

    p = sub.add_parser("evaluate", help="compute metrics for a run folder")
    p.add_argument("run_dir")
    p.add_argument("--gold", help="ground-truth CSV (default: paths.gold_file)")

    p = sub.add_parser("report", help="check one SOP and write an HTML compliance report")
    p.add_argument("sop_file")
    p.add_argument("--modules", help="confirmed GVP modules, e.g. I,IV (default: expert matrix)")
    p.add_argument("--out", help="output HTML file (default: reports/<file name>.html)")

    p = sub.add_parser("compare", help="compare several evaluated runs")
    p.add_argument("run_dirs", nargs="+")
    p.add_argument("--out", help="output markdown file")

    a = ap.parse_args()
    cfg = load_config(a.config)

    if a.cmd == "index":
        cmd_index(cfg)
    elif a.cmd == "chunk":
        cmd_chunk(cfg, a.files)
    elif a.cmd == "run":
        if a.provider:
            cfg["llm"]["provider"] = a.provider
        if a.model:
            cfg["llm"]["model"] = a.model
        cmd_run(cfg, a.name, a.oracle, a.limit, a.files, a.mode, a.scope)
    elif a.cmd == "scope":
        cmd_scope(cfg, a.files)
    elif a.cmd == "evaluate":
        cmd_evaluate(cfg, a.run_dir, a.gold)
    elif a.cmd == "report":
        from hawkim.report_html import render_report
        from hawkim.service import ComplianceService
        svc = ComplianceService(a.config)
        mods = [m.strip().upper() for m in a.modules.split(",")] if a.modules else None
        res = svc.check(a.sop_file, mods)
        out = Path(a.out) if a.out else Path("reports") / (Path(a.sop_file).stem + ".html")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render_report(res), encoding="utf-8")
        print(f"[report] {res['summary']}  ->  {out.resolve()}")
    elif a.cmd == "compare":
        cmd_compare(cfg, a.run_dirs, a.out)


if __name__ == "__main__":
    main()
