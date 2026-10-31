import React from 'react';
import { render, screen } from '@testing-library/react';
import { Constants, ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import Part from '../Part';

jest.mock('../Parts', () => ({
  ImageGen: () => <div data-testid="image-gen" />,
  ExecuteCode: () => <div data-testid="execute-code" />,
  AgentUpdate: () => <div data-testid="agent-update" />,
  EmptyText: () => <div data-testid="empty-text" />,
  Reasoning: () => <div data-testid="reasoning" />,
  Summary: () => <div data-testid="summary" />,
  Text: ({ text }: { text?: string }) => <div data-testid="text">{text}</div>,
  SkillCall: () => <div data-testid="skill-call" />,
  ReadFileCall: () => <div data-testid="read-file-call" />,
  BashCall: ({ commandField }: { commandField?: string }) => (
    <div data-testid="bash-call" data-command-field={commandField ?? 'command'} />
  ),
  SubagentCall: () => <div data-testid="subagent-call" />,
}));

jest.mock('../MessageContent', () => ({
  ErrorMessage: () => <div data-testid="error-message" />,
}));

jest.mock('../RetrievalCall', () => ({
  __esModule: true,
  default: () => <div data-testid="retrieval-call" />,
}));

jest.mock('../KnowledgeRetrievalCall', () => ({
  __esModule: true,
  default: ({ status }: { status?: string }) => (
    <div data-testid="knowledge-retrieval-call" data-status={status} />
  ),
}));

jest.mock('../FileParseCall', () => ({
  __esModule: true,
  default: ({ status }: { status?: string }) => (
    <div data-testid="file-parse-call" data-status={status} />
  ),
}));

jest.mock('../AgentHandoff', () => ({
  __esModule: true,
  default: () => <div data-testid="agent-handoff" />,
}));

jest.mock('../CodeAnalyze', () => ({
  __esModule: true,
  default: () => <div data-testid="code-analyze" />,
}));

jest.mock('../Container', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../WebSearch', () => ({
  __esModule: true,
  default: () => <div data-testid="web-search" />,
}));

jest.mock('../ToolCall', () => ({
  __esModule: true,
  default: () => <div data-testid="tool-call" />,
}));

jest.mock('../Image', () => ({
  __esModule: true,
  default: () => <div data-testid="image" />,
}));

jest.mock('~/utils', () => ({
  getCachedPreview: jest.fn(),
}));

const renderPart = (part: TMessageContentParts) =>
  render(<Part part={part} isSubmitting={false} showCursor={false} isCreatedByUser={false} />);

const toolCallPart = (name: string, args = '{"code":"echo hi"}'): TMessageContentParts =>
  ({
    type: ContentTypes.TOOL_CALL,
    [ContentTypes.TOOL_CALL]: {
      id: 'call_1',
      name,
      args,
      output: 'hi',
      progress: 1,
    },
  }) as unknown as TMessageContentParts;

describe('Part tool renderer selection', () => {
  it('renders execute_code through the code renderer', () => {
    renderPart(toolCallPart('execute_code'));

    expect(screen.getByTestId('execute-code')).toBeInTheDocument();
  });

  it('routes bash PTC tool calls through the BashCall renderer', () => {
    renderPart(toolCallPart(Constants.BASH_PROGRAMMATIC_TOOL_CALLING));

    expect(screen.getByTestId('bash-call')).toHaveAttribute('data-command-field', 'code');
    expect(screen.queryByTestId('execute-code')).not.toBeInTheDocument();
  });

  it('routes default run_tools_with_code PTC calls through the BashCall renderer', () => {
    renderPart(toolCallPart(Constants.PROGRAMMATIC_TOOL_CALLING));

    expect(screen.getByTestId('bash-call')).toHaveAttribute('data-command-field', 'code');
    expect(screen.queryByTestId('execute-code')).not.toBeInTheDocument();
  });

  it('keeps Python PTC calls on the ExecuteCode renderer', () => {
    renderPart(
      toolCallPart(Constants.PROGRAMMATIC_TOOL_CALLING, '{"lang":"py","code":"print(1)"}'),
    );

    expect(screen.getByTestId('execute-code')).toBeInTheDocument();
    expect(screen.queryByTestId('bash-call')).not.toBeInTheDocument();
  });

  it.each([
    ['skill', 'skill-call'],
    ['read_file', 'read-file-call'],
    [Constants.SUBAGENT, 'subagent-call'],
  ])('routes %s through its SanSuo renderer', (name, testId) => {
    renderPart(toolCallPart(name));

    expect(screen.getByTestId(testId)).toBeInTheDocument();
    expect(screen.queryByTestId('tool-call')).not.toBeInTheDocument();
  });

  it('keeps unknown tools on the standard ToolCall renderer', () => {
    renderPart(toolCallPart('custom_tool'));

    expect(screen.getByTestId('tool-call')).toBeInTheDocument();
  });

  it('routes persisted knowledge search parts through the native-style status renderer', () => {
    renderPart(toolCallPart('sansuo_knowledge_search'));

    expect(screen.getByTestId('knowledge-retrieval-call')).not.toHaveAttribute('data-status');
    expect(screen.queryByTestId('tool-call')).not.toBeInTheDocument();
  });

  it('routes persisted document parse parts through the native-style status renderer', () => {
    renderPart(toolCallPart('sansuo_file_parse'));

    expect(screen.getByTestId('file-parse-call')).toBeInTheDocument();
    expect(screen.queryByTestId('tool-call')).not.toBeInTheDocument();
  });
});
