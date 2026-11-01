"""Offline diagnostics from actual Agent traces, no extra model calls or changed gold.
Recall is physical-page recall among top-k ranked chunks, NOT fragment sufficiency.
Each actual query is kept; coverage unions across queries are labelled separately.
"""
import json,pathlib,re,sys
base=pathlib.Path(sys.argv[1]);gold={q['id']:q for q in json.loads((base/'frozen-question-subset.json').read_text())};rows=[]
for arm in ['baseline','candidate']:
 folder=base/arm
 scopes=json.loads((folder/'scope-map.json').read_text()) if (folder/'scope-map.json').exists() else {}
 events=[json.loads(l) for l in (folder/'events.jsonl').read_text().splitlines()] if (folder/'events.jsonl').exists() else []
 for p in sorted(folder.glob('r*/*.json')):
  if any(s in p.name for s in ['followup','warm','failure']):continue
  r=json.loads(p.read_text());g=gold[r['id']];expected=set(g.get('physical_evidence_pages',[]));scope=scopes.get(r['conversation_id'],{}).get('scope_hash');trace=[e for e in events if e.get('scope_hash')==scope]
  calls=[];delivered=[]
  for t in r.get('tool_calls',[]):
   try:a=json.loads(t['args']);o=json.loads(t['output'])
   except (ValueError,TypeError,KeyError):continue
   calls.append({'action':a.get('action'),'pages':[h.get('page_start') for h in o.get('hits',[])],'reference':o.get('reference'),'truncated':o.get('truncated'),'error':o.get('error')})
   delivered.append(o.get('content',''))
  channels={}
  for stage in ['Keyword','BM25','Vector','RRF','Rerank']:
   searches=[e for e in trace if e.get('stage')==stage and 'hits' in e];channels[stage]=[]
   for e in searches:
    pages=[h.get('page') for h in e['hits']]
    channels[stage].append({'query_hash':e.get('query_hash'),'trace_id':e.get('trace_id'),'recall_at_6':len(expected&set(pages[:6]))/len(expected) if expected else None,'recall_at_10':len(expected&set(pages[:10]))/len(expected) if expected else None,'top10_pages':pages[:10],'warnings':e.get('warnings')})
  normalize=lambda s:re.sub(r'\s+','',s)
  text=normalize('\n'.join(delivered));fragments=[{'type':e.get('type'),'source_page':e.get('source_page_id'),'exact_normalized_fragment_delivered':normalize(e['content']) in text} for e in g.get('evidence',[]) if e.get('content')]
  rows.append({'arm':arm,'batch':p.parent.name,'case':p.stem,'expected_physical_pages':sorted(expected),'channels':channels,'tool_evidence':calls,'frozen_text_fragments':fragments,'notes':['Trace may include followup; each query retained. No search means recall not applicable, not zero.','Exact fragment checks can miss equivalent OCR; cannot assess visual truth.','Alternative valid pages (e.g. duplicate financial table) need source adjudication.']})
(base/'retrieval-metrics.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2));print('runs',len(rows))
