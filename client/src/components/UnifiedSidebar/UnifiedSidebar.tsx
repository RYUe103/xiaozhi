import { useCallback, useState, useEffect, useRef, memo, startTransition } from 'react';
import type { ReactNode } from 'react';
import { useRecoilState } from 'recoil';
import { useForm } from 'react-hook-form';
import { Pencil } from 'lucide-react';
import { Button, useMediaQuery } from '@librechat/client';
import type { ChatFormValues } from '~/common';
import { ChatContext, ChatFormProvider, ActivePanelProvider } from '~/Providers';
import useUnifiedSidebarLinks from '~/hooks/Nav/useUnifiedSidebarLinks';
import { useChatHelpers, useLocalize } from '~/hooks';
import SidePanelNav from '~/components/SidePanel/Nav';
import ExpandedPanel from './ExpandedPanel';
import SanSuoDinoIcon from './SanSuoDinoIcon';
import Sidebar from './Sidebar';
import { MemoryPanel } from '~/components/SidePanel/Memories';
import { useGetUserQuery, useUpdateMemoryPreferencesMutation } from '~/data-provider';
import { cn } from '~/utils';
import store from '~/store';

const COLLAPSED_WIDTH = 0;
const EXPANDED_MIN = 244;
const EXPANDED_DEFAULT = 260;
const TRANSITION_MS = 300;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';

function getInitialWidth(): number {
  const saved = localStorage.getItem('side:width');
  return saved ? Math.min(Math.max(Number(saved), EXPANDED_MIN), 280) : EXPANDED_DEFAULT;
}

/**
 * Isolates useChatHelpers Recoil subscriptions from the sidebar layout.
 * Atom changes (e.g. during streaming) only re-render this component
 * and the active panel — not the sidebar shell, resize logic, or icon strip.
 * This works because Recoil subscriptions don't propagate to parent components.
 */
function SidebarChatProvider({ children }: { children: ReactNode }) {
  const chatHelpers = useChatHelpers(0);
  const sidebarFormMethods = useForm<ChatFormValues>({ defaultValues: { text: '' } });
  return (
    <ChatFormProvider {...sidebarFormMethods}>
      <ChatContext.Provider value={chatHelpers}>{children}</ChatContext.Provider>
    </ChatFormProvider>
  );
}

function FloatingMemoryButton({
  visible,
  expanded,
  sidebarWidth,
}: {
  visible: boolean;
  expanded: boolean;
  sidebarWidth: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const { data: user } = useGetUserQuery();
  const updatePreferences = useUpdateMemoryPreferencesMutation();
  const memoryMode =
    user?.personalization?.memoryMode === 'off' || user?.personalization?.memories === false
      ? 'off'
      : 'manual';
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);
  if (!visible) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{ left: expanded ? sidebarWidth + 12 : 16, top: 116 }}
    >
      <div className="group pointer-events-auto relative flex items-center gap-1">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="h-9 rounded-lg border border-border-light bg-surface-primary px-3 text-sm font-medium text-text-primary shadow-sm transition hover:bg-surface-hover"
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
        >
          {memoryMode === 'manual' ? '记忆模式' : '无记忆模式'}
        </button>
        {memoryMode === 'manual' && (
          <button
            type="button"
            aria-label="编辑记忆"
            title="编辑记忆"
            className="grid h-7 w-7 place-items-center rounded-md text-text-secondary opacity-0 transition hover:bg-surface-hover hover:text-text-primary focus:opacity-100 group-hover:opacity-100"
            onClick={() => setEditorOpen(true)}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        {menuOpen && (
          <div className="absolute left-0 top-11 z-30 min-w-36 rounded-xl border border-border-light bg-surface-primary p-1.5 shadow-lg">
            <div className="px-2 py-1 text-[11px] text-text-secondary">选择记忆模式</div>
            {(['manual', 'off'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={memoryMode === mode}
                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-text-primary hover:bg-surface-hover"
                onClick={(event) => {
                  event.stopPropagation();
                  updatePreferences.mutate({ memories: mode === 'manual', memoryMode: mode });
                  setMenuOpen(false);
                }}
              >
                <span>{mode === 'manual' ? '记忆模式' : '无记忆模式'}</span>
                {memoryMode === mode && <span className="text-xs text-text-secondary">当前</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {editorOpen && (
        <div className="pointer-events-auto fixed inset-0 z-[140] flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm">
          <button
            type="button"
            aria-label="关闭记忆"
            className="absolute inset-0 h-full w-full"
            onClick={() => setEditorOpen(false)}
          />
          <section className="relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-surface-primary">
            <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
              <h2 className="text-lg font-semibold text-text-primary">记忆</h2>
              <button
                type="button"
                aria-label="关闭记忆"
                className="rounded-lg px-2 py-1 text-sm text-text-secondary hover:bg-surface-hover"
                onClick={() => setEditorOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto p-2">
              <MemoryPanel />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function UnifiedSidebar() {
  const localize = useLocalize();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const [expanded, setExpanded] = useRecoilState(store.sidebarExpanded);
  const [sidebarWidth, setSidebarWidth] = useState(getInitialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const resizeHandlers = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  const links = useUnifiedSidebarLinks();

  useEffect(() => {
    if (isSmallScreen || typeof window === 'undefined') {
      return;
    }
    const migrationKey = 'sansuo.sidebar.desktopDefaultExpanded.v1';
    if (window.localStorage.getItem(migrationKey) === 'done') {
      return;
    }
    window.localStorage.setItem(migrationKey, 'done');
    startTransition(() => {
      setExpanded(true);
    });
  }, [isSmallScreen, setExpanded]);

  const handleCollapse = useCallback(() => {
    startTransition(() => {
      setExpanded(false);
    });
  }, [setExpanded]);

  const handleExpand = useCallback(() => {
    startTransition(() => {
      setExpanded(true);
    });
  }, [setExpanded]);

  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
    document.body.style.userSelect = 'none';
    const maxWidth = window.innerWidth * 0.4;
    let rafId: number | null = null;

    const move = (e: MouseEvent) => {
      if (rafId != null) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const next = Math.max(EXPANDED_MIN, Math.min(e.clientX, maxWidth));
        setSidebarWidth(next);
      });
    };

    const up = () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      document.body.style.userSelect = '';
      setIsResizing(false);
      resizeHandlers.current = null;
      setSidebarWidth((w) => {
        localStorage.setItem('side:width', String(Math.round(w)));
        return w;
      });
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };

    resizeHandlers.current = { move, up };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, []);

  const handleResizeKeyboard = useCallback((direction: 'shrink' | 'grow') => {
    setSidebarWidth((w) => {
      const next =
        direction === 'shrink'
          ? Math.max(w - 20, EXPANDED_MIN)
          : Math.min(w + 20, window.innerWidth * 0.4);
      localStorage.setItem('side:width', String(Math.round(next)));
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (resizeHandlers.current) {
        document.removeEventListener('mousemove', resizeHandlers.current.move);
        document.removeEventListener('mouseup', resizeHandlers.current.up);
      }
    };
  }, []);

  useEffect(() => {
    if (!isSmallScreen || !expanded) {
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCollapse();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isSmallScreen, expanded, handleCollapse]);

  if (isSmallScreen) {
    return (
      <>
        <div
          className={cn(
            'fixed left-0 top-0 z-[110] flex h-full bg-surface-primary-alt',
            expanded ? 'translate-x-0' : '-translate-x-full',
          )}
          style={{
            width: 'min(85vw, 380px)',
            transition: `transform ${TRANSITION_MS}ms ${EASING}`,
          }}
          inert={!expanded ? '' : undefined}
        >
          <SidebarChatProvider>
            <ActivePanelProvider>
              <ExpandedPanel links={links} onCollapse={handleCollapse} />
              <nav className="min-h-0 flex-1 overflow-hidden bg-surface-primary-alt">
                <SidePanelNav links={links} />
              </nav>
            </ActivePanelProvider>
          </SidebarChatProvider>
        </div>
        <div
          className={cn(
            'fixed inset-0 z-[109] bg-black/50',
            expanded ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
          )}
          style={{ transition: `opacity ${TRANSITION_MS}ms ${EASING}` }}
          role="presentation"
        >
          <button
            className="h-full w-full"
            onClick={handleCollapse}
            aria-label={localize('com_nav_close_sidebar')}
            tabIndex={expanded ? 0 : -1}
          />
        </div>
      </>
    );
  }

  return (
    <SidebarChatProvider>
      <ActivePanelProvider>
        {!expanded && (
          <button
            type="button"
            aria-label={localize('com_nav_open_sidebar')}
            onClick={handleExpand}
            className="fixed left-4 top-4 z-30 grid h-10 w-10 place-items-center rounded-xl border border-[#ececec] bg-white shadow-sm transition hover:bg-[#f3f3f3] active:scale-[0.99]"
          >
            <SanSuoDinoIcon className="h-7 w-7" />
          </button>
        )}
        <aside
          className="relative flex h-full flex-shrink-0 overflow-hidden"
          style={{
            width: expanded ? sidebarWidth : COLLAPSED_WIDTH,
            minWidth: expanded ? EXPANDED_MIN : COLLAPSED_WIDTH,
            maxWidth: expanded ? '40%' : COLLAPSED_WIDTH,
            transition: isResizing
              ? 'none'
              : `width ${TRANSITION_MS}ms ${EASING}, min-width ${TRANSITION_MS}ms ${EASING}, max-width ${TRANSITION_MS}ms ${EASING}`,
          }}
          aria-label={localize('com_nav_control_panel')}
        >
          <Sidebar
            links={links}
            expanded={expanded}
            onCollapse={handleCollapse}
            onExpand={handleExpand}
            onResizeStart={handleResizeStart}
            onResizeKeyboard={handleResizeKeyboard}
          />
        </aside>
      </ActivePanelProvider>
    </SidebarChatProvider>
  );
}

export default memo(UnifiedSidebar);
