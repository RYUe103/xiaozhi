const { DocumentPageVisionService } = require('./DocumentPageVisionService');

function setup(overrides = {}) {
  const doc = { documentId: 'doc', sourceHash: 'hash', pageCount: 3 };
  const repository = { userId: 'u', conversationId: 'c', documents: new Map([['doc', doc]]), checkAuthorization: jest.fn().mockResolvedValue(null) };
  const getPage = jest.fn().mockResolvedValue({ id: 'image', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
  const content = JSON.stringify({ answer: '42 V', evidence_text: '42 V', cells: [{ row: 'voltage', column: 'value', value: '42', unit: 'V' }], series: [], uncertainties: [] });
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { total_tokens: 12 } }) });
  return { repository, getPage, fetchImpl, service: new DocumentPageVisionService({ repository, getPage, fetchImpl, baseURL: 'https://example.invalid', apiKey: 'test', model: 'vl', ...overrides }) };
}
const input = { document_id: 'doc', page: 2, query: '电压是多少？', mode: 'table' };

test('returns question-specific page evidence and deduplicates concurrent calls', async () => {
  const { service, getPage, fetchImpl } = setup();
  const [a, b] = await Promise.all([service.inspect(input), service.inspect(input)]);
  expect(a).toEqual(b);
  expect(a).toMatchObject({ ok: true, page: 2, result: { answer: '42 V' }, source: { type: 'original_pdf_page', page_image_id: 'image' } });
  expect(getPage).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages[0].content[0].text).toContain(input.query);
});
test('rejects invalid pages and regions before fetching any image', async () => {
  const { service, getPage } = setup();
  expect((await service.inspect({ ...input, page: 4 })).error.code).toBe('PAGE_NOT_FOUND');
  expect((await service.inspect({ ...input, region: { x0: 0.8, y0: 0, x1: 0.2, y1: 1 } })).error.code).toBe('INVALID_REGION');
  expect(getPage).not.toHaveBeenCalled();
});
test('rechecks authorization on cache hit and preserves failure as unavailable', async () => {
  const { service, repository, fetchImpl } = setup();
  await service.inspect(input);
  repository.checkAuthorization.mockResolvedValue({ ok: false, error: { code: 'DOCUMENT_ACCESS_DENIED' } });
  expect((await service.inspect(input)).error.code).toBe('DOCUMENT_ACCESS_DENIED');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('reports incomplete model output instead of claiming complete evidence', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }) });
  const { service } = setup({ fetchImpl });
  expect((await service.inspect(input)).warnings).toContain('VISION_RESULT_TRUNCATED');
  expect((await service.inspect(input)).status).toBe('partial');
});
test('unparseable model output is partial and preserved without invented structure', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] }) });
  const { service } = setup({ fetchImpl });
  const result = await service.inspect(input);
  expect(result).toMatchObject({ ok: false, status: 'partial', raw_model_output: 'not json', result: { cells: [], series: [] } });
});
