import { useCallback, useEffect, useMemo, useState } from 'react';

export type SansuoFolder = {
  id: string;
  name: string;
  icon: string;
  color: string;
  createdAt: number;
};

type FolderState = {
  folders: SansuoFolder[];
  assignments: Record<string, string | null>;
  expanded: Record<string, boolean>;
  foldersOpen: boolean;
};

const STORAGE_KEY = 'sansuo.sidebar.folders.v1';
const CHANGE_EVENT = 'sansuo-sidebar-folders-change';
export const PENDING_FOLDER_KEY = 'sansuo.sidebar.pending-folder-id';

export type PendingFolderAssignment = {
  folderId: string;
  createdAt: number;
};

export function queuePendingFolderAssignment(folderId: string) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(
    PENDING_FOLDER_KEY,
    JSON.stringify({ folderId, createdAt: Date.now() }),
  );
}

export function consumePendingFolderAssignment() {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(PENDING_FOLDER_KEY);
  if (raw) {
    window.localStorage.removeItem(PENDING_FOLDER_KEY);
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PendingFolderAssignment>;
    if (parsed.folderId) {
      return {
        folderId: parsed.folderId,
        createdAt: parsed.createdAt ?? 0,
      };
    }
  } catch {
    return { folderId: raw, createdAt: 0 };
  }
  return null;
}

export function assignConversationToFolder(conversationId: string, folderId: string) {
  if (typeof window === 'undefined' || !conversationId || !folderId) {
    return;
  }
  const current = readState();
  if (!current.folders.some((folder) => folder.id === folderId)) {
    return;
  }
  writeState({
    ...current,
    assignments: { ...current.assignments, [conversationId]: folderId },
    expanded: { ...current.expanded, [folderId]: true },
    foldersOpen: true,
  });
}

const defaultFolders: SansuoFolder[] = [
  {
    id: 'folder-personal',
    name: '个人学习文件夹',
    icon: '□',
    color: '#d1a934',
    createdAt: 1,
  },
];

const fallbackState: FolderState = {
  folders: defaultFolders,
  assignments: {},
  expanded: { 'folder-personal': true },
  foldersOpen: true,
};

function readState(): FolderState {
  if (typeof window === 'undefined') {
    return fallbackState;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallbackState;
    }
    const parsed = JSON.parse(raw) as Partial<FolderState>;
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : fallbackState.folders,
      assignments: parsed.assignments ?? {},
      expanded: parsed.expanded ?? fallbackState.expanded,
      foldersOpen: parsed.foldersOpen ?? true,
    };
  } catch {
    return fallbackState;
  }
}

function writeState(next: FolderState) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
}

export function useSansuoFolders() {
  const [state, setState] = useState<FolderState>(() => readState());

  useEffect(() => {
    const handleChange = () => setState(readState());
    window.addEventListener(CHANGE_EVENT, handleChange);
    window.addEventListener('storage', handleChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handleChange);
      window.removeEventListener('storage', handleChange);
    };
  }, []);

  const update = useCallback((producer: (current: FolderState) => FolderState) => {
    const next = producer(readState());
    setState(next);
    writeState(next);
  }, []);

  const createFolder = useCallback(
    (name: string, icon = '□', color = '#d1a934') => {
      const trimmed = name.trim();
      if (!trimmed) {
        return;
      }
      update((current) => {
        const folder: SansuoFolder = {
          id: `folder-${Date.now().toString(36)}`,
          name: trimmed,
          icon,
          color,
          createdAt: Date.now(),
        };
        return {
          ...current,
          folders: [folder, ...current.folders],
          expanded: { ...current.expanded, [folder.id]: true },
          foldersOpen: true,
        };
      });
    },
    [update],
  );

  const renameFolder = useCallback(
    (folderId: string, name: string, icon?: string, color?: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        return;
      }
      update((current) => ({
        ...current,
        folders: current.folders.map((folder) =>
          folder.id === folderId
            ? { ...folder, name: trimmed, icon: icon ?? folder.icon, color: color ?? folder.color }
            : folder,
        ),
      }));
    },
    [update],
  );

  const deleteFolder = useCallback(
    (folderId: string) => {
      update((current) => {
        const assignments = { ...current.assignments };
        Object.entries(assignments).forEach(([conversationId, assignedFolderId]) => {
          if (assignedFolderId === folderId) {
            assignments[conversationId] = null;
          }
        });
        const expanded = { ...current.expanded };
        delete expanded[folderId];
        return {
          ...current,
          assignments,
          expanded,
          folders: current.folders.filter((folder) => folder.id !== folderId),
        };
      });
    },
    [update],
  );

  const toggleFolder = useCallback(
    (folderId: string) => {
      update((current) => ({
        ...current,
        expanded: { ...current.expanded, [folderId]: !(current.expanded[folderId] ?? false) },
      }));
    },
    [update],
  );

  const setFolderExpanded = useCallback(
    (folderId: string, isExpanded = true) => {
      update((current) => ({
        ...current,
        expanded: { ...current.expanded, [folderId]: isExpanded },
        foldersOpen: true,
      }));
    },
    [update],
  );

  const toggleFoldersOpen = useCallback(() => {
    update((current) => ({ ...current, foldersOpen: !current.foldersOpen }));
  }, [update]);

  const moveConversation = useCallback(
    (conversationId: string, folderId: string | null) => {
      update((current) => ({
        ...current,
        assignments: { ...current.assignments, [conversationId]: folderId },
        expanded: folderId ? { ...current.expanded, [folderId]: true } : current.expanded,
        foldersOpen: folderId ? true : current.foldersOpen,
      }));
    },
    [update],
  );

  const setPendingFolder = useCallback((folderId: string | null) => {
    if (folderId) {
      queuePendingFolderAssignment(folderId);
    } else {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(PENDING_FOLDER_KEY);
      }
    }
  }, []);

  const consumePendingFolder = useCallback(() => {
    return consumePendingFolderAssignment();
  }, []);

  return useMemo(
    () => ({
      ...state,
      createFolder,
      renameFolder,
      deleteFolder,
      toggleFolder,
      setFolderExpanded,
      toggleFoldersOpen,
      moveConversation,
      setPendingFolder,
      consumePendingFolder,
    }),
    [
      state,
      createFolder,
      renameFolder,
      deleteFolder,
      toggleFolder,
      setFolderExpanded,
      toggleFoldersOpen,
      moveConversation,
      setPendingFolder,
      consumePendingFolder,
    ],
  );
}
