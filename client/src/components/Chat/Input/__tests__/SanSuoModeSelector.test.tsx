import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SanSuoModeSelector from '../SanSuoModeSelector';

const mockPut = jest.fn();
let mockMode = 'knowledge';
let mockKnowledgeAgentId = 'kb-a';
let mockMaterialIds: string[] = [];

jest.mock('@tanstack/react-query', () => ({
  useQuery: (key: string[]) => {
    if (key[0] === 'sansuo-preferences') return { data: undefined };
    if (key[0] === 'sansuo-knowledge-agents')
      return { data: [{ agentId: 'kb-a', name: '会议纪要' }] };
    return { data: undefined };
  },
}));
jest.mock('@librechat/client', () => ({ useToastContext: () => ({ showToast: jest.fn() }) }));
jest.mock('librechat-data-provider', () => ({
  apiBaseUrl: () => '',
  request: { get: jest.fn(), put: (...args: unknown[]) => mockPut(...args) },
}));
jest.mock('~/hooks', () => ({ useAuthContext: () => ({ user: { id: 'user-a' } }) }));
jest.mock('~/utils', () => ({ cn: (...classes: unknown[]) => classes.filter(Boolean).join(' ') }));
jest.mock('~/utils/sansuoMode', () => ({
  SANSUO_MODE_EVENT: 'sansuo-mode-change',
  getSanSuoMode: () => mockMode,
  getSanSuoKnowledgeAgentId: () => mockKnowledgeAgentId,
  getSanSuoIndustryMaterialIds: () => mockMaterialIds,
  moveSanSuoIndustryMaterials: jest.fn(),
  setSanSuoSelection: (mode: string, agentId: string, materialIds: string[]) => {
    mockMode = mode;
    mockKnowledgeAgentId = agentId || '';
    mockMaterialIds = materialIds || [];
    globalThis.window.dispatchEvent(new globalThis.Event('sansuo-mode-change'));
  },
}));

describe('SanSuoModeSelector knowledge mode', () => {
  beforeEach(() => {
    mockPut.mockReset();
    mockPut.mockResolvedValue({});
    mockMode = 'knowledge';
    mockKnowledgeAgentId = 'kb-a';
    mockMaterialIds = [];
  });

  test('shows only knowledge agents without the old big-knowledge or material groups', async () => {
    render(<SanSuoModeSelector files={new Map()} disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /会议纪要/ }));
    expect(await screen.findAllByRole('button', { name: '会议纪要' })).toHaveLength(2);
    expect(screen.queryByText('大知识库')).not.toBeInTheDocument();
    expect(screen.queryByText('行业资料')).not.toBeInTheDocument();
  });

  test('switching to knowledge mode clears temporary industry materials', async () => {
    mockMode = 'fast';
    mockMaterialIds = ['pipes'];
    render(<SanSuoModeSelector files={new Map()} disabled={false} />);
    fireEvent.click(screen.getByRole('radio', { name: '知识库' }));
    await waitFor(() =>
      expect(mockPut).toHaveBeenLastCalledWith('/api/sansuo-ui/preferences', {
        answerMode: 'knowledge',
        knowledgeAgentId: 'kb-a',
      }),
    );
    expect(mockMode).toBe('knowledge');
    expect(mockMaterialIds).toEqual([]);
  });
});
