#!/usr/bin/env python3
"""Classify only persisted actual tool deliveries, without inventing initial context."""
import collections,hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]);g=json.loads((p/'inference-manifest.json').read_text());out=[]
def obj(x):
 if isinstance(x,dict):return x
 try:return json.loads(x)
 except (ValueError,TypeError):return {}
for q in g['questions']:
 f=p/'results'/(q['id'].replace(':','_')+'.json');r=json.loads(f.read_text()) if f.exists() else {};calls=[]
 for i,t in enumerate(r.get('tool_calls',[])):
  o=obj(t.get('output'));args=obj(t.get('args'));content=o.get('content','') if isinstance(o,dict) else '';hits=o.get('hits',[]) if isinstance(o,dict) else []
  if not isinstance(content,str):content=json.dumps(content,ensure_ascii=False)
  calls.append(dict(index=i,tool=t.get('name'),action=args.get('action'),requested_pages=args.get('pages'),status=o.get('status'),error=o.get('error'),document_id=o.get('document_id'),version=o.get('version'),content_chars=len(content),content_sha256=hashlib.sha256(content.encode()).hexdigest(),evidence_hits=[{k:h[k] for k in ['chunk_id','page_start','page_end','kind','engine','table_ids'] if k in h} for h in hits if isinstance(h,dict)],page_coverage=o.get('page_coverage'),truncated=o.get('truncated'),continuation_available=bool(o.get('continuation_token')),raw_result=str(f.relative_to(p))))
 kinds=collections.Counter(h.get('kind','unknown') for c in calls for h in c['evidence_hits']);engines=sorted(set(h.get('engine','unknown') for c in calls for h in c['evidence_hits']))
 out.append(dict(id=q['id'],state=r.get('state','not_attempted'),actual_tool_deliveries=calls,evidence_kind_counts=dict(kinds),engines_observed=engines,real_ocr_observed=False,real_ocr_reason='This run rejected local MinerU mock and used FITZ/VL; visual_summary is not OCR.',initial_context_completeness='Full initial visual injection not persisted; EvidenceDelivery telemetry is page-level only. Do not substitute entire visual index.',actual_content_location='Exact saved content remains in referenced raw result tool_calls[].output; hashes/counts here avoid duplication.'))
(p/'evidence-delivery-audit.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps(dict(questions=len(out),questions_with_tool_evidence=sum(any(c['content_chars']>0 for c in x['actual_tool_deliveries']) for x in out),kind_counts=dict(sum((collections.Counter(x['evidence_kind_counts']) for x in out),collections.Counter())))))
