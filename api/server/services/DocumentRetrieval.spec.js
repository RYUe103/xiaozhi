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

const { weightedReciprocalRankFusion, protectDiverseCandidates } = require('./DocumentRetrieval');

const hit = (id, page, source) => ({ record: { id, pageStart: page, text: id }, rank: 1, source });

test('weighted RRF does not double count keyword and BM25 unless explicitly supplied', () => {
  const result = weightedReciprocalRankFusion([
    { name: 'bm25', weight: 0.75, results: [hit('lexical', 1, 'bm25')] },
    { name: 'vector', weight: 1, results: [hit('semantic', 2, 'vector')] },
  ]);
  expect(result.map(x => x.record.id)).toEqual(['semantic', 'lexical']);
  expect(result[0].score).toBeGreaterThan(result[1].score);
});

test('candidate protection preserves exclusive same-page evidence without underfilling', () => {
  const vector = Array.from({ length: 10 }, (_, i) => hit(`v${i}`, 87, 'vector'));
  const bm25 = [hit('b-unique', 82, 'bm25'), hit('v0', 87, 'bm25')];
  const fused = weightedReciprocalRankFusion([
    { name: 'bm25', weight: 0.75, results: bm25 },
    { name: 'vector', weight: 1, results: vector },
  ]);
  const result = protectDiverseCandidates(fused, [
    { name: 'bm25', results: bm25 }, { name: 'vector', results: vector },
  ], { limit: 6, uniquePerChannel: 2, maxPerPage: 2 });
  expect(result.map(x => x.record.id)).toContain('b-unique');
  expect(result).toHaveLength(6);
  expect(new Set(result.map(x => x.record.id)).size).toBe(6);
  expect(result.every(x => Number.isFinite(x.score) && x.ranks)).toBe(true);
});

test('duplicate channel results never add votes and invalid weights are rejected', () => {
  const a = hit('a', 1, 'vector');
  const result = weightedReciprocalRankFusion([{ name: 'vector', results: [a, a] }]);
  expect(result[0].score).toBeCloseTo(1 / 61);
  expect(result[0].ranks.vector).toBe(1);
  expect(() => weightedReciprocalRankFusion([], { k: -1 })).toThrow('INVALID_RRF_K');
  expect(() => weightedReciprocalRankFusion([{ weight: Infinity }])).toThrow('INVALID_RRF_WEIGHT');
});

test('protection cannot reorder fused scores or exceed a small pool', () => {
  const channels = ['bm25', 'vector'].map(name => ({ name, results: Array.from({ length: 20 }, (_, i) => hit(name + i, i, name)) }));
  const fused = weightedReciprocalRankFusion(channels);
  const result = protectDiverseCandidates(fused, channels, { limit: 3 });
  expect(result).toHaveLength(3);
  expect(result.map(h => h.score)).toEqual(result.map(h => h.score).sort((a, b) => b - a));
});
test('same page may contain many distinct facts; a page quota alone cannot drop them', () => {
 const records=Array.from({length:8},(_,i)=>({record:{id:String(i),pageStart:5,text:['太阳能路灯','人口与面积','水资源保护','会议日期','委员读书活动','工业产值','教育学校','铁路运输'][i]},source:'bm25'}));
 const fused=weightedReciprocalRankFusion([{name:'bm25',results:records}]);
 const result=protectDiverseCandidates(fused,[{name:'bm25',results:records}],{limit:8,maxPerPage:2});
 expect(result).toHaveLength(8);
});
test('exclusive reservations cannot evict middle-ranked evidence supported by both channels', () => {
 const bm25=Array.from({length:60},(_,i)=>hit('b'+i,i,'bm25'));
 const vector=Array.from({length:60},(_,i)=>hit(i<35?'b'+i:'v'+i,i,'vector'));
 const channels=[{name:'bm25',weight:.75,results:bm25},{name:'vector',weight:1,results:vector}];
 const fused=weightedReciprocalRankFusion(channels);
 const selected=protectDiverseCandidates(fused,channels,{limit:40});
 expect(selected.map(h=>h.record.id)).toEqual(expect.arrayContaining(fused.slice(0,30).map(h=>h.record.id)));
});
