import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IndustryMaterialsMenu from '../IndustryMaterialsMenu';

const mockPut = jest.fn();
const mockShowToast = jest.fn();
let mockMode = 'fast';
let mockMaterialIds: string[] = [];

jest.mock('@tanstack/react-query', () => ({
  useQuery: (key: string[]) => {
    if (key[0] === 'sansuo-industry-materials') {
      return {
        data: [
          {
            materialId: 'pipes',
            name: '管道术语',
            sourceFiles: [{ sourceId: 'pipes-pdf', filename: '管道术语原文.pdf' }],
          },
          { materialId: 'design', name: '设计流程' },
        ],
      };
    }
    return { data: { knowledgeSources: { materialsLabel: '专业资料' } } };
  },
}));
jest.mock('@librechat/client', () => ({
  TooltipAnchor: ({ render }: { render: React.ReactNode }) => render,
  useToastContext: () => ({ showToast: mockShowToast }),
}));
jest.mock('librechat-data-provider', () => ({
  apiBaseUrl: () => '',
  request: { get: jest.fn(), put: (...args: unknown[]) => mockPut(...args) },
}));
jest.mock('~/hooks', () => ({ useAuthContext: () => ({ user: { id: 'user-a' } }) }));
jest.mock('~/utils', () => ({ cn: (...classes: unknown[]) => classes.filter(Boolean).join(' ') }));
jest.mock('~/utils/sansuoMode', () => ({
  SANSUO_MODE_EVENT: 'sansuo-mode-change',
  getSanSuoMode: () => mockMode,
  getSanSuoIndustryMaterialIds: () => mockMaterialIds,
  moveSanSuoIndustryMaterials: jest.fn(),
  setSanSuoIndustryMaterialIds: (ids: string[]) => {
    mockMaterialIds = ids;
    globalThis.dispatchEvent(new Event('sansuo-mode-change'));
  },
  setSanSuoSelection: (mode: string, _agentId: string, ids: string[]) => {
    mockMode = mode;
    mockMaterialIds = ids;
    globalThis.dispatchEvent(new Event('sansuo-mode-change'));
  },
}));

describe('IndustryMaterialsMenu', () => {
  beforeEach(() => {
    mockMode = 'fast';
    mockMaterialIds = [];
    mockPut.mockReset();
    mockPut.mockResolvedValue({});
    mockShowToast.mockReset();
  });

  test('mounts multiple materials and names the mounted material in the button and toast', async () => {
    render(<IndustryMaterialsMenu disabled={false} conversationId="new-chat" />);
    fireEvent.click(screen.getByRole('button', { name: '专业资料' }));
    fireEvent.click(await screen.findByRole('button', { name: /管道术语/ }));

    expect(screen.getByRole('button', { name: '已挂载《管道术语》' })).toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: '已挂载《管道术语》',
      status: 'success',
    });
    expect(screen.getByRole('link', { name: /管道术语原文.pdf/ })).toHaveAttribute(
      'href',
      '/api/sansuo-ui/materials/pipes/sources/pipes-pdf',
    );

    fireEvent.click(screen.getByRole('button', { name: /设计流程/ }));
    expect(screen.getByRole('button', { name: '已挂载《管道术语》等 2 份' })).toBeInTheDocument();
    expect(mockMaterialIds).toEqual(['pipes', 'design']);
  });

  test('mounting a material while in knowledge mode switches to fast mode', async () => {
    mockMode = 'knowledge';
    render(<IndustryMaterialsMenu disabled={false} conversationId="new-chat" />);
    fireEvent.click(screen.getByRole('button', { name: '专业资料' }));
    fireEvent.click(await screen.findByRole('button', { name: /管道术语/ }));

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('/api/sansuo-ui/preferences', {
        answerMode: 'fast',
        knowledgeAgentId: null,
      }),
    );
    expect(mockMode).toBe('fast');
    expect(mockMaterialIds).toEqual(['pipes']);
  });
});
