/* eslint-disable i18next/no-literal-string */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Search, X } from 'lucide-react';
import { Spinner } from '@librechat/client';
import { useNavigate } from 'react-router-dom';
import type { TMessage } from 'librechat-data-provider';
import { useMessagesInfiniteQuery } from '~/data-provider';
import { useAuthContext } from '~/hooks';
import { useSansuoFolders, type SansuoFolder } from '~/components/Conversations/sansuoFolders';
import { getFolderIcon } from '~/components/Conversations/folderVisuals';

type SearchDialogProps = {
  open: boolean;
  onClose: () => void;
};

type SearchResult = {
  conversationId: string;
  title: string;
  preview: string;
  folder?: SansuoFolder | null;
};

function cleanText(value?: string | null) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function getMessagePreview(message: TMessage) {
  const text = cleanText(message.text);
  if (text) {
    return text.length > 120 ? `${text.slice(0, 120)}...` : text;
  }
  return '文件、图片或工具消息';
}

function SearchResultRow({ result, onSelect }: { result: SearchResult; onSelect: () => void }) {
  const FolderIcon = result.folder ? getFolderIcon(result.folder.icon) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-[#f4f4f4] active:scale-[0.995]"
    >
      <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-text-primary">
          {result.title}
        </span>
        <span className="mt-1 block truncate text-sm text-text-secondary">{result.preview}</span>
      </span>
      {result.folder && FolderIcon && (
        <span className="mt-0.5 inline-flex max-w-40 shrink-0 items-center gap-1 rounded-full bg-[#f4f4f4] px-2 py-1 text-xs font-medium text-text-secondary">
          <FolderIcon className="h-3.5 w-3.5" style={{ color: result.folder.color }} />
          <span className="truncate">{result.folder.name}</span>
        </span>
      )}
    </button>
  );
}

export default function SearchDialog({ open, onClose }: SearchDialogProps) {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthContext();
  const { folders, assignments, setFolderExpanded } = useSansuoFolders();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }
    const frameId = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, [open]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const { data, isLoading, isFetching } = useMessagesInfiniteQuery(
    { search: debouncedQuery || undefined },
    {
      enabled: open && isAuthenticated && !!debouncedQuery,
      staleTime: 30000,
      cacheTime: 300000,
    },
  );

  const messages = useMemo(
    () => (data?.pages.flatMap((page) => page.messages) ?? []) as TMessage[],
    [data?.pages],
  );

  const results = useMemo(() => {
    const byId = new Map<string, SearchResult>();
    const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
    for (const message of messages) {
      const conversationId = message.conversationId;
      if (!conversationId || byId.has(conversationId)) {
        continue;
      }
      const folderId = assignments[conversationId] ?? null;
      const folder = folderId ? foldersById.get(folderId) : null;
      byId.set(conversationId, {
        conversationId,
        title: cleanText((message as TMessage & { title?: string }).title) || '未命名聊天',
        preview: getMessagePreview(message),
        folder,
      });
    }
    return Array.from(byId.values());
  }, [assignments, folders, messages]);

  if (!open) {
    return null;
  }

  const isSearching = !!debouncedQuery && (isLoading || isFetching);
  let resultContent = (
    <div className="px-4 py-8 text-center text-sm font-medium text-text-secondary">
      输入关键词搜索聊天标题和消息内容
    </div>
  );
  if (debouncedQuery && isSearching) {
    resultContent = (
      <div className="flex h-32 items-center justify-center">
        <Spinner className="text-text-primary" />
      </div>
    );
  } else if (debouncedQuery && results.length === 0) {
    resultContent = (
      <div className="px-4 py-8 text-center text-sm font-medium text-text-secondary">
        没有找到相关聊天
      </div>
    );
  } else if (debouncedQuery) {
    resultContent = (
      <div className="grid gap-1">
        <div className="px-4 pb-1 text-sm font-semibold text-text-secondary">搜索结果</div>
        {results.map((result) => (
          <SearchResultRow
            key={result.conversationId}
            result={result}
            onSelect={() => {
              if (result.folder) {
                setFolderExpanded(result.folder.id, true);
              }
              const suffix = result.folder
                ? `?folderId=${encodeURIComponent(result.folder.id)}`
                : '';
              navigate(`/c/${result.conversationId}${suffix}`, {
                state: { focusChat: true },
              });
              onClose();
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-start justify-center bg-black/20 px-3 pt-[7vh] backdrop-blur-[1px]">
      <button
        type="button"
        aria-label="关闭搜索"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="搜索聊天"
        className="relative flex max-h-[78vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[24px] border border-border-light bg-white shadow-2xl dark:bg-surface-primary"
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border-light px-5">
          <Search className="h-5 w-5 shrink-0 text-text-secondary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索聊天..."
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xl font-semibold text-text-primary placeholder:text-text-secondary focus:outline-none"
            autoComplete="off"
          />
          <button
            type="button"
            aria-label="关闭搜索"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-text-secondary transition hover:bg-surface-active-alt"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{resultContent}</div>
      </section>
    </div>
  );
}
