"""Read-only candidate provenance; explicitly NOT a capture of prompt payloads."""
import json,pathlib,hashlib,collections,sys
out=pathlib.Path(sys.argv[1]);raw=out/'raw';records=[json.loads(s) for s in next((out/'source-artifacts').glob('*chunks.jsonl')).read_text().splitlines()]
def stable(prefix,*parts):return prefix+'_'+hashlib.sha256('\x1f'.join(map(str,parts)).encode()).hexdigest()[:20]
result=[]
for p in sorted(raw.glob('*.json')):
 if not p.stem.startswith(('longpdf_','turn_')):continue
 x=json.load(open(p));fixture=json.load(open(raw/('fixture-'+x['conversation_id']+'.json')));doc=stable('doc','6ae73548fbae1de9b1b18ae2',fixture['file_id']);occ=collections.Counter();mapping={}
 for r in records:
  key=r['chunk_id'];mapping[stable('chunk',doc,key,occ[key])]=r;occ[key]+=1
 stages=[]
 for e in x.get('trace_events',[]):
  if e['stage'] not in ['Keyword','BM25','Vector','RRF','Rerank']:continue
  stages.append({'stage':e['stage'],'query_hash':e.get('query_hash'),'hits':[{'rank':i+1,'id':h['id'],'page':h.get('page'),'source_chunk_id':mapping.get(h['id'],{}).get('chunk_id'),'source_block_id':mapping.get(h['id'],{}).get('block_id'),'source_text':mapping.get(h['id'],{}).get('text')} for i,h in enumerate(e.get('hits',[]))]})
 result.append({'id':x['id'],'document_id':doc,'retrieval_stages':stages,'caution':'Source corpus reconstructed by frozen identity algorithm. NOT actual prompt capture; actual tool outputs remain raw. MinerU page indices can cross physical-page boundaries.'})
(out/'candidate-provenance.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
