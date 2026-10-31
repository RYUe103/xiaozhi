import { memo, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Constants } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import { useConversationsInfiniteQuery } from '~/data-provider';
import { useNavigateToConvo } from '~/hooks';
import { cn } from '~/utils';
import { useSansuoFolders } from '~/components/Conversations/sansuoFolders';
import { getFolderIcon } from '~/components/Conversations/folderVisuals';
import ProjectChatComposer from './ProjectChatComposer';

function formatDate(value?: string | null) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function getPreview(conversation: TConversation) {
  const title = conversation.title?.trim();
  if (!title || title === 'New Chat' || title === '新聊天') {
    return '打开这条聊天继续对话';
  }
  return '打开这条聊天继续对话';
}

const FolderHome = memo(function FolderHome() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const folderId = searchParams.get('folderId');
  const { navigateToConvo } = useNavigateToConvo();
  const { folders, assignments, setFolderExpanded } = useSansuoFolders();

  const folder = useMemo(
    () => folders.find((item) => item.id === folderId) ?? null,
    [folderId, folders],
  );
  const FolderIcon = getFolderIcon(folder?.icon);

  const { data } = useConversationsInfiniteQuery(
    {},
    {
      staleTime: 0,
      cacheTime: 0,
      refetchOnMount: 'always',
    },
  );

  const conversations = useMemo(() => {
    const all = data ? data.pages.flatMap((page) => page.conversations).filter(Boolean) : [];
    return (all as TConversation[])
      .filter((conversation) => {
        const conversationId = conversation.conversationId;
        return !!conversationId && folderId != null && assignments[conversationId] === folderId;
      })
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
        const bTime = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
        return bTime - aTime;
      });
  }, [assignments, data, folderId]);

  const openConversation = useCallback(
    (conversation: TConversation) => {
      if (folderId) {
        setFolderExpanded(folderId, true);
      }
      navigateToConvo(conversation, {
        currentConvoId: Constants.NEW_CONVO as string,
        resetLatestMessage: false,
      });
    },
    [folderId, navigateToConvo, setFolderExpanded],
  );

  if (!folder) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="text-lg font-semibold text-text-primary">文件夹不存在</div>
        <button
          type="button"
          onClick={() => navigate('/c/new')}
          className="mt-4 rounded-full bg-black px-4 py-2 text-sm font-semibold text-white"
        >
          返回聊天
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 pt-14 text-text-primary">
      <div className="mb-8 flex items-center gap-3">
        <FolderIcon className="h-7 w-7" style={{ color: folder.color }} aria-hidden="true" />
        <h1 className="truncate text-2xl font-semibold tracking-normal">{folder.name}</h1>
      </div>

      <div className="mb-7 w-full">
        <ProjectChatComposer folderId={folder.id} placeholder={`${folder.name}中的新聊天`} />
      </div>

      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          className="rounded-full bg-[#f1f1f1] px-4 py-2 text-sm font-semibold text-text-primary"
        >
          聊天
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {conversations.length === 0 ? (
          <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-border-light text-text-secondary">
            这个文件夹里还没有聊天
          </div>
        ) : (
          <div className="divide-y divide-border-light">
            {conversations.map((conversation) => (
              <button
                key={conversation.conversationId}
                type="button"
                onClick={() => openConversation(conversation)}
                className={cn(
                  'grid w-full grid-cols-[minmax(0,1fr)_80px] gap-5 py-4 text-left transition hover:bg-[#fafafa]',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold text-text-primary">
                    {conversation.title || '未命名聊天'}
                  </span>
                  <span className="mt-1 block truncate text-sm font-medium text-text-secondary">
                    {getPreview(conversation)}
                  </span>
                </span>
                <span className="self-center text-right text-sm font-semibold text-text-secondary">
                  {formatDate(conversation.updatedAt ?? conversation.createdAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default FolderHome;
