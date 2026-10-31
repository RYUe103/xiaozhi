import { FileText } from 'lucide-react';
import ProgressText from './ProgressText';

type FileParseStatus = 'parsing' | 'completed' | 'failed';

export default function FileParseCall({
  progress,
  status,
}: {
  progress: number;
  status?: FileParseStatus;
}) {
  const failed = status === 'failed';
  const complete = failed || status === 'completed' || progress >= 1;
  const finishedText = failed ? '文件解析失败' : '文件解析完成';

  return (
    <div className="my-1">
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {complete ? finishedText : '正在解析文件'}
      </span>
      <div className="relative my-1 flex h-5 shrink-0 items-center gap-2.5">
        <ProgressText
          progress={complete ? 1 : Math.max(0.1, progress)}
          inProgressText="正在解析文件"
          finishedText={finishedText}
          icon={
            <FileText
              className={
                complete ? 'size-4 text-text-secondary' : 'size-4 animate-pulse text-text-secondary'
              }
              aria-hidden="true"
            />
          }
          hasInput={false}
          error={failed}
        />
      </div>
    </div>
  );
}
