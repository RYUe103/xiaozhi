const { exactSearch } = require('./DocumentExactSearch');
const { DocumentArtifactRepository } = require('./DocumentArtifactRepository');
const record = text => ({ id: 'one', chunkId: 'one', text, pageStart: 2, pageEnd: 4 });
test('literal preserves spaces, case and punctuation; zero context and exact limit are not truncation', () => {
 const r = exactSearch([record('X x Ｘ x ')], { query: 'x ', context_chars: 0, limit: 2 });
 expect(r.match_count).toBe(2); expect(r.truncated).toBe(false);
 expect(r.matches.every(m => m.context_before === '' && m.context_after === '')).toBe(true);
});
test('NFKC expansion and combining marks retain exact original UTF16 offsets', () => {
 const text = '😀e\u0301 ﬃ ８０℃';
 for (const query of ['é', 'ffi', '80°C']) {
  const r = exactSearch([record(text)], { query, match_mode: 'nfkc' });
  expect(r.matches).toHaveLength(1);
  const m = r.matches[0];
  expect(text.slice(m.source_offset, m.source_offset + m.source_length)).toBe(m.match_text);
  expect(m.match_text.normalize('NFKC')).toBe(query);
 }
 expect(exactSearch([record('ﬃ')], { query: 'f', match_mode: 'nfkc' }).matches).toHaveLength(0);
});
test('interior page of a range matches without inventing a single-page location', () => {
 const r = exactSearch([record('target')], { query: 'target', pages: [3] });
 expect(r.matches[0]).toMatchObject({ page_start: 2, page_end: 4 });
});
test('searches long tail and repeated overlapping literals, never contextual background', () => {
 const r = record('z'.repeat(30000) + 'aaa'); r.indexText = 'invented';
 expect(exactSearch([r], { query: 'aa' }).match_count).toBe(2);
 expect(exactSearch([r], { query: 'aa' }).matches[0].source_offset).toBe(30000);
 expect(exactSearch([r], { query: 'invented' }).match_count).toBe(0);
 expect(() => exactSearch([r], { query: '' })).toThrow('QUERY_INVALID');
 expect(() => exactSearch([r], { query: 'a', match_mode: 'regex' })).toThrow('MATCH_MODE_INVALID');
});
test('signed exact continuation rejects changed query, action, version and revoked access', async () => {
 let allowed = true;
 const repo = new DocumentArtifactRepository({ userId: 'u', conversationId: 'c', authorize: async () => allowed });
 const d = repo.add({ fileId: 'f', records: [{ page: 1, text: 'abc abc abc' }] });
 const args = { action: 'find_exact', document_id: d.documentId, query: 'abc', limit: 1, context_chars: 0 };
 const first = await repo.executeAsync(args);
 expect(first.truncated).toBe(true); expect(first.match_count).toBe(3);
 const next = { action: 'find_exact', document_id: d.documentId, continuation_token: first.continuation_token };
 expect((await repo.executeAsync(next)).matches[0].source_offset).toBe(4);
 expect((await repo.executeAsync({ ...next, query: 'xyz' })).error.code).toBe('CONTINUATION_SCOPE_MISMATCH');
 expect((await repo.executeAsync({ ...next, action: 'read' })).error.code).toBe('CONTINUATION_ACTION_MISMATCH');
 allowed = false;
 expect((await repo.executeAsync(next)).error.code).toBe('DOCUMENT_ACCESS_DENIED');
 allowed = true; d.version = 'updated';
 expect((await repo.executeAsync(next)).error.code).toBe('DOCUMENT_VERSION_MISMATCH');
});
test('repeated adversarial text returns an explicit lower-bound count and supports later windows', () => {
 const r=exactSearch([record('a'.repeat(12000))],{query:'a',limit:2,offset:10000});
 expect(r.match_count_exact).toBe(false);expect(r.scan_truncated).toBe(true);expect(r.matches[0].source_offset).toBe(10000);expect(r.next_offset).toBe(10002);
});
test('cross chunk matching requires verified original parent and preserves each source offset', () => {
 const records=[{...record('原文ABC'),id:'a',chunkId:'a',block_id:'b',pageStart:2,pageEnd:2},{...record('DEF尾部'),id:'b',chunkId:'b',block_id:'b',pageStart:3,pageEnd:3}];
 const args={query:'ABC\nDEF'};
 expect(exactSearch(records,args).matches).toHaveLength(0);
 const result=exactSearch(records,args,[{block_id:'b',text:'原文ABC\nDEF尾部'}]);
 expect(result.matches[0]).toMatchObject({match_text:'ABC\nDEF',source_offset:null,source_block_offset:2,chunk_ids:['a','b'],page_start:2,page_end:3});
 expect(result.matches[0].source_segments).toEqual([{chunk_id:'a',source_offset:2,source_length:3,page_start:2,page_end:2},{chunk_id:'b',source_offset:0,source_length:3,page_start:3,page_end:3}]);
 expect(exactSearch(records,args,[{block_id:'b',text:'unrelated'}]).matches).toHaveLength(0);
});
test('per-call text output budget limits matches with a resumable offset', () => {
 const r=exactSearch([record(('context '.repeat(20)+'target ').repeat(5))],{query:'target',context_chars:50,max_chars:100});
 expect(r.matches).toHaveLength(1);expect(r.truncated).toBe(true);expect(r.next_offset).toBe(1);
 const m=r.matches[0];expect(m.match_text.length+m.context_before.length+m.context_after.length).toBeLessThanOrEqual(100);
});
