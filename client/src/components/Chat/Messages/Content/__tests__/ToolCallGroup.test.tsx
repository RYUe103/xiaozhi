import React from 'react';
import { RecoilRoot } from 'recoil';
import { Tools, Constants, ContentTypes } from 'librechat-data-provider';
import type { TAttachment, TMessageContentParts } from 'librechat-data-provider';
import { fireEvent, render, screen } from '@testing-library/react';
import ToolCallGroup from '../ToolCallGroup';
import store from '~/store';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string | number, string>) => {
    if (key === 'com_ui_used_n_tools') {
      return `Used ${values?.[0]} tools`;
    }
    if (key === 'com_ui_via_server') {
      return `via ${values?.[0]}`;
    }
    return key;
  },
  useExpandCollapse: (isExpanded: boolean) => ({
    style: {
      display: 'grid',
      gridTemplateRows: isExpanded ? '1fr' : '0fr',
    },
    ref: { current: null },
  }),
}));

jest.mock('~/hooks/MCP', () => ({
  useMCPIconMap: () => new Map(),
}));

jest.mock('../ToolOutput', () => ({
  isError: (value: string) => value.startsWith('Error:'),
  StackedToolIcons: ({ tools }: { tools: Array<{ name: string; args?: { action?: string } }> }) => (
    <span
      data-testid="stacked-icons"
      data-tool-names={tools.map(({ name }) => name).join(',')}
      data-tool-actions={tools.map(({ args }) => args?.action ?? '').join(',')}
    />
  ),
  getMCPServerName: () => '',
}));

jest.mock('lucide-react', () => ({
  ChevronDown: () => <span>{'chevron'}</span>,
  Users: () => <span>{'users'}</span>,
}));

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  getToolDisplayLabel: (name: string, _localize: unknown, args?: { action?: string }) => {
    if (name === 'read_parsed_pdf' || name === 'read_parsed_docx') {
      return (
        {
          search: 'Search Document',
          read_table: 'Read Table',
          read: 'Read Document',
        }[args?.action ?? 'read'] || 'Read Document'
      );
    }
    if (
      ['execute_code', 'bash_tool', 'run_tools_with_code', 'run_tools_with_bash'].includes(name)
    ) {
      return 'Code';
    }
    return name;
  },
}));

jest.mock('../Parts', () => ({
  AttachmentGroup: ({ attachments }: { attachments?: TAttachment[] }) => (
    <div data-testid="attachment-group" data-count={attachments?.length ?? 0} />
  ),
}));

const makePart = (
  id: string,
  output = 'done',
  name = 'fetch_image',
  args: string | Record<string, unknown> = '{}',
): TMessageContentParts =>
  ({
    type: ContentTypes.TOOL_CALL,
    [ContentTypes.TOOL_CALL]: {
      id,
      name,
      args,
      output,
    },
  }) as unknown as TMessageContentParts;

const imageAttachment: TAttachment = {
  filename: 'foo.png',
  filepath: '/files/foo.png',
  width: 128,
  height: 128,
  messageId: 'm1',
  toolCallId: 't1',
  conversationId: 'c1',
} as unknown as TAttachment;

const fileAttachment: TAttachment = {
  filename: 'bar.pdf',
  filepath: '/files/bar.pdf',
  messageId: 'm1',
  toolCallId: 't2',
  conversationId: 'c1',
} as unknown as TAttachment;

const renderGroup = (props: React.ComponentProps<typeof ToolCallGroup>, autoExpand = false) =>
  render(
    <RecoilRoot initializeState={({ set }) => set(store.autoExpandTools, autoExpand)}>
      <ToolCallGroup {...props} />
    </RecoilRoot>,
  );

describe('ToolCallGroup image hoisting', () => {
  const parts = [
    { part: makePart('t1'), idx: 0 },
    { part: makePart('t2'), idx: 1 },
  ];

  const baseProps = {
    parts,
    isSubmitting: false,
    isLast: false,
    lastContentIdx: 1,
    renderPart: (_p: TMessageContentParts, idx: number) => (
      <div data-testid={`inner-${idx}`} key={idx}>
        {'inner'}
      </div>
    ),
  } satisfies React.ComponentProps<typeof ToolCallGroup>;

  it('renders an AttachmentGroup outside the collapsible container with all attachments', () => {
    renderGroup({
      ...baseProps,
      groupAttachments: [imageAttachment, fileAttachment],
    });

    const group = screen.getByTestId('attachment-group');
    expect(group).toBeInTheDocument();
    expect(group.getAttribute('data-count')).toBe('2');
  });

  it('hoists non-image attachments so they survive collapse', () => {
    renderGroup({
      ...baseProps,
      groupAttachments: [fileAttachment],
    });

    const group = screen.getByTestId('attachment-group');
    expect(group).toBeInTheDocument();
    expect(group.getAttribute('data-count')).toBe('1');
  });

  it('does not render an AttachmentGroup when there are no group attachments', () => {
    renderGroup(baseProps);
    expect(screen.queryByTestId('attachment-group')).not.toBeInTheDocument();
  });

  it('renders the image AttachmentGroup as a sibling of the collapsible panel, not a child', () => {
    const { container } = renderGroup({
      ...baseProps,
      groupAttachments: [imageAttachment],
    });

    const outer = container.firstChild as HTMLElement;
    const attachmentGroup = screen.getByTestId('attachment-group');
    expect(attachmentGroup.parentElement).toBe(outer);

    const collapsible = outer.querySelector('[style]');
    expect(collapsible?.contains(attachmentGroup)).toBe(false);
  });

  it('summarizes mixed bash PTC and bash_tool calls as one Code tool family', () => {
    renderGroup({
      ...baseProps,
      parts: [
        {
          part: makePart('t1', 'ptc done', Constants.PROGRAMMATIC_TOOL_CALLING, {
            code: 'echo via ptc',
          }),
          idx: 0,
        },
        {
          part: makePart('t2', 'bash done', Tools.bash_tool, {
            command: 'echo via bash',
          }),
          idx: 1,
        },
      ],
    });

    expect(screen.getByText(/Code.*× 2/)).toBeInTheDocument();
    expect(screen.queryByText(/Code, bash_tool/)).not.toBeInTheDocument();
    expect(screen.getByTestId('stacked-icons')).toHaveAttribute(
      'data-tool-names',
      'bash_tool,bash_tool',
    );
  });

  it('keeps a completed group visible as a collapsed summary and lets the user expand it', () => {
    renderGroup(baseProps);

    const toggle = screen.getByRole('button', { name: 'Used 2 tools' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/fetch_image.*× 2/)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('inner-0')).toBeInTheDocument();
    expect(screen.getByTestId('inner-1')).toBeInTheDocument();
  });

  it('keeps a single completed semantic stage collapsed and hides raw tool count', () => {
    renderGroup({
      ...baseProps,
      parts: [{ part: makePart('t1', 'done', 'execute_code', { code: 'print(42)' }), idx: 0 }],
      activityLabel: '执行计算',
    });

    const toggle = screen.getByRole('button', { name: '执行计算' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('执行计算')).toBeInTheDocument();
    expect(screen.queryByText(/× 1/)).not.toBeInTheDocument();
  });

  it('keeps semantic stages collapsed when legacy tool auto-expand is enabled', () => {
    renderGroup(
      {
        ...baseProps,
        parts: [{ part: makePart('t1', 'done', 'execute_code', { code: 'print(42)' }), idx: 0 }],
        activityLabel: '执行计算',
      },
      true,
    );

    expect(screen.getByRole('button', { name: '执行计算' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('keeps multiple raw calls under one semantic stage', () => {
    renderGroup({ ...baseProps, activityLabel: '生成 Word 文档' });
    const toggle = screen.getByRole('button', { name: '生成 Word 文档' });
    expect(screen.getByText('生成 Word 文档')).toBeInTheDocument();
    expect(screen.queryByText(/× 2/)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByTestId('inner-0')).toBeInTheDocument();
    expect(screen.getByTestId('inner-1')).toBeInTheDocument();
  });

  it('summarizes repeated composite document tools by their real actions', () => {
    renderGroup({
      ...baseProps,
      parts: [
        { part: makePart('t1', 'found', 'read_parsed_pdf', { action: 'search' }), idx: 0 },
        {
          part: makePart('t2', 'table', 'read_parsed_pdf', { action: 'read_table' }),
          idx: 1,
        },
      ],
    });

    expect(screen.getByText(/Search Document, Read Table.*× 2/)).toBeInTheDocument();
    expect(screen.queryByText(/read_parsed_pdf/)).not.toBeInTheDocument();
    expect(screen.getByTestId('stacked-icons')).toHaveAttribute(
      'data-tool-actions',
      'search,read_table',
    );
  });
});
