const { DocumentQueryProcessor } = require('./DocumentQueryProcessor');
const { DocumentJitTrace } = require('./DocumentJitTrace');
const { compactDocumentResult } = require('./DocumentToolResult');
const { focusTable } = require('./DocumentTableFocus');
const { DocumentArtifactRepository } = require('./DocumentArtifactRepository');
describe('Document quality boundaries', () => {
  test('telemetry never stores raw query by default and is bounded even with a failing sink', () => {
    const trace = new DocumentJitTrace({ maxEvents: 2, sink: () => { throw Error(); } });
    for (let i=0;i<4;i++) trace.emit('test', trace.query('private document question'));
    expect(trace.events).toHaveLength(2); expect(JSON.stringify(trace.events)).not.toContain('private');
  });
  test('query reformulation is answer-blind, bounded, request scoped and fails open', async () => {
    const old = { ...process.env };process.env.QWEN_BASE_URL='https://example.invalid';process.env.QWEN_API_KEY='test-only';
    try {
      const fetchImpl=jest.fn(async (_url, args) => {expect(args.body).not.toContain('Standard_Answer');return {ok:true,json:async()=>({choices:[{message:{content:'{"queries":["分解目标一","分解目标二"]}'},finish_reason:'stop'}],usage:{total_tokens:50}})};});
      const q=new DocumentQueryProcessor({fetchImpl,maxCalls:1});
      const query='请从所提供的文档中搜索指定段落的具体身份与职责并完整给出来源';
      expect((await q.process(query)).queries[0]).toBe(query);
      expect((await q.process(query)).cache_hit).toBe(true);expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect((await q.process(query+'其他')).warning).toBe('QUERY_PROCESSOR_BUDGET');
      const bad=new DocumentQueryProcessor({fetchImpl:async()=>{throw Error('provider down');}});
      expect((await bad.process(query)).queries).toEqual([query]);
    } finally {process.env=old;}
  });
  test('compact tables preserve exact rows while eliminating duplicated cells and Markdown', () => {
    const result={action:'read_table',content:'duplicated markdown',retrieval:{},reference:{user_id:'secret'},table:{rows:[['A','1.7']],cells:[{text:'1.7'}],complete:true}};
    const projected=compactDocumentResult(result);expect(projected.table.rows).toEqual(result.table.rows);expect(projected.content).toBeUndefined();expect(projected.table.cells).toBeUndefined();expect(result.content).toBe('duplicated markdown');
  });
  test('table focus preserves full repeated blocks with original row indices', () => {
    const table={rows:[['Key','Value'],['Code','AB-12'],['Price','3.14'],['Code','CD-34'],['Price','9.1']],warnings:[],content:'all'};
    const selected=focusTable(table,'AB-12价格');expect(selected.rows).toEqual(table.rows.slice(1,3));expect(selected.selectedRowIndexes).toEqual([1,2]);expect(selected.totalRows).toBe(5);
    expect(focusTable(table,'未知目标')).toBe(table);expect(focusTable(table,'EF-56')).toBe(table);
  });
  test('search default distributes snippets across hits, explicit budgets still support safe continuation', async () => {
    const repo=new DocumentArtifactRepository({userId:'test',conversationId:'test',quality:{queryProcessing:false}});
    const d=repo.add({fileId:'f',records:Array.from({length:8},(_,i)=>({page:i+1,text:('核心术语'+i+'正文').repeat(1000)}))});
    const result=await repo.executeAsync({action:'search',document_id:d.documentId,query:'核心术语'});
    expect(result.hits).toHaveLength(6);expect(result.content.length).toBeLessThanOrEqual(6000);expect(result.excerpted).toBe(true);
    const first=await repo.executeAsync({action:'search',document_id:d.documentId,query:'核心术语',max_chars:100});
    expect(first.continuation_token).toBeTruthy();const next=await repo.executeAsync({action:'search',document_id:d.documentId,continuation_token:first.continuation_token,max_chars:100});
    expect(next.offset).toBe(100);
  });
});

describe('Semantic ranking safeguards', () => {
  const { DocumentEvidenceReranker } = require('./DocumentEvidenceReranker');
  test('disabled compiler preserves raw punctuation for a true baseline', async () => {
    const q='请查阅“（四）”的条款内容：原文是什么？';
    expect((await new DocumentQueryProcessor({enabled:false}).process(q)).queries).toEqual([q]);
  });
  test('reranker rejects invented IDs and preserves original scores on valid reorder', async () => {
    const old={...process.env};process.env.QWEN_BASE_URL='https://example.invalid';process.env.QWEN_API_KEY='test-only';
    const candidates=[{record:{id:'a',text:'unrelated clause',pageStart:1},score:0.4,ranks:{vector:2}},{record:{id:'b',text:'semantic match',pageStart:2},score:0.2,ranks:{vector:1}}];
    try {
      const invalid=new DocumentEvidenceReranker({fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"ranking":[9]}'}}]})})});
      expect(await invalid.rank('question',candidates)).toBe(candidates);
      const valid=new DocumentEvidenceReranker({fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"ranking":[1,0]}'}}],usage:{total_tokens:30}})})});
      const result=await valid.rank('question',candidates);expect(result[0]).toMatchObject({record:{id:'b'},score:0.2,ranks:{vector:1},rerank_rank:1});expect(valid.usage.total_tokens).toBe(30);
    } finally {process.env=old;}
  });
});

 test('a continued table first row is not invented as the column header of a later product', () => {
 const source={rows:[['Ingress','IP44','1.4'],['Model','UNIT-90','Price'],['Power','3W','2'],['Warranty','2 years',''],['Model','UNIT-91','Price'],['Power','7W','4']],warnings:[],content:'all'};
 const focused=focusTable(source,'UNIT-90');expect(focused.selectedRowIndexes).toEqual([1,2,3]);expect(focused.rows.flat()).not.toContain('1.4');
 });

 test('an explicit table page cannot silently reuse a previous page table', async () => {
  const repo=new DocumentArtifactRepository({userId:'u',conversationId:'c'});const doc=repo.add({fileId:'f',engine:'fitz',pageRecords:[{page:1,tables:[{page:1,rows:[['k','v'],['a','1']]}]},{page:2,tables:[{page:2,rows:[['k','v'],['b','2']]}]}]});
  const first=await repo.executeAsync({action:'read_table',document_id:doc.documentId,pages:[1]});expect(first.hits[0].page_start).toBe(1);
  const second=await repo.executeAsync({action:'read_table',document_id:doc.documentId,pages:[2]});expect(second.hits[0].page_start).toBe(2);
  const denied=await repo.executeAsync({action:'read_table',document_id:doc.documentId,pages:[2],table_id:first.table_id});expect(denied.error.code).toBe('TARGET_OUTSIDE_PAGE');
 });
 test('semantic reranking input and call counts are bounded without dropping source identities', async () => {
  const {DocumentEvidenceReranker}=require('./DocumentEvidenceReranker');const old={...process.env};process.env.QWEN_BASE_URL='https://example.invalid';process.env.QWEN_API_KEY='test-only';
  try {const candidates=Array.from({length:25},(_,i)=>({record:{id:'source'+i,text:'evidence '.repeat(1000)}}));const fetchImpl=jest.fn(async (_url,options)=>{const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);expect(input.candidates.length).toBeLessThanOrEqual(12);expect(input.candidates.every(c=>c.text.length<=600)).toBe(true);return {ok:true,json:async()=>({choices:[{message:{content:'{"ranking":[1,0]}'}}]})};});const ranker=new DocumentEvidenceReranker({fetchImpl,maxCalls:2,candidateLimit:12,excerptChars:600});for(let i=0;i<3;i++){const result=await ranker.rank('question',candidates);expect(result.length).toBe(25);}expect(fetchImpl).toHaveBeenCalledTimes(2);}finally{process.env=old;}
 });

 test('runtime logs retain stage metadata with the deployed message-only logger formatter', () => {
   const { runtimeEvent } = require('./DocumentJitTrace');
   const { logger } = require('@librechat/data-schemas');
   const spy = jest.spyOn(logger, 'info').mockImplementation(() => {});
   const previous = process.env.SANSUO_JIT_TRACE;
   process.env.SANSUO_JIT_TRACE = 'true';
   try {
     runtimeEvent('ModelEnd', 'private-scope', { elapsed_ms: 17, finish_reason: 'stop', usage: { total_tokens: 42 } });
     const line = spy.mock.calls.at(-1)[0];
     const event = JSON.parse(line.slice('[JIT trace] '.length));
     expect(event).toMatchObject({ stage: 'ModelEnd', elapsed_ms: 17, finish_reason: 'stop', usage: { total_tokens: 42 } });
     expect(line).not.toContain('private-scope');
   } finally { spy.mockRestore(); if (previous === undefined) delete process.env.SANSUO_JIT_TRACE; else process.env.SANSUO_JIT_TRACE = previous; }
 });

test('reranker sees the configured 60 candidates and treats length output as partial fallback', async () => {
 const {DocumentEvidenceReranker}=require('./DocumentEvidenceReranker'); const old={...process.env};
 process.env.QWEN_BASE_URL='https://example.invalid'; process.env.QWEN_API_KEY='test-only';
 const candidates=Array.from({length:60},(_,i)=>({record:{id:String(i),text:'original evidence'}}));
 const events=[];
 try {
  const ranker=new DocumentEvidenceReranker({candidateLimit:60,fetchImpl:async(_url,args)=>{
   const body=JSON.parse(args.body);expect(JSON.parse(body.messages[1].content).candidates).toHaveLength(60);
   return {ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{"ranking":[59,0]}'}}],usage:{total_tokens:12}})};
  }});
  expect(await ranker.rank('question',candidates,{emit:(_stage,e)=>events.push(e)})).toBe(candidates);
  expect(events[0].warning).toBe('RERANK_PARTIAL'); expect(ranker.usage.total_tokens).toBe(12);
 } finally {process.env=old;}
});
