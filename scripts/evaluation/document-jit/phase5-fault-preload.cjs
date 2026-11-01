'use strict';
// Explicit fault injection for isolated end-to-end resilience tests, never a benchmark result.
if(!String(process.env.MONGO_URI||'').includes('/LibreChatMineruVisionPhase5'))throw Error('ISOLATED_DB_REQUIRED');
const original=globalThis.fetch;const attempted=new Set();
globalThis.fetch=async function(url,init){
 let body;try{body=JSON.parse(init?.body);}catch{}
 const mode=process.env.PHASE5_MODEL_FAULT;
 if(mode && String(url).endsWith('/chat/completions') && body?.model==='qwen3.6-plus' && body.stream===true){
  const key=JSON.stringify(body.messages);const first=!attempted.has(key);attempted.add(key);
  if(mode==='deny')return new Response('{"error":{"code":"injected_denial"}}',{status:403,headers:{'content-type':'application/json'}});
  if(mode==='reset_once'&&first)throw Object.assign(new TypeError('injected connection reset'),{cause:{code:'ECONNRESET'}});
 }
 return original(url,init);
};
