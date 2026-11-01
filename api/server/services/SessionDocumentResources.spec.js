const { SessionDocumentResources } = require('./SessionDocumentResources');

describe('request-scoped conversation document directory', () => {
  let rows, roots, db, load;
  const root = (id, type = 'application/pdf') => ({ file_id: id, user: 'u', filename: id, type, metadata: { sha256: 'hash' } });
  const artifact = (id) => ({ libreFileId: id + '-text', userId: 'u', conversationId: 'c', status: 'ready', sandboxSessionId: 's', sandboxFileId: id,
    displayFilename: id + '_mineru_chunks.jsonl', metadata: { rootSourceLibreFileId: id, sourceHash: 'hash' } });
  beforeEach(() => {
    roots = [root('a'), root('b')]; rows = roots.map(r => artifact(r.file_id));
    db = { getSanSuoFiles: jest.fn(async () => rows), getFiles: jest.fn(async () => roots) };
    load = jest.fn(async () => ({ execute: jest.fn(async args => ({ status: 'ok', action: args.action })) }));
  });
  const create = (mode = 'deep') => new SessionDocumentResources({ userId: 'u', conversationId: 'c', mode, db, load });
  test('discovers multiple files without reading content or inspecting user language', async () => {
    const service = create(); await service.discover();
    expect(service.list('pdf')).toHaveLength(2); expect(load).not.toHaveBeenCalled();
    expect(db.getSanSuoFiles).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u', conversationId: 'c' }));
    const result = await service.execute('pdf', { action: 'list' });
    expect(result.documents).toHaveLength(2); expect(load).not.toHaveBeenCalled();
  });
  test.each(['fast', 'knowledge'])('does not discover deep documents in %s', async mode => {
    const s = create(mode); await s.discover(); expect(s.list('pdf')).toEqual([]); expect(db.getFiles).not.toHaveBeenCalled();
  });
  test('requires explicit selection for multiple files and rejects foreign IDs', async () => {
    const s = create(); await s.discover();
    expect((await s.execute('pdf', { action: 'read' })).status).toBe('file_selection_required');
    expect((await s.execute('pdf', { action: 'read', document_id: 'foreign' })).error.code).toBe('DOCUMENT_ACCESS_DENIED');
    expect(load).not.toHaveBeenCalled();
  });
  test('does not trust cross-user, cross-conversation or deleted rows even if a database stub returns them', async () => {
    rows[0].userId = 'other'; rows[1].conversationId = 'elsewhere';
    const s = create(); await s.discover(); expect(s.list('pdf')).toHaveLength(0);
  });
  test('rechecks deletion and source version before every execution', async () => {
    const s = create(); await s.discover(); const id = s.list('pdf')[0].document_id;
    roots[0].metadata.sha256 = 'new';
    expect((await s.execute('pdf', { action: 'read', document_id: id })).error.code).toBe('DOCUMENT_VERSION_MISMATCH');
    roots = roots.slice(1);
    expect((await s.execute('pdf', { action: 'read', document_id: id })).error.code).toBe('DOCUMENT_ACCESS_DENIED');
    expect(load).not.toHaveBeenCalled();
  });
  test('shares only an in-flight request-local content load and rechecks after it', async () => {
    const s = create(); await s.discover(); const id = s.list('pdf')[0].document_id;
    await Promise.all([s.execute('pdf', { action: 'read', document_id: id }), s.execute('pdf', { action: 'info', document_id: id })]);
    expect(load).toHaveBeenCalledTimes(1);
    const other = create(); await other.discover(); await other.execute('pdf', { action: 'read', document_id: id });
    expect(load).toHaveBeenCalledTimes(2);
  });
  test('denies a replaced artifact and ignores incomplete generations', async () => {
    const s = create(); await s.discover(); const id = s.list('pdf')[0].document_id;
    rows[0].sandboxFileId = 'replacement';
    expect((await s.execute('pdf', { action: 'read', document_id: id })).error.code).toBe('DOCUMENT_VERSION_MISMATCH');
    rows[0].metadata.parseGeneration = 'pending'; rows[1].metadata.parseGeneration = 'pending';
    const next = create(); await next.discover(); expect(next.list('pdf')).toHaveLength(0);
  });
});
