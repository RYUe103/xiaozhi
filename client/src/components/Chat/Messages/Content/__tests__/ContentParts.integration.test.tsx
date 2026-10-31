import React from 'react';
import { RecoilRoot } from 'recoil';
import { ContentTypes } from 'librechat-data-provider';
import type { TAttachment, TMessageContentParts } from 'librechat-data-provider';
import { render, screen } from '@testing-library/react';
import ContentParts from '../ContentParts';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string | number, string>) => {
    if (key === 'com_ui_used_n_tools') {
      return `Used ${values?.[0]} tools`;
    }
    return key;
  },
  useExpandCollapse: (isExpanded: boolean) => ({
    style: { display: 'grid', gridTemplateRows: isExpanded ? '1fr' : '0fr' },
    ref: { current: null },
  }),
  useProgress: (initial: number) => (initial >= 1 ? 1 : initial),
}));

jest.mock('~/hooks/MCP', () => ({
  useMCPIconMap: () => new Map(),
}));

jest.mock('../ToolOutput', () => ({
  StackedToolIcons: () => <span data-testid="stacked-icons" />,
  getMCPServerName: () => '',
  ToolIcon: () => <span data-testid="tool-icon" />,
  getToolIconType: () => 'mcp',
  isError: () => false,
}));

jest.mock('../ToolCallInfo', () => ({
  __esModule: true,
  default: () => <div data-testid="tool-call-info" />,
}));

jest.mock('../FileWorkspacePanel', () => ({
  __esModule: true,
  default: ({ attachments }: { attachments?: TAttachment[] }) =>
    attachments?.length ? (
      <div data-testid="file-workspace" data-count={attachments.length} />
    ) : null,
}));

jest.mock('../ProgressText', () => ({
  __esModule: true,
  default: ({ onClick, finishedText }: { onClick?: () => void; finishedText?: string }) => (
    <div data-testid="progress-text" onClick={onClick}>
      {finishedText}
    </div>
  ),
}));

jest.mock('lucide-react', () => ({
  Check: () => <span>{'check'}</span>,
  ChevronDown: () => <span>{'chevron'}</span>,
  CircleStop: () => <span>{'stopped'}</span>,
  LoaderCircle: () => <span>{'loading'}</span>,
  TriangleAlert: () => <span>{'alert'}</span>,
  Users: () => <span>{'users'}</span>,
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
}));

jest.mock('../Parts', () => ({
  AttachmentGroup: ({ attachments }: { attachments?: TAttachment[] }) => (
    <div data-testid="attachment-group" data-count={attachments?.length ?? 0} />
  ),
  ExecuteCode: () => <div data-testid="execute-code" />,
  ImageGen: () => <div data-testid="image-gen" />,
  AgentUpdate: () => <div data-testid="agent-update" />,
  EmptyText: () => <div data-testid="empty-text" />,
  Reasoning: () => <div data-testid="reasoning" />,
  Summary: () => <div data-testid="summary" />,
  Text: ({ text }: { text?: string }) => <div data-testid="text">{text}</div>,
  EditTextPart: () => <div data-testid="edit-text" />,
}));

jest.mock('../MemoryArtifacts', () => ({
  __esModule: true,
  default: () => <div data-testid="memory-artifacts" />,
}));

jest.mock('../WebSearch', () => ({
  __esModule: true,
  default: () => <div data-testid="web-search" />,
}));

jest.mock('../RetrievalCall', () => ({
  __esModule: true,
  default: () => <div data-testid="retrieval-call" />,
}));

jest.mock('../AgentHandoff', () => ({
  __esModule: true,
  default: () => <div data-testid="agent-handoff" />,
}));

jest.mock('../CodeAnalyze', () => ({
  __esModule: true,
  default: () => <div data-testid="code-analyze" />,
}));

jest.mock('../Image', () => ({
  __esModule: true,
  default: () => <div data-testid="image" />,
}));

jest.mock('../Container', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('~/utils', () => {
  const actual = jest.requireActual('~/utils');
  return {
    ...actual,
    cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
    logger: { error: jest.fn() },
  };
});

const MCP_DELIMITER = '_mcp_';

const makeMcpToolCall = (id: string, hasOutput = true): TMessageContentParts =>
  ({
    type: ContentTypes.TOOL_CALL,
    [ContentTypes.TOOL_CALL]: {
      id,
      name: `getTinyImage${MCP_DELIMITER}Everything`,
      args: '{}',
      output: hasOutput ? 'image_returned' : '',
    },
  }) as unknown as TMessageContentParts;

const imageAttachment = (toolCallId: string, name = 'tiny.png'): TAttachment =>
  ({
    filename: name,
    filepath: `/files/${name}`,
    width: 16,
    height: 16,
    messageId: 'm1',
    toolCallId,
    conversationId: 'c1',
  }) as unknown as TAttachment;

const renderContentParts = (props: React.ComponentProps<typeof ContentParts>) =>
  render(
    <RecoilRoot>
      <ContentParts {...props} />
    </RecoilRoot>,
  );

describe('ContentParts integration: MCP grouping and file workspace ownership', () => {
  const baseProps = {
    messageId: 'msg1',
    isCreatedByUser: false,
    isLast: true,
    isSubmitting: false,
    isLatestMessage: true,
  };

  it('groups 2+ MCP tool calls without duplicating their attachments in the process timeline', () => {
    const content = [makeMcpToolCall('t1'), makeMcpToolCall('t2')];
    const attachments = [imageAttachment('t1', 'a.png'), imageAttachment('t2', 'b.png')];

    renderContentParts({
      ...baseProps,
      content,
      attachments,
    });

    expect(screen.queryByTestId('attachment-group')).not.toBeInTheDocument();
    expect(screen.getByTestId('file-workspace')).toHaveAttribute('data-count', '2');
  });

  it('does not group a single tool call and still keeps its attachment in the file workspace', () => {
    const content = [makeMcpToolCall('t1')];
    const attachments = [imageAttachment('t1', 'a.png')];

    renderContentParts({
      ...baseProps,
      content,
      attachments,
    });

    expect(screen.queryByTestId('attachment-group')).not.toBeInTheDocument();
    expect(screen.getByTestId('file-workspace')).toHaveAttribute('data-count', '1');
    expect(screen.queryByText(/Used .* tools/)).not.toBeInTheDocument();
  });

  it('keeps mixed image and non-image attachments in one file workspace', () => {
    const fileAtt: TAttachment = {
      filename: 'doc.pdf',
      filepath: '/files/doc.pdf',
      messageId: 'm1',
      toolCallId: 't2',
      conversationId: 'c1',
    } as unknown as TAttachment;

    const content = [makeMcpToolCall('t1'), makeMcpToolCall('t2')];
    const attachments = [imageAttachment('t1', 'a.png'), fileAtt];

    renderContentParts({
      ...baseProps,
      content,
      attachments,
    });

    expect(screen.queryByTestId('attachment-group')).not.toBeInTheDocument();
    expect(screen.getByTestId('file-workspace')).toHaveAttribute('data-count', '2');
  });

  it('renders neither process attachments nor a file workspace when no attachments exist', () => {
    const content = [makeMcpToolCall('t1'), makeMcpToolCall('t2')];

    renderContentParts({
      ...baseProps,
      content,
      attachments: [],
    });

    expect(screen.queryByTestId('attachment-group')).not.toBeInTheDocument();
    expect(screen.queryByTestId('file-workspace')).not.toBeInTheDocument();
  });
});
