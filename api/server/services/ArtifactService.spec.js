const mockGetFiles = jest.fn();
const mockGetParseJobs = jest.fn();
const mockUpdateGovernance = jest.fn();
const mockCreateAudit = jest.fn();
const mongoose = require('mongoose');

jest.mock('~/models', () => ({
  getSanSuoFiles: (...args) => mockGetFiles(...args),
  getSanSuoFileParseJobs: (...args) => mockGetParseJobs(...args),
  updateSanSuoArtifactGovernance: (...args) => mockUpdateGovernance(...args),
  createSanSuoArtifactAudit: (...args) => mockCreateAudit(...args),
}));

const {
  classifyArtifact,
  resolveLineage,
  buildReferenceSnapshot,
  evaluateGcCandidate,
  buildArtifactReport,
  dryRunArtifactGc,
  setArtifactQuarantine,
} = require('./ArtifactService');

const now = new Date('2026-10-30T00:00:00.000Z');
const old = new Date('2026-09-01T00:00:00.000Z');

function source(overrides = {}) {
  return {
    userId: 'user-1',
    libreFileId: 'source-1',
    role: 'input',
    source: 'upload',
    status: 'ready',
    conversationId: 'conversation-a',
    messageId: 'message-a',
    size: 100,
    createdAt: old,
    ...overrides,
  };
}

function derived(overrides = {}) {
  return {
    userId: 'user-1',
    libreFileId: 'derived-1',
    role: 'output',
    source: 'sandbox',
    status: 'ready',
    conversationId: 'conversation-a',
    messageId: 'message-a',
    sandboxSessionId: 'storage-1',
    sandboxFileId: 'file-1',
    size: 40,
    createdAt: old,
    metadata: {
      artifactKind: 'pdf_preparse_artifact',
      rootSourceLibreFileId: 'source-1',
      derivedFrom: [{ file_id: 'source-1' }],
      isIntermediate: true,
    },
    ...overrides,
  };
}

describe('ArtifactService classification and lineage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('classifies source, MinerU derived artifact, cache, working, and deliverable', () => {
    expect(classifyArtifact(source())).toBe('source');
    expect(classifyArtifact(derived())).toBe('derived');
    expect(classifyArtifact(derived({ artifactType: 'cache' }))).toBe('cache');
    expect(
      classifyArtifact({ role: 'output', source: 'sandbox', metadata: { visibility: 'tool' } }),
    ).toBe('working');
    expect(
      classifyArtifact({ role: 'output', source: 'sandbox', metadata: { isDeliverable: true } }),
    ).toBe('deliverable');
  });

  it('resolves legacy MinerU parent and root without a migration', () => {
    expect(resolveLineage(derived())).toEqual({
      artifactId: 'derived-1',
      parentArtifactId: 'source-1',
      rootArtifactId: 'source-1',
    });
  });

  it('preserves multiple conversation references for one source lineage', () => {
    const records = [
      source(),
      derived(),
      source({
        libreFileId: 'source-alias',
        rootArtifactId: 'source-1',
        conversationId: 'conversation-b',
      }),
    ];
    const snapshot = buildReferenceSnapshot(derived(), { records });
    expect(snapshot.conversations).toEqual(['conversation-a', 'conversation-b']);
    expect(snapshot.activeReferenceCount).toBeGreaterThanOrEqual(2);
  });
});

describe('ArtifactService GC planning', () => {
  beforeEach(() => jest.clearAllMocks());

  it('never selects source, derived, or deliverable records for automatic quarantine', () => {
    const records = [
      source({ status: 'deleted' }),
      derived({ status: 'failed', conversationId: null, messageId: null }),
      {
        ...derived({ libreFileId: 'delivery-1', metadata: { isDeliverable: true } }),
        artifactType: 'deliverable',
      },
    ];
    for (const record of records) {
      expect(evaluateGcCandidate(record, { records, now }).eligible).toBe(false);
    }
  });

  it('identifies orphaned derived output but conservatively retains it', () => {
    const artifact = derived({
      metadata: { ...derived().metadata, rootSourceLibreFileId: 'missing' },
    });
    const result = evaluateGcCandidate(artifact, { records: [artifact], now });
    expect(result.reasons).toContain('orphaned_lineage');
    expect(result.blockers).toContain('derived_retained_with_source');
    expect(result.eligible).toBe(false);
  });

  it('selects only old unreferenced working/cache artifacts with confirmed storage refs', () => {
    const artifact = {
      ...derived({ libreFileId: 'working-1', conversationId: null, messageId: null, metadata: {} }),
      artifactType: 'working',
    };
    const result = evaluateGcCandidate(artifact, { records: [artifact], now, workingTtlDays: 7 });
    expect(result.reasons).toContain('working_ttl_expired');
    expect(result.blockers).toEqual([]);
    expect(result.eligible).toBe(true);
  });

  it('reports bytes by type and storage without changing records', () => {
    const records = [source(), derived()];
    const report = buildArtifactReport({ records, now });
    expect(report.totals).toMatchObject({ count: 2, bytes: 140 });
    expect(report.byType.source.count).toBe(1);
    expect(report.byType.derived.count).toBe(1);
    expect(report.byStorage.codeapi.count).toBe(1);
  });

  it('dry run only writes an audit summary', async () => {
    mockGetFiles.mockResolvedValue([source(), derived()]);
    mockGetParseJobs.mockResolvedValue([]);
    mockCreateAudit.mockResolvedValue({});
    const report = await dryRunArtifactGc({ userId: 'user-1', now });
    expect(report.totals.count).toBe(2);
    expect(mockUpdateGovernance).not.toHaveBeenCalled();
    expect(mockCreateAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'dry_run' }));
  });

  it('uses real message attachment references to block a shared artifact candidate', async () => {
    const originalMessageModel = mongoose.models.Message;
    const working = {
      ...derived({ libreFileId: 'working-1', conversationId: null, messageId: null, metadata: {} }),
      artifactType: 'working',
      rootArtifactId: 'source-1',
    };
    mongoose.models.Message = {
      find: jest.fn(() => ({
        select: jest.fn(() => ({
          lean: jest.fn().mockResolvedValue([
            {
              conversationId: 'conversation-b',
              messageId: 'message-b',
              files: [{ file_id: 'source-1' }],
            },
          ]),
        })),
      })),
    };
    mockGetFiles.mockResolvedValue([source(), working]);
    mockGetParseJobs.mockResolvedValue([]);
    mockCreateAudit.mockResolvedValue({});
    try {
      const report = await dryRunArtifactGc({ userId: 'user-1', now });
      const candidate = report.candidates.find((item) => item.artifactId === 'working-1');
      expect(candidate.references.conversations).toContain('conversation-b');
      expect(candidate.blockers).toContain('active_references');
      expect(candidate.eligible).toBe(false);
    } finally {
      if (originalMessageModel) mongoose.models.Message = originalMessageModel;
      else delete mongoose.models.Message;
    }
  });

  it('rejects quarantine when references or retention rules block it', async () => {
    mockGetFiles.mockResolvedValue([source({ status: 'deleted' })]);
    mockGetParseJobs.mockResolvedValue([]);
    await expect(
      setArtifactQuarantine({ userId: 'user-1', artifactId: 'source-1', action: 'quarantine' }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_NOT_ELIGIBLE' });
    expect(mockUpdateGovernance).not.toHaveBeenCalled();
  });

  it('quarantines eligible working files and restores them idempotently', async () => {
    const working = {
      ...derived({ libreFileId: 'working-1', conversationId: null, messageId: null, metadata: {} }),
      artifactType: 'working',
      gcState: 'active',
    };
    mockGetFiles.mockResolvedValue([working]);
    mockGetParseJobs.mockResolvedValue([]);
    mockUpdateGovernance.mockResolvedValue({ ...working, gcState: 'quarantined' });
    await setArtifactQuarantine({
      userId: 'user-1',
      artifactId: 'working-1',
      action: 'quarantine',
    });
    expect(mockUpdateGovernance).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ gcState: 'quarantined' }) }),
    );

    mockGetFiles.mockResolvedValue([{ ...working, gcState: 'quarantined' }]);
    mockUpdateGovernance.mockResolvedValue({
      ...working,
      gcState: 'active',
      quarantineUntil: null,
    });
    await setArtifactQuarantine({ userId: 'user-1', artifactId: 'working-1', action: 'restore' });
    expect(mockUpdateGovernance).toHaveBeenLastCalledWith(
      expect.objectContaining({ update: { gcState: 'active', quarantineUntil: null } }),
    );

    mockGetFiles.mockResolvedValue([{ ...working, gcState: 'active' }]);
    mockUpdateGovernance.mockClear();
    await setArtifactQuarantine({ userId: 'user-1', artifactId: 'working-1', action: 'restore' });
    expect(mockUpdateGovernance).not.toHaveBeenCalled();
  });
});
