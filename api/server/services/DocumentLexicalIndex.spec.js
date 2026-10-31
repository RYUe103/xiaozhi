const { DocumentLexicalIndex, searchRecords, tokenizeQuery } = require('./DocumentRetrieval');

describe('persistable scoped lexical index', () => {
  const records = () => [
    { id: 'a', kind: 'extracted_text', text: '按 GB/T 12345-2024 第3.2条 型号ZX-800 温度80℃ 执行' },
    { id: 'b', kind: 'extracted_text', text: '型号ZX-8000 温度180℃ 按第3.20条执行' },
    { id: 'v', kind: 'visual_summary', text: '温度80℃示意图' },
  ];
  test('retains single-digit, standard, model and clause atoms without substring false hits', () => {
    const index = new DocumentLexicalIndex(records());
    expect(tokenizeQuery('GB/T 12345-2024 第3.2条 ZX-800 1')).toEqual(expect.arrayContaining(['gb/t', '12345-2024', '3.2', 'zx-800', '1']));
    for (const query of ['ZX-800', '80', '3.2']) {
      expect(index.search(query).keyword.map((hit) => hit.record.id)).toEqual(['a']);
    }
    expect(searchRecords(records(), '80', { index, includeVisual: true }).visual[0].record.id).toBe('v');
  });
  test('reuses only unchanged records within the same user and conversation', async () => {
    const data = new Map(); let writes = 0;
    const cache = { get: async (key, scope) => data.get(scope + key), set: async (key, scope, value) => { writes++; data.set(scope + key, value); } };
    const request = { cache, userId: 'u', conversationId: 'c', documentId: 'd' };
    const initial = records();
    await DocumentLexicalIndex.load(initial, request);
    expect(writes).toBe(3);
    const warm = await DocumentLexicalIndex.load(initial, request);
    expect(warm.cacheStats).toMatchObject({ reused: 3, updated: 0 });
    initial[1].text += '维护';
    expect((await DocumentLexicalIndex.load(initial, request)).cacheStats).toMatchObject({ reused: 2, updated: 1 });
    expect((await DocumentLexicalIndex.load(initial, { ...request, userId: 'other' })).cacheStats.updated).toBe(3);
    expect((await DocumentLexicalIndex.load(initial, { ...request, conversationId: 'other' })).cacheStats.updated).toBe(3);
  });
  test('deleted records disappear from postings even while their derived cache remains', async () => {
    const initial = records();
    const index = await DocumentLexicalIndex.load(initial.slice(1), { userId: 'u', conversationId: 'c', documentId: 'd' });
    expect(index.search('12345-2024').keyword).toEqual([]);
  });
  test('requires identity before cache lookup', async () => {
    const cache = { get: jest.fn() };
    await expect(DocumentLexicalIndex.load(records(), { cache })).rejects.toThrow('DOCUMENT_ACCESS_DENIED');
    expect(cache.get).not.toHaveBeenCalled();
  });
});
