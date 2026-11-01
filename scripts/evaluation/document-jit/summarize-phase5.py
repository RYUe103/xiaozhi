"""Descriptive results only: automatic core checks never replace source adjudication."""
import json, pathlib, math, collections, sys, datetime
base=pathlib.Path(sys.argv[1])
read=lambda p:json.loads(p.read_text())
quant=lambda a,q:sorted(a)[max(0,math.ceil(len(a)*q)-1)] if a else None
rows=[]
for arm in ['baseline','candidate']:
 folder=base/arm
 if not folder.exists():continue
 events=[json.loads(s) for s in (folder/'events.jsonl').read_text().splitlines()] if (folder/'events.jsonl').exists() else []
 scopes=read(folder/'scope-map.json') if (folder/'scope-map.json').exists() else {}
 for path in sorted(folder.glob('r*/*.json')):
  if '.followup.' in path.name or '.warm.' in path.name:continue
  result=read(path)
  if path.name.endswith('.failure.json'):
   rows.append({'arm':arm,'batch':path.parent.name,'case':path.name.replace('.json.failure.json',''),'id':result.get('id'),'completed':False,'error':result.get('error')});continue
  conv=scopes.get(result.get('conversation_id'),{})
  scope=result.get('scope_hash') or conv.get('scope_hash')
  trace=[e for e in events if e.get('scope_hash')==scope]
  timing=result.get('message_metadata',{}).get('sansuoProcessTiming',{})
  stamp=lambda v: datetime.datetime.fromisoformat(v.replace('Z','+00:00')).timestamp()*1000 if v else None
  end=stamp(timing.get('completedAt'));start=stamp(timing.get('startedAt'))
  initial_trace=[e for e in trace if end is not None and start is not None and start-1000 <= (e.get('at') or stamp(e.get('export_log_time_utc')) or 0) <= end+1000]
  calls=[];errors=[];visual=[];tool_pages=set()
  for tool in result.get('tool_calls',[]):
   try:
    args=json.loads(tool.get('args','{}')) if isinstance(tool.get('args'),str) else tool.get('args',{})
    out=json.loads(tool.get('output','{}')) if isinstance(tool.get('output'),str) else tool.get('output',{})
   except (ValueError,TypeError):continue
   calls.append(args.get('action',tool.get('name')))
   if out.get('error'):errors.append(out['error'])
   if args.get('action')=='inspect_page':visual.append(out)
   for ref in [out.get('reference',{})]+out.get('references',[]):
    if isinstance(ref,dict) and isinstance(ref.get('page_start'),int):tool_pages.update(range(ref['page_start'],ref.get('page_end',ref['page_start'])+1))
  answer=result.get('answer','')
  failure=result.get('message_error') or result.get('message_metadata',{}).get('sansuoModelFailure') or result.get('error_parts')
  warm_path=path.with_name(path.name+'.warm.json');warm=read(warm_path) if warm_path.exists() else None
  stage_ms=collections.Counter()
  for event in trace:
   if isinstance(event.get('elapsed_ms'),(int,float)):stage_ms[event['stage']]+=event['elapsed_ms']
  vision_events=[e for e in trace if e.get('stage')=='PageVision']
  rows.append({'arm':arm,'batch':path.parent.name,'case':path.stem,'id':result.get('id'),'completed':bool(answer.strip()) and not bool(failure),'elapsed_ms':result.get('elapsed_ms'),'upload_ms':result.get('upload_ms'),'answer':answer,'failure':failure,'model_tokens_initial':sum((e.get('usage') or {}).get('total_tokens',0) for e in initial_trace if e.get('stage')=='ModelEnd'),'model_calls_initial':sum(e.get('stage')=='ModelEnd' for e in initial_trace),'rerank_tokens_initial':sum((e.get('usage') or {}).get('total_tokens',0) for e in initial_trace if e.get('stage')=='Rerank'),'vector_events_initial':[{'usage':e.get('usage'),'warnings':e.get('warnings'),'elapsed_ms':e.get('elapsed_ms')} for e in initial_trace if e.get('stage')=='Vector'],'tool_actions':dict(collections.Counter(calls)),'errors':errors,'visual_attempts_in_initial_tools':len(visual),'visual_statuses':dict(collections.Counter(o.get('status') for o in visual)),'visual_tokens_initial_lower_bound':sum((o.get('telemetry',{}).get('usage') or {}).get('total_tokens',0) for o in visual),'tool_reference_pages':sorted(tool_pages),'stage_elapsed_ms_with_followup':dict(stage_ms),'model_retry_events_with_followup':[e for e in trace if e.get('stage')=='ModelTransport' and e.get('retry')],'visual_cache_hits_with_followup':sum(e.get('cache') in ['hit','persistent_hit'] for e in vision_events),'warm_ms':warm.get('elapsed_ms') if warm else None,'warm_answer':warm.get('answer') if warm else None,'scope_hash':scope})
batches=[]
for arm,batch in sorted({(r['arm'],r['batch']) for r in rows}):
 group=[r for r in rows if r['arm']==arm and r['batch']==batch];times=[r['elapsed_ms'] for r in group if r.get('elapsed_ms') is not None]
 batches.append({'arm':arm,'batch':batch,'n':len(group),'completed':sum(r['completed'] for r in group),'p50_ms':quant(times,.5),'p95_ms':quant(times,.95),'includes_failed_runs':True,'quantile':'nearest-rank; descriptive small sample, not SLA'})
(base/'summary.json').write_text(json.dumps({'batches':batches,'runs':rows,'notes':['Answers and historical failures preserved; accuracy requires separate frozen-gold/source adjudication.','Stage totals may include followup and overlap; do not add them together.','No pooling best answers across snapshots.']},ensure_ascii=False,indent=2))
print(json.dumps(batches,ensure_ascii=False))
