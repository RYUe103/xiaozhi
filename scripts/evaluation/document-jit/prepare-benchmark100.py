#!/usr/bin/env python3
"""Answer-blind metadata sampling, authorized acquisition, immutable pre-inference lock.
No PDF text or model output participates in selection. Failed downloads stay selected.
"""
import ast, collections, concurrent.futures, csv, hashlib, io, json, pathlib, struct, urllib.request, zipfile, zlib

ROOT = pathlib.Path('evidence/jit-benchmark-100-20261031')
SRC = ROOT / 'sources'
SEED = 'sansuo-public-jit-20261031-v1'
TARGET = dict(exact=25, table=20, cross_page=15, visual=15, long=15, unanswerable=10)
def sha(b): return hashlib.sha256(b).hexdigest()
def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
def order(s): return sha((SEED + s).encode())
def pages(v):
    if isinstance(v, str): v = ast.literal_eval(v)
    return sorted(set(v if isinstance(v, list) else [v]))
def get(url, limit=100000000):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'SanSuoResearchBenchmark/1.0'}), timeout=60) as r:
        b=r.read(limit+1)
        if len(b)>limit: raise ValueError('ACQUISITION_SIZE_LIMIT')
        return b

def select():
    if (ROOT/'selection.json').exists(): return json.loads((ROOT/'selection.json').read_text())
    old=pathlib.Path('evidence/jit-quality-20261031/inputs')
    regression=[q for s in ['regression','holdout'] for q in json.loads((old/(s+'-gold.json')).read_text())]
    excluded={pathlib.Path(q['PDF_Source'][0]).stem for q in regression}
    write(ROOT/'regression-original-14.json',regression)
    csvrows={r['track_id']:r for r in csv.DictReader(open('evidence/jit-public-benchmark-20261031/pdf_source.csv'))}
    groups=collections.defaultdict(list); meta={}
    for q in json.load(open('evidence/jit-public-benchmark-20261031/annotations.json')):
        if len(q['PDF_Source'])!=1 or q['language']!='zh': continue
        d=pathlib.Path(q['PDF_Source'][0]).stem;r=csvrows.get(d)
        if not r or d in excluded or not 20<=int(r['page_count'])<=180: continue
        ev=[e for e in q['Evidence'] if e['necessity']=='necessary']; ps=sorted(set(e['source_page_id'] for e in ev))
        types={e['type'] for e in ev}
        cat='cross_page' if len(ps)>1 else 'table' if 'table' in types else 'visual' if any(t in types for t in ['image','figure','chart']) else 'long' if int(r['page_count'])>=80 else 'exact'
        key='citevqa:'+d
        groups[key].append(dict(id='citevqa:'+q['index'],question=q['Question'],answer=q['Standard_Answer'],evidence_pages=ps,evidence=ev,category=cat,original=q))
        meta[key]=dict(dataset='CiteVQA',source_id=d,filename=d+'.pdf',url=r['url'],declared_pages=int(r['page_count']),language='zh',domain=r['sub_domain_label_en'])
    for i,q in enumerate(json.load(open(SRC/'mml-qas.json'))):
        d=q['doc_id']; key='mml:'+d; ps=pages(q['evidence_pages']); es=ast.literal_eval(q['evidence_sources'])
        cat='unanswerable' if q['answer']=='Not answerable' else 'cross_page' if len(ps)>1 else 'table' if 'Table' in es else 'visual' if any(t in es for t in ['Figure','Chart']) else 'long'
        groups[key].append(dict(id='mml:'+str(i),question=q['question'],answer=q['answer'],evidence_pages=ps,evidence_sources=es,category=cat,original=q))
        meta[key]=dict(dataset='MMLongBench-Doc',source_id=d,filename=d,url='https://huggingface.co/datasets/yubo2333/MMLongBench-Doc/resolve/2ff6aa9237fc777b6627dc57a486e9225ac5fb86/documents/'+urllib.parse.quote(d),language='en',domain=q['doc_type'])
    for q in json.load(open(SRC/'ohr-qas.json')):
        d=q['doc_name'];key='ohr:'+d;ps=pages(q['evidence_page_no'])
        cat='cross_page' if len(ps)>1 else 'table' if q['evidence_source']=='table' else 'visual' if q['evidence_source'] in ['chart','figure','image'] else 'exact'
        groups[key].append(dict(id='ohr:'+q['ID'],question=q['questions'],answer=q['answers'],evidence_pages=ps,evidence_sources=[q['evidence_source']],evidence_context=q['evidence_context'],category=cat,original=q))
        meta[key]=dict(dataset='OHR-Bench',source_id=d,filename=d.replace('/','--')+'.pdf',zip_member=d+'.pdf',language='en',domain=q['doc_type'])
    selected=[]; counts=collections.Counter()
    # Source mix and document count are fixed in advance. Localized original questions are
    # chosen by category deficit, with SHA256 tie-breaks independent of answer contents.
    for source,n in [('citevqa',8),('ohr',5),('mml',12)]:
        eligible={k:v for k,v in groups.items() if k.startswith(source+':') and len(v)>=4}
        for _ in range(n):
            options=[]
            for k,qs in eligible.items():
                tmp=counts.copy();chosen=[]
                for __ in range(4):
                    available=[q for q in qs if q not in chosen]
                    q=min(available,key=lambda q:(-(TARGET[q['category']]-tmp[q['category']])/TARGET[q['category']],order(q['id'])))
                    chosen.append(q);tmp[q['category']]+=1
                value=sum(min(TARGET[c]-counts[c],sum(q['category']==c for q in chosen))/TARGET[c] for c in TARGET)
                options.append((-value,order(k),k,chosen))
            _,_,k,chosen=min(options)
            selected.append(dict(key=k,**meta[k],questions=chosen));counts.update(q['category'] for q in chosen);del eligible[k]
    # 8 documents / 32 QA development, 17 documents / 68 QA independent acceptance.
    dev={d['key'] for d in sorted(selected,key=lambda d:order('split:'+d['key']))[:8]}
    for d in selected:
        d['split']='development' if d['key'] in dev else 'acceptance'
    result=dict(seed=SEED,rule='metadata-only deficit stratification; 8 CiteVQA + 5 OHR + 12 MML documents, four unchanged original QA each; no replacements after download',target=TARGET,actual_categories=dict(counts),documents=selected,excluded_regression_documents=sorted(excluded),selection_frozen_before_download=True)
    write(ROOT/'selection.json',result);return result

class RemoteZip:
    """Standard public HTTP byte ranges; no authentication, restrictions or gates bypassed."""
    def __init__(self,url):
        self.url=url
        with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=60) as r:self.size=int(r.headers['Content-Length'])
        tail=self.range(max(0,self.size-65557),self.size-1);pos=tail.rfind(b'PK\x05\x06')
        if pos<0:raise ValueError('ZIP_EOCD_MISSING')
        fields=struct.unpack_from('<4s4H2IH',tail,pos);length,offset=fields[5:7]
        central=self.range(offset,offset+length-1);self.members={};p=0
        while central[p:p+4]==b'PK\x01\x02':
            f=struct.unpack_from('<4s6H3I5H2I',central,p);name=central[p+46:p+46+f[10]].decode('utf-8')
            self.members[name]={'method':f[4],'crc':f[7],'compressed':f[8],'size':f[9],'offset':f[16]};p+=46+f[10]+f[11]+f[12]
        write(SRC/'ohr-zip-directory.json',dict(size=self.size,members=self.members))
    def range(self,a,b):
        r=urllib.request.urlopen(urllib.request.Request(self.url,headers={'Range':'bytes=%d-%d'%(a,b)}),timeout=90)
        if r.status!=206:raise ValueError('RANGE_NOT_SUPPORTED_'+str(r.status))
        return r.read()
    def extract(self,member):
        match=[n for n in self.members if n==member or n.endswith('/'+member)]
        if len(match)!=1:raise ValueError('ZIP_MEMBER_NOT_UNIQUE:'+member)
        m=self.members[match[0]];head=self.range(m['offset'],m['offset']+29);f=struct.unpack('<4s5H3I2H',head);start=m['offset']+30+f[9]+f[10]
        b=self.range(start,start+m['compressed']-1);raw=zlib.decompress(b,-15) if m['method']==8 else b
        if len(raw)!=m['size'] or zlib.crc32(raw)&0xffffffff!=m['crc']:raise ValueError('ZIP_CRC_MISMATCH')
        return raw

def acquire():
    s=select();(ROOT/'pdfs').mkdir(exist_ok=True)
    z=None;ze=None
    try:z=RemoteZip('https://huggingface.co/datasets/opendatalab/OHR-Bench/resolve/7f833e3eda9a571a9ea545a8f6d476fa1685033d/pdfs.zip')
    except Exception as e:ze=str(e)
    def one(d):
        p=ROOT/'pdfs'/d['filename'];r={'key':d['key'],'path':str(p),'split':d['split']}
        try:
            b=p.read_bytes() if p.exists() else z.extract(d['zip_member']) if d['dataset']=='OHR-Bench' and z else get(d['url']) if d.get('url') else (_ for _ in ()).throw(ValueError(ze or 'NO_URL'))
            if not b.startswith(b'%PDF'):raise ValueError('NOT_PDF')
            p.write_bytes(b);r.update(status='downloaded',sha256=sha(b),bytes=len(b))
        except Exception as e:r.update(status='unavailable',error=str(e))
        print(json.dumps(r),flush=True);return r
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:results=list(pool.map(one,s['documents']))
    write(ROOT/'downloads.json',results)

if __name__=='__main__':acquire()
