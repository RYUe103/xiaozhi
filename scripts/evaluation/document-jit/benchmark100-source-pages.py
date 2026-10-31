#!/usr/bin/env python3
"""Independent original-PDF source audit only; outputs never enter the Agent."""
import fitz,json,pathlib,sys
p=pathlib.Path(sys.argv[1]);gold=json.loads((p/'frozen-gold.json').read_text());out=p/'source-audit';out.mkdir(exist_ok=True)
for d in gold['documents']:
    if d['download']['status']!='downloaded':continue
    doc=fitz.open(p/'pdfs'/d['filename']);pages=[]
    for i,page in enumerate(doc):
        pages.append(dict(page=i+1,text=page.get_text(),width=page.rect.width,height=page.rect.height,image_count=len(page.get_images()),source='original_pdf_fitz_text_layer_not_ocr'))
    (out/(d['filename']+'.json')).write_text(json.dumps(dict(document_key=d['key'],page_count=len(doc),pages=pages),ensure_ascii=False),encoding='utf-8')
    print(d['key'],len(doc),sum(not x['text'].strip() for x in pages),flush=True)
