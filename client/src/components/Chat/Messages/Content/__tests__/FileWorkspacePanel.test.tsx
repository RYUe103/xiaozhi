import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TAttachment } from 'librechat-data-provider';
import FileWorkspacePanel from '../FileWorkspacePanel';

jest.mock('recoil', () => ({
  useRecoilValue: () => ({ id: 'user-1' }),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: { user: {} },
}));

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string): string =>
      ({
        com_ui_download: '下载',
        com_ui_file_unavailable: '文件不可用',
        com_ui_files: '文件',
        com_ui_generated_success: '生成成功',
        com_ui_generating: '生成中...',
        com_ui_output: '输出',
        com_ui_preview: '预览',
        com_ui_sources: '来源',
      })[key] ?? key,
}));

jest.mock('~/data-provider', () => ({
  useFileDownload: () => ({ refetch: jest.fn() }),
}));

const mockDownload = jest.fn((event) => event.preventDefault());
jest.mock('../Parts/LogLink', () => ({
  useAttachmentLink: () => ({ handleDownload: mockDownload }),
}));

jest.mock('../FilePreviewDialog', () => ({
  __esModule: true,
  default: ({ open, fileName }: { open: boolean; fileName: string }) =>
    open ? <div data-testid="file-preview">{fileName}</div> : null,
}));

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  triggerDownload: jest.fn(),
}));

const output = {
  file_id: 'output-1',
  filename: '检测结果.xlsx',
  filepath: '/download/output-1',
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as TAttachment;

const sources = [
  {
    file_id: 'source-1',
    filename: '规范.pdf',
    type: 'application/pdf',
    status: 'ready' as const,
    kind: 'file' as const,
  },
  {
    file_id: 'source-2',
    filename: '已删除.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    status: 'failed' as const,
    kind: 'file' as const,
  },
];

describe('FileWorkspacePanel', () => {
  it('renders nothing when there are no real outputs or sources', () => {
    const { container } = render(<FileWorkspacePanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders outputs before sources and exposes unavailable source state', () => {
    render(<FileWorkspacePanel attachments={[output]} sources={sources} />);

    const outputHeading = screen.getByLabelText('输出 1');
    const sourceHeading = screen.getByRole('heading', { name: '来源' });
    expect(
      outputHeading.compareDocumentPosition(sourceHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText('检测结果.xlsx')).toBeInTheDocument();
    expect(screen.getByText(/可编辑 Excel 表格/)).toBeInTheDocument();
    expect(screen.getByText('规范.pdf')).toBeInTheDocument();
    expect(screen.getByText('文件不可用')).toBeInTheDocument();
  });

  it('provides exactly one download button with actual size', () => {
    render(
      <FileWorkspacePanel attachments={[{ ...output, bytes: 36966 } as unknown as TAttachment]} />,
    );
    const link = screen.getByRole('button', { name: '下载 检测结果.xlsx' });
    fireEvent.click(link);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(screen.getByText('可编辑 Excel 表格 · 36.1 KB')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not announce success while the reply is still generating', () => {
    render(<FileWorkspacePanel attachments={[output]} isGenerating />);
    expect(screen.queryByText(/已生成/)).not.toBeInTheDocument();
    expect(screen.getByText(/生成中/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows real unavailable files without a success label or download', () => {
    render(
      <FileWorkspacePanel
        attachments={[{ ...output, status: 'failed' } as unknown as TAttachment]}
      />,
    );
    expect(screen.getByText(/文件不可用/)).toBeInTheDocument();
    expect(screen.queryByText(/已生成/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it.each(['pending', 'failed'])(
    'keeps the real download when only the office preview is %s',
    (status) => {
      render(
        <FileWorkspacePanel
          attachments={[
            {
              ...output,
              status,
              previewRevision: 'preview-only',
              bytes: 100,
            } as unknown as TAttachment,
          ]}
        />,
      );
      expect(screen.getByRole('button', { name: '下载 检测结果.xlsx' })).toBeInTheDocument();
      expect(screen.getByText(/已生成/)).toBeInTheDocument();
    },
  );

  it('deduplicates outputs and counts all common file kinds', () => {
    const names = [
      '报告.docx',
      '表格.xlsx',
      '演示.pptx',
      '正文.pdf',
      '截图.png',
      '清单.csv',
      '备注.txt',
      '打包.zip',
    ];
    const files = names.map(
      (filename, index) =>
        ({
          file_id: String(index),
          filename,
          filepath: `/download/${index}`,
          bytes: 42,
        }) as TAttachment,
    );
    const { container } = render(<FileWorkspacePanel attachments={[...files, files[0]]} />);
    expect(container.querySelectorAll('.sansuo-output-file')).toHaveLength(8);
    expect(screen.getAllByRole('button')).toHaveLength(8);
    expect(screen.getByText('输出 8')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-file-kind="csv"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-file-kind="archive"]')).toHaveLength(1);
  });

  it('collapses and expands the source rows', () => {
    render(<FileWorkspacePanel sources={sources} />);
    const toggle = screen.getByRole('button', { name: /^文件/ });

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('规范.pdf').closest('[aria-hidden="true"]')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
