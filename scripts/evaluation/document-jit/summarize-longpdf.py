"""Summarize real outputs; semantic ratings must come from separate source reviews, never string matching."""
import json,pathlib,collections,statistics,sys,math,re
out=pathlib.Path(sys.argv[1]);raw=out/'raw'; reviews=json.load(open(out/'source-reviews.json')) if (out/'source-reviews.json').exists() else {}
questions={q['id']:q for name in ['questions.json','multiturn-questions.json'] for q in json.load(open(out/name))}
transactions=json.load(open(raw/'token-transactions.json')) if (raw/'token-transactions.json').exists() else []
rows=[]
for p in sorted(raw.glob('*.json')):
 if not p.stem.startswith(('longpdf_','turn_')):continue
 x=json.load(open(p));q=questions[x['id']];events=x.get('trace_events',[]);stage=collections.defaultdict(list)
 for e in events:
  if isinstance(e.get('elapsed_ms'),(int,float)):stage[e['stage']].append(e['elapsed_ms'])
 vector=[e.get('usage',{}) for e in events if e['stage']=='Vector'];main=[e for e in events if e['stage']=='ModelEnd'];visions=[e for e in events if 'Vision' in e['stage']]
 # Vector usage is cumulative within each request; do not sum snapshots.
 tools=x.get('tools',[]);pages=set();outputs=[]
 for t in tools:
  try:o=json.loads(t.get('output',''));outputs.append(o)
  except:continue
  for z in o.get('references',[]):
   if isinstance(z,dict) and isinstance(z.get('page'),int):pages.add(z['page'])
  pages.update(int(n) for n in re.findall(r'page=(\d+)',o.get('content','')))
 delivery=[e for e in events if e['stage']=='EvidenceDelivery'];delivered=sorted(set(p for e in delivery for p in e.get('pages',[]) if isinstance(p,int)))
 rating=reviews.get(x['id'],{'rating':'待来源复核'})
 billing=[t for t in transactions if t.get('messageId')==x.get('message_id')]
 billed_prompt=sum(abs(t.get('rawAmount',0)) for t in billing if t.get('tokenType')=='prompt');billed_completion=sum(abs(t.get('rawAmount',0)) for t in billing if t.get('tokenType')=='completion')
 rows.append({**{k:x.get(k) for k in ['id','question','answer','completed','elapsed_ms','conversation_id','message_id','parent_message_id','error','model_failure','harness_error']},'category':q.get('category','multiturn'),'gold_status':q['verification_status'],'required_pages':q['evidence_pages'],'reference_answer':q['reference_answer'],'review':rating,'formal_human_reviewed':False,'tool_calls':len(tools),'tool_names':dict(collections.Counter(t.get('name') for t in tools)),'delivered_pages':delivered,'tool_output_pages':sorted(pages),'stage_elapsed_ms':dict(stage),'main_model_calls':max(len(main),sum(e['stage']=='ModelTransport' and e.get('phase')=='headers' for e in events)),'completed_model_calls':len(main),'token_usage_complete':not bool(x.get('model_failure')),'main_model_tokens':sum((e.get('usage') or {}).get('total_tokens',0) for e in main),'embedding_calls':max([u.get('calls',0) for u in vector] or [0]),'embedding_tokens':max([u.get('total_tokens',0) for u in vector] or [0]),'query_processor_tokens':sum((e.get('usage') or {}).get('total_tokens',0) for e in events if e['stage']=='QueryProcessor'),'reranker_tokens':sum((e.get('usage') or {}).get('total_tokens',0) for e in events if e['stage']=='Rerank'),'vision_tool_calls':sum(t.get('name')=='inspect_page' or ('inspect_page' in str(t.get('args',''))) for t in tools),'vision_events':visions,'document_reference_restored':[e for e in events if e['stage']=='DocumentReferenceRestored'],'warnings':[e for e in events if e.get('warnings')],'parse_job_after':x.get('parse_job_after'),'billed_prompt_tokens':billed_prompt,'billed_completion_tokens':billed_completion,'billing_note':'Persisted application accounting, not guaranteed provider invoice; timeout completion can be failure-message token estimate','raw_file':'raw/'+p.name})
def quant(vals,p):
 if not vals:return None
 a=sorted(vals);i=(len(a)-1)*p;lo=math.floor(i);hi=math.ceil(i);return round(a[lo]*(hi-i)+a[hi]*(i-lo),3) if hi!=lo else a[lo]
def latency(a):
 vals=[r['elapsed_ms']/1000 for r in a];return {'n':len(vals),'mean_s':statistics.mean(vals) if vals else None,'p50_s':quant(vals,.5),'p90_s':quant(vals,.9),'p95_s':quant(vals,.95),'min_s':min(vals) if vals else None,'max_s':max(vals) if vals else None,'main_calls':sum(r['main_model_calls'] for r in a),'main_tokens_trace_lower_bound':sum(r['main_model_tokens'] for r in a),'billed_prompt_tokens':sum(r['billed_prompt_tokens'] for r in a),'billed_completion_tokens':sum(r['billed_completion_tokens'] for r in a),'embedding_calls':sum(r['embedding_calls'] for r in a),'embedding_tokens':sum(r['embedding_tokens'] for r in a),'tool_calls':sum(r['tool_calls'] for r in a),'vision_tool_calls':sum(r['vision_tool_calls'] for r in a)}
def acc(a):
 verified=[r for r in a if r['gold_status']!='pending' and r['review'].get('eligible_ai_accuracy',True)];return {'run':len(a),'completed':sum(bool(r['completed']) for r in a),'ratings':dict(collections.Counter(r['review']['rating'] for r in a)),'formal_human_verified_denominator':0,'formal_accuracy':None,'ai_image_reviewed_denominator':len(verified),'ai_provisional_full_correct':sum(r['review']['rating']=='完全正确' for r in verified),'ai_provisional_core_correct':sum(bool(r['review'].get('core_correct')) for r in verified),'ai_provisional_complete':sum(bool(r['review'].get('complete')) for r in verified),'ai_provisional_hallucinations':sum(bool(r['review'].get('hallucination')) for r in verified),'pending_excluded':len(a)-len(verified),'citation_ratings':dict(collections.Counter(r['review'].get('citation','待复核') for r in a))}
ind=[r for r in rows if r['id'].startswith('longpdf_')];mt=[r for r in rows if r['id'].startswith('turn_')]
for name,value in [('independent-results.json',ind),('multiturn-results.json',mt),('accuracy-summary.json',{'independent':acc(ind),'cross_page':acc([r for r in ind if r['category']=='cross_page']),'multiturn':acc(mt),'grading':'AI逐题来源复核暂评；独立人工复核待完成。pending不入准确率分母。'}),('latency-summary.json',{'independent':latency(ind),'multiturn':latency(mt),'note':'已解析资产；独立题新授权绑定造成冷向量索引；同会话追问另列。分位数为线性插值描述统计，非SLA。未完成请求亦保留。'})]:
 (out/name).write_text(json.dumps(value,ensure_ascii=False,indent=2))
print(len(ind),len(mt))
