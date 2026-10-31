import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { request } from 'librechat-data-provider';
import SanSuoIndustryMaterialsAdmin from '../SanSuoIndustryMaterialsAdmin';

const existingMaterial = {
  materialId: 'pipeline-terms',
  name: '管道术语',
  description: '',
  version: '1.0',
  contentChars: 6,
  enabled: true,
  published: true,
  sortOrder: 0,
};

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [existingMaterial], isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useMutation: (
    mutationFn: (value: unknown) => Promise<unknown>,
    options: Record<string, any>,
  ) => ({
    mutate: (value: unknown) => {
      void mutationFn(value).then(options.onSuccess).catch(options.onError);
    },
    isLoading: false,
  }),
}));

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    apiBaseUrl: () => '',
    request: {
      ...actual.request,
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      postMultiPart: jest.fn(),
    },
  };
});

const mockPost = request.post as jest.Mock;
const mockPut = request.put as jest.Mock;

describe('SanSuoIndustryMaterialsAdmin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('keeps the blank create form open when existing materials are present', async () => {
    mockPost.mockResolvedValue({
      ...existingMaterial,
      materialId: 'new-material',
      name: '新资料',
    });

    render(<SanSuoIndustryMaterialsAdmin setMessage={jest.fn()} />);

    await screen.findByRole('heading', { name: '编辑资料' });
    fireEvent.click(screen.getByRole('button', { name: '新增资料' }));

    expect(screen.getByRole('heading', { name: '新增资料' })).toBeInTheDocument();
    expect(screen.getByLabelText('资料标识')).toBeEnabled();
    expect(screen.getByLabelText('资料标识')).toHaveValue('');

    fireEvent.change(screen.getByLabelText('资料标识'), { target: { value: 'new-material' } });
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '新资料' } });
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPut).not.toHaveBeenCalled();
  });

  test('returns to edit mode and saves with PUT after selecting an existing material', async () => {
    mockPut.mockResolvedValue(existingMaterial);

    render(<SanSuoIndustryMaterialsAdmin setMessage={jest.fn()} />);

    await screen.findByRole('heading', { name: '编辑资料' });
    fireEvent.click(screen.getByRole('button', { name: '新增资料' }));
    fireEvent.click(screen.getByRole('button', { name: /管道术语/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }));

    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1));
    expect(mockPut.mock.calls[0][1]).not.toHaveProperty('markdown');
    expect(mockPost).not.toHaveBeenCalled();
  });

  test('does not render markdown content and provides an export download', async () => {
    const { container } = render(<SanSuoIndustryMaterialsAdmin setMessage={jest.fn()} />);

    await screen.findByText('已保存 6 字符，正文不在页面中加载。');
    expect(container.querySelector('textarea')).not.toBeInTheDocument();
    expect(screen.queryByText('# 管道术语')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '导出 MD' })).toHaveAttribute(
      'href',
      '/api/admin/sansuo-data/industry-materials/pipeline-terms/markdown',
    );
  });

  test('normalizes legacy materials without resource arrays and keeps create available', async () => {
    render(<SanSuoIndustryMaterialsAdmin setMessage={jest.fn()} />);

    await screen.findByRole('heading', { name: '编辑资料' });
    expect(screen.getAllByText('暂无文件')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '新增资料' }));
    expect(screen.getByRole('heading', { name: '新增资料' })).toBeInTheDocument();
    expect(screen.getByLabelText('资料标识')).toHaveValue('');
  });
});
