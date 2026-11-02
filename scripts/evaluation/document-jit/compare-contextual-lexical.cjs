const fs=require('fs'),crypto=require('crypto');
const {DocumentArtifactRepository}=require('../../../api/server/services/DocumentArtifactRepository');
const {DocumentLexicalIndex}=require('../../../api/server/services/DocumentRetrieval');
const source=process.argv[2],questions=process.argv[3],output=process.argv[4];
const records=fs.readFileSync(source,'utf8').trim().split('\n').map(JSON.parse);
const gold=JSON.parse(fs.readFileSync(questions));
const repo=new DocumentArtifactRepository({userId:'evaluation',conversationId:'context-ab',quality:{contextualRetrieval:true}});
const doc=repo.add({fileId:'frozen',records});
const plain=new DocumentLexicalIndex(doc.records),context=new DocumentLexicalIndex(doc.retrievalRecords);
const rows=gold.map(q=>({id:q.id,...Object.fromEntries([['original',plain],['contextual',context]].map(([name,index])=>{
 const hits=index.search(q.question).bm25;
 return [name,Object.fromEntries([20,40,60].map(k=>[k,{page_coverage:(q.evidence_pages||[]).filter(p=>hits.slice(0,k).some(h=>p>=h.record.pageStart&&p<=h.record.pageEnd)).length/Math.max(1,(q.evidence_pages||[]).length),pages:[...new Set(hits.slice(0,k).map(h=>h.record.pageStart))]}]))];
}))}));
const report={scope:'offline real PDF BM25 page coverage, NOT required-fragment recall or Agent accuracy; gold only used by scorer',source_sha256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),question_sha256:crypto.createHash('sha256').update(fs.readFileSync(questions)).digest('hex'),headings:doc.headings.length,contextual_records:doc.retrievalRecords.filter(r=>r.retrievalContext.text).length,rows};
fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({headings:report.headings,contextual_records:report.contextual_records,means:Object.fromEntries(['original','contextual'].map(name=>[name,Object.fromEntries([20,40,60].map(k=>[k,rows.reduce((sum,r)=>sum+r[name][k].page_coverage,0)/rows.length]))]))}));
