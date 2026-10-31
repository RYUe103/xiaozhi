const { EToolResources } = require('librechat-data-provider');
const {
  createExecutionResourceService,
  isSanSuoMainToolResourceRequest,
} = require('./ExecutionResourceService');

function makeRef(storageSessionId, fileId, extra = {}) {
  return {
    ...extra,
    metadata: {
      ...(extra.metadata || {}),
      codeEnvRef: {
        kind: 'user',
        id: 'user-1',
        storage_session_id: storageSessionId,
        file_id: fileId,
      },
    },
  };
}

function makeRequest(overrides = {}) {
  return {
    user: { id: 'user-1' },
    body: { endpoint: 'SanSuoMain', sansuoMode: 'deep', ...overrides },
  };
}

describe('ExecutionResourceService', () => {
  let getSanSuoFiles;
  let log;
  let service;

  beforeEach(() => {
    getSanSuoFiles = jest.fn().mockResolvedValue([]);
    log = { info: jest.fn() };
    service = createExecutionResourceService({ getSanSuoFiles, log });
  });

  it('recognizes SanSuoMain from the request or active agent provider', () => {
    expect(isSanSuoMainToolResourceRequest(makeRequest(), {}, {})).toBe(true);
    expect(
      isSanSuoMainToolResourceRequest(
        { body: { endpoint: 'agents' } },
        {},
        { provider: 'SanSuoMain' },
      ),
    ).toBe(true);
    expect(
      isSanSuoMainToolResourceRequest({ body: { endpoint: 'agents' } }, {}, { provider: 'openai' }),
    ).toBe(false);
  });

  it('does not query or mount files during deep-mode initialization', async () => {
    const initial = { marker: true };
    const result = await service.augmentExecuteCodeToolResources({
      req: makeRequest(),
      primaryAgent: { provider: 'SanSuoMain' },
      conversationId: 'conversation-1',
      tool_resources: initial,
    });

    expect(result).toBe(initial);
    expect(getSanSuoFiles).not.toHaveBeenCalled();
  });

  it('loads only the current owner and conversation when execution is requested', async () => {
    const req = makeRequest();
    await service.augmentExecuteCodeToolResources({
      req,
      primaryAgent: { provider: 'SanSuoMain' },
      conversationId: 'conversation-1',
      force: true,
    });

    expect(getSanSuoFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        conversationId: 'conversation-1',
        status: 'ready',
      }),
      { sort: { createdAt: -1 } },
    );
  });

  it('preserves file_ids and merges existing, request, and persisted resources once', async () => {
    getSanSuoFiles.mockResolvedValue([
      {
        libreFileId: 'libre-persisted',
        displayFilename: 'data.xlsx',
        sandboxSessionId: 'storage-3',
        sandboxFileId: 'file-3',
      },
    ]);
    const req = makeRequest();
    const duplicate = makeRef('storage-1', 'file-1', { filename: 'existing.docx' });
    const result = await service.augmentExecuteCodeToolResources({
      req,
      primaryAgent: { provider: 'SanSuoMain' },
      conversationId: 'conversation-1',
      requestFiles: [duplicate, makeRef('storage-2', 'file-2', { filename: 'current.csv' })],
      tool_resources: {
        [EToolResources.execute_code]: { file_ids: ['legacy-id'], files: [duplicate] },
      },
      force: true,
    });

    const code = result[EToolResources.execute_code];
    expect(code.file_ids).toEqual(['legacy-id']);
    expect(code.files.map((file) => file.filename)).toEqual([
      'existing.docx',
      'current.csv',
      'data.xlsx',
    ]);
    expect(req.body.tool_resources).toBe(result);
  });

  it('prioritizes the current PDF and its best persisted parsing artifact', async () => {
    getSanSuoFiles.mockResolvedValue([
      {
        libreFileId: 'other',
        displayFilename: 'notes.docx',
        sandboxSessionId: 'storage-other',
        sandboxFileId: 'file-other',
      },
      {
        libreFileId: 'chunks',
        displayFilename: 'report_mineru_chunks.jsonl',
        sandboxSessionId: 'storage-chunks',
        sandboxFileId: 'file-chunks',
        metadata: { rootSourceFileId: 'pdf-root', artifactKind: 'pdf_mineru_chunks' },
      },
      {
        libreFileId: 'manifest',
        displayFilename: 'report_smart_manifest.json',
        sandboxSessionId: 'storage-manifest',
        sandboxFileId: 'file-manifest',
        metadata: { rootSourceFileId: 'pdf-root', artifactKind: 'pdf_smart_manifest' },
      },
    ]);
    const pdf = makeRef('storage-pdf', 'file-pdf', {
      file_id: 'pdf-root',
      filename: 'report.pdf',
      type: 'application/pdf',
    });
    const result = await service.augmentExecuteCodeToolResources({
      req: makeRequest(),
      primaryAgent: { provider: 'SanSuoMain' },
      conversationId: 'conversation-1',
      requestFiles: [pdf],
      force: true,
    });

    expect(result[EToolResources.execute_code].files.map((file) => file.filename)).toEqual([
      'report.pdf',
      'report_smart_manifest.json',
      'report_mineru_chunks.jsonl',
      'notes.docx',
    ]);
  });

  it('drops incomplete and hidden synthetic refs before tool loading', async () => {
    getSanSuoFiles.mockResolvedValue([
      { libreFileId: 'missing', displayFilename: 'missing.txt' },
      {
        libreFileId: 'hidden',
        displayFilename: 'hidden.txt',
        sandboxSessionId: 'storage-hidden',
        sandboxFileId: 'sansuo_hidden__file',
      },
    ]);
    const result = await service.augmentExecuteCodeToolResources({
      req: makeRequest(),
      primaryAgent: { provider: 'SanSuoMain' },
      conversationId: 'conversation-1',
      force: true,
    });

    expect(result[EToolResources.execute_code].files).toEqual([]);
  });

  it('does not query resources for a non-SanSuo agent', async () => {
    const initial = { untouched: true };
    const result = await service.augmentExecuteCodeToolResources({
      req: { user: { id: 'user-1' }, body: { endpoint: 'agents' } },
      primaryAgent: { provider: 'openai' },
      conversationId: 'conversation-1',
      tool_resources: initial,
      force: true,
    });

    expect(result).toBe(initial);
    expect(getSanSuoFiles).not.toHaveBeenCalled();
  });
});
