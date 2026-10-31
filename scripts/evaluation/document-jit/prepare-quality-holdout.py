#!/usr/bin/env python3
"""Frozen acquisition rule for public holdout. Run from real repository root; original CiteVQA evidence required. Does not select based on answers or parser quality."""
import json,csv,pathlib,urllib.request,concurrent.futures,hashlib
base=pathlib.Path('evidence/jit-public-benchmark-20261031');p=pathlib.Path('evidence/jit-quality-20261031');(p/'inputs/pdfs').mkdir(parents=True,exist_ok=True)
a=json.loads((base/'annotations.json').read_text());rs={r['track_id']:r for r in csv.DictReader((base/'pdf_source.csv').open())};existing={pathlib.Path(q['PDF_Source'][0]).stem for q in json.loads((base/'sample-gold.json').read_text())};seen=set();c=[]
for q in a:
 if q['language']!='zh' or len(q['PDF_Source'])!=1:continue
 id=pathlib.Path(q['PDF_Source'][0]).stem;r=rs.get(id)
 if not r or id in seen or id in existing or 'opticsjournal' in r['url']:continue
 seen.add(id)
 if 25<=int(r['page_count'])<=150:c.append(r)
 if len(c)>=15:break
(p/'holdout-candidates.json').write_text(json.dumps(c,ensure_ascii=False,indent=2))
def get(r):
 d=dict(r)
 try:
  res=urllib.request.urlopen(urllib.request.Request(r['url'],headers={'User-Agent':'Mozilla/5.0'}),timeout=20);b=res.read(20000001)
  if not b.startswith(b'%PDF'):raise ValueError('not_pdf')
  if len(b)>20000000:raise ValueError('size_budget')
  (p/'inputs/pdfs'/(r['track_id']+'.pdf')).write_bytes(b);d.update(ok=True,sha256=hashlib.sha256(b).hexdigest(),bytes=len(b))
 except Exception as e:d.update(ok=False,error=str(e))
 print(d['track_id'],d['ok'],d.get('error'),flush=True);return d
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(get,c))
(p/'holdout-downloads.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
# Three/four document split: select longest available plus first three other available in annotation order.
ok=[r for r in results if r['ok']];chosen=([max(ok,key=lambda r:int(r['page_count']))] if ok else [])
chosen+= [r for r in ok if r not in chosen][:3]
qs=[]
for r in chosen:qs.extend([q for q in a if len(q['PDF_Source'])==1 and pathlib.Path(q['PDF_Source'][0]).stem==r['track_id'] and q['language']=='zh'][:2])
(p/'inputs/holdout-gold.json').write_text(json.dumps(qs,ensure_ascii=False,indent=2));(p/'inputs/regression-gold.json').write_bytes((base/'sample-gold.json').read_bytes());(p/'inputs/downloads.json').write_text(json.dumps(results+json.loads((base/'downloads.json').read_text()),ensure_ascii=False,indent=2))
print('fixed holdout',len(qs),[r['track_id'] for r in chosen])
