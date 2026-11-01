"""Summarize immutable tool-audit runs. No gold or inference output edits."""
import collections
import hashlib
import json
import math
from pathlib import Path

root = Path(__file__).resolve().parents[3]
evidence = root / "evidence/agent-tools-refactor-20261102"
usage = json.loads((evidence / "performance/usage-export.json").read_text())
accounting = {r["batch"]: r for r in usage["results"]}
versions = {"r1": "0198c13", "r2": "a3d057b", "r3": "27df227"}
def quantile(values, q):
    values = sorted(values)
    pos = (len(values) - 1) * q
    return round(values[math.floor(pos)] + (values[math.ceil(pos)] - values[math.floor(pos)]) * (pos % 1), 3)
summary = {}
for batch, sha in versions.items():
    turns = []
    for file in sorted((evidence / "multiturn" / batch).glob("turn_*.json")):
        run = json.loads(file.read_text())
        trace = run.get("trace_events", [])
        stages = collections.defaultdict(float)
        for event in trace:
            if isinstance(event.get("elapsed_ms"), (int, float)):
                stages[event["stage"]] += event["elapsed_ms"]
        records = [r for r in accounting[batch]["records"] if r.get("messageId") == run.get("message_id")]
        counts = {kind: sum(abs(r.get("rawAmount", 0)) for r in records if r["tokenType"] == kind) for kind in ["prompt", "completion"]}
        turns.append({"id": run["id"], "completed": run["completed"], "elapsed_ms": run["elapsed_ms"],
            "tool_calls": len(run["tools"]), "tool_names": [t["name"] for t in run["tools"]],
            "actions": [json.loads(t["args"]).get("action") for t in run["tools"]],
            "model_transport_completed": sum(e.get("stage") == "ModelTransport" and e.get("phase") == "complete" for e in trace),
            "vl_tool_calls": sum("inspect_page" in t.get("args", "") for t in run["tools"]),
            "stage_ms": dict(stages), "main_model_accounting_tokens": counts if records else None,
            "trace_usage_tokens": sum(e.get("usage", {}).get("total_tokens", 0) for e in trace),
            "tool_not_found": any("not found" in t.get("output", "").lower() and "tool" in t.get("output", "").lower() for t in run["tools"])})
    summary[batch] = {"sha": sha, "n": len(turns), "completed": sum(t["completed"] for t in turns),
        "p50_ms": quantile([t["elapsed_ms"] for t in turns], .5), "p95_ms": quantile([t["elapsed_ms"] for t in turns], .95),
        "total_ms": sum(t["elapsed_ms"] for t in turns), "tool_calls": sum(t["tool_calls"] for t in turns),
        "main_model_accounting_tokens": {k: sum((t["main_model_accounting_tokens"] or {}).get(k, 0) for t in turns) for k in ["prompt", "completion"]},
        "turns": turns}
(evidence / "performance/metrics.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
(evidence / "tool-registry").mkdir(exist_ok=True)
(evidence / "tool-registry/r3.json").write_text(json.dumps(accounting["r3"]["directory_snapshots"], ensure_ascii=False, indent=2))
print(json.dumps({k: {a: b for a, b in v.items() if a != "turns"} for k, v in summary.items()}, ensure_ascii=False, indent=2))
