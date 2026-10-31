import React from 'react';
import { render, screen } from '@testing-library/react';
import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';

jest.mock('~/utils', () => ({
  mapAttachments: () => ({}),
  getToolDisplayLabel: (name: string) => name,
  groupSequentialToolCalls: (parts: Array<{ part: unknown; idx: number }>) =>
    parts.map((p) => ({ type: 'single' as const, part: p })),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/Providers', () => ({
  MessageContext: {
    Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
  SearchContext: {
    Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));

jest.mock('../Parts', () => ({
  EditTextPart: () => <div data-testid="edit-text-part" />,
  EmptyText: () => <div data-testid="empty-text" />,
}));

jest.mock('../MemoryArtifacts', () => ({
  __esModule: true,
  default: () => <div data-testid="memory-artifacts" />,
}));

jest.mock('../Parts/PendingSkillCall', () => ({
  __esModule: true,
  default: ({ skillName, loaded }: { skillName: string; loaded: boolean }) => (
    <div data-testid="pending-skill-call" data-skill={skillName} data-loaded={String(loaded)} />
  ),
}));

jest.mock('../ToolCallGroup', () => ({
  __esModule: true,
  default: ({ activityLabel }: { activityLabel?: string }) => (
    <div data-testid="tool-call-group" data-activity-label={activityLabel} />
  ),
}));

jest.mock('../MessageProcessGroup', () => ({
  __esModule: true,
  default: ({
    children,
    statusLabel,
    hasInterruption,
  }: {
    children: React.ReactNode;
    statusLabel?: string;
    hasInterruption?: boolean;
  }) => (
    <div
      data-testid="message-process-group"
      data-status-label={statusLabel}
      data-interrupted={String(hasInterruption)}
    >
      {children}
    </div>
  ),
}));

jest.mock('../KnowledgeRetrievalCall', () => ({
  __esModule: true,
  default: ({ status }: { status?: string }) => (
    <div data-testid="legacy-knowledge-status" data-status={status} />
  ),
}));

jest.mock('../FileParseCall', () => ({
  __esModule: true,
  default: ({ status }: { status?: string }) => (
    <div data-testid="file-parse-status" data-status={status} />
  ),
}));

jest.mock('../Container', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="container">{children}</div>
  ),
}));

jest.mock('../Part', () => ({
  __esModule: true,
  default: ({ part }: { part: TMessageContentParts }) => (
    <div data-testid={`real-part-${part.type}`} />
  ),
}));

jest.mock('../ParallelContent', () => ({
  ParallelContentRenderer: () => <div data-testid="parallel-renderer" />,
}));

import ContentParts from '../ContentParts';

const baseProps = {
  messageId: 'msg-1',
  isLast: false,
  isSubmitting: false,
  isLatestMessage: false,
  isCreatedByUser: false,
  content: [],
};

describe('ContentParts — interim skill cards', () => {
  it('renders a PendingSkillCall per manual skill on assistant messages', () => {
    render(<ContentParts {...baseProps} manualSkills={['brand-guidelines', 'pptx']} />);
    const cards = screen.getAllByTestId('pending-skill-call');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-skill', 'brand-guidelines');
    expect(cards[1]).toHaveAttribute('data-skill', 'pptx');
  });

  it('starts pending skill cards in the not-loaded state (no real content yet)', () => {
    render(<ContentParts {...baseProps} manualSkills={['pptx']} />);
    expect(screen.getByTestId('pending-skill-call')).toHaveAttribute('data-loaded', 'false');
  });

  it('flips pending cards to loaded once any real content part arrives', () => {
    const content: TMessageContentParts[] = [
      { type: ContentTypes.TEXT, text: 'streamed' } as unknown as TMessageContentParts,
    ];
    render(<ContentParts {...baseProps} content={content} manualSkills={['pptx']} />);
    expect(screen.getByTestId('pending-skill-call')).toHaveAttribute('data-loaded', 'true');
  });

  it('does NOT render skill cards on user messages', () => {
    render(<ContentParts {...baseProps} isCreatedByUser manualSkills={['pptx']} />);
    expect(screen.queryByTestId('pending-skill-call')).toBeNull();
  });

  it('renders nothing when manualSkills is empty and content is undefined', () => {
    const { container } = render(
      <ContentParts {...baseProps} content={undefined} manualSkills={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders pending skill cards even when content is undefined', () => {
    render(<ContentParts {...baseProps} content={undefined} manualSkills={['pptx']} />);
    expect(screen.getAllByTestId('pending-skill-call')).toHaveLength(1);
  });

  it('renders pending skill cards above parallel content', () => {
    const parallelContent: TMessageContentParts[] = [
      {
        type: ContentTypes.TEXT,
        text: 'parallel',
        groupId: 'group-1',
      } as unknown as TMessageContentParts,
    ];
    render(<ContentParts {...baseProps} content={parallelContent} manualSkills={['pptx']} />);
    const skillCard = screen.getByTestId('pending-skill-call');
    const parallelRenderer = screen.getByTestId('parallel-renderer');
    expect(skillCard).toBeTruthy();
    expect(parallelRenderer).toBeTruthy();
    expect(skillCard.compareDocumentPosition(parallelRenderer)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('renders pending skill cards above sequential content', () => {
    const sequentialContent: TMessageContentParts[] = [
      { type: ContentTypes.TEXT, text: 'streamed' } as unknown as TMessageContentParts,
    ];
    render(<ContentParts {...baseProps} content={sequentialContent} manualSkills={['pptx']} />);
    const skillCard = screen.getByTestId('pending-skill-call');
    const textPart = screen.getByTestId(`real-part-${ContentTypes.TEXT}`);
    expect(skillCard).toBeTruthy();
    expect(textPart).toBeTruthy();
    expect(skillCard.compareDocumentPosition(textPart)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe('ContentParts — process history', () => {
  it('does not turn reasoning-only content into timeline rows', () => {
    const content = [
      { type: ContentTypes.THINK, think: 'first' },
      { type: ContentTypes.THINK, think: 'second' },
    ] as unknown as TMessageContentParts[];
    render(<ContentParts {...baseProps} content={content} />);
    expect(screen.queryByTestId(`real-part-${ContentTypes.THINK}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`real-part-${ContentTypes.TOOL_CALL}`)).not.toBeInTheDocument();
  });

  it('renders repeated Word calls separated by reasoning as one semantic stage', () => {
    const wordCode = "from docx import Document\ndoc = Document()\ndoc.save('/mnt/data/a.docx')";
    const content = [
      { type: ContentTypes.THINK, think: 'prepare' },
      {
        type: ContentTypes.TOOL_CALL,
        tool_call: {
          id: 'word-1',
          name: 'execute_code',
          args: { code: wordCode },
          output: 'Generated files: /mnt/data/a.docx',
          progress: 1,
        },
      },
      { type: ContentTypes.THINK, think: 'retry' },
      {
        type: ContentTypes.TOOL_CALL,
        tool_call: {
          id: 'word-2',
          name: 'execute_code',
          args: { code: wordCode },
          output: 'Generated files: /mnt/data/a.docx',
          progress: 1,
        },
      },
      { type: ContentTypes.THINK, think: 'finish' },
    ] as unknown as TMessageContentParts[];

    render(<ContentParts {...baseProps} content={content} />);

    expect(screen.getAllByTestId('tool-call-group')).toHaveLength(1);
    expect(screen.getByTestId('tool-call-group')).toHaveAttribute(
      'data-activity-label',
      '生成 Word 文档',
    );
    expect(screen.queryByTestId(`real-part-${ContentTypes.THINK}`)).not.toBeInTheDocument();
  });

  it('uses the latest real stage for the running top-level status', () => {
    const content = [
      { type: ContentTypes.THINK, think: 'prepare' },
      {
        type: ContentTypes.TOOL_CALL,
        tool_call: {
          id: 'calc-1',
          name: 'execute_code',
          args: { code: 'print(6 * 7)' },
          progress: 0.2,
        },
      },
      { type: ContentTypes.THINK, think: 'wait' },
    ] as unknown as TMessageContentParts[];

    render(<ContentParts {...baseProps} isLast isLatestMessage isSubmitting content={content} />);

    expect(screen.getByTestId('message-process-group')).toHaveAttribute(
      'data-status-label',
      '正在执行计算',
    );
  });

  it('marks the whole run interrupted when tools finished but no final answer arrived', () => {
    const content = [
      {
        type: ContentTypes.TOOL_CALL,
        tool_call: {
          id: 'calc-1',
          name: 'execute_code',
          args: { code: 'print(6 * 7)' },
          output: '42',
          progress: 1,
        },
      },
    ] as unknown as TMessageContentParts[];

    render(<ContentParts {...baseProps} content={content} />);

    expect(screen.getByTestId('message-process-group')).toHaveAttribute('data-interrupted', 'true');
  });
});

describe('ContentParts — knowledge status lifecycle', () => {
  it('renders persisted metadata status for older knowledge messages', () => {
    render(<ContentParts {...baseProps} knowledgeStatus="completed" />);

    expect(screen.getByTestId('legacy-knowledge-status')).toHaveAttribute(
      'data-status',
      'completed',
    );
  });

  it('does not duplicate status when the message already contains the knowledge part', () => {
    const content = [
      {
        type: ContentTypes.TOOL_CALL,
        tool_call: {
          id: 'knowledge-1',
          name: 'sansuo_knowledge_search',
          args: '{}',
          progress: 1,
        },
      } as unknown as TMessageContentParts,
    ];
    render(<ContentParts {...baseProps} content={content} knowledgeStatus="completed" />);

    expect(screen.getAllByTestId('legacy-knowledge-status')).toHaveLength(1);
    expect(screen.queryByTestId(`real-part-${ContentTypes.TOOL_CALL}`)).not.toBeInTheDocument();
  });

  it('keeps searching visible when streaming replaces the tool part before text arrives', () => {
    render(
      <ContentParts
        {...baseProps}
        isLast
        isLatestMessage
        isSubmitting
        content={[]}
        knowledgeStatus="searching"
      />,
    );

    expect(screen.getByTestId('legacy-knowledge-status')).toHaveAttribute(
      'data-status',
      'searching',
    );
  });

  it('switches to completed only after non-empty answer text appears', () => {
    const content = [
      { type: ContentTypes.TEXT, text: '知识库正文' } as unknown as TMessageContentParts,
    ];
    render(
      <ContentParts
        {...baseProps}
        isLast
        isLatestMessage
        isSubmitting
        content={content}
        knowledgeStatus="searching"
      />,
    );

    expect(screen.getByTestId('legacy-knowledge-status')).toHaveAttribute(
      'data-status',
      'completed',
    );
  });

  it('does not complete from tool progress alone while the answer is still pending', () => {
    const content = [
      {
        type: ContentTypes.TOOL_CALL,
        tool_call: {
          id: 'knowledge-1',
          name: 'sansuo_knowledge_search',
          args: '{}',
          progress: 1,
          status: 'completed',
        },
      } as unknown as TMessageContentParts,
    ];
    render(
      <ContentParts
        {...baseProps}
        isLast
        isLatestMessage
        isSubmitting
        content={content}
        knowledgeStatus="searching"
      />,
    );

    expect(screen.getByTestId('legacy-knowledge-status')).toHaveAttribute(
      'data-status',
      'searching',
    );
  });
});

describe('ContentParts — file parse status lifecycle', () => {
  it('renders the parse row above the answer without exposing internal reasoning', () => {
    const content = [
      { type: ContentTypes.THINK, think: '独立思考内容' },
      { type: ContentTypes.TEXT, text: '最终正文' },
    ] as unknown as TMessageContentParts[];

    render(<ContentParts {...baseProps} content={content} fileParseStatus="completed" />);

    const parseStatus = screen.getByTestId('file-parse-status');
    const answer = screen.getByTestId(`real-part-${ContentTypes.TEXT}`);
    expect(screen.queryByTestId(`real-part-${ContentTypes.THINK}`)).not.toBeInTheDocument();
    expect(parseStatus.compareDocumentPosition(answer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps parsing visible when the temporary tool part is replaced', () => {
    render(
      <ContentParts
        {...baseProps}
        isLast
        isLatestMessage
        isSubmitting
        content={[]}
        fileParseStatus="parsing"
      />,
    );

    expect(screen.getByTestId('file-parse-status')).toHaveAttribute('data-status', 'parsing');
  });

  it('switches to completed when model content starts after the parse gate', () => {
    const content = [
      { type: ContentTypes.THINK, think: '正在分析' } as unknown as TMessageContentParts,
    ];
    render(
      <ContentParts
        {...baseProps}
        isLast
        isLatestMessage
        isSubmitting
        content={content}
        fileParseStatus="parsing"
      />,
    );

    expect(screen.getByTestId('file-parse-status')).toHaveAttribute('data-status', 'completed');
  });

  it('renders one completed row from a persisted parse tool part', () => {
    const content = [
      {
        type: ContentTypes.TOOL_CALL,
        tool_call: {
          id: 'parse-1',
          name: 'sansuo_file_parse',
          args: '{}',
          progress: 1,
          status: 'completed',
        },
      } as unknown as TMessageContentParts,
    ];
    render(<ContentParts {...baseProps} content={content} fileParseStatus="completed" />);

    expect(screen.getAllByTestId('file-parse-status')).toHaveLength(1);
    expect(screen.getByTestId('file-parse-status')).toHaveAttribute('data-status', 'completed');
  });
});
