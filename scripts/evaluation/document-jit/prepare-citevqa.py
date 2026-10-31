#!/usr/bin/env python3
"""Bounded public-source acquisition; run from repository root.
Requires annotations.json and pdf_source.csv in the evidence directory.
Eligible: Chinese, single-document, <=25 pages. First 12 unique PDFs in annotation
order are attempted, independent of answers or parser quality. Original publisher
URLs only. No access-control bypass. At most four questions per available PDF.
The initial run acquired 2/12 PDFs and fixed 6 questions BEFORE model execution.
"""
import json,csv,pathlib,urllib.request,hashlib,concurrent.futures
p=pathlib.Path('evidence/jit-public-benchmark-20261031');(p/'pdfs').mkdir(exist_ok=True)
a=json.loads((p/'annotations.json').read_text());rows={r['track_id']:r for r in csv.DictReader((p/'pdf_source.csv').open())}; candidates={}
for q in a:
 ids=[pathlib.Path(x).stem for x in q['PDF_Source']]
 if q['language']=='zh' and len(ids)==1 and ids[0] in rows and int(rows[ids[0]]['page_count'])<=25:candidates.setdefault(ids[0],rows[ids[0]])
 if len(candidates)>=12:break
(p/'download-candidates.json').write_text(json.dumps(list(candidates.values()),ensure_ascii=False,indent=2))
def get(r):
 d=dict(r)
 try:
  req=urllib.request.Request(r['url'],headers={'User-Agent':'Mozilla/5.0'});res=urllib.request.urlopen(req,timeout=18);b=res.read(20000001)
  if not b.startswith(b'%PDF-'):raise ValueError('not_pdf')
  if len(b)>20000000:raise ValueError('size_budget')
  (p/'pdfs'/(r['track_id']+'.pdf')).write_bytes(b);d.update(ok=True,bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),final_url=res.url)
 except Exception as e:d.update(ok=False,error=str(e))
 print(d['track_id'],d['ok'],d.get('error',''),flush=True);return d
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(get,candidates.values()))
(p/'downloads.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))

selected=[]
for d in results:
 if not d['ok']:continue
 selected.extend([q for q in a if q['language']=='zh' and len(q['PDF_Source'])==1 and pathlib.Path(q['PDF_Source'][0]).stem==d['track_id']][:4])
(p/'sample-gold.json').write_text(json.dumps(selected,ensure_ascii=False,indent=2))
