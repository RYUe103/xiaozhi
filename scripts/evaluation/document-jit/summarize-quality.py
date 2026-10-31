"""Offline source review + reproducible all-case metrics. Never imported by retrieval/inference.

Preserves frozen gold and raw one-shot model judgements. Source review is by the coding
agent, not an independent human assessment. It corrects both favorable and unfavorable
judge errors; explicit rules and reasons remain in a separate artifact.
"""
import hashlib
import json
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

root = Path(sys.argv[1])
profiles = ["baseline", "normalization-control", "retrieval", "delivery-initial", "full", "budgeted"]
load = lambda name: json.loads((root / name).read_text())
write = lambda name, value: (root / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
raw = load("judgements.json")["reviews"] + load("judgements-budgeted.json")["reviews"]
judges = {(r["profile"], r["id"]): r for r in raw}
normalize = lambda s: re.sub(r"\s+", "", s)
annual = load("inputs/e3e6d6ed-77ba-5053-8147-20137ae9a88b.parsed.json")
firm_pages = [p["page"] for p in annual["pages"] if "中汇会计师事务所" in normalize(p["text"])]
assert firm_pages == [4, 5, 8, 42, 44]
reviews, metrics, cases = [], [], []
for profile in profiles:
    tasks = load(profile + ".json")["tasks"]
    for t in tasks:
        j = judges[(profile, t["id"])]
        correct, wrong = j.get("core_answer_correct"), j.get("unsupported_citation")
        reason, source_pages = "Source review agrees with the raw core/citation finding.", t["gold_pages"]
        # Evaluation-only source adjudications, never runtime answer/ranking rules.
        if t["id"] == "e3e6d6ed-77ba-5053-8147-20137ae9a88b_8":
            source_pages = firm_pages
            correct = profile != "budgeted"
            wrong = profile == "budgeted"
            reason = ("Original annotation lists 5/42 only; actual physical pages 4/5/8/42/44 all contain the institution. "
                      "All original annotations remain unchanged. Budgeted answer omits page 5 and invents page 17.")
        elif t["id"] == "509b2bc6-5957-553b-a80e-482790f96ba7_1":
            correct, wrong = True, False
            reason = "Address and legal representative match physical page 2; an additional correct institution name does not invalidate extraction."
        elif t["id"] == "509b2bc6-5957-553b-a80e-482790f96ba7_4":
            correct = profile in ("delivery-initial", "full")
            wrong = False
            source_pages = [10, 21]
            reason = ("Require all three requested duties: records, original contracts, holder registers. Page 10 explicitly "
                      "requires each party to hold an original contract for >=15 years. Baseline/retrieval/normalization/budgeted "
                      "omit this contract duty although the raw judge sometimes passes them. Page 21 limits the >=20-year "
                      "statement explicitly to the registrar; do not impose a broader interpretation from the reference answer.")
        elif j.get("error") == "JUDGE_INVALID_JSON":
            correct, wrong = True, False
            source_pages = [42, 43]
            reason = "Raw judge response truncated/invalid, retained as such. Source review confirms unqualified opinion and receivables impairment; revenue recognition is another real source item, not an invented citation."
        if not t.get("answer"):
            correct, wrong, reason = False, False, "No final answer within the frozen eight-model-round budget; counted as failure, not retried."
        review = dict(profile=profile, id=t["id"], core_answer_correct=correct,
                      unsupported_citation=wrong, source_pages=source_pages, reason=reason,
                      raw_judge_correct=j.get("core_answer_correct"), raw_judge_wrong_citation=j.get("unsupported_citation"),
                      raw_judge_error=j.get("error"), changed=correct != j.get("core_answer_correct") or wrong != j.get("unsupported_citation"))
        reviews.append(review)
        usages = [t["usage"], t.get("query_processor_usage", {}), t.get("reranker_usage", {})]
        inp = sum(u.get("prompt_tokens", 0) for u in usages)
        out = sum(u.get("completion_tokens", 0) for u in usages)
        stages = defaultdict(list)
        for e in t.get("telemetry", []):
            if "elapsed_ms" in e:
                stages[e["stage"]].append(e["elapsed_ms"])
        # Keyword and BM25 share a lexical pass, EvidenceDelivery nests other stages.
        # Stage durations describe attribution and must not be added as disjoint wall time.
        case = dict(profile=profile, split=t["split"], id=t["id"], **t["metrics"],
                    core_answer_correct=correct, unsupported_citation=wrong,
                    raw_judge_correct=j.get("core_answer_correct"), raw_judge_wrong_citation=j.get("unsupported_citation"),
                    missing_final=not bool(t.get("answer")), finish_reason=t.get("finish_reason"),
                    main_tokens=t["usage"]["total_tokens"], query_tokens=usages[1].get("total_tokens", 0),
                    rerank_tokens=usages[2].get("total_tokens", 0), chat_input_tokens=inp, chat_output_tokens=out,
                    chat_total_tokens=inp + out, embedding_tokens=t.get("embedding_usage", {}).get("total_tokens", 0),
                    elapsed_ms=t["elapsed_ms"], stages_ms={s: sum(v) for s, v in stages.items()},
                    estimated_cny=(inp * 2 + out * 12 + t.get("embedding_usage", {}).get("total_tokens", 0) * .5) / 1e6)
        cases.append(case)
    for split in ("regression", "holdout"):
        rows = [c for c in cases if c["profile"] == profile and c["split"] == split]
        n = len(rows)
        m = dict(profile=profile, split=split, n=n,
                 fixed_retrieval_page_recall_at_6=statistics.mean(c["fixed_page_recall_at_6"] for c in rows),
                 annotated_page_delivery_rate=sum(c["all_pages_delivered"] for c in rows) / n,
                 core_correct_count=sum(c["core_answer_correct"] is True for c in rows),
                 core_accuracy=sum(c["core_answer_correct"] is True for c in rows) / n,
                 raw_judge_correct_count=sum(c["raw_judge_correct"] is True for c in rows),
                 raw_judge_unknown=sum(c["raw_judge_correct"] is None for c in rows),
                 answers_with_wrong_citation=sum(c["unsupported_citation"] is True for c in rows),
                 wrong_citation_rate_per_task=sum(c["unsupported_citation"] is True for c in rows) / n,
                 missing_final=sum(c["missing_final"] for c in rows),
                 tools=sum(c["tool_calls"] for c in rows),
                 mean_latency_ms=statistics.mean(c["elapsed_ms"] for c in rows),
                 p50_latency_ms=statistics.median(c["elapsed_ms"] for c in rows))
        for k in ("main_tokens", "query_tokens", "rerank_tokens", "chat_total_tokens", "chat_input_tokens", "chat_output_tokens", "embedding_tokens", "estimated_cny"):
            m[k] = sum(c[k] for c in rows)
        for stage in sorted({s for c in rows for s in c["stages_ms"]}):
            m.setdefault("mean_stage_ms", {})[stage] = statistics.mean(c["stages_ms"].get(stage, 0) for c in rows)
        metrics.append(m)

write("source-adjudication.json", {"method": "Coding-agent source review, NOT independent human labels. Both favorable and unfavorable raw judge errors corrected; original gold/answers/judgements untouched.", "reviews": reviews})
write("metrics.json", {"notes": ["Recall/delivery are physical-page proxies, not bbox/SAA or complete-fact guarantees.", "Wrong citation is per task with an unsupported cited core fact, not per citation. No-answer tasks separately fail accuracy.", "Core accuracy allows correct extra context; unsupported currency/extra section titles remain grounding warnings.", "Latencies include cold indexing and fixed-query probe; profiles had network/concurrency differences. No causal speed claim.", "Costs are public list-price estimates, not actual invoices."], "aggregate": metrics, "cases": cases})
lines = ["| 版本 | 集合 | Recall@6 | 标注页交付 | 核心正确 | 错引题 | 无最终答案 | 工具数 | P50秒 | 主模型Token | 辅助Token |",
         "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
for m in metrics:
    lines.append(f'| {m["profile"]} | {m["split"]} | {m["fixed_retrieval_page_recall_at_6"]:.1%} | {m["annotated_page_delivery_rate"]:.1%} | {m["core_correct_count"]}/{m["n"]} | {m["answers_with_wrong_citation"]} | {m["missing_final"]} | {m["tools"]} | {m["p50_latency_ms"]/1000:.2f} | {m["main_tokens"]} | {m["query_tokens"]+m["rerank_tokens"]} |')
(root / "metrics-table.md").write_text("\n".join(lines) + "\n")
print("\n".join(lines))
