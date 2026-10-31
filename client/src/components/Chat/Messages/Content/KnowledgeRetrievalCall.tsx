import ProgressText from './ProgressText';
import { ToolIcon } from './ToolOutput';

type KnowledgeStatus = 'searching' | 'completed' | 'failed';

export default function KnowledgeRetrievalCall({
  progress,
  status,
}: {
  progress: number;
  status?: KnowledgeStatus;
}) {
  const failed = status === 'failed';
  const complete = failed || status === 'completed' || progress >= 1;
  const effectiveProgress = complete ? 1 : Math.max(0.1, progress);
  const statusText = failed ? '检索失败' : '检索完成';

  return (
    <div className="my-1">
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {complete ? statusText : '检索知识库中'}
      </span>
      <div className="relative my-1 flex h-5 shrink-0 items-center gap-2.5">
        <ProgressText
          progress={effectiveProgress}
          inProgressText="检索知识库中"
          finishedText={statusText}
          icon={<ToolIcon type="file_search" isAnimating={!complete} />}
          hasInput={false}
        />
      </div>
    </div>
  );
}
