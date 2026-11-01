'use strict';

const crypto = require('crypto');
const { getDocumentId } = require('./DocumentContextService');
const { artifactSignature } = require('./DocumentArtifactRepository');

const fail = (code) => ({ status: 'unavailable', ok: false, error: { code }, message: '文档不可读取，请核对当前会话的授权、解析状态或版本。' });
const hash = root => root.metadata?.sha256 || root.metadata?.contentHash || null;
const kind = root => /pdf/i.test(root.type || root.mimeType || '') || /\.pdf$/i.test(root.filename || '') ? 'pdf'
  : /wordprocessingml/i.test(root.type || root.mimeType || '') || /\.docx$/i.test(root.filename || '') ? 'docx' : null;
const nameOf = a => a.displayFilename || a.originalFilename || '';
const isTextAsset = a => /_(?:mineru(?:_chunks\.jsonl|\.md|_content_list\.json|_blocks\.json)|visual_(?:pages\.jsonl|chunks\.jsonl|manifest\.json)|smart_manifest\.json|profile\.json|docx_blocks\.jsonl|docx_reading_pack\.md|docx_manifest\.json|docx_image_\d+\.(?:png|jpe?g|webp|gif))$/i.test(nameOf(a));
const signature = (root, artifacts) => crypto.createHash('sha256').update(JSON.stringify([
  root.file_id, String(root.user), hash(root), artifacts.map(a => artifactSignature(a)).sort(),
])).digest('hex');

/** Request-local resource directory, NOT a second tool registry.
 * Discover reads metadata only. The injected loader reuses existing readers.
 * No user question, model call, storage download or global private cache here.
 */
class SessionDocumentResources {
  constructor({ userId, conversationId, mode, db, load, maxDocuments = 128, maxCalls = 64 }) {
    Object.assign(this, { userId: String(userId || ''), conversationId, mode, db, load, maxDocuments, maxCalls });
    this.documents = new Map();
    this.loads = new Map();
    this.calls = 0;
  }

  async snapshot() {
    const rootHashes = new Map();
    const rows = await this.db.getSanSuoFiles({ userId: this.userId, conversationId: this.conversationId }, {
      select: 'libreFileId userId conversationId status sandboxSessionId sandboxFileId displayFilename originalFilename createdAt metadata.rootSourceLibreFileId metadata.sourceHash metadata.contentHash metadata.parseGeneration metadata.artifactSetStatus metadata.parserVersion',
    });
    const scoped = rows.filter(a => String(a.userId) === this.userId && a.conversationId === this.conversationId);
    const ids = [...new Set(scoped.map(a => a.metadata?.rootSourceLibreFileId).filter(Boolean))];
    if (!ids.length) return new Map();
    if (ids.length > this.maxDocuments) throw new Error('DOCUMENT_DIRECTORY_BUDGET_EXCEEDED');
    const roots = await this.db.getFiles({ user: this.userId, file_id: { $in: ids } }, {}, {});
    const found = new Map();
    for (const root of roots) {
      if (String(root.user) !== this.userId || !ids.includes(root.file_id) || ['deleted', 'failed'].includes(root.status) || !kind(root)) continue;
      if (scoped.some(a => a.libreFileId === root.file_id && ['deleted', 'failed'].includes(a.status))) continue;
      rootHashes.set(root.file_id, hash(root));
      let artifacts = scoped.filter(a => a.status === 'ready' && a.metadata?.rootSourceLibreFileId === root.file_id && isTextAsset(a));
      if (hash(root)) artifacts = artifacts.filter(a => !a.metadata?.sourceHash || a.metadata.sourceHash === hash(root));
      const generation = artifacts.filter(a => a.metadata?.parseGeneration && a.metadata?.artifactSetStatus === 'complete')
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0]?.metadata.parseGeneration;
      artifacts = artifacts.filter(a => a.metadata?.parseGeneration ? a.metadata.parseGeneration === generation : !generation);
      const readable = artifacts.some(a => a.sandboxSessionId && a.sandboxFileId &&
        (kind(root) === 'pdf' ? /_(?:mineru(?:_chunks\.jsonl|\.md|_content_list\.json)|visual_(?:pages|chunks)\.jsonl)$/i.test(nameOf(a)) : /_docx_(?:blocks\.jsonl|reading_pack\.md)$/i.test(nameOf(a))));
      if (!readable) continue;
      const id = getDocumentId(this.userId, root.file_id);
      found.set(id, { documentId: id, fileId: root.file_id, filename: root.filename || root.name,
        kind: kind(root), root, artifacts, sourceHash: hash(root), signature: signature(root, artifacts) });
    }
    found.rootHashes = rootHashes;
    return found;
  }

  async discover() {
    if (this.mode !== 'deep' || !this.userId || !this.conversationId || this.conversationId === 'new') return;
    this.documents = await this.snapshot();
  }

  list(type) {
    return [...this.documents.values()].filter(d => d.kind === type).map(d => ({
      document_id: d.documentId, file_id: d.fileId, filename: d.filename,
      source_sha256: d.sourceHash, status: 'available', content_loaded: this.loads.has(d.documentId),
    }));
  }

  async execute(type, args = {}) {
    if (++this.calls > this.maxCalls) return fail('REQUEST_READ_BUDGET_EXCEEDED');
    try {
      const candidates = [...this.documents.values()].filter(d => d.kind === type);
      const selected = args.document_id ? candidates.find(d => d.documentId === args.document_id)
        : args.file_id ? candidates.find(d => d.fileId === args.file_id) : candidates.length === 1 ? candidates[0] : null;
      if (args.action !== 'list' && !selected) return args.document_id || args.file_id ? fail('DOCUMENT_ACCESS_DENIED')
        : { status: 'file_selection_required', documents: this.list(type), files: this.list(type) };
      const current = await this.snapshot();
      const check = d => current.rootHashes?.has(d.fileId) && current.rootHashes.get(d.fileId) !== d.sourceHash ? 'DOCUMENT_VERSION_MISMATCH'
        : !current.has(d.documentId) ? 'DOCUMENT_ACCESS_DENIED'
        : current.get(d.documentId).signature !== d.signature ? 'DOCUMENT_VERSION_MISMATCH' : null;
      if (args.action === 'list') return { status: 'ok', documents: this.list(type).filter(d => !check(this.documents.get(d.document_id))) };
      const denied = check(selected); if (denied) return fail(denied);
      if (!this.loads.has(selected.documentId)) {
        const pending = Promise.resolve().then(() => this.load(current.get(selected.documentId)));
        this.loads.set(selected.documentId, pending);
        pending.catch(() => this.loads.delete(selected.documentId));
      }
      const reader = await this.loads.get(selected.documentId);
      // A source can be revoked while the storage download is in flight.
      const after = (await this.snapshot()).get(selected.documentId);
      if (!after) return fail('DOCUMENT_ACCESS_DENIED');
      if (after.signature !== selected.signature) return fail('DOCUMENT_VERSION_MISMATCH');
      return await reader.execute({ ...args, document_id: selected.documentId });
    } catch (error) {
      return fail(error.message === 'DOCUMENT_DIRECTORY_BUDGET_EXCEEDED' ? error.message : 'DOCUMENT_RESOURCE_UNAVAILABLE');
    }
  }
}

module.exports = { SessionDocumentResources };
