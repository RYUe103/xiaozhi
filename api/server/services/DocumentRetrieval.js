const crypto = require('crypto');
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const INDEX_VERSION = 'jit-lexical-v2';
const normalized = (value) => String(value || '').normalize('NFKC').toLowerCase();

function tokenize(value = '') {
  const tokens = [];
  for (const match of normalized(value).match(/[a-z0-9](?:[a-z0-9_.:/-]*[a-z0-9])?|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g) || []) {
    if (CJK.test(match)) {
      if (segmenter) for (const part of segmenter.segment(match)) if (part.isWordLike) tokens.push(part.segment);
      if (match.length <= 4) tokens.push(match);
      for (let i = 0; i < match.length - 1; i++) tokens.push(match.slice(i, i + 2));
      for (let i = 0; i < match.length - 2; i++) tokens.push(match.slice(i, i + 3));
    } else tokens.push(match);
  }
  return tokens.filter(Boolean);
}
function tokenizeQuery(value = '') { return [...new Set(tokenize(value))].slice(0, 120); }
function frequency(text) {
  const counts = new Map();
  const tokens = tokenize(text);
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return { counts: [...counts], length: tokens.length };
}
function validFrequency(value) {
  return value && Number.isSafeInteger(value.length) && value.length >= 0 && value.length <= 10000000 &&
    Array.isArray(value.counts) && value.counts.length <= 1000000 && value.counts.every(([term, count]) => typeof term === 'string' && term.length <= 10000 && Number.isSafeInteger(count) && count > 0);
}

/** Request-owned index: postings only refer to authorized Repository records. */
class DocumentLexicalIndex {
  constructor(records, frequencies = null) {
    this.records = records;
    this.postings = new Map();
    this.lengths = [];
    this.kinds = new Map();
    records.forEach((record, index) => {
      const value = frequencies?.[index] || frequency(record.text);
      this.lengths.push(value.length);
      for (const [term, count] of value.counts) {
        if (!this.postings.has(term)) this.postings.set(term, new Map());
        this.postings.get(term).set(index, count);
      }
      const kind = record.kind === 'visual_summary' ? 'visual_summary' : 'extracted_text';
      const stats = this.kinds.get(kind) || { count: 0, length: 0 };
      stats.count++; stats.length += value.length; this.kinds.set(kind, stats);
    });
  }
  static async load(records, { cache, userId, conversationId, documentId } = {}) {
    if (!userId || !conversationId || !documentId) throw new Error('DOCUMENT_ACCESS_DENIED');
    const scope = hash([INDEX_VERSION, userId, conversationId, documentId]);
    let reused = 0, updated = 0;
    const frequencies = [];
    // Bound concurrency and Mongo request size; unchanged records reuse their per-content index.
    for (let start = 0; start < records.length; start += 32) {
      const batch = await Promise.all(records.slice(start, start + 32).map(async (record) => {
        const key = hash([scope, record.id, record.kind, record.text]);
        const stored = await cache?.get(key, scope);
        if (validFrequency(stored)) { reused++; return stored; }
        const value = frequency(record.text); updated++;
        await cache?.set(key, scope, value);
        return value;
      }));
      frequencies.push(...batch);
    }
    const index = new DocumentLexicalIndex(records, frequencies);
    index.cacheStats = { reused, updated, index_version: INDEX_VERSION };
    return index;
  }
  search(query, kind = 'extracted_text', options = {}) {
    const terms = tokenizeQuery(query);
    const keyword = new Map(), bm25 = new Map();
    const stats = this.kinds.get(kind) || { count: 0, length: 0 };
    const avgdl = stats.length / stats.count || 1;
    const k1 = options.k1 || 1.2, b = options.b ?? 0.75;
    for (const term of terms) {
      const matches = [...(this.postings.get(term) || [])].filter(([i]) => (this.records[i].kind === 'visual_summary' ? 'visual_summary' : 'extracted_text') === kind);
      const idf = Math.log(1 + (stats.count - matches.length + 0.5) / (matches.length + 0.5));
      for (const [index, tf] of matches) {
        keyword.set(index, (keyword.get(index) || 0) + Math.max(1, term.length));
        const score = idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * this.lengths[index] / avgdl));
        bm25.set(index, (bm25.get(index) || 0) + score);
      }
    }
    const sorted = (values, source) => [...values].map(([index, score]) => ({ record: this.records[index], score, source }))
      .sort((a, b) => b.score - a.score || (a.record.index || 0) - (b.record.index || 0))
      .map((item, index) => ({ ...item, rank: index + 1 }));
    return { keyword: sorted(keyword, kind === 'visual_summary' ? 'visual_summary' : 'keyword'), bm25: sorted(bm25, 'bm25') };
  }
}

function keywordScore(text, query = '') {
  const tokens = new Set(tokenize(text));
  return tokenizeQuery(query).reduce((score, term) => score + (tokens.has(term) ? Math.max(1, term.length) : 0), 0);
}
function bm25Search(records = [], query = '', options = {}) {
  return (options.index || new DocumentLexicalIndex(records)).search(query, 'extracted_text', options).bm25;
}
function keywordSearch(records = [], query = '') {
  return new DocumentLexicalIndex(records).search(query).keyword;
}
function reciprocalRankFusion(resultSets = [], options = {}) {
  const k = Number(options.k) || 60;
  const byId = new Map();
  for (const set of resultSets) {
    for (const [rank, item] of set.entries()) {
      const id = item.record?.id || item.record?.chunkId || item.record?.sourceRecordId;
      if (!id) continue;
      const entry = byId.get(id) || { record: item.record, score: 0, sources: [], ranks: {} };
      const source = item.source || 'unknown';
      if (!entry.sources.includes(source)) {
        entry.score += 1 / (k + rank + 1); entry.sources.push(source); entry.ranks[source] = rank + 1;
      }
      byId.set(id, entry);
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score || String(a.record.id).localeCompare(String(b.record.id)));
}
function searchRecords(records = [], query = '', options = {}) {
  const index = options.index || new DocumentLexicalIndex(records);
  const result = index.search(query);
  const keyword = result.keyword.slice(0, options.limit || 20);
  const bm25 = result.bm25.slice(0, options.limit || 20);
  const visual = options.includeVisual ? index.search(query, 'visual_summary').keyword.slice(0, options.limit || 20) : [];
  const fused = reciprocalRankFusion([keyword, bm25, visual], options).slice(0, options.limit || 6);
  return { keyword, bm25, visual, fused, vector: [], warnings: ['vector_search_unavailable'] };
}
function createMongoLexicalCache(mongoose) {
  let initialization;
  const ready = () => initialization ||= (async () => {
    const collection = mongoose.connection.collection('sansuo_jit_lexical_cache');
    await collection.createIndex({ key: 1, scope: 1 }, { unique: true });
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    return collection;
  })().catch((error) => { initialization = null; throw error; });
  return {
    async get(key, scope) { return (await (await ready()).findOne({ key, scope, expiresAt: { $gt: new Date() } }))?.frequencies || null; },
    async set(key, scope, frequencies) { await (await ready()).updateOne({ key, scope }, { $set: { frequencies, expiresAt: new Date(Date.now() + 7 * 86400000) } }, { upsert: true }); },
  };
}
module.exports = { tokenizeQuery, tokenize, keywordScore, keywordSearch, bm25Search, reciprocalRankFusion, searchRecords, DocumentLexicalIndex, createMongoLexicalCache };
