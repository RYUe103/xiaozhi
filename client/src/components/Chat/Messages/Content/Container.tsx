import { TMessage } from 'librechat-data-provider';
import Files from './Files';
import FilePreviewErrorBoundary from './FilePreviewErrorBoundary';
import SkillPills from './SkillPills';

const Container = ({ children, message }: { children: React.ReactNode; message?: TMessage }) => (
  <div
    className="text-message flex min-h-[20px] flex-col items-start gap-3 overflow-visible [.text-message+&]:mt-5"
    dir="auto"
  >
    {message?.isCreatedByUser === true && (
      <>
        <FilePreviewErrorBoundary
          resetKey={(message.files ?? [])
            .map((file) => `${file.file_id ?? ''}:${file.filename ?? ''}:${file.status ?? ''}`)
            .join('|')}
        >
          <Files message={message} />
        </FilePreviewErrorBoundary>
        <SkillPills skills={message.alwaysAppliedSkills} source="always-apply" />
        <SkillPills skills={message.manualSkills} source="manual" />
      </>
    )}
    {children}
  </div>
);

export default Container;
