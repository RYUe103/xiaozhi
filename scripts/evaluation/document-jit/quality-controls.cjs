/* Public-page scan and unanswerable controls. Separate from untouched official questions. */
const fs=require('fs'),{createRequire}=require('module');const r=createRequire('/app/api/package.json');
const {DocumentArtifactRepository}=r('/app/api/server/services/DocumentArtifactRepository');
const {DocumentVectorSearch}=r('/app/api/server/services/DocumentVectorSearch');
const out=process.argv[2],dir=process.argv[3],report={scope:'Supplementary controls; NOT original CiteVQA items or independent naturally scanned corpus.',tasks:[]};
async function main(){
 const png=fs.readFileSync('/tmp/jit-quality-scan.png');const t=Date.now();
 const response=await fetch(process.env.QWEN_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.QWEN_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'qwen3-vl-plus',temperature:0,enable_thinking:false,max_tokens:600,messages:[{role:'user',content:[{type:'text',text:'描述此页中可辨认的文档标题及机构名称。只记录可见内容，不推断，并标记为视觉摘要、不是全文OCR。'},{type:'image_url',image_url:{url:'data:image/png;base64,'+png.toString('base64')}}]}]}),signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('VL_HTTP_'+response.status);const j=await response.json(),summary=j.choices[0].message.content;
 report.visual_call={model:'qwen3-vl-plus',usage:j.usage,finish_reason:j.choices[0].finish_reason,elapsed_ms:Date.now()-t};
 fs.writeFileSync('/tmp/jit-quality-public-scan-artifact.json',JSON.stringify({summary,usage:j.usage,model:'qwen3-vl-plus'}));
 for(const profile of ['baseline','retrieval','full']){
  const repo=new DocumentArtifactRepository({userId:'controls',conversationId:'scan',quality:{queryProcessing:false,compactDelivery:profile==='full',rerank:profile==='full'}});
  const d=repo.add({fileId:'public-one-page-raster',engine:'fitz',pageCount:1,records:[],pageRecords:JSON.parse(fs.readFileSync('/tmp/jit-quality-scan.parsed.json')).pages,pageImages:[1]});
  const before=await repo.executeAsync({action:'read',document_id:d.documentId,pages:[1]});repo.updateVisual({fileId:d.fileId,summaries:[{page:1,summary}],pageImages:[1]});
  const after=await repo.executeAsync({action:'visual_page',document_id:d.documentId,pages:[1]});
  report.tasks.push({profile,kind:'scan',native_text_available:false,before_error:before.error?.code,visual_result:after,visual_usage:j.usage,visual_elapsed_ms:Date.now()-t,visual_model:'qwen3-vl-plus',ok:before.error?.code==='PAGE_TEXT_UNAVAILABLE'&&after.hits?.[0]?.kind==='visual_summary'});
 }
 const {createCodeExecutionTool,ToolNode}=r('@librechat/agents'),{AIMessage}=r('@langchain/core/messages'),{getCodeApiAuthHeaders}=r('@librechat/api');
 const code=createCodeExecutionTool({user_id:'quality-evaluation-only',files:[],authHeaders:()=>getCodeApiAuthHeaders({user:{id:'quality-evaluation-only'}})});
 const node=new ToolNode({tools:[code]});
 const messages=[{role:'system',content:'你是计算验收Agent。对多步小数金额运算使用execute_code及Python Decimal核验，只运行计算，不读取文件。回答计算结果和算式。'}, {role:'user',content:'计算控制场景（不是CiteVQA原题）：有三项金额8.35、2.70、13.49，数量分别17、23、9。先求合计，再打93折，最后加13%税，四舍五入到分。请给出税前优惠后金额和最终金额。'}];
 const calls=[],tools=[{type:'function',function:{name:'execute_code',description:'运行Python精确计算核验，必须输出结果',parameters:{type:'object',properties:{lang:{type:'string',enum:['py']},code:{type:'string'}},required:['lang','code']}}}];
 let answer='';const started=Date.now();let usage=0;
 for(let turn=0;turn<3;turn++){
  const response=await fetch(process.env.QWEN_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.QWEN_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'qwen3.6-plus',temperature:0,enable_thinking:false,max_tokens:700,messages,tools}),signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('CALC_MODEL_HTTP_'+response.status);const j=await response.json();usage+=j.usage?.total_tokens||0;const m=j.choices[0].message;messages.push(m);
  if(!m.tool_calls?.length){answer=m.content||'';break;}
  const invoked=m.tool_calls.map(c=>({id:c.id,name:c.function.name,args:JSON.parse(c.function.arguments),type:'tool_call'}));calls.push(...invoked);
  const executed=await node.invoke({messages:[new AIMessage({content:'',tool_calls:invoked})]},{configurable:{run_id:'quality-calculation-control'}});
  for(const tm of executed.messages||executed)messages.push({role:'tool',content:tm.content,tool_call_id:tm.tool_call_id});
 }
 report.tasks.push({kind:'multi_step_calculation',answer,calls,total_tokens:usage,elapsed_ms:Date.now()-started,ok:calls.some(c=>c.name==='execute_code')&&answer.includes('302.68')&&answer.includes('342.03')});

}
main().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(()=>fs.writeFileSync(out,JSON.stringify(report,null,2)));
