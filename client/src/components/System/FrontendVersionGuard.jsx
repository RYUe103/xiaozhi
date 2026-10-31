import { useEffect, useState } from 'react';

const POLL_MS = 60 * 1000;

function isUserBusy() {
  const active = document.activeElement;
  return Boolean(active && /^(INPUT|TEXTAREA)$/.test(active.tagName));
}

export default function FrontendVersionGuard() {
  const [latestBuildId, setLatestBuildId] = useState(null);

  useEffect(() => {
    let stopped = false;
    const currentBuildId = String(import.meta.env.VITE_BUILD_ID || __SANSUO_BUILD_ID__ || '');

    const check = async () => {
      try {
        const response = await fetch(`/build-id.json?ts=${Date.now()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return;
        const payload = await response.json();
        const nextBuildId = String(payload?.buildId || '');
        if (!nextBuildId || !currentBuildId || nextBuildId === currentBuildId || stopped) return;
        if (document.hidden && !isUserBusy()) {
          window.location.reload();
          return;
        }
        setLatestBuildId(nextBuildId);
      } catch {
        // A temporary proxy/network failure must not interrupt the current chat.
      }
    };

    check();
    const timer = window.setInterval(check, POLL_MS);
    const onVisibility = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!latestBuildId) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border-light bg-surface-primary px-4 py-3 text-sm shadow-lg dark:border-border-medium dark:bg-surface-secondary">
      <span>发现新版本</span>
      <button
        type="button"
        className="rounded-md bg-surface-active px-3 py-1.5 font-medium hover:opacity-80"
        onClick={() => window.location.reload()}
      >
        立即更新
      </button>
    </div>
  );
}
