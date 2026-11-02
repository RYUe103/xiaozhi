"""Summarize preserved runs; no inference calls and no edits to frozen gold.

Usage: python3 summarize-fixed-retrieval-batch.py RUN_DIR QUESTIONS_JSON OUTPUT
Page coverage is a proxy, never fragment recall or answer accuracy.
"""
import collections
import json
import math
import sys
from pathlib import Path


def percentile(values, p):
    values = sorted(values)
    if not values:
        return None
    x = (len(values) - 1) * p
    lo, hi = math.floor(x), math.ceil(x)
    return values[lo] + (values[hi] - values[lo]) * (x - lo)


def coverage(expected, actual):
    return len(expected & actual) / len(expected) if expected else None


directory, questions, output = map(Path, sys.argv[1:])
gold = {q['id']: q for q in json.loads(questions.read_text())}
rows = []
for path in sorted(directory.glob('*.json')):
    run = json.loads(path.read_text())
    if run.get('id') not in gold:
        continue
    events = run.get('trace_events', [])
    expected = set(gold[run['id']]['evidence_pages'])
    stages = collections.defaultdict(lambda: {'events': 0, 'reported_elapsed_ms': 0})
    pages = collections.defaultdict(set)
    warnings = []
    for event in events:
        stage = event.get('stage', 'unknown')
        stages[stage]['events'] += 1
        stages[stage]['reported_elapsed_ms'] += event.get('elapsed_ms', 0)
        if event.get('warning'):
            warnings.append(event['warning'])
        warnings.extend(event.get('warnings', []))
        if stage in ('BM25', 'Vector'):
            for k in (20, 40, 60):
                pages[stage + '@' + str(k)].update(h.get('page') for h in event.get('hits', [])[:k])
        if stage == 'RRF':
            pages['rerank_input'].update(h.get('page') for h in event.get('hits', []))
        if stage == 'EvidenceDelivery':
            pages['delivery'].update(event.get('pages', []))
    # Vector usage is cumulative per Repository/request. Never sum every event.
    vector = [e['usage'] for e in events if e.get('stage') == 'Vector' and 'usage' in e]
    rerank = [e['usage'] for e in events if e.get('stage') == 'Rerank' and 'usage' in e]
    rows.append({
        'id': run['id'], 'completed': run.get('completed', False),
        'elapsed_ms': run['elapsed_ms'], 'tools': len(run.get('tools', [])),
        'vl_calls': sum(e.get('stage') == 'PageVision' for e in events),
        'model_transport_headers_received': sum(e.get('stage') == 'ModelTransport' and e.get('phase') == 'headers' for e in events),
        'model_failure': run.get('model_failure') or run.get('harness_error'),
        'stages': dict(stages), 'warnings': warnings,
        'vector_usage_request_max': {k: max(u.get(k, 0) for u in vector) for k in ('calls', 'chars', 'total_tokens')} if vector else None,
        'rerank_success_usage': {k: sum(u.get(k, 0) for u in rerank) for k in ('prompt_tokens', 'completion_tokens', 'total_tokens')} if rerank else None,
        'main_model_usage': None,
        'page_coverage_proxy': {k: coverage(expected, v) for k, v in pages.items()},
        'fragment_recall': None, 'answer_accuracy': None, 'citation_accuracy': None,
    })
times = [r['elapsed_ms'] for r in rows]
report = {
    'method': 'linear interpolation; all questions including failures; no best-answer mixing',
    'limits': [
        'Page coverage unions all query variants and tool calls; not fragment recall.',
        'Trace stages overlap (Keyword/BM25 and EvidenceDelivery); do not sum them as wall time.',
        'RRF page coverage approximates rerank input; model skip/failure is separate.',
        'Main model usage comes from separate application transaction export; unknown is not zero.',
        'Failed rerank usage may be absent from trace; success usage is a lower bound.',
        'Cache hit counts are not instrumented; no numeric hit rate is invented.',
    ],
    'total': len(rows), 'completed': sum(r['completed'] for r in rows),
    'p50_ms': percentile(times, .5), 'p95_ms': percentile(times, .95),
    'rows': rows,
}
with output.open('x') as file:
    json.dump(report, file, ensure_ascii=False, indent=2)
print(json.dumps({k: report[k] for k in ('total', 'completed', 'p50_ms', 'p95_ms')}))
