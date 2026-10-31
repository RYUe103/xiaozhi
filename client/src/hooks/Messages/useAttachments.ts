import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import type { TAttachment, TFile } from 'librechat-data-provider';
import { useSearchResultsByTurn } from './useSearchResultsByTurn';
import store from '~/store';

function normalizeAttachment(attachment: TAttachment): TAttachment {
  const wrapped = attachment as TAttachment & { file?: TAttachment };
  const source = wrapped.file
    ? ({ ...attachment, ...wrapped.file } as TAttachment)
    : attachment;
  const normalized = { ...source } as TAttachment & {
    file?: unknown;
    url?: string;
    tool_call_id?: string;
  };
  delete normalized.file;
  const file = normalized as Partial<TFile> & {
    filepath?: string;
    toolCallId?: string;
  };
  if (!file.filepath && normalized.url) {
    file.filepath = normalized.url;
  }
  if (!file.toolCallId && normalized.tool_call_id) {
    file.toolCallId = normalized.tool_call_id;
  }
  return normalized;
}

export default function useAttachments({
  messageId,
  attachments,
}: {
  messageId?: string;
  attachments?: TAttachment[];
}) {
  const messageAttachmentsMap = useRecoilValue(store.messageAttachmentsMap);
  const messageAttachments = useMemo<TAttachment[]>(() => {
    const live = messageAttachmentsMap[messageId ?? ''];
    if (!attachments || attachments.length === 0) {
      return (live ?? []).map(normalizeAttachment);
    }
    if (!live || live.length === 0) {
      return attachments.map(normalizeAttachment);
    }
    /* DB-loaded attachments are the source of truth for which
     * attachments belong to this message, but live entries (from the
     * SSE handler / `useAttachmentPreviewSync` polling) carry fresher
     * lifecycle fields — `status`, `text`, `textFormat`,
     * `previewError`. Without this merge, the deferred-preview flow
     * would render "stuck pending" forever on a loaded conversation:
     * the message saved to DB at end-of-run has the immediate-persist
     * snapshot (`status: 'pending'`, `text: null`); the file record
     * itself updates to `'ready'` later, but the message's
     * `attachments` array doesn't get rewritten. Polling fetches the
     * resolved record into `messageAttachmentsMap`; merging here lets
     * `artifactTypeForAttachment` see the resolved text/textFormat
     * and route through the proper PanelArtifact card. */
    const liveByFileId = new Map<string, TAttachment>();
    for (const a of live) {
      const id = (a as Partial<TFile>).file_id;
      if (id) {
        liveByFileId.set(id, normalizeAttachment(a));
      }
    }
    return attachments.map((db) => {
      const normalizedDb = normalizeAttachment(db);
      const id = (normalizedDb as Partial<TFile>).file_id;
      if (!id) {
        return normalizedDb;
      }
      const liveEntry = liveByFileId.get(id);
      return liveEntry ? ({ ...normalizedDb, ...liveEntry } as TAttachment) : normalizedDb;
    });
  }, [attachments, messageAttachmentsMap, messageId]);

  const searchResults = useSearchResultsByTurn(messageAttachments);

  return {
    attachments: messageAttachments,
    searchResults,
  };
}
