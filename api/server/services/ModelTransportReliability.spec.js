const { createModelFetch, classifyModelError, failureMessage } = require('./ModelTransportReliability');

test('retries only transient model request failures and records underlying cause', async () => {
 const fetchImpl=jest.fn().mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}})).mockResolvedValue(new Response('ok'));
 const events=[];const request=createModelFetch({fetchImpl,backoffMs:1,emit:e=>events.push(e)});
 expect(await (await request('https://example.invalid')).text()).toBe('ok');
 expect(fetchImpl).toHaveBeenCalledTimes(2);expect(events[0]).toMatchObject({cause:'ECONNRESET',retry:true,attempt:1});
});
test('does not retry authorization failures or unknown application errors',async()=>{
 for(const error of [Object.assign(new Error('denied'),{status:403}),new Error('bad schema')]){
  const fetchImpl=jest.fn().mockRejectedValue(error);await expect(createModelFetch({fetchImpl})('url')).rejects.toBe(error);expect(fetchImpl).toHaveBeenCalledTimes(1);
 }
});
test('cancels error body and retries 503, but respects retry-after beyond deadline',async()=>{
 const cancel=jest.fn().mockResolvedValue();const fetchImpl=jest.fn().mockResolvedValueOnce({ok:false,status:503,body:{cancel},headers:new Headers()}).mockResolvedValue(new Response('done'));
 expect(await(await createModelFetch({fetchImpl,backoffMs:1})('url')).text()).toBe('done');expect(cancel).toHaveBeenCalledTimes(1);
 const limited=jest.fn().mockResolvedValue(new Response('limit',{status:429,headers:{'retry-after':'90'}}));
 await expect(createModelFetch({fetchImpl:limited,timeoutMs:100})('url')).rejects.toMatchObject({status:429});expect(limited).toHaveBeenCalledTimes(1);
});
test('stream failure is not replayed after delivering bytes',async()=>{
 let n=0;const events=[];const fetchImpl=jest.fn().mockResolvedValue(new Response(new ReadableStream({pull(c){if(n++===0)c.enqueue(new TextEncoder().encode('partial'));else c.error(Object.assign(new Error('socket'),{code:'ECONNRESET'}));}})));
 const response=await createModelFetch({fetchImpl,emit:e=>events.push(e)})('url');await expect(response.text()).rejects.toThrow('socket');expect(fetchImpl).toHaveBeenCalledTimes(1);expect(events.at(-1)).toMatchObject({phase:'stream_failed',retry_suppressed:'stream_started'});
});
test('abort interrupts backoff and cannot restart model call',async()=>{
 const controller=new AbortController();const fetchImpl=jest.fn().mockRejectedValue(Object.assign(new Error('socket'),{code:'ECONNRESET'}));
 const call=createModelFetch({fetchImpl,signal:controller.signal,backoffMs:1000})('url');setTimeout(()=>controller.abort(),5);await expect(call).rejects.toMatchObject({name:'AbortError'});expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('timeout bounds all retries and produces an explicit non-answer',async()=>{
 const fetchImpl=jest.fn((u,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
 await expect(createModelFetch({fetchImpl,timeoutMs:10})('url')).rejects.toMatchObject({name:'TimeoutError'});expect(fetchImpl).toHaveBeenCalledTimes(1);
 expect(classifyModelError({cause:{code:'UND_ERR_CONNECT_TIMEOUT'}})).toMatchObject({code:'MODEL_NETWORK_ERROR',retryable:true});
 expect(failureMessage({code:'MODEL_TIMEOUT'})).toContain('本次回答未完成');
});

test('user cancellation during a returned body never retries and preserves cancellation classification',async()=>{
 const controller=new AbortController(),events=[];
 const fetchImpl=jest.fn(async(u,{signal})=>new Response(new ReadableStream({start(c){signal.addEventListener('abort',()=>c.error(signal.reason),{once:true});}})));
 const response=await createModelFetch({fetchImpl,signal:controller.signal,emit:e=>events.push(e)})('url');
 const body=response.text();controller.abort();await expect(body).rejects.toMatchObject({name:'AbortError'});
 expect(fetchImpl).toHaveBeenCalledTimes(1);expect(events.at(-1).code).toBe('MODEL_CANCELLED');
});
test('deadline covers body consumption and does not replay an unfinished stream',async()=>{
 const events=[];const fetchImpl=jest.fn(async(u,{signal})=>new Response(new ReadableStream({start(c){signal.addEventListener('abort',()=>c.error(signal.reason),{once:true});}})));
 const response=await createModelFetch({fetchImpl,timeoutMs:15,emit:e=>events.push(e)})('url');
 await expect(response.text()).rejects.toMatchObject({code:'MODEL_DEADLINE'});
 expect(fetchImpl).toHaveBeenCalledTimes(1);expect(events.at(-1).code).toBe('MODEL_TIMEOUT');
});
