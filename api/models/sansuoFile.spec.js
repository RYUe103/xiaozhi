const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  getSanSuoFileModel,
  getSanSuoFileParseJobModel,
  getSanSuoArtifactAuditModel,
  rebindSanSuoFileConversationRefs,
  touchSanSuoArtifacts,
  updateSanSuoArtifactGovernance,
  createSanSuoArtifactAudit,
} = require('./sansuoFile');

describe('SanSuo file conversation rebinding', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      getSanSuoFileModel().deleteMany({}),
      getSanSuoFileParseJobModel().deleteMany({}),
      getSanSuoArtifactAuditModel().deleteMany({}),
    ]);
  });

  it('stores lifecycle metadata, access time, quarantine state, and audit without deleting data', async () => {
    const userId = new mongoose.Types.ObjectId();
    const File = getSanSuoFileModel();
    const created = await File.create({
      userId,
      role: 'output',
      source: 'sandbox',
      originalFilename: 'working.json',
      displayFilename: 'working.json',
      libreFileId: 'working-artifact',
      artifactType: 'working',
      retentionPolicy: 'task_ttl',
      gcState: 'active',
    });

    const accessedAt = new Date('2026-10-30T01:02:03.000Z');
    await touchSanSuoArtifacts({ userId, libreFileIds: ['working-artifact'], accessedAt });
    await updateSanSuoArtifactGovernance({
      userId,
      artifactId: 'working-artifact',
      update: {
        gcState: 'quarantined',
        quarantineUntil: new Date('2026-11-30T01:02:03.000Z'),
      },
    });
    await createSanSuoArtifactAudit({
      userId,
      artifactId: 'working-artifact',
      action: 'quarantine',
      result: { gcState: 'quarantined' },
    });

    const stored = await File.findById(created._id).lean();
    expect(stored.status).toBe('ready');
    expect(stored.lastAccessedAt.toISOString()).toBe(accessedAt.toISOString());
    expect(stored.gcState).toBe('quarantined');
    expect(
      await getSanSuoArtifactAuditModel().countDocuments({ artifactId: 'working-artifact' }),
    ).toBe(1);
  });

  it('moves the root file, derived artifacts, and parse job from new to the real conversation', async () => {
    const userId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();
    const File = getSanSuoFileModel();
    const Job = getSanSuoFileParseJobModel();
    const rootFileId = 'pdf-root-new';

    await File.create([
      {
        userId,
        conversationId: 'new',
        role: 'input',
        source: 'upload',
        originalFilename: 'manual.pdf',
        displayFilename: 'manual.pdf',
        libreFileId: rootFileId,
      },
      {
        userId,
        conversationId: 'new',
        role: 'output',
        source: 'backend',
        originalFilename: 'manual_preparse_mineru_chunks.jsonl',
        displayFilename: 'manual_preparse_mineru_chunks.jsonl',
        libreFileId: 'artifact-new',
        metadata: { rootSourceLibreFileId: rootFileId, artifactKind: 'pdf_mineru_chunks' },
      },
      {
        userId,
        conversationId: 'another-real-conversation',
        role: 'output',
        source: 'backend',
        originalFilename: 'protected.jsonl',
        displayFilename: 'protected.jsonl',
        libreFileId: 'artifact-protected',
        metadata: { rootSourceLibreFileId: rootFileId, artifactKind: 'pdf_mineru_chunks' },
      },
      {
        userId: otherUserId,
        conversationId: 'new',
        role: 'output',
        source: 'backend',
        originalFilename: 'other-user.jsonl',
        displayFilename: 'other-user.jsonl',
        libreFileId: 'artifact-other-user',
        metadata: { rootSourceLibreFileId: rootFileId, artifactKind: 'pdf_mineru_chunks' },
      },
    ]);
    await Job.create({
      userId,
      libreFileId: rootFileId,
      conversationId: 'new',
      filename: 'manual.pdf',
      mimeType: 'application/pdf',
      sourceRef: { storage_session_id: 'storage', file_id: 'source' },
      status: 'ready',
    });

    const result = await rebindSanSuoFileConversationRefs({
      userId,
      fileIds: [rootFileId],
      conversationId: 'conversation-real',
      messageId: 'message-real',
    });

    expect(result).toEqual({ inputFiles: 1, derivedArtifacts: 1, parseJobs: 1 });
    expect(await File.countDocuments({ userId, conversationId: 'conversation-real' })).toBe(2);
    expect(await Job.countDocuments({ userId, conversationId: 'conversation-real' })).toBe(1);
    expect(await File.countDocuments({ userId, conversationId: 'another-real-conversation' })).toBe(
      1,
    );
    expect(await File.countDocuments({ userId: otherUserId, conversationId: 'new' })).toBe(1);
  });

  it('is idempotent and does nothing for the new placeholder conversation', async () => {
    const userId = new mongoose.Types.ObjectId();
    expect(
      await rebindSanSuoFileConversationRefs({
        userId,
        fileIds: ['pdf-root'],
        conversationId: 'new',
      }),
    ).toEqual({ inputFiles: 0, derivedArtifacts: 0, parseJobs: 0 });
  });
});
