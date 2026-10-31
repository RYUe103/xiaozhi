'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { score, mean, percentile, deliveredRanking } = require('./metrics.cjs');
test('hand-calculated two-relevant ranking; precision denominator is K', () => {
  const value = score(['noise', 'a', 'noise2', 'b'], ['a', 'b']);
  assert.equal(value['recall@1'], 0);
  assert.equal(value['recall@3'], 0.5);
  assert.equal(value['recall@5'], 1);
  assert.equal(value['precision@3'], 1 / 3);
  assert.equal(value['precision@5'], 2 / 5);
  assert.equal(value['mrr@6'], 0.5);
});
test('empty ranking is not successful retrieval; negatives are separate', () => {
  assert.ok(Object.values(score([], ['a'])).every((v) => v === 0));
  assert.throws(() => score([], []));
  assert.throws(() => score(['a', 'a'], ['a']));
  assert.equal(score(['x','y','z','u','v','w','a'], ['a'])['mrr@6'], 0);
});
test('nearest-rank latency quantiles and empty means', () => {
  assert.equal(percentile([5, 1, 4, 2, 3], 0.5), 3);
  assert.equal(percentile([5, 1, 4, 2, 3], 0.95), 5);
  assert.equal(mean([]), null);
  assert.equal(mean([1, 3]), 2);
});
test('metadata or a partial answer does not count as delivered evidence', () => {
  const result = { hits: [{ chunk_id: 'chunk_a1' }, { chunk_id: 'chunk_b2' }], content: '[chunk_a1 page=1]\n轴承温度达到75' };
  const gold = [{ id: 'chunk_a1', fragment: '达到75摄氏度时应停机' }, { id: 'chunk_b2', fragment: '检查润滑系统' }];
  assert.deepEqual(deliveredRanking(result, gold), ['missing-0', 'missing-1']);
  assert.equal(score(deliveredRanking(result, gold), gold.map((g) => g.id))['recall@5'], 0);
});
test('answer must appear in correct record; ranks stay fixed in PDF and Word', () => {
  const expected = [{ id: 'chunk_b2', fragment: '唯一答案' }];
  const result = { hits: [{ chunk_id: 'chunk_a1' }, { chunk_id: 'chunk_b2' }], content: '[paragraph=1 chunk=chunk_a1]\n唯一答案\n\n[paragraph=2 chunk=chunk_b2]\n无关内容' };
  assert.deepEqual(deliveredRanking(result, expected), ['chunk_a1', 'missing-1']);
  result.content = '[chunk_a1 page=1]\n无关内容\n\n[chunk_b2 page=2]\n唯一答案';
  assert.equal(score(deliveredRanking(result, expected), ['chunk_b2'])['mrr@6'], 0.5);
});
