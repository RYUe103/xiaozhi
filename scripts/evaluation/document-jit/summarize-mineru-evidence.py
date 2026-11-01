import pathlib,json,hashlib,math,statistics,collections,sys
base=pathlib.Path(sys.argv[1])
# Read-only originals; derived reports are written only in this independent run directory.
goldpath=base/'assets-run-1/frozen-gold.original.json';gold=json.loads(goldpath.read_text());g={q['id']:q for q in gold['questions']}
rows=[]
scope_map=json.loads((base/'trace-scope-map.json').read_text()) if (base/'trace-scope-map.json').exists() else {}
events={v:[json.loads(l) for l in (base/v/'events.jsonl').read_text().splitlines()] for v in ['baseline','candidate']}
for variant in ['baseline','candidate']:
 for f in sorted((base/variant).glob('agent-*.json')):
  if 'followup' in f.name:continue
  r=json.loads(f.read_text()); outputs=[];pages=set();actions=collections.Counter();errors=[]
  for t in r.get('tool_calls',[]):
   try:a=json.loads(t.get('args') or '{}') if isinstance(t.get('args'),str) else t.get('args',{});o=json.loads(t.get('output') or '{}') if isinstance(t.get('output'),str) else t.get('output',{})
   except:continue
   actions[str(t.get('name'))+':'+str(a.get('action'))]+=1
   if isinstance(o,dict):
    if o.get('visual_result_id'):outputs.append(o)
    if o.get('error'):errors.append(o['error'])
    for ref in o.get('references',[]):
     if isinstance(ref,dict) and isinstance(ref.get('page_start'),int):pages.add(ref['page_start'])
  unique={o['visual_result_id']:o for o in outputs}
  call_ids={t.get('id') for t in r.get('tool_calls',[])}; scopes={e.get('scope_hash') for e in events[variant] if e.get('tool_call_id') in call_ids and e.get('scope_hash')}; scopes=scopes or {scope_map.get(r.get('conversation_id'))}; scopes.discard(None); trace_ids={e.get('trace_id') for e in events[variant] if e.get('tool_call_id') in call_ids and e.get('trace_id')}; trace_ids=trace_ids or {next((e['trace_id'] for e in events[variant] if e.get('scope_hash') in scopes and e.get('trace_id')),None)}; trace=[e for e in events[variant] if e.get('trace_id') in trace_ids]; vision=[e for e in trace if e.get('stage')=='PageVision']; stage_ms=collections.defaultdict(list)
  for e in trace:
   if isinstance(e.get('elapsed_ms'),(int,float)):stage_ms[e['stage']].append(e['elapsed_ms'])
  rows.append({'variant':variant,'file':f.name,'id':r.get('id'),'gold':g.get(r.get('id'),{}).get('answer'),'elapsed_ms':r.get('elapsed_ms'),'upload_ms':r.get('upload_ms'),'answer':r.get('answer'),'tool_actions':dict(actions),'trace_scope_hashes':sorted(scopes),'trace_stage_elapsed_ms':dict(stage_ms),'page_vision_miss_attempts':sum(e.get('cache')=='miss' for e in vision),'vl_confirmed_responses':sum(e.get('cache')=='miss' and bool(e.get('usage')) for e in vision),'vision_attempts_without_usage':sum(e.get('cache')=='miss' and not e.get('usage') for e in vision),'vl_observed_tokens_lower_bound':sum(e.get('usage',{}).get('total_tokens',0) for e in vision if e.get('cache')=='miss'),'vl_cache_events':dict(collections.Counter(e.get('cache') for e in vision)),'visual_results':len(unique),'visual_tokens_in_unique_outputs':sum(o.get('telemetry',{}).get('usage',{}).get('total_tokens',0) for o in unique.values()),'visual_elapsed_ms_in_unique_outputs':sum(o.get('telemetry',{}).get('elapsed_ms',0) for o in unique.values()),'visual_pages':sorted({o['page'] for o in outputs}),'visual_partial':sum(o.get('status')=='partial' for o in unique.values()),'errors':errors})
quant=lambda v,p: sorted(v)[max(0,math.ceil(len(v)*p)-1)] if v else None
batches=[]
for variant,prefix in [('baseline','agent-batch2-'),('candidate','agent-batch2-'),('candidate','agent-batch3-'),('candidate','agent-batch4-'),('candidate','agent-batch5-'),('candidate','agent-batch6-')]:
 rs=[r for r in rows if r['variant']==variant and r['file'].startswith(prefix)];times=[r['elapsed_ms'] for r in rs if isinstance(r.get('elapsed_ms'),(int,float))];batches.append({'variant':variant,'batch':prefix,'n':len(rs),'p50_ms_nearest_rank':quant(times,.5),'p95_ms_nearest_rank':quant(times,.95),'includes_failures':True,'host_sleep_contaminated':prefix in ['agent-batch3-','agent-batch4-','agent-batch5-'],'not_a_performance_nonregression_test':True,'visual_results':sum(r['visual_results'] for r in rs),'visual_tokens_in_outputs':sum(r['visual_tokens_in_unique_outputs'] for r in rs)})
ids={r['id'] for r in rows};(base/'frozen-question-subset.json').write_text(json.dumps([g[i] for i in g if i in ids],ensure_ascii=False,indent=2))
(base/'ab-run-summary.json').write_text(json.dumps({'gold_sha256':hashlib.sha256(goldpath.read_bytes()).hexdigest(),'measurement_notes':['P50/P95为小样本描述统计，nearest-rank；包含失败，不证明性能非退化','visual_results从实际tool输出去重，不冒充缓存miss次数；调用/命中以events.jsonl为准','全部问题gold原样，判断另存人工验收；不得把分批最佳答案拼为一次结果'],'batches':batches,'runs':rows},ensure_ascii=False,indent=2))
print(json.dumps(batches,ensure_ascii=False))
