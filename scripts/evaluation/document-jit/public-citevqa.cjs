/* Public external corpus evaluation. Gold is never included in agent messages or tool inputs. */
const fs=require('fs'),path=require('path'),{createRequire}=require('module');
const root=process.env.SANSUO_JIT_REPO_ROOT||'/app',req=createRequire(root+'/api/package.json');
const {DocumentArtifactRepository}=req(root+'/api/server/services/DocumentArtifactRepository');
const {DocumentVectorSearch}=req(root+'/api/server/services/DocumentVectorSearch');
const {registerSanSuoPdfReadTool}=req(root+'/api/server/services/Endpoints/agents/sansuoToolPolicy');
const {ToolNode}=req('@librechat/agents'),{AIMessage}=req('@langchain/core/messages');
const dir=process.argv[2],out=process.argv[3];
const report={dataset:'opendatalab/CiteVQA',scope:'6 public Chinese single-document questions; full physical PDFs parsed by actual production FITZ renderer; actual Repository, Bailian embedding and model-selected ToolNode. Upload/storage/browser, MinerU OCR and official bbox/SAA grading excluded.',started_at:new Date().toISOString(),tasks:[]};
async function model(messages,tools,max_tokens=1300){const t=Date.now();const r=await fetch(process.env.QWEN_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.QWEN_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'qwen3.6-plus',messages,tools,temperature:0,enable_thinking:false,max_tokens}),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('MODEL_HTTP_'+r.status);const j=await r.json();return {...j,elapsed_ms:Date.now()-t};}
const uniq=a=>[...new Set(a.filter(Number.isInteger))];
const recall=(got,gold)=>gold.filter(x=>got.includes(x)).length/gold.length;
async function main(){
 const gold=JSON.parse(fs.readFileSync(path.join(dir,'sample-gold.json'))),downloads=JSON.parse(fs.readFileSync(path.join(dir,'downloads.json')));
 const cache={data:new Map(),async get(k,s){return this.data.get(s+k);},async set(k,s,v){this.data.set(s+k,v);}};
 for(const q of gold){
  const started=Date.now(),file=path.basename(q.PDF_Source[0],'.pdf'),fixture=JSON.parse(fs.readFileSync(path.join(dir,file+'.parsed.json')));
  const vector=new DocumentVectorSearch({cache,maxEmbeddingCalls:40});
  const repo=new DocumentArtifactRepository({userId:'public-benchmark-only',conversationId:'citevqa-'+file,vectorSearch:vector,budget:{maxCalls:48,maxContentChars:160000}});
  const doc=repo.add({fileId:file,filename:file+'.pdf',engine:'fitz',sourceHash:downloads.find(x=>x.track_id===file).sha256,records:fixture.pages.filter(p=>p.text).map(p=>({page:p.page,text:p.text})),pageRecords:fixture.pages,pageCount:fixture.document_page_count});
  const task={id:q.index,question:q.Question,type:q.Question_Type,file,pages:doc.pageCount,parse_elapsed_ms:fixture.parse_elapsed_ms,empty_text_pages:fixture.pages.filter(p=>!p.text).map(p=>p.page),gold_pages:uniq(q.Evidence.filter(e=>e.necessity==='necessary').map(e=>e.source_page_id)),traces:[],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}};
  try{
   const t=Date.now(),baseline=await repo.executeAsync({action:'search',document_id:doc.documentId,query:q.Question,limit:6,max_chars:16000});
   task.fixed_query={elapsed_ms:Date.now()-t,candidate_pages:uniq((baseline.retrieval?.rrf||[]).map(h=>doc.records.find(r=>r.id===h.id)?.pageStart)),delivered_pages:uniq((baseline.hits||[]).map(h=>h.page_start)),ranks:baseline.retrieval,warnings:baseline.warnings};
   const agent={tools:[],toolDefinitions:[]};registerSanSuoPdfReadTool({_sansuoPdfReadSources:repo.documents},agent,async args=>{const t=Date.now();const r=await repo.executeAsync(args);task.traces.push({args,elapsed_ms:Date.now()-t,candidate_pages:uniq((r.retrieval?.rrf||[]).map(h=>doc.records.find(x=>x.id===h.id)?.pageStart)),delivered_pages:uniq((r.hits||[]).map(h=>h.page_start)),content:r.content||'',error:r.error,warnings:r.retrieval?.warnings||r.warnings,table:r.table});return r;});
   const node=new ToolNode({tools:agent.tools}),tools=agent.toolDefinitions.map(d=>({type:'function',function:d}));
   const messages=[{role:'system',content:'你是文档问答Agent。只根据 read_parsed_pdf 实际工具证据回答。先 list 发现文档，再 search 检索并 read 读取相关证据，需要表格时可 toc/read_table。多个型号或跨页问题应分别检索。证据不足明确说明。保留原文和数值，回答简洁中文并注明物理页码。工具预算最多24次。'},{role:'user',content:q.Question}];
   task.answer='';
   for(let turn=0;turn<8;turn++){
    const r=await model(messages,tools);for(const k of Object.keys(task.usage))task.usage[k]+=r.usage?.[k]||0;
    const m=r.choices[0].message;task.last_finish_reason=r.choices[0].finish_reason;messages.push(m);if(!m.tool_calls?.length){task.answer=m.content||'';break;}
    const calls=m.tool_calls.slice(0,4).map(c=>({id:c.id,name:c.function.name,args:JSON.parse(c.function.arguments),type:'tool_call'}));
    const result=await node.invoke({messages:[new AIMessage({content:'',tool_calls:calls})]},{configurable:{run_id:'public-'+q.index}});
    for(const tm of result.messages||result)messages.push({role:'tool',content:tm.content,tool_call_id:tm.tool_call_id});
   }
   task.agent_candidate_pages=uniq(task.traces.flatMap(t=>t.candidate_pages));task.agent_delivered_pages=uniq(task.traces.flatMap(t=>t.delivered_pages));
   task.metrics={fixed_query_page_recall_at_6:recall(task.fixed_query.candidate_pages,task.gold_pages),agent_search_page_recall:recall(task.agent_candidate_pages,task.gold_pages),agent_delivered_page_recall:recall(task.agent_delivered_pages,task.gold_pages),all_evidence_pages_delivered:task.gold_pages.every(x=>task.agent_delivered_pages.includes(x)),final_answer_present:Boolean(task.answer)};
  }catch(e){task.error=e.message;}
  task.embedding_usage=vector.usage;task.elapsed_ms=Date.now()-started;report.tasks.push(task);fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({id:task.id,metrics:task.metrics,error:task.error,elapsed_ms:task.elapsed_ms,answer:task.answer}));
 }
 report.completed_at=new Date().toISOString();report.metrics={tasks:report.tasks.length,errors:report.tasks.filter(t=>t.error).length,fixed_query_page_recall_at_6:report.tasks.reduce((s,t)=>s+(t.metrics?.fixed_query_page_recall_at_6||0),0)/gold.length,agent_search_page_recall:report.tasks.reduce((s,t)=>s+(t.metrics?.agent_search_page_recall||0),0)/gold.length,agent_delivered_page_recall:report.tasks.reduce((s,t)=>s+(t.metrics?.agent_delivered_page_recall||0),0)/gold.length,all_evidence_pages_delivered:report.tasks.filter(t=>t.metrics?.all_evidence_pages_delivered).length,total_tokens:report.tasks.reduce((s,t)=>s+t.usage.total_tokens,0),elapsed_ms:report.tasks.reduce((s,t)=>s+t.elapsed_ms,0)};
}
main().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(()=>fs.writeFileSync(out,JSON.stringify(report,null,2)));
