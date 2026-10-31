import { memo, useCallback, useMemo, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { ChevronRight, CircleAlert, Download, Eye, Folder } from 'lucide-react';
import type { TAttachment } from 'librechat-data-provider';
import FilePreviewDialog from './FilePreviewDialog';
import { useAttachmentLink } from './Parts/LogLink';
import { useFileDownload } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn, triggerDownload } from '~/utils';
import store from '~/store';
import {
  canPreviewWorkspaceSource,
  getWorkspaceFileKind,
  getWorkspaceOutputs,
  type SanSuoFileSource,
} from '~/utils/fileWorkspace';

const FILE_KIND: Record<string, { asset: string; label: string }> = {
  pdf: { asset: 'pdf', label: 'PDF' },
  word: { asset: 'microsoft-word', label: 'Word' },
  excel: { asset: 'microsoft-excel', label: 'Excel' },
  powerpoint: { asset: 'microsoft-powerpoint', label: 'PowerPoint' },
  image: { asset: 'photo', label: '图片' },
  json: { asset: 'code', label: 'JSON' },
  markdown: { asset: 'md', label: 'Markdown' },
  csv: { asset: 'csv', label: 'CSV' },
  archive: { asset: 'zip', label: 'ZIP' },
  text: { asset: 'txt', label: '文本' },
  audio: { asset: 'audio', label: '音频' },
  video: { asset: 'video', label: '视频' },
  code: { asset: 'code', label: '代码' },
  file: { asset: 'genericfile', label: '文件' },
};

function WorkspaceFileIcon({ kind, className }: { kind: string; className: string }) {
  const { asset } = FILE_KIND[kind] ?? FILE_KIND.file;
  return (
    <img
      src={`assets/file-types/${asset}.svg`}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
    />
  );
}

const formatBytes = (bytes?: number) => {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

const SourceFileRow = memo(function SourceFileRow({ source }: { source: SanSuoFileSource }) {
  const localize = useLocalize();
  const user = useRecoilValue(store.user);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { refetch: downloadFile } = useFileDownload(user?.id ?? '', source.file_id, {
    source: source.source,
  });
  const kind = getWorkspaceFileKind(source.filename, source.type);
  const { label } = FILE_KIND[kind] ?? FILE_KIND.file;
  const previewable = canPreviewWorkspaceSource(source.filename, source.type);
  const unavailable = source.status === 'failed';
  const size = formatBytes(source.bytes);

  const handleDownload = useCallback(async () => {
    if (unavailable) return;
    const result = await downloadFile();
    if (result.data) triggerDownload(result.data, source.filename);
  }, [downloadFile, source.filename, unavailable]);

  const handleOpen = useCallback(() => {
    if (unavailable) return;
    if (previewable) setPreviewOpen(true);
    else void handleDownload();
  }, [handleDownload, previewable, unavailable]);

  return (
    <>
      <div className="group/file flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-surface-hover">
        <button
          type="button"
          onClick={handleOpen}
          disabled={unavailable}
          className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy disabled:cursor-default"
        >
          <span className="flex size-8 shrink-0 items-center justify-center">
            {unavailable ? (
              <CircleAlert className="size-4 text-red-500" aria-hidden="true" />
            ) : (
              <WorkspaceFileIcon kind={kind} className="size-8" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-sm font-medium text-text-primary"
              title={source.filename}
            >
              {source.filename}
            </span>
            <span className="block truncate text-xs text-text-secondary">
              {unavailable
                ? localize('com_ui_file_unavailable')
                : [label, size].filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
        {!unavailable && (
          <button
            type="button"
            onClick={previewable ? () => setPreviewOpen(true) : handleDownload}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-secondary opacity-70 transition-colors hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy md:opacity-0 md:group-focus-within/file:opacity-100 md:group-hover/file:opacity-100"
            aria-label={`${previewable ? localize('com_ui_preview') : localize('com_ui_download')} ${source.filename}`}
            title={previewable ? localize('com_ui_preview') : localize('com_ui_download')}
          >
            {previewable ? <Eye className="size-4" /> : <Download className="size-4" />}
          </button>
        )}
      </div>
      {previewable && (
        <FilePreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          fileName={source.filename}
          fileId={source.file_id}
          fileType={source.type}
          fileSize={source.bytes}
        />
      )}
    </>
  );
});

const OutputFileRow = memo(function OutputFileRow({
  attachment,
  isGenerating,
}: {
  attachment: TAttachment;
  isGenerating: boolean;
}) {
  const localize = useLocalize();
  const file = attachment as TAttachment & {
    file_id?: string;
    filename?: string;
    filepath?: string;
    source?: string;
    status?: string;
    bytes?: number;
    user?: string;
    expiresAt?: number;
    previewRevision?: string;
    previewError?: string;
  };
  const filename = file.filename || localize('com_ui_files');
  const kind = getWorkspaceFileKind(filename, String(file.type || ''));
  const { label } = FILE_KIND[kind] ?? FILE_KIND.file;
  // Office status tracks deferred preview extraction, not file generation.
  const previewOnly = Boolean(file.previewRevision || file.previewError);
  const unavailable =
    (!previewOnly && file.status === 'failed') ||
    ['missing', 'deleted', 'expired'].includes(file.status ?? '') ||
    (typeof file.expiresAt === 'number' && file.expiresAt < Date.now());
  const pending =
    isGenerating ||
    (!previewOnly && ['pending', 'running', 'processing'].includes(file.status ?? ''));
  const size = formatBytes(file.bytes);
  const { handleDownload } = useAttachmentLink({
    href: file.filepath || '',
    filename,
    file_id: file.file_id,
    user: file.user,
    source: file.source,
  });
  const typeLabel =
    kind === 'archive' || kind === 'image' || kind === 'text'
      ? filename.split('.').pop()?.toUpperCase() || label
      : label;
  const description =
    {
      word: '可编辑 Word 文档',
      excel: '可编辑 Excel 表格',
      powerpoint: '可编辑 PowerPoint 演示文稿',
    }[kind] ?? `${typeLabel} 文件`;
  let fileState = 'ready';
  let stateLabel = localize('com_ui_generated_success');
  if (pending) {
    fileState = 'pending';
    stateLabel = localize('com_ui_generating');
  }
  if (unavailable) {
    fileState = 'unavailable';
    stateLabel = localize('com_ui_file_unavailable');
  }

  return (
    <div
      className="sansuo-output-file min-w-0 py-2"
      data-file-kind={kind}
      data-file-state={fileState}
    >
      <span
        className={cn(
          'mb-5 inline-flex rounded-full px-2.5 py-0.5 text-sm leading-5',
          fileState === 'ready'
            ? 'bg-[#dff3e3] text-[#008b29] dark:bg-green-950 dark:text-green-300'
            : 'bg-surface-secondary text-text-secondary',
        )}
        role="status"
      >
        {fileState === 'ready'
          ? `已生成 ${typeLabel}${['word', 'excel', 'powerpoint'].includes(kind) ? ' 文档' : ' 文件'}`
          : stateLabel}
      </span>
      <div className="flex min-w-0 items-center gap-4 py-1 sm:gap-6">
        <span className="flex size-10 shrink-0 items-center justify-center" aria-hidden="true">
          <WorkspaceFileIcon kind={kind} className="size-10" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="sansuo-output-name block break-words text-base font-semibold leading-6 text-text-primary [overflow-wrap:anywhere]">
            {filename}
          </span>
          <span
            className="sansuo-output-meta mt-1 block text-sm leading-5 text-text-secondary"
            role={unavailable ? 'status' : undefined}
          >
            {[description, size].filter(Boolean).join(' · ')}
          </span>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={unavailable || pending}
          aria-label={`${localize('com_ui_download')} ${filename}`}
          className="min-h-10 shrink-0 rounded-full bg-[#0d0d0d] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-gray-200 sm:px-5"
        >
          {localize('com_ui_download')}
        </button>
      </div>
    </div>
  );
});

type FileWorkspacePanelProps = {
  attachments?: TAttachment[];
  sources?: SanSuoFileSource[];
  isGenerating?: boolean;
};

const FileWorkspacePanel = memo(function FileWorkspacePanel({
  attachments,
  sources,
  isGenerating = false,
}: FileWorkspacePanelProps) {
  const localize = useLocalize();
  const outputs = useMemo(() => getWorkspaceOutputs(attachments), [attachments]);
  const visibleSources = sources ?? [];
  const [sourcesExpanded, setSourcesExpanded] = useState(true);
  if (outputs.length === 0 && visibleSources.length === 0) return null;

  return (
    <section
      className="sansuo-file-workspace mb-4 mt-2 w-full min-w-0 text-text-primary"
      aria-label={localize('com_ui_files')}
    >
      {outputs.length > 0 && (
        <div
          className="sansuo-outputs pb-2 pl-3"
          aria-label={`${localize('com_ui_output')} ${outputs.length}`}
        >
          {outputs.length > 1 && (
            <h3 className="mb-1 text-sm text-text-secondary">
              {localize('com_ui_output')} {outputs.length}
            </h3>
          )}
          <div className="min-w-0 space-y-3">
            {outputs.map((output, index) => (
              <OutputFileRow
                key={String(
                  ('file_id' in output && output.file_id) ||
                    output.filepath ||
                    output.filename ||
                    index,
                )}
                attachment={output}
                isGenerating={isGenerating}
              />
            ))}
          </div>
        </div>
      )}
      {visibleSources.length > 0 && (
        <div className={cn(outputs.length > 0 && 'pt-3')}>
          <div className="mb-1 flex min-h-8 items-center px-1">
            <h3 className="text-sm font-semibold">{localize('com_ui_sources')}</h3>
            <span className="ml-2 text-xs tabular-nums text-text-secondary">
              {visibleSources.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSourcesExpanded((value) => !value)}
            aria-expanded={sourcesExpanded}
            className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
          >
            <Folder
              className="size-[18px] text-text-secondary"
              strokeWidth={1.7}
              aria-hidden="true"
            />
            <span className="font-medium">{localize('com_ui_files')}</span>
            <span className="text-xs tabular-nums text-text-secondary">
              {visibleSources.length}
            </span>
            <ChevronRight
              className={cn(
                'ml-auto size-4 text-text-secondary transition-transform duration-200',
                sourcesExpanded && 'rotate-90',
              )}
              aria-hidden="true"
            />
          </button>
          <div
            className="overflow-hidden transition-[max-height,opacity] duration-200 ease-out"
            style={{
              maxHeight: sourcesExpanded ? `${Math.max(1, visibleSources.length) * 52}px` : '0px',
              opacity: sourcesExpanded ? 1 : 0,
            }}
            aria-hidden={!sourcesExpanded || undefined}
          >
            <div className="pl-4">
              {visibleSources.map((source) => (
                <SourceFileRow key={source.file_id} source={source} />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
});

export default FileWorkspacePanel;
