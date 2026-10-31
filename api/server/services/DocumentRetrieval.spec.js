const {
  tokenizeQuery,
  keywordScore,
  bm25Search,
  reciprocalRankFusion,
  searchRecords,
} = require('./DocumentRetrieval');

describe('DocumentRetrieval', () => {
  const records = [
    { id: 'a', text: 'GB 12345-2024 轴承温度达到 80 摄氏度时停机', kind: 'extracted_text', index: 0 },
    { id: 'b', text: '巡检周期为三个月，普通维护记录', kind: 'extracted_text', index: 1 },
    { id: 'c', text: '扫描页视觉摘要：轴承温度报警阈值为 80 摄氏度', kind: 'visual_summary', index: 2 },
  ];

  test('tokenizes Chinese terms and exact standards/numbers', () => {
    expect(tokenizeQuery('GB 12345-2024 轴承温度')).toEqual(
      expect.arrayContaining(['gb', '12345-2024', '轴承', '温度']),
    );
    expect(keywordScore(records[0].text, 'GB 12345-2024')).toBeGreaterThan(0);
  });

  test('ranks BM25 candidates and keeps visual channel separate', () => {
    const result = searchRecords(records, '轴承温度 80', { includeVisual: true });
    expect(result.bm25[0].record.id).toBe('a');
    expect(result.visual[0].record.id).toBe('c');
    expect(result.fused[0]).toHaveProperty('ranks');
    expect(result.warnings).toContain('vector_search_unavailable');
  });

  test('fuses independent rankings with source and rank evidence', () => {
    const fused = reciprocalRankFusion([
      [{ record: records[0], source: 'keyword' }],
      [{ record: records[0], source: 'bm25' }],
    ]);
    expect(fused[0]).toMatchObject({ record: records[0], sources: ['keyword', 'bm25'] });
    expect(fused[0].ranks).toEqual({ keyword: 1, bm25: 1 });
  });
});
