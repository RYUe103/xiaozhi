import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SanSuoAdmin from '../SanSuoAdmin';

const mockPut = jest.fn();
const mockPost = jest.fn();
const mockConnections = [
  {
    knowledgeBaseId: 'meeting-kb',
    name: '会议资料',
    baseUrl: 'http://knowledge.internal:8765',
    agentId: 'default',
    answerMode: 'local_model',
    answerPrompt: '原有提示词',
    enabled: true,
  },
];
const mockUiConfig = { appLinks: [] };
const mockUsage = {
  totals: { chat_request: { count: 3 }, knowledge_query: { count: 2 } },
  modes: { fast: { count: 1 }, deep: { count: 2 }, knowledge: { count: 2 } },
  trend: [],
  knowledgeBases: [
    {
      _id: 'meeting-kb',
      name: '会议资料',
      count: 2,
      users: 1,
      success: 1,
      errors: 0,
      timeouts: 0,
      insufficient: 1,
      averageDurationMs: 1500,
    },
  ],
};

jest.mock('@tanstack/react-query', () => ({
  useQuery: (key: string[]) => ({
    data:
      key[0] === 'sansuo-admin-knowledge-bases'
        ? mockConnections
        : key[0] === 'sansuo-admin-users'
          ? { users: [] }
          : key[0] === 'sansuo-admin-ui-config'
            ? mockUiConfig
            : key[0] === 'sansuo-admin-usage-overview'
              ? mockUsage
            : {},
    isLoading: false,
  }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useMutation: (fn: (arg: unknown) => unknown) => ({ mutate: fn, isLoading: false }),
}));
jest.mock('librechat-data-provider', () => ({
  apiBaseUrl: () => '',
  SystemRoles: { ADMIN: 'ADMIN' },
  request: {
    get: jest.fn(),
    put: (...args: unknown[]) => mockPut(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));
jest.mock('~/hooks', () => ({ useAuthContext: () => ({ user: { role: 'ADMIN' } }) }));
jest.mock('~/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }));
jest.mock('~/components/Skills/display/SkillMarkdownRenderer', () => () => null);
jest.mock('~/components/UnifiedSidebar/sansuoUiConfig', () => ({
  createEmptyAppLink: jest.fn(),
  getSansuoAppIcon: jest.fn(),
  sansuoAppIconOptions: [],
}));

describe('knowledge answer mode administration', () => {
  it('shows named knowledge-base result statistics without chat content', () => {
    render(<SanSuoAdmin />);

    expect(screen.getByText('具体知识库使用情况')).toBeInTheDocument();
    expect(screen.getByText('会议资料')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1.5 秒')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('preserves the old prompt across mode switches and saves the chosen mode', async () => {
    render(<SanSuoAdmin />);
    fireEvent.click(screen.getByRole('button', { name: '知识库', exact: true }));
    await waitFor(() =>
      expect(screen.getByLabelText('Answer 系统提示词')).toHaveValue('原有提示词'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Agentic RAG 直答', exact: true }));
    expect(screen.queryByLabelText('Answer 系统提示词')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存连接', exact: true }));
    expect(mockPut).toHaveBeenCalledWith(
      '/api/admin/sansuo-data/knowledge-bases/meeting-kb',
      expect.objectContaining({ answerMode: 'agentic_ask', answerPrompt: '原有提示词' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '自有 Answer 模型', exact: true }));
    expect(screen.getByLabelText('Answer 系统提示词')).toHaveValue('原有提示词');
  });

  it('defaults a new connection to Ask and tests the selected mode', () => {
    render(<SanSuoAdmin />);
    fireEvent.click(screen.getByRole('button', { name: '知识库', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '新增连接', exact: true }));
    expect(screen.getByRole('button', { name: 'Agentic RAG 直答', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByLabelText('Answer 系统提示词')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '测试连接', exact: true }));
    expect(mockPost).toHaveBeenCalledWith(
      '/api/admin/sansuo-data/knowledge-bases/test',
      expect.objectContaining({ answerMode: 'agentic_ask' }),
    );
  });
});
