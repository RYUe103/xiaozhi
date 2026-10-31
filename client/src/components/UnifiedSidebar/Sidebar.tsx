/* eslint-disable i18next/no-literal-string */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as Menu from '@ariakit/react/menu';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  FileText,
  LogOut,
  Megaphone,
  MoreHorizontal,
  PanelLeftClose,
  PenLine,
  Search,
  X,
} from 'lucide-react';
import { apiBaseUrl, request } from 'librechat-data-provider';
import type { NavLink } from '~/common';
import SidePanelNav from '~/components/SidePanel/Nav';
import NewChat from '~/components/Nav/NewChat';
import SearchDialog from './SearchDialog';
import { Avatar, Button, DropdownMenuSeparator } from '@librechat/client';
import { MyFilesModal } from '~/components/Chat/Input/Files/MyFilesModal';
import SkillMarkdownRenderer from '~/components/Skills/display/SkillMarkdownRenderer';
import { useAuthContext, useLocalize } from '~/hooks';
import { cn } from '~/utils';
import {
  getSansuoAppIcon,
  type SanSuoAppLink,
  type SanSuoAppLinkNotice,
  type SanSuoUiConfig,
} from './sansuoUiConfig';

const fallbackConfig: SanSuoUiConfig = {
  appLinks: [],
  announcement: { title: '公告', body: '暂无公告。', imageUrl: '', showOnLogin: false },
};

function Sidebar({
  links,
  expanded,
  onCollapse,
  onResizeStart,
  onResizeKeyboard,
}: {
  links: NavLink[];
  expanded: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onResizeKeyboard: (direction: 'shrink' | 'grow') => void;
}) {
  const localize = useLocalize();
  const { user, logout } = useAuthContext();
  const displayName = user?.name ?? user?.username ?? '用户';
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAnnouncementOpen, setIsAnnouncementOpen] = useState(false);
  const [pendingAppLink, setPendingAppLink] = useState<SanSuoAppLink | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);
  const configQuery = useQuery<SanSuoUiConfig>(
    ['sansuo-ui-config', user?.id ?? 'anonymous'],
    () => request.get<SanSuoUiConfig>(`${apiBaseUrl()}/api/sansuo-ui/config`),
    { enabled: Boolean(user), staleTime: 60_000 },
  );
  const uiConfig = configQuery.data ?? fallbackConfig;
  const appLinks = useMemo(
    () =>
      (uiConfig.appLinks ?? fallbackConfig.appLinks ?? []).filter((link) => link.enabled !== false),
    [uiConfig.appLinks],
  );
  const announcement = uiConfig.announcement ?? fallbackConfig.announcement;
  const announcementSeenKey = useMemo(() => {
    const stamp =
      announcement?.updatedAt || `${announcement?.title || ''}:${announcement?.body || ''}`;
    return `sansuo.announcement.seen.${stamp}`;
  }, [announcement?.body, announcement?.title, announcement?.updatedAt]);

  useEffect(() => {
    if (!announcement?.showOnLogin || !announcement?.body || !configQuery.data) {
      return;
    }
    if (window.localStorage.getItem(announcementSeenKey) === '1') {
      return;
    }
    setIsAnnouncementOpen(true);
    window.localStorage.setItem(announcementSeenKey, '1');
  }, [announcement?.body, announcement?.showOnLogin, announcementSeenKey, configQuery.data]);

  const openAppLink = (link: SanSuoAppLink) => {
    if (!link.url) {
      return;
    }
    if (hasAppLinkNotice(link.entryNotice) && !isNoticeDismissed(user?.id, link)) {
      setPendingAppLink(link);
      return;
    }
    void request
      .post(`${apiBaseUrl()}/api/sansuo-usage/events`, {
        eventType: 'sidebar_app_click',
        appLinkId: link.id,
      })
      .catch(() => undefined);
    window.open(link.url, '_blank', 'noopener,noreferrer');
  };

  const confirmAppLink = (dontRemind = false) => {
    if (!pendingAppLink?.url) {
      setPendingAppLink(null);
      return;
    }
    const url = pendingAppLink.url;
    if (dontRemind) {
      rememberNoticeDismissed(user?.id, pendingAppLink);
    }
    void request
      .post(`${apiBaseUrl()}/api/sansuo-usage/events`, {
        eventType: 'sidebar_app_click',
        appLinkId: pendingAppLink.id,
      })
      .catch(() => undefined);
    setPendingAppLink(null);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <div className="flex h-full w-full flex-col overflow-hidden border-r border-[#ececec] bg-white dark:bg-surface-primary-alt">
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
          <div className="min-w-0 truncate text-[20px] font-semibold tracking-normal text-text-primary">
            三所小智
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label={localize('com_nav_close_sidebar')}
            id="close-sidebar-button"
            className="h-8 w-8 shrink-0 rounded-lg bg-transparent text-text-secondary hover:bg-[#f3f3f3] dark:hover:bg-surface-secondary"
            onClick={onCollapse}
          >
            <PanelLeftClose className="h-[18px] w-[18px] text-text-secondary" />
          </Button>
        </div>
        <div className="shrink-0 px-3 pb-4">
          <div className="grid gap-1">
            <NewChat className="h-8 w-full justify-start gap-3 rounded-lg border-0 bg-transparent px-2 text-[14px] font-medium shadow-none hover:bg-[#f3f3f3] max-md:flex">
              <PenLine className="h-[17px] w-[17px] text-text-primary" />
              <span>新建聊天</span>
            </NewChat>
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="flex h-8 w-full items-center gap-3 rounded-lg px-2 text-left text-[14px] font-medium text-text-primary transition hover:bg-[#f3f3f3] active:scale-[0.99]"
            >
              <Search className="h-[17px] w-[17px] text-text-primary" />
              <span>搜索聊天</span>
            </button>
            {appLinks.map((link) => (
              <AppLinkButton
                key={link.id}
                link={link}
                onClick={() => openAppLink(link)}
                onRestoreNotice={() => {
                  clearNoticeDismissed(user?.id, link);
                  setPendingAppLink(link);
                }}
              />
            ))}
            <button
              type="button"
              onClick={() => setIsAnnouncementOpen(true)}
              className="flex h-8 w-full items-center gap-3 rounded-lg px-2 text-left text-[14px] font-medium text-text-primary transition hover:bg-[#f3f3f3] active:scale-[0.99]"
            >
              <Megaphone className="h-[17px] w-[17px] text-text-primary" />
              <span>公告</span>
            </button>
          </div>
        </div>
        <nav
          className={cn(
            'min-h-0 flex-1 overflow-hidden bg-transparent',
            expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          style={{ transition: expanded ? 'opacity 200ms ease 80ms' : 'opacity 150ms ease' }}
          aria-hidden={!expanded}
        >
          <SidePanelNav links={links} />
        </nav>
        <div className="shrink-0 border-t border-[#f3f3f3] px-3 py-3">
          <Menu.MenuProvider>
            <Menu.MenuButton
              ref={userMenuButtonRef}
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-[#f3f3f3] active:scale-[0.99] aria-[expanded=true]:bg-[#f3f3f3]"
            >
              <div className="size-9 flex-shrink-0 overflow-hidden rounded-full">
                <Avatar user={user} size={36} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold leading-5 text-text-primary">
                  {displayName}
                </div>
                <div className="truncate text-sm leading-5 text-text-secondary">Plus</div>
              </div>
            </Menu.MenuButton>
            <Menu.Menu
              portal
              className="account-settings-popover popover-ui z-[125] w-[244px] rounded-xl"
              placement="top-start"
              style={{ transformOrigin: 'left bottom', translate: '0 -8px' }}
            >
              <div className="text-token-text-secondary ml-3 mr-2 py-2 text-sm" role="note">
                {user?.email ?? displayName}
              </div>
              <DropdownMenuSeparator />
              <Menu.MenuItem onClick={() => setShowFiles(true)} className="select-item text-sm">
                <FileText className="icon-md" aria-hidden="true" />
                {localize('com_nav_my_files')}
              </Menu.MenuItem>
              <Menu.MenuItem onClick={() => logout()} className="select-item text-sm">
                <LogOut className="icon-md" aria-hidden="true" />
                {localize('com_nav_log_out')}
              </Menu.MenuItem>
            </Menu.Menu>
          </Menu.MenuProvider>
        </div>
      </div>
      <SearchDialog open={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      {pendingAppLink && (
        <AppLinkNoticeDialog
          link={pendingAppLink}
          onCancel={() => setPendingAppLink(null)}
          onConfirm={confirmAppLink}
        />
      )}
      {isAnnouncementOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm">
          <button
            type="button"
            aria-label="关闭公告"
            className="absolute inset-0 h-full w-full"
            onClick={() => setIsAnnouncementOpen(false)}
          />
          <section className="relative max-h-[82vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#ececec] px-6 py-4">
              <div>
                <div className="text-xs font-medium text-text-secondary">三所小智公告</div>
                <h2 className="mt-1 text-xl font-semibold text-[#202123]">
                  {announcement?.title || '公告'}
                </h2>
              </div>
              <button
                type="button"
                aria-label="关闭公告"
                onClick={() => setIsAnnouncementOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full text-[#5f6368] hover:bg-[#f3f3f3]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[62vh] overflow-y-auto px-6 py-5">
              {announcement?.imageUrl && (
                <img
                  src={announcement.imageUrl}
                  alt=""
                  className="mb-5 max-h-72 w-full rounded-xl object-cover"
                />
              )}
              <SkillMarkdownRenderer
                content={announcement?.body || '暂无公告。'}
                className="markdown prose light w-full max-w-none break-words leading-7 text-[#202123]"
              />
            </div>
          </section>
        </div>
      )}
      {showFiles && (
        <MyFilesModal open={showFiles} onOpenChange={setShowFiles} triggerRef={userMenuButtonRef} />
      )}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabIndex={expanded ? 0 : -1}
        className={cn(
          'absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-border-medium active:bg-border-heavy',
          expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{ transition: expanded ? 'opacity 200ms ease 80ms' : 'opacity 150ms ease' }}
        onMouseDown={onResizeStart}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            onResizeKeyboard('shrink');
          } else if (e.key === 'ArrowRight') {
            onResizeKeyboard('grow');
          }
        }}
      />
    </>
  );
}

export default memo(Sidebar);

function AppLinkButton({
  link,
  onClick,
  onRestoreNotice,
}: {
  link: SanSuoAppLink;
  onClick: () => void;
  onRestoreNotice: () => void;
}) {
  const Icon = getSansuoAppIcon(link.icon);
  const canRestore = hasAppLinkNotice(link.entryNotice);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        className="flex h-8 w-full items-center gap-3 rounded-lg px-2 pr-9 text-left text-[14px] font-medium text-text-primary transition hover:bg-[#f3f3f3] active:scale-[0.99]"
      >
        <Icon className="h-[17px] w-[17px] text-text-primary" />
        <span className="truncate">{link.label}</span>
      </button>
      {canRestore && (
        <div className="absolute right-1 top-0.5">
          <button
            type="button"
            aria-label={`管理${link.label}提醒`}
            title="显示提醒"
            onClick={(event) => {
              event.stopPropagation();
              onRestoreNotice();
            }}
            className="grid h-7 w-7 place-items-center rounded-md text-text-secondary opacity-0 transition hover:bg-white focus:opacity-100 group-hover:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function noticeStorageKey(userId: string | undefined, link: SanSuoAppLink) {
  const notice = link.entryNotice;
  const fingerprint = [notice?.title, notice?.body, notice?.imageUrl, notice?.confirmLabel]
    .map((value) => value || '')
    .join('|');
  return `sansuo.app-link-notice.dismissed.${userId || 'anonymous'}.${link.id}.${fingerprint}`;
}

function isNoticeDismissed(userId: string | undefined, link: SanSuoAppLink) {
  return window.localStorage.getItem(noticeStorageKey(userId, link)) === '1';
}

function rememberNoticeDismissed(userId: string | undefined, link: SanSuoAppLink) {
  window.localStorage.setItem(noticeStorageKey(userId, link), '1');
}

function clearNoticeDismissed(userId: string | undefined, link: SanSuoAppLink) {
  window.localStorage.removeItem(noticeStorageKey(userId, link));
}

function hasAppLinkNotice(notice?: SanSuoAppLinkNotice) {
  return Boolean(notice?.title?.trim() || notice?.body?.trim() || notice?.imageUrl?.trim());
}

function AppLinkNoticeDialog({
  link,
  onCancel,
  onConfirm,
}: {
  link: SanSuoAppLink;
  onCancel: () => void;
  onConfirm: (dontRemind?: boolean) => void;
}) {
  const [dontRemind, setDontRemind] = useState(false);
  const notice = link.entryNotice;
  const title = notice?.title?.trim() || `进入${link.label || '应用'}前提示`;
  const body = notice?.body?.trim() || '请确认后继续访问该链接。';
  const confirmLabel = notice?.confirmLabel?.trim() || '确认进入';

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-label="关闭进入提示"
        className="absolute inset-0 h-full w-full"
        onClick={onCancel}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sansuo-app-link-notice-title"
        className="relative max-h-[82vh] w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-surface-primary"
      >
        <div className="flex items-center justify-between border-b border-[#ececec] px-6 py-4 dark:border-border-light">
          <div className="min-w-0">
            <div className="text-xs font-medium text-text-secondary">进入前提示</div>
            <h2
              id="sansuo-app-link-notice-title"
              className="mt-1 truncate text-xl font-semibold text-[#202123] dark:text-text-primary"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="关闭进入提示"
            onClick={onCancel}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#5f6368] hover:bg-[#f3f3f3] dark:text-text-secondary dark:hover:bg-surface-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[58vh] overflow-y-auto px-6 py-5">
          {notice?.imageUrl && (
            <img
              src={notice.imageUrl}
              alt=""
              className="mb-5 max-h-64 w-full rounded-xl object-cover"
            />
          )}
          <SkillMarkdownRenderer
            content={body}
            className="markdown prose light w-full max-w-none break-words leading-7 text-[#202123] dark:text-text-primary"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[#ececec] px-6 py-4 dark:border-border-light">
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={dontRemind} onChange={(event) => setDontRemind(event.target.checked)} className="h-4 w-4 rounded border-border-medium" />
            <span>下次不再提醒</span>
          </label>
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-lg border border-border-light px-4 text-sm text-text-secondary hover:bg-surface-hover"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(dontRemind)}
            className="bg-surface-inverse text-text-inverse inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium hover:opacity-90"
          >
            {confirmLabel}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}
