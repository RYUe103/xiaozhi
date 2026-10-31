const { DocumentArtifactRepository } = require('./DocumentArtifactRepository');
const make = (options = {}) => {
  const repo = new DocumentArtifactRepository({ userId: 'u', conversationId: 'c', secret: 's', ...options });
  const doc = repo.add({ fileId: 'f', sourceHash: 'source-hash', records: [{ chunk_id: 'a', page: 1, text: '# Chapter\n' + 'long evidence '.repeat(500) }, { page: 2, text: 'second page evidence' }] });
  return { repo, doc };
};

describe('Repository authorization, history and read budgets', () => {
  test('rechecks authorization on each call and denies revoked or unavailable ACL before vector access', async () => {
    let allowed = true;
    const vectorSearch = { configured: true, search: jest.fn(async () => []) };
    const authorize = jest.fn(async () => allowed);
    const { repo } = make({ authorize, vectorSearch });
    expect((await repo.executeAsync({ action: 'list' })).documents).toHaveLength(1);
    allowed = false;
    expect((await repo.executeAsync({ action: 'search', query: 'evidence' })).error.code).toBe('DOCUMENT_ACCESS_DENIED');
    expect(vectorSearch.search).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledTimes(2);
    repo.authorize = async () => { throw Error('db'); };
    expect((await repo.executeAsync({ action: 'read', pages: [1] })).error.code).toBe('DOCUMENT_AUTHORIZATION_UNAVAILABLE');
  });
  test('historical reference cannot silently follow a different version or conversation', async () => {
    const { repo, doc } = make();
    const first = await repo.executeAsync({ action: 'read', pages: [1], max_chars: 200 });
    expect(first.reference).toMatchObject({ version: doc.version, user_id: 'u', conversation_id: 'c' });
    doc.version = 'new';
    expect(repo.execute({ action: 'read' }).error.code).toBe('HISTORICAL_REFERENCE_STALE');
    repo.previousReference = { ...first.reference, version: 'new', conversation_id: 'other' };
    expect(repo.execute({ action: 'read_adjacent' }).error.code).toBe('HISTORICAL_REFERENCE_STALE');
  });
  test('historical legacy identity remains usable with explicit unknown-version warning', () => {
    const { repo, doc } = make();
    repo.previousReference = { document_id: doc.documentId, chunk_id: doc.records[0].chunkId };
    const result = repo.execute({ action: 'read' });
    expect(result.content).toContain('long evidence');
    expect(result.warnings).toContain('HISTORICAL_REFERENCE_VERSION_UNKNOWN');
  });
  test('rejects naked offsets and cross-action token reuse', () => {
    const { repo } = make();
    const first = repo.execute({ action: 'read', pages: [1], max_chars: 200 });
    expect(repo.execute({ action: 'read', pages: [1], offset: 200 }).error.code).toBe('CONTINUATION_REQUIRED');
    expect(repo.execute({ action: 'visual_search', continuation_token: first.continuation_token }).error.code).toBe('CONTINUATION_ACTION_MISMATCH');
  });
  test('enforces cumulative tool-call and output budgets across a single Agent request', async () => {
    const { repo } = make({ budget: { maxCalls: 2, maxContentChars: 300 } });
    expect((await repo.executeAsync({ action: 'read', pages: [1], max_chars: 200 })).content.length).toBe(200);
    expect((await repo.executeAsync({ action: 'read', pages: [1], max_chars: 200 })).error.code).toBe('REQUEST_READ_BUDGET_EXCEEDED');
    expect((await repo.executeAsync({ action: 'info' })).error.code).toBe('REQUEST_READ_BUDGET_EXCEEDED');
  });
  test('coverage is bounded and can be read in windows without pretending unknown pages have text', () => {
    const { repo } = make();
    const doc = repo.add({ fileId: 'large', pageCount: 2000, records: [{ page: 1, text: 'start' }] });
    expect(repo.listDocuments().find((d) => d.document_id === doc.documentId).page_coverage).toHaveLength(60);
    const next = repo.execute({ action: 'info', document_id: doc.documentId, coverage_offset: 60 });
    expect(next.page_coverage[0]).toMatchObject({ page: 61, textStatus: 'unknown' });
    expect(next.next_coverage_offset).toBe(120);
  });
  test('streamed section windows concatenate without gaps or duplicated boundaries', () => {
    const { repo, doc } = make();
    let result = repo.execute({ action: 'read', section_id: doc.headings[0].sectionId, max_chars: 1000 });
    let combined = result.content;
    while (result.continuation_token) {
      result = repo.execute({ action: 'read', continuation_token: result.continuation_token, max_chars: 1000 });
      combined += result.content;
    }
    const full = repo.execute({ action: 'read', section_id: doc.headings[0].sectionId, max_chars: 20000 });
    expect(combined).toBe(full.content);
  });
  test('initial overview injection fails closed when root authorization is revoked', async () => {
    const { repo, doc } = make({ authorize: async () => false });
    const result = await repo.overviewAsync(doc.documentId);
    expect(result.error.code).toBe('DOCUMENT_ACCESS_DENIED');
    expect(result.content).toBeUndefined();
  });

  test('targeted chapter reads preserve boundaries and reject outside target chunks', () => {
    const { repo } = make();
    const doc = repo.add({ fileId: 'chapter-boundaries', records: [
      { page: 1, text: '# First\n' + 'first content '.repeat(80) },
      { page: 2, text: 'late target evidence\n# Second\nconfidential second chapter' },
      { page: 3, text: 'outside chunk' },
    ] });
    const result = repo.execute({ action: 'read', document_id: doc.documentId, section_id: doc.headings[0].sectionId, chunk_id: doc.records[1].chunkId, max_chars: 300 });
    expect(result.content).toContain('late target evidence');
    expect(result.content).not.toContain('Second');
    expect(result.reference.section_id).toBe(doc.headings[0].sectionId);
    expect(repo.execute({ action: 'read', document_id: doc.documentId, section_id: doc.headings[0].sectionId, chunk_id: doc.records[2].chunkId }).error.code).toBe('TARGET_OUTSIDE_SECTION');
  });

  test('does not disclose revoked metadata through an unknown-document error', async () => {
    const { repo } = make({ authorize: async () => false });
    const result = await repo.executeAsync({ action: 'read', document_id: 'missing' });
    expect(result.error.code).toBe('DOCUMENT_ACCESS_DENIED');
    expect(result.documents).toBeUndefined();
  });

});
