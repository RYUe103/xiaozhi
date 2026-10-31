/* Bounded real VL + real model-selected ToolNode on a physical synthetic mixed PDF. */
const { createRequire } = require('module');
const fs = require('fs');
const root = process.env.SANSUO_JIT_REPO_ROOT || '/app';
const req = createRequire(root + '/api/package.json');
const { DocumentArtifactRepository } = req(root + '/api/server/services/DocumentArtifactRepository');
const { DocumentVectorSearch } = req(root + '/api/server/services/DocumentVectorSearch');
const { registerSanSuoPdfReadTool } = req(root + '/api/server/services/Endpoints/agents/sansuoToolPolicy');
const { ToolNode } = req('@librechat/agents');
const { AIMessage } = req('@langchain/core/messages');
const report = { scope: 'Physical synthetic native/table/scan PDF -> actual FITZ -> one actual qwen3-vl-plus scan summary -> Repository -> real model-selected ToolNode tasks. VL summary is not OCR body. Excludes HTTP upload (separate test).', tasks: [] };
async function completion(messages, tools, model) {
  const res = await fetch(process.env.QWEN_BASE_URL.replace(/\/$/,'') + '/chat/completions', { method:'POST', headers:{Authorization:'Bearer '+process.env.QWEN_API_KEY,'Content-Type':'application/json'}, body:JSON.stringify({model,messages,tools,max_tokens:1000,temperature:0,enable_thinking:false}),signal:AbortSignal.timeout(45000)});
  if(!res.ok)throw Error('MODEL_HTTP_'+res.status);
  return res.json();
}
async function main() {
  const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const scan = fixture.pages.find(p => !p.text);
  const started = Date.now();
  const visual = await completion([{role:'user',content:[{type:'text',text:'请用中文简短描述此页面，说明可见安全阀标签和颜色。不要推断不可见内容。'}, {type:'image_url',image_url:{url:'data:image/png;base64,'+fs.readFileSync(process.argv[3]+'/'+scan.image_name).toString('base64')}}]}],undefined,'qwen3-vl-plus');
  const summary = visual.choices[0].message.content;
  report.visual = { model:'qwen3-vl-plus', page:scan.page, elapsed_ms:Date.now()-started, usage:visual.usage, summary, native_text_chars:scan.text.length };
  const vector = new DocumentVectorSearch({cache:{data:new Map(),async get(k,s){return this.data.get(s+k);},async set(k,s,v){this.data.set(s+k,v);}},maxEmbeddingCalls:100});
  const repo = new DocumentArtifactRepository({userId:'synthetic-agent-matrix',conversationId:'mixed-physical-pdf',vectorSearch:vector,budget:{maxCalls:100,maxContentChars:500000}});
  const doc = repo.add({fileId:'mixed-physical-pdf',filename:'mixed-physical.pdf',engine:'fitz',sourceHash:'physical-synthetic-v1',records:fixture.pages.filter(p=>p.text).map(p=>({page:p.page,text:p.text})),pageRecords:fixture.pages,pageImages:fixture.pages.map(p=>p.page),pageCount:fixture.document_page_count,summaries:[{page:scan.page,summary}]});
  const tasks = [
    {id:'exact-evidence',prompt:'先发现文档，再检索 ZX-800 第3.2条并读取命中的正文。轴承温度上限是多少？注明页码。',required:['list','search','read'],gold:/80/,page:1},
    {id:'structured-table',prompt:'发现并查看文档目录中的表格，然后用 read_table 读取第二页结构化表格。Pressure 的上限和单位是什么？注明页码。',required:['list','toc','read_table'],gold:/1\.6[\s\S]*MPa|MPa[\s\S]*1\.6/i,page:2},
    {id:'scan-summary',prompt:'发现文档并查看第三页状态：正文不可用时读取第三页视觉摘要。该页安全阀标签和颜色是什么？注明页码和视觉摘要来源，不要称为正文 OCR。',required:['list','info','visual_page'],gold:/SV-42/i,page:3},
    {id:'adjacent-context',prompt:'先发现文档，再搜索检修周期，读取命中块相邻上下文。检修周期是多久？注明页码。',required:['list','search','read_adjacent'],gold:/3|三/,page:1},
    {id:'safe-continuation',prompt:'先发现文档。使用 read 读取第一页，max_chars 必须设为 100，然后用返回的 continuation_token 继续 read，直到读到 Service interval。检修周期是多久？注明页码。',required:['list','read'],gold:/3\s*(?:个月|月|months)|三个月/i,page:1},
    {id:'missing-evidence',prompt:'发现并检索文档：是否规定了量子传感器 QS-991 的年度校准费用？如果没有证据请明确回答未找到，禁止编造。',required:['list','search'],gold:/未|没有|无法|不包含/,page:null},
  ];
  for(const task of tasks){
    const traces=[]; const agent={tools:[],toolDefinitions:[]};
    registerSanSuoPdfReadTool({_sansuoPdfReadSources:repo.documents},agent,async args=>{const t=Date.now();const r=await repo.executeAsync(args);traces.push({action:args.action,continuation_used:Boolean(args.continuation_token),elapsed_ms:Date.now()-t,ok:!r.error,error:r.error?.code,pages:(r.hits||[]).map(h=>h.page_start),candidate_pages:(r.retrieval?.rrf||[]).map(h=>doc.records.find(x=>x.id===h.id)?.pageStart),kind:(r.hits||[]).map(h=>h.kind),gold_delivered:task.gold.test(r.content||'')});return r;});
    const node=new ToolNode({tools:agent.tools});const tools=agent.toolDefinitions.map(d=>({type:'function',function:d}));
    const messages=[{role:'system',content:'你是文档验收Agent。按照用户步骤自主调用工具，只根据工具结果回答。请先list，不得猜测ID。需要正文证据时必须实际读取，表格使用read_table。不存在的信息应明确未找到。回答简短中文并标注页码。'}, {role:'user',content:task.prompt}];
    let answer='';let usage=0;const t=Date.now();
    for(let turn=0;turn<8;turn++){
      const result=await completion(messages,tools,'qwen3.6-plus');usage+=result.usage?.total_tokens||0;const m=result.choices[0].message;messages.push(m);
      if(!m.tool_calls?.length){answer=m.content||'';break;}
      const calls=m.tool_calls.map(c=>({id:c.id,name:c.function.name,args:JSON.parse(c.function.arguments),type:'tool_call'}));
      const executed=await node.invoke({messages:[new AIMessage({content:'',tool_calls:calls})]},{configurable:{run_id:'synthetic-'+task.id}});
      for(const tm of executed.messages||executed)messages.push({role:'tool',content:tm.content,tool_call_id:tm.tool_call_id});
    }
    const evidence=task.page==null ? null : traces.some(x=>x.gold_delivered&&x.pages.includes(task.page));
    report.tasks.push({id:task.id,elapsed_ms:Date.now()-t,total_tokens:usage,traces,answer,retrieval_success:task.page==null?null:traces.some(x=>x.candidate_pages.includes(task.page)),evidence_delivered:evidence,answer_success:task.gold.test(answer),required_actions_success:task.required.every(a=>traces.some(x=>x.action===a&&x.ok))});
  }
  report.ok=report.tasks.every(t=>t.answer_success&&(t.evidence_delivered!==false)) && report.tasks.find(t=>t.id==='safe-continuation').traces.some(t=>t.continuation_used);
  report.workflow_adherence=report.tasks.filter(t=>t.required_actions_success).length+'/'+report.tasks.length;
  report.metrics={tasks:report.tasks.length,answer_success:report.tasks.filter(t=>t.answer_success).length,evidence_tasks:report.tasks.filter(t=>t.evidence_delivered!==null).length,evidence_success:report.tasks.filter(t=>t.evidence_delivered).length};
}
main().catch(e=>{report.ok=false;report.error=e.message;}).finally(()=>{fs.writeFileSync(process.argv[4],JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,error:report.error,tasks:report.tasks.map(t=>({id:t.id,evidence:t.evidence_delivered,answer:t.answer_success,actions:t.required_actions_success,elapsed_ms:t.elapsed_ms}))}));process.exit(report.ok?0:1);});
