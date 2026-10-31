const crypto = require('crypto');
const { buildPdfDocument } = require('./DocumentContextService');
const { searchRecords, reciprocalRankFusion, tokenizeQuery, DocumentLexicalIndex } = require('./DocumentRetrieval');
const { buildDocumentTables } = require('./DocumentTables');
const { DocumentQueryProcessor } = require('./DocumentQueryProcessor');
const { DocumentEvidenceReranker } = require('./DocumentEvidenceReranker');
const { DocumentJitTrace, runtimeEvent } = require('./DocumentJitTrace');

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message) => ({ status: 'unavailable', ok: false, error: { code, message }, message });
const pageOf = (r) => r.pageStart ?? r.page_start ?? r.page ?? (r.page_idx != null ? Number(r.page_idx) + 1 : null);
const json = (buffer) => JSON.parse(Buffer.from(buffer).toString('utf8'));
const lines = (buffer, onInvalid = () => {}) => Buffer.from(buffer).toString('utf8').split(/\r?\n/).filter((s) => s.trim()).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { onInvalid(); return []; }
});


function artifactSignature(artifact) {
  return digest([artifact.libreFileId, String(artifact.userId || ''), artifact.conversationId,
    artifact.sandboxSessionId, artifact.sandboxFileId, artifact.status || 'ready',
    artifact.metadata?.rootSourceLibreFileId, artifact.metadata?.sourceHash || artifact.metadata?.contentHash || null]);
}
function splitMarkdown(text, chunkChars = 4500, overlap = 300) {
  const source = String(text || '').trim();
  if (!source) {
    return [];
  }
  const records = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + chunkChars);
    if (end < source.length) {
      const boundary = Math.max(
        source.lastIndexOf('\n\n', end),
        source.lastIndexOf('\n', end),
        source.lastIndexOf('。', end),
      );
      if (boundary > start + Math.floor(chunkChars * 0.6)) {
        end = boundary + 1;
      }
    }
    const chunk = source.slice(start, end).trim();
    if (chunk) {
      records.push({
        index: records.length,
        chunkId: `markdown-${records.length + 1}`,
        pageStart: null,
        pageEnd: null,
        text: chunk,
      });
    }
    if (end >= source.length) {
      break;
    }
    start = Math.max(start + 1, end - overlap);
  }
  return records;
}

/** Request-scoped authorized snapshot. No network, VL or storage URLs are exposed by execute. */
class DocumentArtifactRepository {
  constructor({ userId, conversationId, secret, now = Date.now, previousReference = null, vectorSearch = null, lexicalCache = null, authorize = null, budget = {}, trace = null, quality = {} } = {}) {
    if (!userId || !conversationId) throw new Error('DOCUMENT_ACCESS_DENIED');
    this.userId = String(userId);
    this.conversationId = String(conversationId);
    this.secret = secret || process.env.SANSUO_JIT_CONTINUATION_SECRET || process.env.JWT_SECRET || crypto.randomBytes(32);
    this.now = now;
    this.documents = new Map();
    this.previousReference = previousReference;
    this.vectorSearch = vectorSearch;
    this.lexicalCache = lexicalCache;
    this.authorize = authorize;
    this.quality = { queryProcessing: true, candidateDepth: 30, compactDelivery: true, rerank: true, ...quality };
    this.trace = trace || new DocumentJitTrace({ sink: (event) => runtimeEvent(event.stage, [this.userId, this.conversationId].join(':'), event) });
    this.queryProcessor = new DocumentQueryProcessor({ enabled: this.quality.queryProcessing });
    this.reranker = new DocumentEvidenceReranker(this.quality.rerankOptions || {});
    this.budget = { maxCalls: 32, maxContentChars: 160000, ...budget };
    this.usage = { calls: 0, contentChars: 0 };
  }

  /** Inputs are obtained by server-owned user/conversation/root queries and authenticated storage. */
  async load({ roots, artifacts, download }) {
    let loadedBytes = 0;
    for (const root of roots) {
      if (root.user && String(root.user) !== this.userId) continue;
      const related = artifacts.filter((a) => a.metadata?.rootSourceLibreFileId === root.file_id &&
        (!a.userId || String(a.userId) === this.userId) && (!a.conversationId || String(a.conversationId) === this.conversationId));
      const warnings = [];
      const buffers = new Map();
      for (const a of related) {
        const name = String(a.displayFilename || a.originalFilename || '');
        if (!/_(?:mineru(?:_chunks\.jsonl|\.md|_content_list\.json)|visual_(?:pages\.jsonl|chunks\.jsonl|manifest\.json)|smart_manifest\.json|profile\.json)$/i.test(name)) continue;
        try {
          const value = await download(a);
          loadedBytes += Buffer.byteLength(value);
          if (loadedBytes > 64000000) throw new Error('DOCUMENT_LOAD_BUDGET_EXCEEDED');
          buffers.set(name, { value, artifact: a });
        }
        catch (error) { if (error.message === 'DOCUMENT_LOAD_BUDGET_EXCEEDED') throw error;
          warnings.push({ code: 'ARTIFACT_READ_FAILED', artifact_id: a.libreFileId || null }); }
      }
      const choose = (regex) => [...buffers.entries()].find(([name]) => regex.test(name));
      const parse = (regex, fn) => {
        const item = choose(regex);
        if (!item) return null;
        const invalid = () => warnings.push({ code: 'ARTIFACT_INVALID', artifact_id: item[1].artifact.libreFileId || null });
        try { return fn(item[1].value, invalid); } catch { invalid(); return null; }
      };
      const mineru = parse(/_mineru_chunks\.jsonl$/i, lines);
      const fitz = parse(/_visual_chunks\.jsonl$/i, lines);
      const pages = parse(/_visual_pages\.jsonl$/i, lines) || [];
      const manifest = parse(/_visual_manifest\.json$/i, json) || parse(/_smart_manifest\.json$/i, json);
      const profile = parse(/_profile\.json$/i, json);
      if (manifest?.fallback_reason) warnings.push({ code: 'PARSER_FALLBACK', reason: manifest.fallback_reason });
      let records = mineru?.length ? mineru : fitz?.length ? fitz : pages.filter((p) => String(p.text || '').trim());
      let engine = mineru?.length ? 'mineru' : records.length ? 'fitz' : 'unknown';
      if (!records.length) {
        const md = choose(/_mineru\.md$/i);
        if (md) {
          records = splitMarkdown(Buffer.from(md[1].value).toString('utf8'));
          engine = 'mineru';
        }
      }
      const contentList = parse(/_mineru_content_list\.json$/i, json);
      if (!records.length && Array.isArray(contentList)) {
        records = contentList.map((r) => ({ ...r, text: r.text || r.content || r.markdown || r.table_body || r.html || '' })); engine = 'mineru';
      }
      const pageImages = related.flatMap((a) => {
        const match = String(a.displayFilename || '').match(/_(?:visual|review)_page_(\d+)\.(?:png|jpe?g|webp)$/i);
        return match ? [Number(match[1])] : [];
      });
      const visual = related.find((a) => a.metadata?.artifactKind === 'pdf_visual_summary');
      const index = visual?.metadata?.visualIndex;
      let summaries = [];
      const artifactHashes = [...new Set(related.map((a) => a.metadata?.sourceHash).filter(Boolean))];
      const sourceHash = root.metadata?.sha256 || root.metadata?.contentHash || (artifactHashes.length === 1 ? artifactHashes[0] : null);
      if (artifactHashes.length > 1) warnings.push({ code: 'ARTIFACT_SOURCE_CONFLICT' });
      if (artifactHashes.some((hash) => sourceHash && hash !== sourceHash)) {
        this.add({ fileId: root.file_id, filename: root.filename || root.name,
          sourceHash, warnings: [{ code: 'DOCUMENT_VERSION_MISMATCH' }] });
        continue;
      }
      if (index) {
        if (index.version !== 'pdf-visual-index-v1') warnings.push({ code: 'VISUAL_INDEX_VERSION_UNSUPPORTED' });
        else if (sourceHash && index.sourceHash && sourceHash !== index.sourceHash) warnings.push({ code: 'DOCUMENT_VERSION_MISMATCH' });
        else {
          if (!sourceHash || !index.sourceHash) warnings.push({ code: 'SOURCE_VERSION_UNKNOWN' });
          summaries = (Array.isArray(index.pages) ? index.pages : []).filter((p) => Number.isInteger(p.page) && p.page > 0 && String(p.summary || '').trim());
        }
      }
      const document = this.add({ fileId: root.file_id, filename: root.filename || root.name, records, engine, pageRecords: pages, pageImages,
        pageCount: manifest?.document_page_count || manifest?.page_count || (profile?.page_count_source !== 'content_list_max_page' && (manifest?.profile?.page_count || profile?.page_count)) || index?.pageCount || null,
        summaries, warnings: [...warnings, ...(profile?.is_mock ? [{ code: 'MOCK_PARSER_OUTPUT', provider: profile.provider }] : [])], contentList, sourceHash, sourceArtifact: choose(/_(?:mineru|visual)_chunks\.jsonl$/i)?.[1].artifact.libreFileId || null });
      document.artifactBindings = related.filter((a) => a.libreFileId).map((a) => ({ id: a.libreFileId, signature: artifactSignature(a) }));
    }
    return this;
  }

  add({ fileId, filename, records = [], engine = 'unknown', pageRecords = [], pageImages = [], pageCount = null,
    summaries = [], warnings = [], contentList = null, sourceHash = null, sourceArtifact = null }) {
    if (records.length > 50000 || records.reduce((sum, r) => sum + String(r.text || r.content || '').length, 0) > 16000000 || Number(pageCount) > 100000) throw new Error('DOCUMENT_LOAD_BUDGET_EXCEEDED');
    const document = buildPdfDocument({ userId: this.userId, fileId, filename, records, artifactId: sourceArtifact });
    document.records.forEach((r) => Object.assign(r, { id: r.chunkId, kind: 'extracted_text', engine, sourceArtifact }));
    document.visualRecords = summaries.map((p) => ({ id: 'visual_' + digest([fileId, p.page, p.summary]), pageStart: p.page, pageEnd: p.page,
      kind: 'visual_summary', engine: 'vl', text: p.summary, keywords: p.keywords || [] }));
    const observed = [...document.records.flatMap((r) => [r.pageStart, r.pageEnd]), ...pageRecords.map((p) => p.page), ...pageImages, ...summaries.map((p) => p.page)].filter((p) => Number.isInteger(p) && p > 0 && p <= 100000);
    const count = Number.isInteger(Number(pageCount)) && Number(pageCount) > 0 ? Number(pageCount) : null;
    const pageSet = new Set(observed);
    if (count) for (let p = 1; p <= count; p++) pageSet.add(p);
    const textPages = new Map(), layers = new Map(pageRecords.map((p) => [p.page, p]));
    const summaryPages = new Set(document.visualRecords.map((p) => p.pageStart)), imagePages = new Set(pageImages);
    for (const record of document.records) if (record.pageStart != null) {
      for (let page = record.pageStart; page <= Math.min(record.pageEnd, 100000); page++) {
        pageSet.add(page);
        if (!textPages.has(page)) textPages.set(page, new Set());
        textPages.get(page).add(record.engine);
      }
    }
    document.pageCoverage = [...pageSet].sort((a, b) => a - b).map((page) => {
      const text = textPages.get(page), layer = layers.get(page), summary = summaryPages.has(page), image = imagePages.has(page);
      return { page, hasExtractedText: Boolean(text), hasVisualPage: image, hasVisualSummary: summary,
        textStatus: text ? 'available' : layer && layer.text === '' ? 'empty' : 'unknown',
        visualStatus: summary ? 'available' : image ? 'pending' : 'unavailable',
        engines: [...new Set([...(text || []), ...(layer ? ['fitz'] : []), ...(summary ? ['vl'] : [])])],
        warnings: [...(!text ? ['PAGE_TEXT_UNAVAILABLE'] : []), ...(!image ? ['PAGE_IMAGE_UNAVAILABLE'] : [])] };
    });
    document.pageCount = count || (observed.length ? Math.max(...observed) : null);
    document.pageCountSource = count ? 'manifest' : 'observed_lower_bound';
    document.sourceHash = sourceHash;
    document.warnings = [...warnings, ...(!sourceHash ? [{ code: 'SOURCE_VERSION_UNKNOWN' }] : [])];
    document.bindingVersion = digest([fileId, sourceHash, sourceArtifact]);
    document.tables = buildDocumentTables(document, [...(Array.isArray(contentList) ? contentList : []), ...pageRecords.flatMap((page) => page.tables || [])]);
    document.version = digest([document.records.map((r) => [r.chunkId, r.text]), document.visualRecords, document.pageCoverage, document.tables, sourceHash]);
    this.documents.set(document.documentId, document);
    return document;
  }

  updateVisual({ fileId, summaries, pageImages = [] }) {
    const existing = [...this.documents.values()].find((d) => d.fileId === fileId);
    if (!existing) return null;
    const document = this.add({ fileId, filename: existing.filename, records: existing.records,
      engine: existing.records[0]?.engine || 'unknown', summaries, pageImages,
      pageCount: existing.pageCountSource === 'manifest' ? existing.pageCount : null,
      sourceHash: existing.sourceHash, warnings: existing.warnings, sourceArtifact: existing.artifactId });
    // Keep the original text-layer status and trusted structured tables when only VL changes.
    document.pageCoverage.forEach((page) => {
      const prior = existing.pageCoverage.find((p) => p.page === page.page);
      if (prior) {
        if (!page.hasExtractedText) page.textStatus = prior.textStatus;
        page.engines = [...new Set([...prior.engines.filter((engine) => engine !== 'vl'), ...page.engines])];
      }
    });
    document.tables = existing.tables;
    document.artifactBindings = existing.artifactBindings;
    document.version = digest([document.records.map((r) => [r.chunkId, r.text]), document.visualRecords, document.pageCoverage, document.tables, document.sourceHash]);
    return document;
  }

  listDocuments() {
    return [...this.documents.values()].map((d) => ({ document_id: d.documentId, file_id: d.fileId, filename: d.filename, format: 'pdf',
      page_count: d.pageCount, page_count_source: d.pageCountSource, chunk_count: d.records.length, table_count: d.tables.length, section_count: d.headings.length,
      page_coverage: d.pageCoverage.slice(0, 60), coverage_total: d.pageCoverage.length, coverage_truncated: d.pageCoverage.length > 60,
      coverage_summary: { text_pages: d.pageCoverage.filter((p) => p.hasExtractedText).length, summary_pages: d.pageCoverage.filter((p) => p.hasVisualSummary).length },
      warnings: d.warnings, version: d.version, status: d.records.length ? 'ready' : 'text_unavailable' }));
  }

  sign(payload) {
    const data = Buffer.from(JSON.stringify({ ...payload, user: this.userId, conversation: this.conversationId, expires: this.now() + 1800000 })).toString('base64url');
    return data + '.' + crypto.createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  decode(token, document) {
    try {
      const [data, signature, extra] = token.split('.');
      const expected = crypto.createHmac('sha256', this.secret).update(data).digest();
      const actual = Buffer.from(signature, 'base64url');
      if (extra || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw Error();
      const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
      if (payload.user !== this.userId || payload.conversation !== this.conversationId || payload.document !== document.documentId || payload.expires <= this.now()) throw Error();
      if (payload.version !== document.version) return fail('DOCUMENT_VERSION_MISMATCH', '文档已变化，请重新读取。');
      return payload;
    } catch { return fail('CONTINUATION_INVALID', '续读令牌无效、过期或不属于当前授权范围。'); }
  }

  async checkAuthorization(documents) {
    if (this.authorize) {
      try {
        for (const doc of documents) {
          const access = await this.authorize(doc);
          if (access !== true) return fail(typeof access === 'string' ? access : 'DOCUMENT_ACCESS_DENIED', '文档授权或源版本已变化，请重新选择当前会话文件。');
        }
      } catch { return fail('DOCUMENT_AUTHORIZATION_UNAVAILABLE', '暂时无法确认文档权限，读取已停止。'); }
    }
    return null;
  }

  async overviewAsync(documentId, maxChars = 16000) {
    const document = this.documents.get(documentId);
    const denied = await this.checkAuthorization(document ? [document] : []);
    if (denied) return denied;
    if (this.usage.calls >= this.budget.maxCalls || this.usage.contentChars + maxChars > this.budget.maxContentChars) return fail('REQUEST_READ_BUDGET_EXCEEDED', '本轮文档读取预算不足。');
    const result = this.overview(documentId, maxChars);
    this.usage.calls++;
    this.usage.contentChars += result.content?.length || 0;
    return result;
  }

  async executeAsync(input = {}) {
    const started = Date.now();
    const result = await this._executeAsync(input);
    this.trace.emit('EvidenceDelivery', { action: input.action || 'search', document_id: result.document_id,
      elapsed_ms: Date.now() - started, content_chars: result.content?.length || 0,
      pages: (result.hits || []).map(h => h.page_start), error: result.error?.code,
      truncated: result.truncated, continuation_available: Boolean(result.continuation_token) });
    return result;
  }

  async _executeAsync(input = {}) {
    if (this.usage.calls >= this.budget.maxCalls || this.usage.contentChars >= this.budget.maxContentChars) return fail('REQUEST_READ_BUDGET_EXCEEDED', '本轮文档读取预算已用完。');
    this.usage.calls++;
    const document = input.document_id ? this.documents.get(input.document_id) : this.documents.size === 1 ? [...this.documents.values()][0] : null;
    const checked = input.action === 'list' || !document ? [...this.documents.values()] : [document];
    const denied = await this.checkAuthorization(checked);
    if (denied) return denied;
    const action = input.action || 'search';
    let result;
    if (!['search', 'visual_search'].includes(action) || input.continuation_token || !document) result = this.execute(input);
    else {
      if (!document.lexicalIndex) {
        try {
          document.lexicalIndex = await DocumentLexicalIndex.load([...document.records, ...document.visualRecords], {
            cache: this.lexicalCache, userId: this.userId, conversationId: this.conversationId, documentId: document.documentId });
        } catch {
          document.lexicalIndex = new DocumentLexicalIndex([...document.records, ...document.visualRecords]);
          document.lexicalCacheWarning = 'LEXICAL_CACHE_UNAVAILABLE';
        }
      }
      const processed = await this.queryProcessor.process(input.query, this.trace);
      if (processed.method === 'original') this.trace.emit('QueryProcessor', { ...this.trace.query(input.query), method: 'original', query_count: 1, warning: processed.warning });
      const depth = Math.min(60, Math.max(input.limit || 6, this.quality.candidateDepth));
      const variants = [];
      for (const query of processed.queries) {
        const t = Date.now();
        const variant = searchRecords([...document.records, ...document.visualRecords], query, {
          index: document.lexicalIndex, includeVisual: action === 'visual_search' || input.include_visual_summary, limit: depth });
        const pack = (hits) => hits.map(h => ({ id: h.record.id, page: h.record.pageStart, score: h.score, rank: h.rank, kind: h.record.kind, engine: h.record.engine, source: h.source }));
        this.trace.emit('Keyword', { ...this.trace.query(query), elapsed_ms: Date.now() - t, hits: pack(variant.keyword) });
        this.trace.emit('BM25', { ...this.trace.query(query), elapsed_ms: Date.now() - t, hits: pack(variant.bm25) });
        if (this.vectorSearch?.configured) {
          const vt = Date.now();
          try {
            variant.vector = (await this.vectorSearch.search({ userId: this.userId, conversationId: this.conversationId, document, query, limit: Math.max(12, depth) }))
              .filter(h => action === 'visual_search' ? h.record.kind === 'visual_summary' : input.include_visual_summary || h.record.kind !== 'visual_summary');
            variant.warnings = [];
          } catch (error) { variant.warnings = [error.message.startsWith('VECTOR_') ? error.message : 'VECTOR_SEARCH_FAILED']; }
          this.trace.emit('Vector', { ...this.trace.query(query), elapsed_ms: Date.now() - vt, hits: pack(variant.vector), warnings: variant.warnings, usage: { ...this.vectorSearch.usage } });
        } else this.trace.emit('Vector', { configured: false, hits: [] });
        variants.push(variant);
      }
      // Merge query variants within each channel before cross-channel RRF: lexical duplicates cannot outvote semantics.
      const merge = (name) => {
        if (variants.length === 1) return variants[0][name];
        return reciprocalRankFusion(variants.map((v, index) => v[name].map(h => ({ ...h, source: name + ':q' + index })))).slice(0, depth)
          .map((h, index) => ({ ...h, source: name, rank: index + 1 }));
      };
      const lexical = { keyword: merge('keyword'), bm25: merge('bm25'), visual: merge('visual'), vector: merge('vector'),
        warnings: [...new Set(variants.flatMap(v => v.warnings))] };
      const rt = Date.now();
      lexical.fused = reciprocalRankFusion(action === 'visual_search' ? [lexical.visual, lexical.vector] : [lexical.keyword, lexical.bm25, lexical.visual, lexical.vector]).slice(0, this.quality.rerank ? 20 : Math.min(12, input.limit || 6));
      this.trace.emit('RRF', { elapsed_ms: Date.now() - rt, candidates: depth, hits: lexical.fused.map(h => ({ id: h.record.id, page: h.record.pageStart, score: h.score, ranks: h.ranks, sources: h.sources })) });
      if (this.quality.rerank) lexical.fused = (await this.reranker.rank(input.query, lexical.fused, this.trace)).slice(0, Math.min(12, input.limit || 6));
      if (document.lexicalCacheWarning) lexical.warnings.push(document.lexicalCacheWarning);
      result = this.execute(input, lexical);
    }
    if (result?.content) {
      if (this.usage.contentChars + result.content.length > this.budget.maxContentChars) return fail('REQUEST_READ_BUDGET_EXCEEDED', '本轮文档读取预算不足。');
      this.usage.contentChars += result.content.length;
    }
    if (result.reference) this.previousReference = result.reference;
    return result;
  }

  overview(documentId, maxChars = 16000) {
    const document = this.documents.get(documentId);
    if (!document?.records.length) return this.execute({ action: 'info', document_id: documentId });
    const records = document.records;
    const anchors = document.headings.length >= 2 ? [document.headings[0], document.headings[Math.floor(document.headings.length / 2)], document.headings.at(-1)] : [];
    const selected = anchors.length ? [...new Set(anchors.map((h) => h.chunkId))].map((id) => records.find((r) => r.chunkId === id)) :
      [...new Set([0, Math.floor(records.length / 2), records.length - 1])].map((i) => records[i]);
    const perRecord = Math.floor(maxChars / selected.length);
    const results = selected.map((record) => this.execute({ action: 'read', document_id: documentId, chunk_id: record.chunkId, query: anchors.find((h) => h.chunkId === record.chunkId)?.title, max_chars: Math.min(20000, perRecord) }));
    return { content: results.map((r) => r.content).filter(Boolean).join('\n\n'), hits: results.flatMap((r) => r.hits || []), scope: 'sampled_overview' };
  }

  execute(input = {}, retrievalOverride = null) {
    let args = { ...input };
    let continuationIds;
    const action = args.action || 'search';
    if (!['list', 'info', 'toc', 'search', 'read', 'read_table', 'read_adjacent', 'visual_page', 'visual_search'].includes(action)) return fail('ACTION_INVALID', '不支持的文档动作。');
    if (action === 'list') return { status: 'ok', documents: this.listDocuments() };
    const document = args.document_id ? this.documents.get(args.document_id) : this.documents.size === 1 ? [...this.documents.values()][0] : null;
    if (!document) return { ...fail('DOCUMENT_NOT_FOUND', '请指定当前聊天可用的 document_id。'), documents: this.listDocuments() };
    if (args.continuation_token) {
      const payload = this.decode(args.continuation_token, document);
      if (payload.error) return payload;
      if (action !== payload.selection.action && action !== 'read') return fail('CONTINUATION_ACTION_MISMATCH', '续读动作与原始读取不一致。');
      continuationIds = payload.rankedIds;
      args = { ...payload.selection, offset: payload.offset, max_chars: args.max_chars ?? payload.selection.max_chars };
    }
    if (!input.continuation_token && Number(input.offset) > 0) return fail('CONTINUATION_REQUIRED', '继续读取必须使用服务端签发的 continuation_token。');
    const base = { status: 'ok', ok: true, document_id: document.documentId, filename: document.filename, version: document.version };
    if (action === 'info') {
      const coverageOffset = Math.max(0, Math.floor(Number(args.coverage_offset) || 0));
      const coverage = document.pageCoverage.filter((p) => !args.pages || args.pages.includes(p.page));
      return { ...base, ...this.listDocuments().find((d) => d.document_id === document.documentId),
        page_coverage: coverage.slice(coverageOffset, coverageOffset + 60), coverage_offset: coverageOffset,
        next_coverage_offset: coverageOffset + 60 < coverage.length ? coverageOffset + 60 : null };
    }
    if (action === 'toc') {
      const offset = Math.max(0, Math.floor(Number(args.catalog_offset) || 0));
      return { ...base, sections: document.headings.slice(offset, offset + 60), section_count: document.headings.length,
        tables: document.tables.slice(offset, offset + 60).map((t) => ({ table_id: t.tableId,
          page_start: t.pageStart, page_end: t.pageEnd, structure: t.structure, readable: t.readable, warnings: t.warnings })),
        table_count: document.tables.length, next_catalog_offset: offset + 60 < Math.max(document.headings.length, document.tables.length) ? offset + 60 : null };
    }
    const previous = this.previousReference?.document_id === document.documentId ? this.previousReference : null;
    const usesPrevious = !args.chunk_id && !args.section_id && !args.table_id && !args.pages && ['read', 'read_table', 'read_adjacent'].includes(args.action || action);
    if (previous && usesPrevious && ((previous.version && previous.version !== document.version) ||
      (previous.user_id && previous.user_id !== this.userId) || (previous.conversation_id && previous.conversation_id !== this.conversationId))) return fail('HISTORICAL_REFERENCE_STALE', '历史引用的来源、会话或版本已变化，请重新检索。');
    let selected = [], warnings = previous && usesPrevious && !previous.version ? ['HISTORICAL_REFERENCE_VERSION_UNKNOWN'] : [], table = null, retrieval = null;
    const effectiveAction = args.action || action;
    if (effectiveAction === 'visual_page' || effectiveAction === 'visual_search') {
      if (effectiveAction === 'visual_page') selected = document.visualRecords.filter((r) => (args.pages || [args.page]).includes(r.pageStart));
      else { retrieval = retrievalOverride || searchRecords(document.visualRecords, args.query, { includeVisual: true }); selected = retrieval.fused.filter((h) => h.record.kind === 'visual_summary').map((h) => h.record); }
    } else if (effectiveAction === 'read_table') {
      const targetId = args.table_id || (usesPrevious ? previous?.table_id : null);
      table = targetId ? document.tables.find(t => t.tableId === targetId || t.aliases?.includes(targetId)) : null;
      if (!targetId && args.pages?.length) {
        const candidates = document.tables.filter(t => args.pages.some(page => page >= t.pageStart && page <= t.pageEnd));
        if (candidates.length === 1) table = candidates[0];
        else if (candidates.length > 1) return { ...base, ...fail('TABLE_SELECTION_REQUIRED', '指定页面存在多张表，请使用返回的table_id选择，不能复用其他页的历史表格。'),
          tables: candidates.map(t => ({ table_id: t.tableId, page_start: t.pageStart, page_end: t.pageEnd, structure: t.structure })) };
      }
      if (!table) return { ...fail('TABLE_STRUCTURE_UNAVAILABLE', '没有可可靠读取的指定表格。'), tables: document.tables.map((t) => ({ table_id: t.tableId, page_start: t.pageStart, page_end: t.pageEnd, structure: t.structure })) };
      if (args.pages?.length && !args.pages.some(page => page >= table.pageStart && page <= table.pageEnd)) return fail('TARGET_OUTSIDE_PAGE', '目标表格不在指定页面，不能复用历史表格。');
      if (table.readable === false) return { ...base, ...fail('TABLE_STRUCTURE_INCOMPLETE', '表格行列结构不完整，不能当作完整结构化表格读取。'), table_id: table.tableId, warnings: table.warnings };
      if (this.quality.compactDelivery && args.query) {
        const { focusTable } = require('./DocumentTableFocus');
        table = focusTable(table, args.query);
      }
      selected = [{ id: table.tableId, chunkId: table.chunkId, text: table.content, pageStart: table.pageStart, pageEnd: table.pageEnd, kind: 'table', engine: table.engine || 'unknown' }];
      warnings.push(...(table.warnings || []));
    } else if (effectiveAction === 'read_adjacent') {
      const center = document.records.findIndex((r) => r.chunkId === (args.chunk_id || previous?.chunk_id));
      const radius = Math.max(1, Math.min(3, args.adjacent_count || 1));
      selected = center < 0 ? [] : document.records.slice(Math.max(0, center - radius), center + radius + 1);
    } else if (effectiveAction === 'read') {
      const chunk = args.chunk_id || (!args.pages && !args.section_id ? previous?.chunk_id : null);
      const section = document.headings.find((h) => h.sectionId === (args.section_id || (!args.pages && !chunk ? previous?.section_id : null)));
      if (section) {
        const start = document.records.findIndex((r) => r.chunkId === section.chunkId);
        const sectionIndex = document.headings.indexOf(section);
        const next = document.headings.slice(sectionIndex + 1).find((h) => h.level <= section.level);
        const end = next ? document.records.findIndex((r) => r.chunkId === next.chunkId) : document.records.length;
        selected = document.records.slice(start, next ? end + 1 : end).map((r) => ({ ...r }));
        if (selected.length) {
          if (next && selected.at(-1).chunkId === next.chunkId) selected.at(-1).text = selected.at(-1).text.slice(0, next.textOffset || 0);
          selected[0].text = selected[0].text.slice(section.textOffset || 0);
          selected = selected.filter((r) => r.text.trim());
        }
        if (chunk && !selected.some((r) => r.chunkId === chunk)) return fail('TARGET_OUTSIDE_SECTION', '目标片段不属于指定章节。');
        if (section.textOffset == null) warnings.push('SECTION_BOUNDARY_UNCERTAIN');
      } else if (chunk) selected = document.records.filter((r) => r.chunkId === chunk);
      else selected = document.records.filter((r) => (args.pages || []).some((p) => r.pageStart != null && p >= r.pageStart && p <= r.pageEnd));
    } else {
      retrieval = retrievalOverride || searchRecords([...document.records, ...document.visualRecords], args.query, { index: document.lexicalIndex, includeVisual: args.include_visual_summary, limit: Math.min(12, args.limit || 6) });
      selected = retrieval.fused.map((h) => h.record);
    }
    if (continuationIds) {
      const recordsById = new Map([...document.records, ...document.visualRecords].map((r) => [r.id, r]));
      selected = continuationIds.map((id) => recordsById.get(id)).filter(Boolean);
    }
    if (!selected.length) return { ...base, ...fail(effectiveAction.startsWith('visual') ? 'VISUAL_SUMMARY_UNAVAILABLE' : 'PAGE_TEXT_UNAVAILABLE', '当前范围没有可用内容。'), page_coverage: document.pageCoverage.filter((p) => !args.pages || args.pages.includes(p.page)).slice(0, 60) };
    const max = Number(args.max_chars ?? (this.quality.compactDelivery ? (effectiveAction === 'search' ? 6000 : 12000) : 20000));
    if (!Number.isInteger(max) || max < 100 || max > 20000) return fail('READ_BUDGET_EXCEEDED', 'max_chars 必须为100至20000。');
    let excerpted = false;
    if (this.quality.compactDelivery && effectiveAction === 'search' && !args.max_chars && !input.continuation_token) {
      const perHit = Math.max(100, Math.floor(max / selected.length) - 160);
      const terms = tokenizeQuery(args.query).sort((a, b) => b.length - a.length);
      selected = selected.map(record => {
        if (record.text.length <= perHit) return record;
        excerpted = true;
        let best = 0, bestScore = -1;
        for (let offset = 0; offset < record.text.length; offset += Math.max(100, Math.floor(perHit / 2))) {
          const window = record.text.slice(offset, offset + perHit).toLowerCase();
          const score = terms.reduce((sum, term) => sum + (window.includes(term) ? term.length : 0), 0);
          if (score > bestScore) { best = offset; bestScore = score; }
        }
        return { ...record, text: record.text.slice(best, best + perHit) };
      });
      if (excerpted) warnings.push('SEARCH_EXCERPTS_USE_READ_FOR_FULL_EVIDENCE');
    }
    let offset = Math.max(0, Number(args.offset) || 0);
    // Offsets address lightweight spans. A long section is never concatenated into a second full string.
    const spans = [];
    let totalLength = 0;
    for (const record of selected) {
      const prefix = (spans.length ? '\n\n' : '') + '[' + record.id + ' page=' + (record.pageStart ?? '?') + ' kind=' + record.kind + ']\n';
      const start = totalLength;
      totalLength += prefix.length + record.text.length;
      spans.push({ record, prefix, start, bodyStart: start + prefix.length, end: totalLength });
    }
    const targetSpan = args.chunk_id && args.section_id ? spans.find((span) => span.record.chunkId === args.chunk_id) : null;
    if (!offset && targetSpan) offset = targetSpan.bodyStart;
    if (!input.continuation_token && args.query) {
      const terms = [String(args.query).toLowerCase(), ...tokenizeQuery(args.query).sort((a, b) => b.length - a.length)];
      for (const term of terms) {
        const span = (targetSpan ? [targetSpan] : spans).find((s) => s.record.text.toLowerCase().includes(term));
        if (!span) continue;
        const pos = span.bodyStart + span.record.text.toLowerCase().indexOf(term);
        if (pos > max) offset = Math.max(span.bodyStart, pos - Math.floor(max / 4));
        break;
      }
    }
    const next = Math.min(totalLength, offset + max);
    const active = spans.filter((s) => s.start < next && s.end > offset);
    const content = active.map((span) => {
      const prefix = span.prefix.slice(Math.max(0, offset - span.start), Math.max(0, next - span.start));
      const body = span.record.text.slice(Math.max(0, offset - span.bodyStart), Math.max(0, next - span.bodyStart));
      return prefix + body;
    }).join('');
    const delivered = active.filter((s) => s.bodyStart < next && s.end > offset).map((s) => s.record);
    const truncated = next < totalLength;
    const selection = { ...args, action: effectiveAction, continuation_token: undefined, offset: undefined };
    const rankedIds = effectiveAction === 'search' || effectiveAction === 'visual_search' ? selected.map((r) => r.id) : undefined;
    const continuation = truncated ? this.sign({ document: document.documentId, version: document.version, selection, rankedIds, offset: next }) : null;
    const includeTableStructure = table && !truncated && !offset && JSON.stringify([table.rows, table.cells, table.rowProvenance]).length <= max;
    if (table && !includeTableStructure) warnings.push('TABLE_STRUCTURE_METADATA_BUDGETED');
    return { ...base, action: effectiveAction, content, excerpted, offset, truncated, next_offset: truncated ? next : null, continuation_token: continuation,
      warnings, table_id: table?.tableId, table: table ? { structure: table.structure, rows: includeTableStructure ? table.rows : undefined,
        cells: includeTableStructure ? table.cells : undefined, row_provenance: includeTableStructure ? table.rowProvenance : undefined,
        complete: table.complete, columns: table.columns, source_table_id: table.sourceTableId, selected_row_indexes: table.selectedRowIndexes, total_rows: table.totalRows, selection: table.selection, source_complete: table.sourceComplete } : undefined, page_coverage: document.pageCoverage.filter((p) => args.pages ? args.pages.includes(p.page) : delivered.some((r) => r.pageStart != null && p.page >= r.pageStart && p.page <= r.pageEnd)).slice(0, 60),
      hits: delivered.map((r) => ({ chunk_id: r.chunkId || r.id, source_chunk_id: r.sourceChunkId, page_start: r.pageStart, page_end: r.pageEnd, kind: r.kind, engine: r.engine,
        table_ids: document.tables.filter((t) => t.chunkIds?.includes(r.chunkId)).map((t) => t.tableId) })),
      retrieval: retrieval ? { warnings: retrieval.warnings, keyword: retrieval.keyword.map((h) => ({ id: h.record.id, score: h.score, rank: h.rank })), bm25: retrieval.bm25.map((h) => ({ id: h.record.id, score: h.score, rank: h.rank })), vector: (retrieval.vector || []).map((h) => ({ id: h.record.id, score: h.score, rank: h.rank })), rrf: retrieval.fused.map((h) => ({ id: h.record.id, score: h.score, ranks: h.ranks, sources: h.sources })) } : undefined,
      reference: { document_id: document.documentId, chunk_id: delivered[0]?.chunkId || delivered[0]?.id, page_start: delivered[0]?.pageStart, page_end: delivered[0]?.pageEnd,
        section_id: args.section_id || null,
        table_id: table?.tableId || document.tables.find((t) => t.chunkIds?.includes(delivered[0]?.chunkId))?.tableId || null,
        version: document.version, source_hash: document.sourceHash, user_id: this.userId, conversation_id: this.conversationId } };
  }
}

module.exports = { DocumentArtifactRepository, artifactSignature };
