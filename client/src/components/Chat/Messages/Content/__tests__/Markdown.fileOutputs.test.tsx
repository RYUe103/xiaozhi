import React from 'react';
import { render, screen } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TAttachment } from 'librechat-data-provider';
import remarkFileOutputs, { matchesFileOutput } from '~/utils/remarkFileOutputs';

const outputs = [
  { file_id: 'out-123', filename: '报告.docx', filepath: '/uploads/user/out-123__报告.docx' },
] as TAttachment[];
const show = (content: string, files = outputs) =>
  render(
    <ReactMarkdown remarkPlugins={[remarkGfm, [remarkFileOutputs, files]]}>
      {content}
    </ReactMarkdown>,
  );

describe('structured output Markdown deduplication', () => {
  it('removes sandbox and real output downloads, including nested/reference links', () => {
    const { container } = show(
      '已生成文档。\n\n📥 **[报告.docx](sandbox:/mnt/data/报告.docx)**\n\n- [重复下载](/uploads/user/out-123__报告.docx)\n\n[下载][file]\n\n[file]: sandbox:/mnt/data/报告.docx\n\n后续可继续修改。',
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('已生成文档。')).toBeInTheDocument();
    expect(screen.getByText('后续可继续修改。')).toBeInTheDocument();
    expect(container.querySelector('ul')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
    expect(container).not.toHaveTextContent('📥');
  });

  it('preserves ordinary website/citation links even when the filename matches', () => {
    show('[报告.docx](https://example.com/报告.docx) [资料](https://kb.example/1)');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('keeps an unmatched file link when there is no real output object', () => {
    show('[文档](/api/files/download/out-123)', []);
    expect(screen.getByRole('link')).toBeInTheDocument();
  });

  it('preserves fenced and inline code and unrelated sandbox downloads', () => {
    show(
      '`[报告.docx](sandbox:/mnt/data/报告.docx)`\n\n```md\n[报告.docx](sandbox:/mnt/data/报告.docx)\n```\n\n[别的文件](sandbox:/mnt/data/其他.pdf)',
    );
    expect(screen.getAllByText('[报告.docx](sandbox:/mnt/data/报告.docx)')).toHaveLength(2);
    expect(screen.getByText('别的文件')).toBeInTheDocument();
  });

  it('keeps table geometry when a cell contains only the promoted download', () => {
    const { container } = show(
      '| 文件 | 说明 |\n| --- | --- |\n| [报告.docx](sandbox:/mnt/data/报告.docx) | 保留内容 |',
    );
    expect(container.querySelectorAll('tbody td')).toHaveLength(2);
    expect(screen.getByText('保留内容')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('matches encoded Chinese names and internal IDs without matching another site', () => {
    expect(matchesFileOutput('sandbox:/mnt/data/%E6%8A%A5%E5%91%8A.docx', outputs)).toBe(true);
    expect(matchesFileOutput('/api/files/download/out-123', outputs)).toBe(true);
    expect(matchesFileOutput('https://example.com/api/files/download/out-123', outputs)).toBe(
      false,
    );
    expect(matchesFileOutput('/api/files/download/out-1234', outputs)).toBe(false);
  });
});
