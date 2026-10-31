import { Tools } from 'librechat-data-provider';
import type { TAttachment } from 'librechat-data-provider';

export type SanSuoFileSource = {
  file_id: string;
  filename: string;
  type?: string;
  source?: string;
  bytes?: number;
  status: 'ready' | 'failed';
  kind: 'file';
};

export function normalizeSanSuoFileSources(value: unknown): SanSuoFileSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: SanSuoFileSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const fileId = typeof source.file_id === 'string' ? source.file_id.trim() : '';
    const filename = typeof source.filename === 'string' ? source.filename.trim() : '';
    if (!fileId || !filename || seen.has(fileId)) continue;
    seen.add(fileId);
    result.push({
      file_id: fileId,
      filename,
      type: typeof source.type === 'string' ? source.type : undefined,
      source: typeof source.source === 'string' ? source.source : undefined,
      bytes: Number.isFinite(Number(source.bytes)) ? Number(source.bytes) : undefined,
      status: source.status === 'failed' ? 'failed' : 'ready',
      kind: 'file',
    });
  }
  return result.slice(0, 30);
}

export function getWorkspaceOutputs(attachments?: TAttachment[]): TAttachment[] {
  const seen = new Set<string>();
  return (attachments ?? []).filter((attachment) => {
    if (!attachment || attachment.type === Tools.web_search || attachment.type === Tools.memory) {
      return false;
    }
    const metadata = (attachment as TAttachment & { metadata?: Record<string, unknown> }).metadata;
    if (metadata?.visibility === 'tool' || metadata?.isIntermediate === true) return false;
    if (
      !attachment.filename ||
      (!('file_id' in attachment && attachment.file_id) && !attachment.filepath)
    )
      return false;
    const key = String(
      ('file_id' in attachment && attachment.file_id) ||
        attachment.filepath ||
        attachment.filename ||
        '',
    );
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getWorkspaceFileKind(filename = '', mime = '') {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  const type = mime.toLowerCase();
  if (extension === 'pdf' || type.includes('pdf')) return 'pdf';
  if (['doc', 'docx'].includes(extension) || type.includes('word')) return 'word';
  if (['xls', 'xlsx'].includes(extension) || type.includes('spreadsheet') || type.includes('excel'))
    return 'excel';
  if (['ppt', 'pptx'].includes(extension) || type.includes('presentation')) return 'powerpoint';
  if (/^(png|jpe?g|gif|webp|bmp|svg)$/.test(extension) || type.startsWith('image/')) return 'image';
  if (extension === 'csv' || type.includes('text/csv')) return 'csv';
  if (['zip', '7z', 'rar', 'gz', 'tar'].includes(extension) || /zip|compressed|archive/.test(type))
    return 'archive';
  if (extension === 'json' || type.includes('json')) return 'json';
  if (['md', 'markdown'].includes(extension) || type.includes('markdown')) return 'markdown';
  if (/^(mp3|wav|m4a|aac|flac|ogg|wma)$/.test(extension) || type.startsWith('audio/'))
    return 'audio';
  if (/^(mp4|mov|avi|webm|mkv|m4v|wmv)$/.test(extension) || type.startsWith('video/'))
    return 'video';
  if (/^(py|js|ts|jsx|tsx|html?|css|scss|sh|sql|ya?ml|xml)$/.test(extension)) return 'code';
  if (type.startsWith('text/') || ['txt', 'csv', 'log'].includes(extension)) return 'text';
  return 'file';
}

export function canPreviewWorkspaceSource(filename = '', mime = '') {
  const kind = getWorkspaceFileKind(filename, mime);
  // A more specific icon must not disable an existing plain-text source preview.
  if (kind === 'code') return mime.toLowerCase().startsWith('text/');
  return ['pdf', 'json', 'markdown', 'text', 'csv'].includes(kind);
}
