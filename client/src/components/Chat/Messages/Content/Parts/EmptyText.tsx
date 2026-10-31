import { memo } from 'react';

/** Streaming cursor placeholder — no bottom margin to match Container's structure and prevent CLS */
const EmptyTextPart = memo(() => {
  return (
    <div className="text-message flex min-h-[20px] flex-col items-start gap-3 overflow-visible">
      <div className="markdown prose dark:prose-invert light w-full break-words dark:text-gray-100">
        <div
          role="status"
          className="inline-flex min-h-8 items-center gap-2 text-sm text-text-secondary"
        >
          <span
            className="message-process-pulse h-1.5 w-1.5 rounded-full bg-current"
            aria-hidden="true"
          />
          <span>正在处理</span>
        </div>
      </div>
    </div>
  );
});

export default EmptyTextPart;
