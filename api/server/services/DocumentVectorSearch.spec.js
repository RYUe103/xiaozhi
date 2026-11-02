const { DocumentVectorSearch, resolveEmbeddingConfig, createMongoVectorCache } = require('./DocumentVectorSearch');

describe('JIT embedding provider and scoped incremental cache', () => {
  test('reuses the configured Bailian provider without reusing a chat model', () => {
    const config = resolveEmbeddingConfig({}, { QWEN_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/', QWEN_API_KEY: 'test-only', QWEN_MODEL: 'chat-model' });
    expect(config).toMatchObject({ endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings', model: 'text-embedding-v4', apiKey: 'test-only' });
    const foreign = resolveEmbeddingConfig({ endpoint: 'https://example.com/embeddings' }, { QWEN_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', QWEN_API_KEY: 'test-only' });
    expect(foreign.apiKey).toBeUndefined();
  });

  function client() {
    const cacheData = new Map();
    const inputs = [];
    const cache = { get: async (key, scope) => cacheData.get(scope + key), set: async (key, scope, vector) => { cacheData.set(scope + key, vector); } };
    const fetchImpl = jest.fn(async (_, options) => {
      const { input } = JSON.parse(options.body);
      inputs.push(input);
      return { ok: true, json: async () => ({ data: input.map((text, index) => ({ index, embedding: text.includes('温度') ? [1, 0] : [0, 1] })) }) };
    });
    return { provider: new DocumentVectorSearch({ endpoint: 'https://example.com/embeddings', apiKey: 'test-only', model: 'test-model', fetchImpl, cache, cacheQueries: false }), inputs, fetchImpl };
  }
  const doc = () => ({ documentId: 'd', records: [{ id: 'a', kind: 'extracted_text', text: '温度上限80摄氏度' }, { id: 'b', kind: 'extracted_text', text: '篮球比赛' }], visualRecords: [] });

  test('ranks vectors, reuses unchanged records, and re-embeds only changed content', async () => {
    const { provider, inputs } = client();
    const document = doc();
    const request = { userId: 'u', conversationId: 'c', document, query: '温度多少' };
    expect((await provider.search(request))[0].record.id).toBe('a');
    expect(inputs.map((batch) => batch.length)).toEqual([2, 1]);
    await provider.search(request);
    expect(inputs.map((batch) => batch.length)).toEqual([2, 1, 1]);
    document.records[1].text += '新版';
    await provider.search(request);
    expect(inputs.slice(-2).map((batch) => batch.length)).toEqual([1, 1]);
    await provider.search({ ...request, userId: 'other' });
    expect(inputs.slice(-2).map((batch) => batch.length)).toEqual([2, 1]);
    await provider.search({ ...request, conversationId: 'other' });
    expect(inputs.slice(-2).map((batch) => batch.length)).toEqual([2, 1]);
  });

  test('segments long text without truncating source and distinguishes visual summaries', async () => {
    const { provider, inputs } = client();
    const document = doc();
    document.records[0].text = '长'.repeat(13000);
    document.visualRecords = [{ id: 'v', kind: 'visual_summary', text: '温度图示' }];
    const result = await provider.search({ userId: 'u', conversationId: 'c', document, query: '温度' });
    expect(result[0]).toMatchObject({ source: 'vector_visual', record: { id: 'v' } });
    expect(inputs[0]).toHaveLength(5);
    expect(inputs[0].every((text) => text.length <= 6000)).toBe(true);
    expect(document.records[0].text).toHaveLength(13000);
  });

  test('rejects missing scope, empty query, invalid output and provider auth errors', async () => {
    const { provider } = client();
    await expect(provider.search({ document: doc(), query: 'q' })).rejects.toThrow('DOCUMENT_ACCESS_DENIED');
    await expect(provider.search({ userId: 'u', conversationId: 'c', document: doc(), query: '' })).rejects.toThrow('VECTOR_QUERY_INVALID');
    provider.fetch = async () => ({ ok: false, status: 401 });
    await expect(provider.embed(['q'])).rejects.toThrow('VECTOR_HTTP_401');
    provider.fetch = async () => ({ ok: true, json: async () => ({ data: {} }) });
    await expect(provider.embed(['q'])).rejects.toThrow('VECTOR_RESPONSE_INVALID');
    provider.fetch = async () => ({ ok: true, json: async () => ({ data: [{ index: 0, embedding: [Infinity] }] }) });
    await expect(provider.embed(['q'])).rejects.toThrow('VECTOR_RESPONSE_INVALID');
  });

  test('waits for cache indexes before concurrent operations', async () => {
    const calls = [];
    const collection = { createIndex: async () => { await new Promise((resolve) => setTimeout(resolve, 5)); calls.push('index'); }, findOne: async () => { calls.push('read'); return null; } };
    const cache = createMongoVectorCache({ connection: { collection: () => collection } });
    await Promise.all([cache.get('a', 'scope'), cache.get('b', 'scope')]);
    expect(calls).toEqual(['index', 'index', 'read', 'read']);
  });
  test('bounds cumulative real-provider calls and input characters across searches', async () => {
    const { provider, inputs } = client();
    provider.maxEmbeddingCalls = 2;
    const request = { userId: 'u', conversationId: 'c', document: doc(), query: '温度' };
    await provider.search(request);
    await expect(provider.search(request)).rejects.toThrow('VECTOR_REQUEST_BUDGET_EXCEEDED');
    expect(inputs).toHaveLength(2);
    provider.maxEmbeddingCalls = 10;
    provider.maxEmbeddingChars = provider.usage.chars;
    await expect(provider.embed(['extra'])).rejects.toThrow('VECTOR_REQUEST_BUDGET_EXCEEDED');
  });
  test('stops a search when a slow cache consumes the total deadline', async () => {
    const { provider } = client();
    provider.searchTimeoutMs = 1;
    provider.cache.get = async () => { await new Promise(resolve => setTimeout(resolve, 10)); return null; };
    await expect(provider.search({ userId: 'u', conversationId: 'c', document: doc(), query: '温度' })).rejects.toThrow('VECTOR_SEARCH_TIMEOUT');
  });

});

 test('query vector reuse is bounded by user/session/document/model version scope', async () => {
 const data=new Map(), embed=jest.fn(async (_url, request)=>({ok:true,json:async()=>({data:JSON.parse(request.body).input.map((x,index)=>({index,embedding:[1,0]}))})}));
 const p=new DocumentVectorSearch({endpoint:'https://example.invalid',apiKey:'test-only',model:'embedding',fetchImpl:embed,cache:{get:async(k,s)=>data.get(s+k),set:async(k,s,v)=>data.set(s+k,v)}});
 const document={documentId:'d',version:'v1',records:[{id:'a',text:'content'}]};
 const args={userId:'u',conversationId:'c',document,query:'question'};await p.search(args);const count=embed.mock.calls.length;await p.search(args);expect(embed.mock.calls.length).toBe(count);
 await p.search({...args,conversationId:'other'});expect(embed.mock.calls.length).toBeGreaterThan(count);
 });

 test('indexes more than 400 MinerU blocks without losing tail evidence; concurrency stays bounded', async () => {
 let active=0,peak=0;const input=[];
 const fetchImpl=async (_url,request)=>{active++;peak=Math.max(peak,active);const texts=JSON.parse(request.body).input;input.push(...texts);await new Promise(resolve=>setTimeout(resolve,1));active--;return {ok:true,json:async()=>({data:texts.map((text,index)=>({index,embedding:text.includes('target')?[1,0]:[0,1]}))})};};
 const p=new DocumentVectorSearch({endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings',apiKey:'test',model:'embedding',fetchImpl});
 const records=Array.from({length:450},(_,i)=>({id:String(i),text:i===449?'target evidence':'other '+i}));
 const hits=await p.search({userId:'u',conversationId:'c',document:{documentId:'d',records},query:'target'});
 expect(hits[0].record.id).toBe('449');expect(input).toHaveLength(451);expect(peak).toBe(4);expect(active).toBe(0);
 });
 test('impossible cold index budget fails before making any paid request', async () => {
 const fetchImpl=jest.fn();const p=new DocumentVectorSearch({endpoint:'https://example.invalid',apiKey:'test',model:'embedding',fetchImpl,maxEmbeddingCalls:1});
 await expect(p.search({userId:'u',conversationId:'c',document:{documentId:'d',records:[{id:'1',text:'text'}]},query:'question'})).rejects.toThrow('VECTOR_REQUEST_BUDGET_EXCEEDED');expect(fetchImpl).not.toHaveBeenCalled();
 });
test('source SHA or parser generation changes invalidate identical-text embeddings',async()=>{
 const store=new Map();const fetchImpl=jest.fn(async(_u,init)=>({ok:true,json:async()=>({data:JSON.parse(init.body).input.map((_,index)=>({index,embedding:[1,0]}))})}));
 const provider=new DocumentVectorSearch({endpoint:'https://example.invalid',apiKey:'test',model:'embed',fetchImpl,cache:{get:async(k,s)=>store.get(s+k),set:async(k,s,v)=>store.set(s+k,v)}});
 const document={documentId:'d',version:'v',sourceHash:'sha1',bindingVersion:'g1',records:[{id:'r',text:'same content',parser_version:'v1'}]};
 const input={userId:'u',conversationId:'c',document,query:'question'};
 await provider.search(input);expect(fetchImpl).toHaveBeenCalledTimes(2);
 await provider.search(input);expect(fetchImpl).toHaveBeenCalledTimes(2);
 document.sourceHash='sha2';await provider.search(input);expect(fetchImpl).toHaveBeenCalledTimes(4);
 document.records[0].parser_version='v2';await provider.search(input);expect(fetchImpl).toHaveBeenCalledTimes(6);
});

test('context prefixes every segment, retains original offset and invalidates its cache version', async () => {
 const inputs=[],store=new Map();
 const provider=new DocumentVectorSearch({endpoint:'https://example.invalid',apiKey:'test',model:'embedding',
  cache:{get:async(k,s)=>store.get(s+k),set:async(k,s,v)=>store.set(s+k,v)},
  fetchImpl:async(_url,args)=>{const texts=JSON.parse(args.body).input;inputs.push(texts);return {ok:true,json:async()=>({data:texts.map((text,index)=>({index,embedding:text.includes('needle')?[1,0]:[0,1]}))})};}});
 const original={id:'a',text:'x'.repeat(6000)+'needle'};
 const document={documentId:'d',records:[original],retrievalRecords:[{...original,retrievalContext:{text:'heading'}}],retrievalIndex:{key:'v1'}};
 const request={userId:'u',conversationId:'c',document,query:'needle'};
 const first=await provider.search(request);
 expect(first[0].source_offset).toBe(6000);expect(inputs[0].every(t=>t.startsWith('heading\n'))).toBe(true);
 expect(original.text).toBe('x'.repeat(6000)+'needle');
 const count=inputs.length;await provider.search(request);expect(inputs.length).toBe(count);
 document.retrievalIndex.key='v2';await provider.search(request);expect(inputs.length).toBe(count+2);
});
