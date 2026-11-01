const { DocumentArtifactRepository, artifactSignature } = require('./DocumentArtifactRepository');

function fixture(scope = {}) {
  const repo = new DocumentArtifactRepository({ userId: 'u', conversationId: 'c', secret: 'test-secret', ...scope });
  const doc = repo.add({ fileId: 'f', filename: '规范.pdf', engine: 'fitz', pageCount: 4,
    records: [{ chunk_id: 'a', page: 1, text: '# 第一章\n电子正文 GB/T 12345-2024 型号 ZX-800 第3.2条 80℃' },
      { chunk_id: 'b', page: 3, text: '前缀'.repeat(2000) + '后部证据：检修周期为三个月' },
      { chunk_id: 'c', page: 4, text: '# 第二章\n| 项目 | 数值 |\n| --- | --- |\n| 温度 | 80 |' }],
    pageRecords: [{ page: 2, text: '' }], pageImages: [1, 2, 3],
    summaries: [{ page: 2, summary: '扫描图含安全阀示意图', keywords: ['安全阀'] }] });
  return { repo, doc };
}

describe('authorized DocumentArtifactRepository', () => {
  test('invalidates loaded artifact bindings when parse generation, commit state or parser version changes', () => {
    const artifact = { libreFileId: 'a', metadata: { sourceHash: 'same', parseGeneration: 'g1', artifactSetStatus: 'complete', parserVersion: 'v1' } };
    for (const [key, value] of Object.entries({ parseGeneration: 'g2', artifactSetStatus: 'partial', parserVersion: 'v2' })) {
      expect(artifactSignature({ ...artifact, metadata: { ...artifact.metadata, [key]: value } })).not.toBe(artifactSignature(artifact));
    }
    expect(artifactSignature({ ...artifact, lastAccess: 'changed' })).toBe(artifactSignature(artifact));
  });
  test('classifies page text for visual preparation without calling it verified OCR', () => {
    const { repo } = fixture();
    const doc = repo.add({ fileId: 'quality', pageCount: 2, records: [
      { page: 1, text: 'This is a normal electronic PDF with readable text and numbers 12345.' },
      { page: 2, text: 'This is damaged text with replacement character \uFFFD in the middle.' },
    ] });
    expect(doc.pageCoverage.map((p) => p.textQuality)).toEqual(['plausible', 'suspect']);
  });
  test('fills missing MinerU pages with FITZ while excluding duplicate page text', async () => {
    const { repo } = fixture();
    const artifacts = ['mineru', 'visual'].map((type) => ({ libreFileId: type, displayFilename: `x_${type}_chunks.jsonl`, metadata: { rootSourceLibreFileId: 'mixed' } }));
    await repo.load({ roots: [{ file_id: 'mixed' }], artifacts, download: async (a) => Buffer.from(a.libreFileId === 'mineru'
      ? JSON.stringify({ page: 1, text: 'MinerU page one' })
      : [JSON.stringify({ page: 1, text: 'duplicate one' }), JSON.stringify({ page: 2, text: 'FITZ page two' })].join('\n')) });
    const doc = [...repo.documents.values()].find((d) => d.fileId === 'mixed');
    expect(doc.records.map((r) => [r.pageStart, r.engine, r.text, r.sourceArtifact])).toEqual([
      [1, 'mineru', 'MinerU page one', 'mineru'], [2, 'fitz', 'FITZ page two', 'visual'],
    ]);
  });
  test('scanned page has separate summary and no fabricated searchable body', () => {
    const { repo, doc } = fixture();
    const info = repo.execute({ action: 'info', document_id: doc.documentId });
    expect(info.page_coverage[1]).toMatchObject({ page: 2, hasExtractedText: false, hasVisualSummary: true, textStatus: 'empty' });
    const summary = repo.execute({ action: 'visual_page', pages: [2] });
    expect(summary.hits[0]).toMatchObject({ kind: 'visual_summary', engine: 'vl', page_start: 2 });
    expect(repo.execute({ action: 'read', pages: [2] }).error.code).toBe('PAGE_TEXT_UNAVAILABLE');
  });
  test('summary does not imply page image exists', () => {
    const { repo } = fixture();
    const doc = repo.add({ fileId: 'summary-only', summaries: [{ page: 5, summary: '保留摘要' }], pageCount: 5 });
    expect(doc.pageCoverage[4]).toMatchObject({ hasVisualPage: false, hasVisualSummary: true });
  });
  test('preserves historical chunk identity and page provenance', () => {
    const { repo, doc } = fixture();
    const result = repo.execute({ action: 'read', document_id: doc.documentId, chunk_id: doc.records[0].chunkId });
    expect(result.content).toContain('GB/T 12345-2024');
    expect(result.reference.chunk_id).toBe(doc.records[0].chunkId);
  });
  test('signed continuation binds scope, version and selection; tampering is rejected', () => {
    const { repo, doc } = fixture();
    const first = repo.execute({ action: 'read', chunk_id: doc.records[1].chunkId, max_chars: 200 });
    expect(first.continuation_token).toBeTruthy();
    const next = repo.execute({ action: 'read', continuation_token: first.continuation_token, max_chars: 200 });
    expect(next.offset).toBe(first.next_offset);
    expect(repo.execute({ action: 'read', continuation_token: first.continuation_token + 'x' }).error.code).toBe('CONTINUATION_INVALID');
    const other = fixture({ conversationId: 'different' }).repo;
    expect(other.execute({ action: 'read', continuation_token: first.continuation_token }).error.code).toBe('CONTINUATION_INVALID');
    doc.version = 'changed';
    expect(repo.execute({ action: 'read', continuation_token: first.continuation_token }).error.code).toBe('DOCUMENT_VERSION_MISMATCH');
  });
  test('expired continuation cannot be used', () => {
    let time = 1000;
    const { repo, doc } = fixture({ now: () => time });
    const first = repo.execute({ action: 'read', chunk_id: doc.records[1].chunkId, max_chars: 100 });
    time += 1800001;
    expect(repo.execute({ action: 'read', continuation_token: first.continuation_token }).error.code).toBe('CONTINUATION_INVALID');
  });
  test('priority chunk returns late evidence within budget and supports continuation', () => {
    const { repo, doc } = fixture();
    const result = repo.execute({ action: 'read', section_id: doc.headings[0].sectionId,
      chunk_id: doc.records[1].chunkId, query: '后部证据', max_chars: 300 });
    expect(result.content).toContain('检修周期为三个月');
    expect(result.content.length).toBeLessThanOrEqual(300);
  });
  test('unknown documents and invalid budgets are explicit', () => {
    const { repo } = fixture();
    expect(repo.execute({ action: 'read', document_id: '/etc/passwd' }).error.code).toBe('DOCUMENT_NOT_FOUND');
    expect(repo.execute({ action: 'read', pages: [1], max_chars: 50000 }).error.code).toBe('READ_BUDGET_EXCEEDED');
  });
  test('partial summary coverage is calculated against declared physical total', () => {
    const { repo } = fixture();
    const doc = repo.add({ fileId: 'partial', pageCount: 10, summaries: Array.from({ length: 7 }, (_, i) => ({ page: i + 1, summary: '摘要' })) });
    expect(doc.pageCoverage).toHaveLength(10);
    expect(doc.pageCoverage.filter((p) => p.hasVisualSummary)).toHaveLength(7);
  });
  test('load rejects foreign artifacts and reports invalid and unreadable objects', async () => {
    const { repo } = fixture();
    await repo.load({ roots: [{ file_id: 'loaded', filename: '历史.pdf' }], artifacts: [
      { userId: 'other', displayFilename: 'x_mineru_chunks.jsonl', metadata: { rootSourceLibreFileId: 'loaded' } },
      { userId: 'u', conversationId: 'c', displayFilename: 'x_visual_pages.jsonl', metadata: { rootSourceLibreFileId: 'loaded' } },
    ], download: async () => Buffer.from('not json') });
    const doc = [...repo.documents.values()].find((d) => d.fileId === 'loaded');
    expect(doc.records).toEqual([]);
    expect(doc.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ARTIFACT_INVALID' })]));
  });
  test('preserves valid lines when a persisted JSONL line is corrupt', async () => {
    const { repo } = fixture();
    await repo.load({ roots: [{ file_id: 'partial-jsonl' }], artifacts: [{ userId: 'u', conversationId: 'c', displayFilename: 'p_mineru_chunks.jsonl', metadata: { rootSourceLibreFileId: 'partial-jsonl' } }],
      download: async () => Buffer.from('{"text":"first","page":1}\ninvalid\n{"text":"last","page":2}') });
    const doc = [...repo.documents.values()].find((d) => d.fileId === 'partial-jsonl');
    expect(doc.records.map((r) => r.text)).toEqual(['first', 'last']);
    expect(doc.warnings[0].code).toBe('ARTIFACT_INVALID');
  });
  test('reads precise same-chunk chapter boundaries', () => {
    const { repo } = fixture();
    const doc = repo.add({ fileId: 'chapters', records: [{ page: 1, text: '# First\nalpha\n# Second\nbeta' }] });
    const result = repo.execute({ action: 'read', document_id: doc.documentId, section_id: doc.headings[1].sectionId });
    expect(result.content).toContain('beta');
    expect(result.content).not.toContain('alpha');
  });
  test('refreshes newly persisted VL summaries without changing text identity or repeated versions', () => {
    const { repo, doc } = fixture();
    const args = { fileId: doc.fileId, summaries: [{ page: 2, summary: 'updated scan summary' }], pageImages: [1, 2, 3] };
    const first = repo.updateVisual(args);
    const second = repo.updateVisual(args);
    expect(first.version).toBe(second.version);
    expect(second.records.map((r) => r.id)).toEqual(doc.records.map((r) => r.id));
    expect(second.pageCoverage[1].textStatus).toBe('empty');
  });
  test('search continuation preserves the signed vector ranking', async () => {
    const repo = new DocumentArtifactRepository({ userId: 'u', conversationId: 'c', secret: 'test' });
    const doc = repo.add({ fileId: 'vector-continuation', records: [{ page: 1, text: '相关'.repeat(500) }, { page: 2, text: 'semantic-answer'.repeat(300) }] });
    repo.vectorSearch = { configured: true, search: async () => [{ record: doc.records[1], rank: 1, source: 'vector', score: 1 }] };
    const first = await repo.executeAsync({ action: 'search', query: 'synonym', max_chars: 200 });
    const next = repo.execute({ action: 'search', continuation_token: first.continuation_token, max_chars: 200 });
    expect(next.hits[0].page_start).toBe(2);
    expect(next.content).toContain('semantic-answer');
    expect(next.offset).toBe(first.next_offset);
  });
});
test('visual followup uses physical page despite newly materialized image artifacts',()=>{
 const {repo,doc}=fixture();doc.sourceHash='hash';
 repo.previousReference={document_id:doc.documentId,visual_result_id:'v',source_sha256:'hash',page_start:3,version:'old-render-state',user_id:'u',conversation_id:'c'};
 expect(repo.execute({action:'read',document_id:doc.documentId}).content).toContain('后部证据');
 doc.sourceHash='changed';expect(repo.execute({action:'read',document_id:doc.documentId}).error.code).toBe('HISTORICAL_REFERENCE_STALE');
});
test('uncommitted generation cannot replace available evidence',async()=>{
 const {repo}=fixture();await repo.load({roots:[{file_id:'x',metadata:{sha256:'sha'}}],artifacts:[
  {libreFileId:'partial',displayFilename:'x_mineru_chunks.jsonl',metadata:{rootSourceLibreFileId:'x',sourceHash:'sha',parseGeneration:'incomplete'}}
 ],download:async()=>Buffer.from(JSON.stringify({text:'wrong partial',page:1}))});
 const doc=[...repo.documents.values()].find(d=>d.fileId==='x');expect(doc.records).toHaveLength(0);expect(doc.warnings).toContainEqual({code:'INCOMPLETE_OR_SUPERSEDED_PARSE_IGNORED'});
});

test('query-only read searches existing channels instead of returning missing page evidence', async () => {
 const {repo,doc}=fixture({quality:{queryProcessing:false,rerank:false}});
 repo.previousReference={document_id:doc.documentId,chunk_id:'missing-old-chunk',version:doc.version};
 const result=await repo.executeAsync({action:'read',document_id:doc.documentId,query:'检修周期'});
 expect(result.error).toBeUndefined();
 expect(result.content).toContain('三个月');
 expect(repo.trace.events.some(e=>e.stage==='BM25')).toBe(true);
 const explicit=await repo.executeAsync({action:'read',document_id:doc.documentId,query:'检修周期',pages:[2]});
 expect(explicit.error.code).toBe('PAGE_TEXT_UNAVAILABLE');
});
