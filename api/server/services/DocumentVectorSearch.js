const crypto = require('crypto');
const fetch = require('node-fetch');

const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function isBailianEndpoint(endpoint) {
  try {
    return /^(?:dashscope(?:-intl|-us)?\.aliyuncs\.com|dashscope\.(?:intl|us)\.aliyuncs\.com)$/.test(new URL(endpoint).hostname);
  } catch { return false; }
}

function resolveEmbeddingConfig(options = {}, env = process.env) {
  const base = env.RAG_OPENAI_BASEURL || (isBailianEndpoint(env.QWEN_BASE_URL) ? env.QWEN_BASE_URL : '');
  const endpoint = options.endpoint || env.SANSUO_JIT_EMBEDDING_URL || (base ? base.replace(/\/$/, '') + '/embeddings' : '');
  const bailian = isBailianEndpoint(endpoint);
  const sameQwenProvider = bailian && isBailianEndpoint(env.QWEN_BASE_URL) &&
    new URL(endpoint).origin === new URL(env.QWEN_BASE_URL).origin;
  return {
    endpoint,
    apiKey: options.apiKey || env.SANSUO_JIT_EMBEDDING_KEY || env.SANSUO_JIT_EMBEDDING_API_KEY ||
      (sameQwenProvider ? env.QWEN_API_KEY : env.RAG_OPENAI_API_KEY),
    model: options.model || env.SANSUO_JIT_EMBEDDING_MODEL || env.EMBEDDINGS_MODEL || (bailian ? 'text-embedding-v4' : ''),
    revision: options.revision || env.SANSUO_JIT_EMBEDDING_REVISION || '1',
    bailian,
  };
}

/** Reuses an OpenAI-compatible embedding provider; never queries the knowledge-base corpus. */
class DocumentVectorSearch {
  constructor(options = {}) {
    const { fetchImpl = fetch, cache = null, timeoutMs = 15000, searchTimeoutMs = 45000, maxEmbeddingCalls = 256, maxEmbeddingChars = 480000, cacheQueries = true } = options;
    Object.assign(this, resolveEmbeddingConfig(options));
    this.fetch = fetchImpl;
    this.cache = cache;
    this.timeoutMs = timeoutMs;
    this.searchTimeoutMs = searchTimeoutMs;
    this.maxEmbeddingCalls = maxEmbeddingCalls;
    this.maxEmbeddingChars = maxEmbeddingChars;
    this.cacheQueries = cacheQueries;
    this.queryVectors = new Map();
    this.usage = { calls: 0, chars: 0, total_tokens: 0 };
  }
  get configured() { return Boolean(this.endpoint && this.apiKey && this.model); }
  async embed(texts, timeoutMs = this.timeoutMs) {
    if (!this.configured) throw new Error('VECTOR_PROVIDER_UNCONFIGURED');
    if (!texts.length || texts.some((text) => typeof text !== 'string' || !text.trim())) throw new Error('VECTOR_INPUT_INVALID');
    const chars = texts.reduce((sum, text) => sum + text.length, 0);
    if (this.usage.calls >= this.maxEmbeddingCalls || this.usage.chars + chars > this.maxEmbeddingChars) throw new Error('VECTOR_REQUEST_BUDGET_EXCEEDED');
    this.usage.calls++;
    this.usage.chars += chars;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(this.timeoutMs, timeoutMs)));
    try {
      const response = await this.fetch(this.endpoint, { method: 'POST', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: texts }) });
      if (!response.ok) throw new Error('VECTOR_HTTP_' + response.status);
      const result = await response.json();
      this.usage.total_tokens += result.usage?.total_tokens || 0;
      const rows = Array.isArray(result.data) ? result.data.slice().sort((a, b) => a.index - b.index) : null;
      if (!Array.isArray(rows) || rows.length !== texts.length || rows.some((r, i) => r.index !== i || !validVector(r.embedding))) throw new Error('VECTOR_RESPONSE_INVALID');
      if (rows.some((r) => r.embedding.length !== rows[0].embedding.length)) throw new Error('VECTOR_DIMENSION_MISMATCH');
      return rows.map((r) => r.embedding);
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('VECTOR_TIMEOUT');
      if (error.message.startsWith('VECTOR_')) throw error;
      throw new Error('VECTOR_REQUEST_FAILED');
    } finally { clearTimeout(timer); }
  }
  async search({ userId, conversationId, document, query, limit = 12 }) {
    if (!userId || !conversationId) throw new Error('DOCUMENT_ACCESS_DENIED');
    const records = [...(document.retrievalRecords || document.records), ...(document.visualRecords || [])];
    if (!records.length) return [];
    if (records.length > 2000) throw new Error('VECTOR_INDEX_BUDGET_EXCEEDED');
    if (!String(query || '').trim() || String(query).length > 8000) throw new Error('VECTOR_QUERY_INVALID');
    const scope = fingerprint([userId, conversationId, document.documentId, document.sourceHash,
      document.bindingVersion, document.retrievalIndex?.key, records.map(record => [record.parser_version, record.engine]),
      this.endpoint, this.model, this.revision]);
    // Segment embedding inputs without truncating the evidence returned by the Repository.
    const segments = records.flatMap((record, recordIndex) => {
      const result = [];
      for (let offset = 0; offset < record.text.length; offset += 6000) result.push({ ...record, recordIndex, offset, text: (record.retrievalContext?.text ? record.retrievalContext.text + '\n' : '') + record.text.slice(offset, offset + 6000) });
      return result;
    });
    if (segments.length > 5000) throw new Error('VECTOR_INDEX_BUDGET_EXCEEDED');
    const deadline = Date.now() + this.searchTimeoutMs;
    const remaining = () => {
      const ms = deadline - Date.now();
      if (ms <= 0) throw new Error('VECTOR_SEARCH_TIMEOUT');
      return ms;
    };
    // Check the complete missing index before spending provider calls. Fine-grained
    // MinerU blocks routinely exceed the old 400-segment cold-start allowance.
    const batchSize = this.bailian ? 10 : 32;
    const keys = segments.map(r => fingerprint([scope, r.id, r.kind, r.offset, r.text]));
    const vectors = [];
    for (let start = 0; start < keys.length; start += 50) {
      remaining();
      vectors.push(...await Promise.all(keys.slice(start, start + 50).map(key => this.cache?.get(key, scope) || null)));
    }
    remaining();
    const missing = segments.map((r, i) => ({ r, i })).filter(item => !validVector(vectors[item.i]));
    const newChars = missing.reduce((sum, item) => sum + item.r.text.length, 0);
    if (newChars > 240000) throw new Error('VECTOR_INDEX_BUDGET_EXCEEDED');
    const existingQuery = this.cacheQueries && this.queryVectors.get(fingerprint([scope, document.version, query]));
    const queryCalls = existingQuery ? 0 : 1;
    if (this.usage.calls + Math.ceil(missing.length / batchSize) + queryCalls > this.maxEmbeddingCalls ||
        this.usage.chars + newChars + (queryCalls ? query.length : 0) > this.maxEmbeddingChars)
      throw new Error('VECTOR_REQUEST_BUDGET_EXCEEDED');
    // Four bounded batches; retain every segment and wait for in-flight work on failure.
    for (let start = 0; start < missing.length; start += batchSize * 4) {
      const jobs = [];
      for (let offset = start; offset < Math.min(missing.length, start + batchSize * 4); offset += batchSize) {
        const batch = missing.slice(offset, offset + batchSize);
        jobs.push((async () => {
          const generated = await this.embed(batch.map(x => x.r.text), remaining());
          await Promise.all(batch.map(async (item, index) => {
            vectors[item.i] = generated[index];
            await this.cache?.set(keys[item.i], scope, generated[index]);
          }));
        })());
      }
      const outcomes = await Promise.allSettled(jobs);
      const failed = outcomes.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    const queryKey = fingerprint([scope, document.version, query]);
    let q = this.cacheQueries ? this.queryVectors.get(queryKey) : null;
    if (!q) {
      [q] = await this.embed([query], remaining());
      if (this.cacheQueries) {
        this.queryVectors.set(queryKey, q);
        if (this.queryVectors.size > 128) this.queryVectors.delete(this.queryVectors.keys().next().value);
      }
    }
    const scores = new Map(), offsets = new Map();
    segments.forEach((segment, i) => {
      const score = cosine(q, vectors[i]);
      if (score > (scores.get(segment.recordIndex) ?? -Infinity)) { scores.set(segment.recordIndex, score); offsets.set(segment.recordIndex, segment.offset); }
    });
    return records.map((record, i) => ({ record, source: record.kind === 'visual_summary' ? 'vector_visual' : 'vector', score: scores.get(i) ?? -1, source_offset: offsets.get(i) ?? null }))
      .sort((a, b) => b.score - a.score).slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  }
}

function validVector(v) { return Array.isArray(v) && v.length > 0 && v.length <= 32768 && v.every(Number.isFinite); }
function cosine(a, b) {
  if (!validVector(a) || !validVector(b) || a.length !== b.length) throw new Error('VECTOR_DIMENSION_MISMATCH');
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0));
  return norm ? dot / norm : 0;
}

/** New isolated cache collection; TTL expiry only removes derived vectors, never source artifacts. */
function createMongoVectorCache(mongoose) {
  let initialization;
  const ready = () => initialization ||= (async () => {
    const collection = mongoose.connection.collection('sansuo_jit_embedding_cache');
    await collection.createIndex({ key: 1, scope: 1 }, { unique: true });
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    return collection;
  })().catch((error) => { initialization = null; throw error; });
  return {
    async get(key, scope) { const row = await (await ready()).findOne({ key, scope, expiresAt: { $gt: new Date() } }); return row?.vector || null; },
    async set(key, scope, vector) { await (await ready()).updateOne({ key, scope }, { $set: { vector, expiresAt: new Date(Date.now() + 7 * 86400000) } }, { upsert: true }); },
  };
}

module.exports = { DocumentVectorSearch, createMongoVectorCache, cosine, resolveEmbeddingConfig };
