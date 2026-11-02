const { DocumentArtifactRepository } = require('./DocumentArtifactRepository');
const { DocumentReadBudget } = require('./DocumentReadBudget');
const { compactDocumentResult } = require('./DocumentToolResult');
const { createPdfReadContract, createDocxReadContract } = require('./Endpoints/agents/documentReadContracts');
function fixture(options = {}, records = [{ page: 1, text: '真实原文甲。'.repeat(80) }, { page: 2, text: '真实原文乙。'.repeat(80) }]) {
  const budget = new DocumentReadBudget({ maxContextTokens: 200000, count: s => s.length, reserveTokens: 8192 });
  budget.observe([]);
  const repo = new DocumentArtifactRepository({ userId: 'u', conversationId: 'c', secret: 'stable-test-secret', contextBudget: budget, ...options });
  const doc = repo.add({ fileId: 'f', sourceHash: 'sha', sourceArtifact: 'a', pageCount: 2, records });
  return { repo, doc, budget };
}
test('full original text, traceable tables and no VL or embedding', async () => {
  const { repo, doc } = fixture({ vectorSearch: { search: jest.fn(() => { throw Error('must not run'); }) } });
  doc.visualRecords.push({ text: 'AI SUMMARY MUST NOT APPEAR' });
  const r = await repo.executeAsync({ action: 'read_full' });
  expect(r.status).toBe('ok'); expect(r.parsed_text_complete).toBe(true);
  expect(r.content).toBe(doc.records.map(r => r.text).join('\n\n'));
  expect(r.document_verified).toBe(false); expect(r.coverage.parsed_text_read_pages).toEqual([[1, 2]]);
  expect(compactDocumentResult(r).content).toBe(r.content);
});
test('scan resumes without skipped or repeated source characters across repositories', async () => {
  let { repo, doc } = fixture(); const strings = new Map(doc.records.map(r => [r.chunkId, '']));
  let token, calls = 0, last;
  do {
    last = await repo.executeAsync({ action: 'scan_document', max_chars: 137, continuation_token: token });
    expect(last.error).toBeUndefined(); expect(last.content.length).toBeLessThanOrEqual(137);
    for (const h of last.hits) { const original = doc.records.find(r => r.chunkId === h.chunk_id); strings.set(h.chunk_id, strings.get(h.chunk_id) + original.text.slice(h.source_offset, h.source_offset + h.source_length)); }
    token = last.continuation_token; calls++; ({ repo } = fixture());
  } while (token && calls < 30);
  expect(calls).toBeGreaterThan(2); expect(token).toBeNull();
  for (const r of doc.records) expect(strings.get(r.chunkId)).toBe(r.text);
  expect(last.coverage.completed_chunks).toBe(2);
});
test.each(['userId', 'conversationId'])('rejects cross-scope continuation %s', async key => {
  const first = await fixture().repo.executeAsync({ action: 'scan_document', max_chars: 100 });
  const other = fixture({ [key]: 'foreign' });
  expect((await other.repo.executeAsync({ action: 'scan_document', continuation_token: first.continuation_token })).error.code).toBe('CONTINUATION_INVALID');
});
test('rejects version change and action switch', async () => {
  const { repo, doc } = fixture(); const first = await repo.executeAsync({ action: 'scan_document', max_chars: 100 });
  expect((await repo.executeAsync({ action: 'read', continuation_token: first.continuation_token })).error.code).toBe('CONTINUATION_ACTION_MISMATCH');
  doc.version = 'new'; expect((await repo.executeAsync({ action: 'scan_document', continuation_token: first.continuation_token })).error.code).toBe('DOCUMENT_VERSION_MISMATCH');
});
test('rechecks authorization after computing result', async () => {
  const { repo } = fixture({ authorize: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) });
  expect((await repo.executeAsync({ action: 'read_full' })).error.code).toBe('DOCUMENT_ACCESS_DENIED');
});
test('missing and suspect pages remain partial even when all parsed text read', async () => {
  const { repo } = fixture({}, [{ page: 1, text: '损坏的文字层\uFFFD'.repeat(10) }]);
  const r = await repo.executeAsync({ action: 'read_full' });
  expect(r.parsed_text_complete).toBe(true); expect(r.status).toBe('partial');
  expect(r.coverage.missing_text_pages).toEqual([[2, 2]]); expect(r.coverage.suspect_text_pages).toEqual([[1, 1]]);
});
test('all chunks of a page must be consumed before page is marked read', async () => {
  const { repo } = fixture({}, [{ page: 1, text: 'a'.repeat(150) }, { page: 1, text: 'b'.repeat(150) }]);
  const r = await repo.executeAsync({ action: 'scan_document', max_chars: 200 });
  expect(r.coverage.completed_chunks).toBe(1); expect(r.coverage.parsed_text_read_pages).toEqual([]);
});
test('proven overlap removed; equal unrelated content is preserved', async () => {
  const { repo } = fixture({}, [{ page: 1, text: 'abcde', source_text_id: 's', source_text_offset: 0 },
    { page: 1, text: 'defgh', source_text_id: 's', source_text_offset: 3 }, { page: 2, text: 'defgh' }]);
  const r = await repo.executeAsync({ action: 'read_full' });
  expect(r.deduplicated_chars).toBe(2); expect(r.content).toBe('abcde\n\nfgh\n\ndefgh');
});
test('unavailable runtime budget fails closed; model cannot supply one', async () => {
  const { repo } = fixture({ contextBudget: null });
  expect((await repo.executeAsync({ action: 'read_full', remaining_tokens: 999999 })).error.code).toBe('MODEL_CONTEXT_BUDGET_UNAVAILABLE');
});
test('full never silently truncates; scans honor context and ToolNode JSON cap', async () => {
  const { repo, budget } = fixture(); budget.maxChars = 2600;
  const full = await repo.executeAsync({ action: 'read_full' });
  expect(full.error.code).toBe('MODEL_CONTEXT_BUDGET_EXCEEDED');
  const scan = await repo.executeAsync({ action: 'scan_document' });
  expect(scan.status).toBe('partial'); expect(JSON.stringify(compactDocumentResult(scan)).length).toBeLessThanOrEqual(2600);
  expect(scan.continuation_token).toBeTruthy();
});
test('context depletion stops scanning and request call budget is explicit', async () => {
  const { repo, budget } = fixture({ budget: { maxCalls: 2 } });
  budget.used = budget.limit;
  expect((await repo.executeAsync({ action: 'scan_document' })).error.code).toBe('MODEL_CONTEXT_BUDGET_EXCEEDED');
  await repo.executeAsync({ action: 'info' });
  expect((await repo.executeAsync({ action: 'scan_document' })).error.code).toBe('REQUEST_READ_BUDGET_EXCEEDED');
});
test('no arbitrary offset, multi-document concatenation or selected subset of full read', async () => {
  const { repo } = fixture();
  expect((await repo.executeAsync({ action: 'scan_document', offset: 1 })).error.code).toBe('CONTINUATION_REQUIRED');
  expect((await repo.executeAsync({ action: 'read_full', pages: [1] })).error.code).toBe('SEQUENTIAL_SCOPE_INVALID');
  repo.add({ fileId: 'other', records: [{ text: 'other' }] });
  expect((await repo.executeAsync({ action: 'read_full' })).error.code).toBe('DOCUMENT_NOT_FOUND');
});
test('schema allows 100k PDF sequential read while Word remains 20k', () => {
  expect(createPdfReadContract().schema.parse({ action: 'read_full', max_chars: 100000 }).max_chars).toBe(100000);
  expect(createDocxReadContract().schema.safeParse({ max_chars: 100000 }).success).toBe(false);
});
test('100000 characters survive original ToolNode truncation limit when context permits', async () => {
  const { repo, budget } = fixture({}, [{ page: 1, text: '原'.repeat(100000) }]);
  budget.maxChars = 400000;
  const r = await repo.executeAsync({ action: 'read_full', max_chars: 100000 });
  expect(r.content.length).toBe(100000);
  const { truncateToolResultContent, calculateMaxToolResultChars } = require('../../../node_modules/@librechat/agents/dist/cjs/utils/truncation.cjs');
  const value = JSON.stringify(compactDocumentResult(r));
  expect(truncateToolResultContent(value, calculateMaxToolResultChars(200000))).toBe(value);
});

test('actual provider envelope includes output reserve, tool schemas and call arguments', () => {
  const { budget } = fixture();
  budget.observeRequest({ messages: [{ role: 'assistant', content: '', tool_calls: [{ arguments: 'x'.repeat(3000) }] }],
    tools: [{ description: 'schema'.repeat(1000) }], max_tokens: 50000 });
  expect(budget.snapshot().reserved_tokens).toBeGreaterThanOrEqual(52048); expect(budget.maxChars).toBe(24000);
  expect(budget.used).toBeGreaterThan(9000);
  budget.observeRequest({}); expect(budget.snapshot().available).toBe(false);
});
test('full table retains original markup, table IDs and merged-cell parent read', async () => {
  const original = '| 型号 | 金额（万元） |\n| --- | --- |\n| A | 12.50 |\n| B | 6.25 |';
  const { repo, doc } = fixture({}, [{ page: 1, text: original }]);
  const full = await repo.executeAsync({ action: 'read_full' });
  expect(full.content).toBe(original);
  const id = full.hits[0].table_ids[0]; expect(id).toBe(doc.tables[0].tableId);
  const table = await repo.executeAsync({ action: 'read_table', table_id: id });
  expect(table.table.rows[1]).toEqual(['A', '12.50']);
});
