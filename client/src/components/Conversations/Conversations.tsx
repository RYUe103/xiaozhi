import { useMemo, memo, type FC, useCallback, useEffect, useId, useRef, useState } from 'react';
import throttle from 'lodash/throttle';
import * as Ariakit from '@ariakit/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Ellipsis, FolderPlus, Trash2, PenLine } from 'lucide-react';
import { useRecoilValue } from 'recoil';
import { DropdownPopup, Spinner, useMediaQuery } from '@librechat/client';
import { List, AutoSizer, CellMeasurer, CellMeasurerCache } from 'react-virtualized';
import { Constants } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import { useLocalize, TranslationKeys, useFavorites, useShowMarketplace } from '~/hooks';
import FavoritesList from '~/components/Nav/Favorites/FavoritesList';
import { useActiveJobs, useDeleteConversationMutation } from '~/data-provider';
import { groupConversationsByDate, cn } from '~/utils';
import Convo from './Convo';
import { useSansuoFolders, type SansuoFolder } from './sansuoFolders';
import { colorChoices, folderIconChoices, getFolderIcon } from './folderVisuals';
import store from '~/store';

export type CellPosition = {
  columnIndex: number;
  rowIndex: number;
};

export type MeasuredCellParent = {
  invalidateCellSizeAfterRender?: ((cell: CellPosition) => void) | undefined;
  recomputeGridSize?: ((cell: CellPosition) => void) | undefined;
};

interface ConversationsProps {
  conversations: Array<TConversation | null>;
  moveToTop: () => void;
  toggleNav: () => void;
  containerRef: React.RefObject<List>;
  loadMoreConversations: () => void;
  isLoading: boolean;
  isSearchLoading: boolean;
  isChatsExpanded: boolean;
  setIsChatsExpanded: (expanded: boolean) => void;
}

interface MeasuredRowProps {
  cache: CellMeasurerCache;
  rowKey: string;
  parent: MeasuredCellParent;
  index: number;
  style: React.CSSProperties;
  children: React.ReactNode;
}

/** Reusable wrapper for virtualized row measurement */
const MeasuredRow: FC<MeasuredRowProps> = memo(
  ({ cache, rowKey, parent, index, style, children }) => (
    <CellMeasurer cache={cache} columnIndex={0} key={rowKey} parent={parent} rowIndex={index}>
      {({ registerChild }) => (
        <div ref={registerChild as React.LegacyRef<HTMLDivElement>} style={style} className="px-3">
          {children}
        </div>
      )}
    </CellMeasurer>
  ),
);

MeasuredRow.displayName = 'MeasuredRow';

const LoadingSpinner = memo(() => {
  const localize = useLocalize();

  return (
    <div className="mx-auto mt-2 flex items-center justify-center gap-2">
      <Spinner className="text-text-primary" />
      <span className="animate-pulse text-text-primary">{localize('com_ui_loading')}</span>
    </div>
  );
});

LoadingSpinner.displayName = 'LoadingSpinner';

const folderLabels = {
  create: '新建文件夹',
  title: '新建文件夹',
  name: '文件夹名称',
  placeholder: '重要任务',
  cancel: '取消',
  confirm: '新建',
  styleLabel: '样式',
  colorLabel: '颜色',
  deleteTitle: '删除文件夹',
  deleteMessagePrefix: '删除文件夹“',
  deleteMessageSuffix: '”？聊天不会被删除。',
  deleteConfirm: '删除',
  moveChats: '保留聊天',
  moveChatsHint: '把文件夹里的聊天移动到：',
  unfiled: '不属于文件夹',
  deleteChats: '同时删除全部聊天',
  deleteChatsHint: '会删除这个文件夹里的全部聊天记录。',
  deleting: '删除中...',
};

const DateLabel: FC<{ groupName: string; isFirst?: boolean }> = memo(({ groupName, isFirst }) => {
  const localize = useLocalize();
  return (
    <h2
      aria-label={localize('com_a11y_chats_date_section', {
        date: localize(groupName as TranslationKeys) || groupName,
      })}
      className={cn('pl-1 pt-1 text-text-secondary', isFirst === true ? 'mt-0' : 'mt-2')}
      style={{ fontSize: '0.7rem' }}
    >
      {localize(groupName as TranslationKeys) || groupName}
    </h2>
  );
});

DateLabel.displayName = 'DateLabel';

type FlattenedItem =
  | { type: 'favorites' }
  | { type: 'folders-header' }
  | { type: 'folder-create' }
  | { type: 'folder'; folder: SansuoFolder }
  | { type: 'folder-convo'; convo: TConversation }
  | { type: 'chats-header' }
  | { type: 'header'; groupName: string }
  | { type: 'convo'; convo: TConversation }
  | { type: 'loading' };

const MemoizedConvo = memo(
  ({
    conversation,
    retainView,
    toggleNav,
    isGenerating,
  }: {
    conversation: TConversation;
    retainView: () => void;
    toggleNav: () => void;
    isGenerating: boolean;
  }) => {
    return (
      <Convo
        conversation={conversation}
        retainView={retainView}
        toggleNav={toggleNav}
        isGenerating={isGenerating}
      />
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.conversation.conversationId === nextProps.conversation.conversationId &&
      prevProps.conversation.title === nextProps.conversation.title &&
      prevProps.conversation.endpoint === nextProps.conversation.endpoint &&
      prevProps.isGenerating === nextProps.isGenerating
    );
  },
);

const SectionHeader = memo(
  ({
    label,
    isExpanded,
    onToggle,
  }: {
    label: string;
    isExpanded: boolean;
    onToggle: () => void;
  }) => (
    <button
      onClick={onToggle}
      className="group flex h-7 w-full items-center justify-between rounded-lg px-2 text-[13px] font-semibold text-text-primary transition hover:bg-[#f3f3f3] active:scale-[0.99]"
      type="button"
    >
      <span className="select-none">{label}</span>
      <ChevronDown
        className={cn('h-4 w-4 transition-transform duration-200', isExpanded ? '' : '-rotate-90')}
      />
    </button>
  ),
);

SectionHeader.displayName = 'SectionHeader';

const FolderCreateRow = memo(({ onCreate }: { onCreate: () => void }) => (
  <button
    type="button"
    onClick={onCreate}
    className="group flex h-8 w-full items-center gap-3 rounded-lg px-2 text-left text-[14px] font-medium text-text-primary transition hover:bg-[#f3f3f3] active:scale-[0.99]"
  >
    <FolderPlus className="h-[17px] w-[17px] text-text-primary" />
    <span className="min-w-0 truncate">{folderLabels.create}</span>
  </button>
));

FolderCreateRow.displayName = 'FolderCreateRow';

const FolderRow = memo(
  ({
    folder,
    expanded,
    active,
    onToggle,
    onOpen,
    onRename,
    onDelete,
  }: {
    folder: SansuoFolder;
    expanded: boolean;
    active: boolean;
    onToggle: () => void;
    onOpen: () => void;
    onRename: () => void;
    onDelete: () => void;
  }) => {
    const menuId = useId();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const FolderIcon = getFolderIcon(folder.icon);
    const dropdownItems = useMemo(
      () => [
        {
          label: '重命名',
          onClick: onRename,
          icon: <PenLine className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
        },
        {
          label: '删除',
          onClick: onDelete,
          icon: <Trash2 className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
        },
      ],
      [onDelete, onRename],
    );

    return (
      <div className="group relative">
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? `收起${folder.name}` : `展开${folder.name}`}
          className="absolute left-1 top-1/2 z-10 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-text-secondary transition hover:bg-[#e9e9e9]"
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', expanded && 'rotate-90')}
          />
        </button>
        <button
          type="button"
          onClick={onOpen}
          title={folder.name}
          className={cn(
            'flex h-8 w-full items-center gap-2.5 rounded-lg py-0 pl-8 pr-8 text-left text-[14px] font-medium text-text-primary transition active:scale-[0.99]',
            active ? 'bg-[#f3f3f3]' : 'hover:bg-[#f7f7f7]',
          )}
        >
          <FolderIcon
            className="h-[17px] w-[17px] shrink-0"
            style={{ color: folder.color }}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        </button>
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
          <DropdownPopup
            portal={true}
            menuId={menuId}
            isOpen={isMenuOpen}
            setIsOpen={setIsMenuOpen}
            focusLoop={true}
            className="z-[125]"
            unmountOnHide={true}
            trigger={
              <Ariakit.MenuButton
                aria-label="文件夹选项"
                className="grid h-7 w-7 place-items-center rounded-lg bg-[#f3f3f3] text-text-secondary transition hover:bg-[#e8e8e8]"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <Ellipsis className="h-4 w-4" aria-hidden="true" />
              </Ariakit.MenuButton>
            }
            items={dropdownItems}
          />
        </div>
      </div>
    );
  },
);

FolderRow.displayName = 'FolderRow';

const FolderCreateDialog = memo(
  ({
    open,
    title,
    confirmLabel,
    name,
    icon,
    color,
    onNameChange,
    onIconChange,
    onColorChange,
    onClose,
    onSubmit,
  }: {
    open: boolean;
    title: string;
    confirmLabel: string;
    name: string;
    icon: string;
    color: string;
    onNameChange: (name: string) => void;
    onIconChange: (icon: string) => void;
    onColorChange: (color: string) => void;
    onClose: () => void;
    onSubmit: () => void;
  }) => {
    if (!open) {
      return null;
    }

    const PreviewIcon = getFolderIcon(icon);

    return (
      <div className="fixed inset-0 z-[140] flex items-center justify-center px-4">
        <button
          type="button"
          aria-label={folderLabels.cancel}
          className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
          onClick={onClose}
        />
        <section className="relative w-full max-w-[460px] rounded-2xl border border-border-light bg-white p-5 shadow-2xl dark:bg-surface-primary">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-lg font-semibold text-text-primary">{title}</div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-xl text-text-secondary hover:bg-surface-active-alt"
              aria-label={folderLabels.cancel}
            >
              ×
            </button>
          </div>
          <label className="mb-2 block text-sm font-semibold text-text-primary">
            {folderLabels.name}
          </label>
          <div className="mb-4 flex items-center gap-3">
            <div
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            >
              <PreviewIcon className="h-6 w-6" />
            </div>
            <input
              value={name}
              placeholder={folderLabels.placeholder}
              onChange={(event) => onNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onSubmit();
                }
                if (event.key === 'Escape') {
                  onClose();
                }
              }}
              className="h-12 min-w-0 flex-1 rounded-2xl border border-border-medium bg-transparent px-4 text-base font-semibold outline-none transition focus:border-text-secondary"
            />
          </div>
          <div className="mb-3 text-sm font-semibold text-text-primary">
            {folderLabels.styleLabel}
          </div>
          <div className="mb-4 grid grid-cols-5 gap-2">
            {folderIconChoices.map((choice) => (
              <button
                key={choice.value}
                type="button"
                onClick={() => onIconChange(choice.value)}
                className={cn(
                  'flex h-10 items-center justify-center rounded-xl border text-text-primary transition hover:bg-surface-secondary',
                  icon === choice.value
                    ? 'border-text-primary bg-surface-secondary'
                    : 'border-border-light',
                )}
                title={choice.label}
              >
                <choice.Icon className="h-5 w-5" style={{ color }} />
              </button>
            ))}
          </div>
          <div className="mb-3 text-sm font-semibold text-text-primary">
            {folderLabels.colorLabel}
          </div>
          <div className="mb-5 flex gap-3">
            {colorChoices.map((choice) => (
              <button
                key={choice}
                type="button"
                aria-label={choice}
                onClick={() => onColorChange(choice)}
                className={cn(
                  'h-7 w-7 rounded-full border-2 transition',
                  color === choice ? 'border-text-primary' : 'border-transparent',
                )}
                style={{ backgroundColor: choice }}
              />
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-xl bg-surface-secondary px-4 text-sm font-semibold hover:bg-surface-active-alt"
            >
              {folderLabels.cancel}
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!name.trim()}
              className="h-10 rounded-xl bg-text-primary px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {confirmLabel}
            </button>
          </div>
        </section>
      </div>
    );
  },
);

FolderCreateDialog.displayName = 'FolderCreateDialog';

const FolderDeleteDialog = memo(
  ({
    folder,
    folders,
    mode,
    destinationFolderId,
    isDeletingChats,
    onModeChange,
    onDestinationChange,
    onClose,
    onConfirm,
  }: {
    folder: SansuoFolder | null;
    folders: SansuoFolder[];
    mode: 'move' | 'delete';
    destinationFolderId: string | null;
    isDeletingChats: boolean;
    onModeChange: (mode: 'move' | 'delete') => void;
    onDestinationChange: (folderId: string | null) => void;
    onClose: () => void;
    onConfirm: () => void;
  }) => {
    if (!folder) {
      return null;
    }

    return (
      <div className="fixed inset-0 z-[140] flex items-center justify-center px-4">
        <button
          type="button"
          aria-label={folderLabels.cancel}
          className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
          onClick={onClose}
        />
        <section className="relative w-full max-w-[420px] rounded-2xl border border-border-light bg-white p-5 shadow-2xl dark:bg-surface-primary">
          <div className="mb-2 text-sm font-semibold text-text-secondary">
            {folderLabels.deleteTitle}
          </div>
          <div className="mb-5 text-base font-semibold text-text-primary">
            {folderLabels.deleteMessagePrefix}
            {folder.name}
            {folderLabels.deleteMessageSuffix}
          </div>
          <div className="mb-6 grid gap-2">
            <label className="flex cursor-pointer gap-3 rounded-xl border border-border-light p-3 transition hover:bg-surface-secondary">
              <input
                type="radio"
                name="folder-delete-mode"
                checked={mode === 'move'}
                onChange={() => onModeChange('move')}
                className="mt-1"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text-primary">
                  {folderLabels.moveChats}
                </span>
                <span className="mt-1 block text-xs text-text-secondary">
                  {folderLabels.moveChatsHint}
                </span>
                <select
                  value={destinationFolderId ?? ''}
                  disabled={mode !== 'move'}
                  onChange={(event) => onDestinationChange(event.target.value || null)}
                  className="mt-2 h-9 w-full rounded-xl border border-border-light bg-white px-3 text-sm outline-none disabled:opacity-50 dark:bg-surface-primary"
                >
                  <option value="">{folderLabels.unfiled}</option>
                  {folders
                    .filter((item) => item.id !== folder.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-xl border border-border-light p-3 transition hover:bg-surface-secondary">
              <input
                type="radio"
                name="folder-delete-mode"
                checked={mode === 'delete'}
                onChange={() => onModeChange('delete')}
                className="mt-1"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text-primary">
                  {folderLabels.deleteChats}
                </span>
                <span className="mt-1 block text-xs text-text-secondary">
                  {folderLabels.deleteChatsHint}
                </span>
              </span>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-xl bg-surface-secondary px-4 text-sm font-semibold hover:bg-surface-active-alt"
            >
              {folderLabels.cancel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isDeletingChats}
              className="h-10 rounded-xl bg-text-primary px-4 text-sm font-semibold text-white transition hover:opacity-90"
            >
              {isDeletingChats ? folderLabels.deleting : folderLabels.deleteConfirm}
            </button>
          </div>
        </section>
      </div>
    );
  },
);

FolderDeleteDialog.displayName = 'FolderDeleteDialog';

const Conversations: FC<ConversationsProps> = ({
  conversations: rawConversations,
  moveToTop,
  toggleNav,
  containerRef,
  loadMoreConversations,
  isLoading,
  isSearchLoading,
  isChatsExpanded,
  setIsChatsExpanded,
}) => {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeFolderId = searchParams.get('folderId');
  const search = useRecoilValue(store.search);
  const currentConversation = useRecoilValue(store.conversationByIndex(0));
  const isCurrentSubmitting = useRecoilValue(store.isSubmittingFamily(0));
  const { favorites, isLoading: isFavoritesLoading } = useFavorites();
  const {
    folders,
    assignments,
    expanded,
    foldersOpen,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleFolder,
    setFolderExpanded,
    toggleFoldersOpen,
    moveConversation,
    setPendingFolder,
    consumePendingFolder,
  } = useSansuoFolders();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const convoHeight = isSmallScreen ? 44 : 34;
  const showAgentMarketplace = useShowMarketplace();
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderIcon, setFolderIcon] = useState('folder');
  const [folderColor, setFolderColor] = useState('#d1a934');
  const [renamingFolder, setRenamingFolder] = useState<SansuoFolder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<SansuoFolder | null>(null);
  const [deleteFolderMode, setDeleteFolderMode] = useState<'move' | 'delete'>('move');
  const [deleteDestinationFolderId, setDeleteDestinationFolderId] = useState<string | null>(null);
  const deleteConvoMutation = useDeleteConversationMutation();

  const favoritesContentKeyRef = useRef('');

  // Fetch active job IDs for showing generation indicators
  const { data: activeJobsData } = useActiveJobs();
  const activeJobIds = useMemo(
    () => new Set(activeJobsData?.activeJobIds ?? []),
    [activeJobsData?.activeJobIds],
  );
  const localGeneratingConversationId = useMemo(() => {
    if (!isCurrentSubmitting) {
      return null;
    }

    const conversationId = currentConversation?.conversationId;
    if (!conversationId || conversationId === Constants.NEW_CONVO) {
      return null;
    }

    return conversationId;
  }, [currentConversation?.conversationId, isCurrentSubmitting]);
  const generatingConversationIds = useMemo(() => {
    const ids = new Set(activeJobIds);
    if (localGeneratingConversationId) {
      ids.add(localGeneratingConversationId);
    }
    return ids;
  }, [activeJobIds, localGeneratingConversationId]);

  // Determine if FavoritesList will render content
  const shouldShowFavorites =
    !search.query && (isFavoritesLoading || favorites.length > 0 || showAgentMarketplace);

  favoritesContentKeyRef.current = `${favorites.length}-${showAgentMarketplace ? 1 : 0}-${isFavoritesLoading ? 1 : 0}`;

  const filteredConversations = useMemo(
    () => rawConversations.filter(Boolean) as TConversation[],
    [rawConversations],
  );

  const groupedConversations = useMemo(
    () =>
      groupConversationsByDate(
        filteredConversations.filter((conversation) => {
          const conversationId = conversation.conversationId;
          return !conversationId || !assignments[conversationId];
        }),
      ),
    [filteredConversations, assignments],
  );

  const folderConversations = useMemo(() => {
    const byFolder = new Map<string, TConversation[]>();
    folders.forEach((folder) => byFolder.set(folder.id, []));
    filteredConversations.forEach((conversation) => {
      const conversationId = conversation.conversationId;
      const folderId = conversationId ? assignments[conversationId] : null;
      if (folderId && byFolder.has(folderId)) {
        byFolder.get(folderId)?.push(conversation);
      }
    });
    return byFolder;
  }, [assignments, filteredConversations, folders]);

  const flattenedItems = useMemo(() => {
    const items: FlattenedItem[] = [];
    // Only include favorites row if FavoritesList will render content
    if (shouldShowFavorites) {
      items.push({ type: 'favorites' });
    }
    if (!search.query) {
      items.push({ type: 'folders-header' });
      if (foldersOpen) {
        items.push({ type: 'folder-create' });
        folders.forEach((folder) => {
          const nested = folderConversations.get(folder.id) ?? [];
          items.push({ type: 'folder', folder });
          if (expanded[folder.id]) {
            items.push(...nested.map((convo) => ({ type: 'folder-convo' as const, convo })));
          }
        });
      }
    }
    items.push({ type: 'chats-header' });

    if (isChatsExpanded) {
      groupedConversations.forEach(([groupName, convos]) => {
        items.push({ type: 'header', groupName });
        items.push(...convos.map((convo) => ({ type: 'convo' as const, convo })));
      });

      if (isLoading) {
        items.push({ type: 'loading' } as any);
      }
    }
    return items;
  }, [
    groupedConversations,
    isLoading,
    isChatsExpanded,
    shouldShowFavorites,
    search.query,
    foldersOpen,
    folders,
    folderConversations,
    expanded,
  ]);

  // Store flattenedItems in a ref for keyMapper to access without recreating cache
  const flattenedItemsRef = useRef(flattenedItems);
  flattenedItemsRef.current = flattenedItems;

  // Create a stable cache that doesn't depend on flattenedItems
  const cache = useMemo(
    () =>
      new CellMeasurerCache({
        fixedWidth: true,
        defaultHeight: convoHeight,
        keyMapper: (index) => {
          const item = flattenedItemsRef.current[index];
          if (!item) {
            return `unknown-${index}`;
          }
          if (item.type === 'favorites') {
            return `favorites-${favoritesContentKeyRef.current}`;
          }
          if (item.type === 'folders-header') {
            return 'folders-header';
          }
          if (item.type === 'folder-create') {
            return 'folder-create';
          }
          if (item.type === 'folder') {
            return `folder-${item.folder.id}`;
          }
          if (item.type === 'folder-convo') {
            return `folder-convo-${item.convo.conversationId}`;
          }
          if (item.type === 'chats-header') {
            return 'chats-header';
          }
          if (item.type === 'header') {
            return `header-${item.groupName}`;
          }
          if (item.type === 'convo') {
            return `convo-${item.convo.conversationId}`;
          }
          if (item.type === 'loading') {
            return 'loading';
          }
          return `unknown-${index}`;
        },
      }),
    [convoHeight],
  );

  const clearFavoritesCache = useCallback(() => {
    if (cache) {
      cache.clear(0, 0);
      if (containerRef.current && 'recomputeRowHeights' in containerRef.current) {
        containerRef.current.recomputeRowHeights(0);
      }
    }
  }, [cache, containerRef]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      clearFavoritesCache();
    });
    return () => cancelAnimationFrame(frameId);
  }, [favorites.length, isFavoritesLoading, showAgentMarketplace, clearFavoritesCache]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      cache.clearAll();
      if (containerRef.current && 'recomputeRowHeights' in containerRef.current) {
        containerRef.current.recomputeRowHeights(0);
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [search.query, cache, containerRef]);

  const openCreateFolder = useCallback(() => {
    setFolderName('');
    setFolderIcon('folder');
    setFolderColor('#d1a934');
    setIsCreateFolderOpen(true);
  }, []);

  const closeCreateFolder = useCallback(() => {
    setIsCreateFolderOpen(false);
  }, []);

  const submitCreateFolder = useCallback(() => {
    if (!folderName.trim()) {
      return;
    }
    createFolder(folderName, folderIcon, folderColor);
    setIsCreateFolderOpen(false);
  }, [createFolder, folderColor, folderIcon, folderName]);

  const openRenameFolder = useCallback((folder: SansuoFolder) => {
    setRenamingFolder(folder);
    setFolderName(folder.name);
    setFolderIcon(folder.icon);
    setFolderColor(folder.color);
  }, []);

  const closeRenameFolder = useCallback(() => {
    setRenamingFolder(null);
  }, []);

  const submitRenameFolder = useCallback(() => {
    if (!renamingFolder || !folderName.trim()) {
      return;
    }
    renameFolder(renamingFolder.id, folderName, folderIcon, folderColor);
    setRenamingFolder(null);
  }, [folderColor, folderIcon, folderName, renameFolder, renamingFolder]);

  useEffect(() => {
    const pending = consumePendingFolder();
    if (!pending || !folders.some((folder) => folder.id === pending.folderId)) {
      return;
    }
    const newestUnassigned = filteredConversations
      .filter((conversation) => {
        const conversationId = conversation.conversationId;
        const updatedAt = new Date(conversation.updatedAt ?? conversation.createdAt ?? 0).getTime();
        return (
          conversationId &&
          conversationId !== 'new' &&
          !assignments[conversationId] &&
          updatedAt >= pending.createdAt - 5000
        );
      })
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
        const bTime = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
        return bTime - aTime;
      })[0];

    if (newestUnassigned?.conversationId) {
      moveConversation(newestUnassigned.conversationId, pending.folderId);
    } else {
      setPendingFolder(pending.folderId);
    }
  }, [
    assignments,
    consumePendingFolder,
    filteredConversations,
    folders,
    moveConversation,
    setPendingFolder,
  ]);

  const closeDeleteFolder = useCallback(() => {
    setDeletingFolder(null);
    setDeleteFolderMode('move');
    setDeleteDestinationFolderId(null);
  }, []);

  const submitDeleteFolder = useCallback(async () => {
    if (!deletingFolder) {
      return;
    }
    const nested = folderConversations.get(deletingFolder.id) ?? [];
    if (deleteFolderMode === 'delete') {
      await Promise.all(
        nested
          .filter((conversation) => !!conversation.conversationId)
          .map((conversation) =>
            deleteConvoMutation.mutateAsync({
              conversationId: conversation.conversationId ?? '',
              endpoint: conversation.endpoint ?? undefined,
              source: 'button',
            }),
          ),
      );
    } else {
      nested.forEach((conversation) => {
        if (conversation.conversationId) {
          moveConversation(conversation.conversationId, deleteDestinationFolderId);
        }
      });
    }
    deleteFolder(deletingFolder.id);
    setDeletingFolder(null);
    setDeleteFolderMode('move');
    setDeleteDestinationFolderId(null);
  }, [
    deleteConvoMutation,
    deleteDestinationFolderId,
    deleteFolder,
    deleteFolderMode,
    deletingFolder,
    folderConversations,
    moveConversation,
  ]);

  const rowRenderer = useCallback(
    ({ index, key, parent, style }) => {
      const item = flattenedItems[index];
      const rowProps = { cache, rowKey: key, parent, index, style };

      if (item.type === 'loading') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            <LoadingSpinner />
          </MeasuredRow>
        );
      }

      if (item.type === 'favorites') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            <FavoritesList isSmallScreen={isSmallScreen} toggleNav={toggleNav} />
          </MeasuredRow>
        );
      }

      if (item.type === 'folders-header') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            <SectionHeader label="文件夹" isExpanded={foldersOpen} onToggle={toggleFoldersOpen} />
          </MeasuredRow>
        );
      }

      if (item.type === 'folder-create') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            <FolderCreateRow onCreate={openCreateFolder} />
          </MeasuredRow>
        );
      }

      if (item.type === 'folder') {
        const isExpanded = expanded[item.folder.id] ?? false;
        return (
          <MeasuredRow key={key} {...rowProps}>
            <FolderRow
              folder={item.folder}
              expanded={isExpanded}
              active={activeFolderId === item.folder.id}
              onToggle={() => toggleFolder(item.folder.id)}
              onOpen={() => {
                setFolderExpanded(item.folder.id, true);
                navigate(`/c/new?folderId=${encodeURIComponent(item.folder.id)}`);
              }}
              onRename={() => {
                openRenameFolder(item.folder);
              }}
              onDelete={() => {
                setDeletingFolder(item.folder);
              }}
            />
          </MeasuredRow>
        );
      }

      if (item.type === 'chats-header') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            <SectionHeader
              label="你的聊天"
              isExpanded={isChatsExpanded}
              onToggle={() => setIsChatsExpanded(!isChatsExpanded)}
            />
          </MeasuredRow>
        );
      }

      if (item.type === 'header') {
        // First date header index depends on whether favorites row is included
        // With favorites: [favorites, chats-header, first-header] → index 2
        // Without favorites: [chats-header, first-header] → index 1
        const firstHeaderIndex = shouldShowFavorites ? 2 : 1;
        return (
          <MeasuredRow key={key} {...rowProps}>
            <DateLabel groupName={item.groupName} isFirst={index === firstHeaderIndex} />
          </MeasuredRow>
        );
      }

      if (item.type === 'convo' || item.type === 'folder-convo') {
        const isGenerating = generatingConversationIds.has(item.convo.conversationId ?? '');
        return (
          <MeasuredRow key={key} {...rowProps}>
            <div className={item.type === 'folder-convo' ? 'pl-6' : undefined}>
              <MemoizedConvo
                conversation={item.convo}
                retainView={moveToTop}
                toggleNav={toggleNav}
                isGenerating={isGenerating}
              />
            </div>
          </MeasuredRow>
        );
      }

      return null;
    },
    [
      cache,
      flattenedItems,
      moveToTop,
      toggleNav,
      isSmallScreen,
      isChatsExpanded,
      setIsChatsExpanded,
      shouldShowFavorites,
      generatingConversationIds,
      foldersOpen,
      toggleFoldersOpen,
      expanded,
      activeFolderId,
      openCreateFolder,
      toggleFolder,
      setFolderExpanded,
      openRenameFolder,
      navigate,
      setDeletingFolder,
    ],
  );

  const getRowHeight = useCallback(
    ({ index }: { index: number }) => cache.getHeight(index, 0),
    [cache],
  );

  const throttledLoadMore = useMemo(
    () => throttle(loadMoreConversations, 300),
    [loadMoreConversations],
  );

  const handleRowsRendered = useCallback(
    ({ stopIndex }: { stopIndex: number }) => {
      if (stopIndex >= flattenedItems.length - 8) {
        throttledLoadMore();
      }
    },
    [flattenedItems.length, throttledLoadMore],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col pb-2 text-sm text-text-primary">
      <FolderCreateDialog
        open={isCreateFolderOpen}
        title={folderLabels.title}
        confirmLabel={folderLabels.confirm}
        name={folderName}
        icon={folderIcon}
        color={folderColor}
        onNameChange={setFolderName}
        onIconChange={setFolderIcon}
        onColorChange={setFolderColor}
        onClose={closeCreateFolder}
        onSubmit={submitCreateFolder}
      />
      <FolderCreateDialog
        open={renamingFolder != null}
        title="重命名文件夹"
        confirmLabel="保存"
        name={folderName}
        icon={folderIcon}
        color={folderColor}
        onNameChange={setFolderName}
        onIconChange={setFolderIcon}
        onColorChange={setFolderColor}
        onClose={closeRenameFolder}
        onSubmit={submitRenameFolder}
      />
      <FolderDeleteDialog
        folder={deletingFolder}
        folders={folders}
        mode={deleteFolderMode}
        destinationFolderId={deleteDestinationFolderId}
        isDeletingChats={deleteConvoMutation.isLoading}
        onModeChange={setDeleteFolderMode}
        onDestinationChange={setDeleteDestinationFolderId}
        onClose={closeDeleteFolder}
        onConfirm={submitDeleteFolder}
      />
      {isSearchLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="text-text-primary" />
          <span className="ml-2 text-text-primary">{localize('com_ui_loading')}</span>
        </div>
      ) : (
        <div className="flex-1">
          <AutoSizer>
            {({ width, height }) => (
              <List
                ref={containerRef}
                width={width}
                height={height}
                deferredMeasurementCache={cache}
                rowCount={flattenedItems.length}
                rowHeight={getRowHeight}
                rowRenderer={rowRenderer}
                overscanRowCount={10}
                aria-readonly={false}
                className="outline-none"
                aria-label="Conversations"
                onRowsRendered={handleRowsRendered}
                tabIndex={-1}
                style={{ outline: 'none' }}
                containerRole="rowgroup"
              />
            )}
          </AutoSizer>
        </div>
      )}
    </div>
  );
};

export { DateLabel };
export default memo(Conversations);
