import {
  memo,
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, ChevronDown, CircleStop, LoaderCircle, TriangleAlert } from 'lucide-react';
import { cn } from '~/utils';
import { useLocalize } from '~/hooks';
import { ProcessContext } from './ProcessContext';

type MessageProcessGroupProps = {
  children: ReactNode;
  isActive: boolean;
  isComplete: boolean;
  hasFailure?: boolean;
  hasInterruption?: boolean;
  failureReason?: string;
  startedAt?: string;
  elapsedMs?: number;
  statusLabel?: string;
};

const parseStartedAt = (startedAt?: string) => {
  const value = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
};

const MessageProcessGroup = memo(function MessageProcessGroup({
  children,
  isActive,
  isComplete,
  hasFailure = false,
  hasInterruption = false,
  failureReason,
  startedAt,
  elapsedMs,
  statusLabel,
}: MessageProcessGroupProps) {
  const localize = useLocalize();
  const hasDetails = Children.toArray(children).length > 0;
  const contentRef = useRef<HTMLDivElement>(null);
  const userOverrideRef = useRef(false);
  const [isExpanded, setIsExpanded] = useState(hasFailure || hasInterruption);
  const [contentHeight, setContentHeight] = useState(0);
  const fallbackStartedAtRef = useRef(Date.now());
  const [displayElapsedMs, setDisplayElapsedMs] = useState(() => {
    if (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs)) {
      return Math.max(0, elapsedMs);
    }
    const start = parseStartedAt(startedAt) ?? fallbackStartedAtRef.current;
    return isActive ? Math.max(0, Date.now() - start) : 0;
  });

  const measure = useCallback(() => {
    const element = contentRef.current;
    if (element) {
      setContentHeight(element.scrollHeight);
    }
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [children, isExpanded, measure]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (userOverrideRef.current) {
      return;
    }
    if (hasFailure || hasInterruption) {
      setIsExpanded(true);
    } else if (isComplete) {
      setIsExpanded(false);
    }
  }, [hasFailure, hasInterruption, isActive, isComplete]);

  useEffect(() => {
    if (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs)) {
      setDisplayElapsedMs(Math.max(0, elapsedMs));
      return;
    }
    if (!isActive) {
      return;
    }
    const start = parseStartedAt(startedAt) ?? fallbackStartedAtRef.current;
    const updateElapsed = () => setDisplayElapsedMs(Math.max(0, Date.now() - start));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [elapsedMs, isActive, startedAt]);

  const handleToggle = useCallback(() => {
    userOverrideRef.current = true;
    setIsExpanded((expanded) => !expanded);
  }, []);

  const totalSeconds = Math.max(0, Math.floor(displayElapsedMs / 1000));
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const getDuration = () => {
    if (totalSeconds < 60) {
      return localize('com_ui_duration_seconds', { 0: String(totalSeconds) });
    }
    if (totalMinutes < 60) {
      if (seconds > 0) {
        return localize('com_ui_duration_minutes_seconds', {
          0: String(totalMinutes),
          1: String(seconds),
        });
      }
      return localize('com_ui_duration_minutes', { 0: String(totalMinutes) });
    }
    if (minutes > 0) {
      return localize('com_ui_duration_hours_minutes', {
        0: String(hours),
        1: String(minutes),
      });
    }
    return localize('com_ui_duration_hours', { 0: String(hours) });
  };
  const duration = getDuration();
  const hasDuration =
    isActive ||
    displayElapsedMs > 0 ||
    (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs));
  const getLabel = () => {
    if (hasFailure) {
      if (failureReason) {
        return `执行失败 · ${failureReason}`;
      }
      return hasDuration
        ? localize('com_ui_process_failed', { 0: duration })
        : localize('com_ui_process_failed_no_time');
    }
    if (hasInterruption) {
      return hasDuration ? `处理已中断，耗时 ${duration}` : '处理已中断';
    }
    if (isActive) {
      return localize('com_ui_process_running', { 0: duration });
    }
    return hasDuration
      ? localize('com_ui_process_complete', { 0: duration })
      : localize('com_ui_process_complete_no_time');
  };
  const label = getLabel();
  const statusIcon = (() => {
    if (hasFailure) {
      return <TriangleAlert className="size-4 text-red-500" aria-hidden="true" />;
    }
    if (hasInterruption) {
      return <CircleStop className="size-4 text-text-tertiary" aria-hidden="true" />;
    }
    if (isActive) {
      return (
        <LoaderCircle className="message-process-spinner size-4 text-blue-500" aria-hidden="true" />
      );
    }
    return <Check className="size-4 text-green-600 dark:text-green-400" aria-hidden="true" />;
  })();

  return (
    <div className="message-process-group mb-2 mt-1 min-w-0" data-testid="message-process-group">
      <button
        type="button"
        onClick={handleToggle}
        disabled={!hasDetails}
        aria-expanded={hasDetails ? isExpanded : false}
        className="message-process-toggle inline-flex min-h-8 max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
      >
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          {statusIcon}
        </span>
        <span
          className="tool-status-text min-w-[14ch] truncate font-medium tabular-nums"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {label}
        </span>
        {isActive && statusLabel && <span className="process-current-stage">· {statusLabel}</span>}
        {hasDetails && (
          <ChevronDown
            className={cn(
              'size-4 shrink-0 transition-transform duration-200 ease-out',
              isExpanded && 'rotate-180',
            )}
            aria-hidden="true"
          />
        )}
      </button>
      <div
        className="message-process-content overflow-hidden transition-[height,opacity] duration-200 ease-out"
        style={{ height: isExpanded ? `${contentHeight}px` : '0px', opacity: isExpanded ? 1 : 0 }}
        aria-hidden={!isExpanded || undefined}
      >
        <div ref={contentRef} className="pb-1 pl-1">
          <ProcessContext.Provider value={true}>{children}</ProcessContext.Provider>
        </div>
      </div>
    </div>
  );
});

export default MessageProcessGroup;
