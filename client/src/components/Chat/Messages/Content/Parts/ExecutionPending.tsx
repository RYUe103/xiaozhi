import { memo } from 'react';
import { LoaderCircle } from 'lucide-react';

const ExecutionPending = memo(function ExecutionPending() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="my-2 inline-flex max-w-full items-center gap-2 rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-secondary"
    >
      <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      <span>正在执行任务，请稍候...</span>
    </div>
  );
});

export default ExecutionPending;
