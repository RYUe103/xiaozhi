/* Frozen one-shot A/B/C evaluation. No gold fields are passed to inference. */
const fs=require('fs'),path=require('path'),{createRequire}=require('module');
const root=process.env.SANSUO_JIT_REPO_ROOT||'/app',req=createRequire(root+'/api/package.json');
const {DocumentArtifactRepository}=req(root+'/api/server/services/DocumentArtifactRepository');
const {DocumentVectorSearch}=req(root+'/api/server/services/DocumentVectorSearch');
const {DocumentJitTrace}=req(root+'/api/server/services/DocumentJitTrace');
const {registerSanSuoPdfReadTool:modernTool}=req(root+'/api/server/services/Endpoints/agents/sansuoToolPolicy');
const {registerSanSuoPdfReadTool:oldTool}=req(root+'/api/server/services/Endpoints/agents/sansuoToolPolicyBaseline');
const {ToolNode,createCodeExecutionTool}=req('@librechat/agents'),{AIMessage}=req('@langchain/core/messages');
const {getCodeApiAuthHeaders}=req('@librechat/api');
const dir=process.argv[2],profile=process.argv[3],out=process.argv[4];
if(!['baseline','retrieval','full','budgeted'].includes(profile))throw Error('unknown profile');
const fullProfile=profile==='full'||profile==='budgeted';
const quality={queryProcessing:profile!=='baseline',candidateDepth:profile==='baseline'?6:30,compactDelivery:fullProfile,rerank:fullProfile,...(profile==='budgeted'?{rerankOptions:{maxCalls:2,candidateLimit:12,excerptChars:600}}:{})};
const report={profile,quality,model:'qwen3.6-plus',started_at:new Date().toISOString(),tasks:[]};
const uniq=a=>[...new Set(a.filter(Number.isInteger))], recall=(got,gold)=>gold.length?gold.filter(x=>got.includes(x)).length/gold.length:null;
async function completion(messages,tools){const t=Date.now();const body={model:report.model,messages,tools,temperature:0,enable_thinking:false,max_tokens:1300};
 const r=await fetch(process.env.QWEN_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.QWEN_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('MODEL_HTTP_'+r.status);return {...await r.json(),elapsed_ms:Date.now()-t,request_chars:JSON.stringify(body).length};}
async function main(){
 const downloads=JSON.parse(fs.readFileSync(path.join(dir,'downloads.json')));const cache={data:new Map(),async get(k,s){return this.data.get(s+k);},async set(k,s,v){this.data.set(s+k,v);}};
 for(const split of (process.env.JIT_EVAL_SPLITS || 'regression,holdout').split(','))for(const q of JSON.parse(fs.readFileSync(path.join(dir,split+'-gold.json')))){
  const started=Date.now(),file=path.basename(q.PDF_Source[0],'.pdf'),fixture=JSON.parse(fs.readFileSync(path.join(dir,file+'.parsed.json')));
  const trace=new DocumentJitTrace({captureQueries:true,maxEvents:512});
  const vector=new DocumentVectorSearch({cache,maxEmbeddingCalls:60,maxEmbeddingChars:800000,cacheQueries:fullProfile});
  const repo=new DocumentArtifactRepository({userId:'quality-evaluation-only',conversationId:'quality-'+file,vectorSearch:vector,trace,quality,budget:{maxCalls:48,maxContentChars:160000}});
  const doc=repo.add({fileId:file,filename:file+'.pdf',engine:'fitz',sourceHash:downloads.find(x=>x.track_id===file).sha256,records:fixture.pages.filter(p=>p.text).map(p=>({page:p.page,text:p.text})),pageRecords:fixture.pages,pageCount:fixture.document_page_count,summaries:fixture.visual_summaries||[],pageImages:(fixture.visual_summaries||[]).map(p=>p.page)});
  const task={id:q.index,split,question:q.Question,type:q.Question_Type,file,page_count:doc.pageCount,gold_pages:uniq(q.Evidence.filter(e=>e.necessity==='necessary').map(e=>e.source_page_id)),traces:[],model_calls:[],answer:'',usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}};
  try{
   const result=await repo.executeAsync({action:'search',document_id:doc.documentId,query:q.Question,limit:6,...(profile!=='full'?{max_chars:16000}:{})});
   task.fixed_query={candidates:(result.retrieval?.rrf||[]).map(h=>({id:h.id,page:doc.records.find(r=>r.id===h.id)?.pageStart,ranks:h.ranks})),delivered_pages:uniq((result.hits||[]).map(h=>h.page_start)),trace_events:trace.events.slice(),warnings:result.retrieval?.warnings};
   const agent={tools:[],toolDefinitions:[]},request={_sansuoPdfReadSources:repo.documents,_sansuoDocumentRepository:repo,_sansuoJitCompact:fullProfile};
   (fullProfile?modernTool:oldTool)(request,agent,async args=>{const t=Date.now(),result=await repo.executeAsync(args);task.traces.push({tool:'read_parsed_pdf',args,elapsed_ms:Date.now()-t,result});return result;});
   const tools=agent.toolDefinitions.map(d=>({type:'function',function:d}));
   if(fullProfile){
    // The existing production factory and authenticated local Code API, never JS eval or a mock calculator.
    const code=createCodeExecutionTool({user_id:'quality-evaluation-only',files:[],authHeaders:()=>getCodeApiAuthHeaders({user:{id:'quality-evaluation-only'}})});
    const original=code.func.bind(code);code.func=async (input,...rest)=>{const t=Date.now();const result=await original(input,...rest);task.traces.push({tool:'execute_code',args:input,elapsed_ms:Date.now()-t,result});return result;};
    agent.tools.push(code);tools.push({type:'function',function:{name:'execute_code',description:'复用真实代码执行服务。对已从文档核实的数据进行精确小数、多步/批量计算和核验，输出计算式与结果。不能重新打开或解析PDF；简单加减可直接计算。',parameters:{type:'object',properties:{lang:{type:'string',enum:['py']},code:{type:'string'}},required:['lang','code']}}});
   }
   const node=new ToolNode({tools:agent.tools});
   const system=fullProfile?'你是基于文档证据的问答Agent。先list，再检索。证据不足应换核心概念检索而不是仅匹配条款序号。search给的是节选，缺少目标原文时read补读；表格用read_table并以query指明目标型号，rows是原始列，不能用别的型号推断空白。多步/精确小数或批量计算可用execute_code核验，简单计算可直接完成。多个目标分别确认，缺证明确说无法确认。答案先给结论/计算结果，再简短引用物理页码；不要输出反复自问或未完成推理。只使用工具证据，不生成问题没要求的文件。最多24次工具调用。':'你是文档问答Agent。只根据 read_parsed_pdf 实际工具证据回答。先 list 发现文档，再 search 检索并 read 读取相关证据，需要表格时可 toc/read_table。多个型号或跨页问题应分别检索。证据不足明确说明。保留原文和数值，回答简洁中文并注明物理页码。工具预算最多24次。';
   const messages=[{role:'system',content:system},{role:'user',content:q.Question}];
   for(let turn=0;turn<8;turn++){
    const sizes=messages.map(m=>({role:m.role,chars:JSON.stringify(m).length}));const r=await completion(messages,tools),m=r.choices[0].message;
    task.model_calls.push({turn,finish_reason:r.choices[0].finish_reason,usage:r.usage,elapsed_ms:r.elapsed_ms,request_chars:r.request_chars,message_sizes:sizes,schema_chars:JSON.stringify(tools).length,tool_calls:m.tool_calls?.map(c=>({id:c.id,name:c.function.name,args:c.function.arguments})),output:m.content});
    trace.emit('ModelEnd',{turn,finish_reason:r.choices[0].finish_reason,usage:r.usage,elapsed_ms:r.elapsed_ms});for(const k of Object.keys(task.usage))task.usage[k]+=r.usage?.[k]||0;
    messages.push(m);if(!m.tool_calls?.length){task.answer=m.content||'';task.finish_reason=r.choices[0].finish_reason;break;}
    const calls=m.tool_calls.map(c=>({id:c.id,name:c.function.name,args:JSON.parse(c.function.arguments),type:'tool_call'}));
    if(task.traces.length+calls.length>24){task.error='AGENT_TOOL_BUDGET_EXCEEDED';break;}
    const results=await node.invoke({messages:[new AIMessage({content:'',tool_calls:calls})]},{configurable:{run_id:'quality-'+q.index}});
    for(const tm of results.messages||results)messages.push({role:'tool',content:tm.content,tool_call_id:tm.tool_call_id});
   }
   const reads=task.traces.filter(t=>t.tool==='read_parsed_pdf');
   task.delivered_pages=uniq(reads.flatMap(t=>(t.result.hits||[]).map(h=>h.page_start)));
   task.retrieved_pages=uniq(reads.flatMap(t=>(t.result.retrieval?.rrf||[]).map(h=>doc.records.find(x=>x.id===h.id)?.pageStart)));
   task.metrics={fixed_page_recall_at_6:recall(task.fixed_query.candidates.map(x=>x.page),task.gold_pages),agent_retrieval_recall:recall(task.retrieved_pages,task.gold_pages),delivery_page_recall:recall(task.delivered_pages,task.gold_pages),all_pages_delivered:task.gold_pages.every(x=>task.delivered_pages.includes(x)),tool_calls:task.traces.length};
  }catch(e){task.error=e.message;}
  task.telemetry=trace.events;task.query_processor_usage=repo.queryProcessor.usage;task.reranker_usage=repo.reranker.usage;task.embedding_usage=vector.usage;task.elapsed_ms=Date.now()-started;report.tasks.push(task);fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({profile,split,id:task.id,metrics:task.metrics,error:task.error,finish:task.finish_reason,tokens:task.usage.total_tokens,elapsed_ms:task.elapsed_ms}));
 }
 report.completed_at=new Date().toISOString();
}
main().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(()=>fs.writeFileSync(out,JSON.stringify(report,null,2)));
