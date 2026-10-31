import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MemoryModeMenu from '../MemoryModeMenu';

const mockMutate = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetUserQuery: () => ({
    data: { personalization: { memoryMode: 'manual', memories: true } },
  }),
  useUpdateMemoryPreferencesMutation: () => ({ mutate: mockMutate }),
}));

jest.mock('~/components/SidePanel/Memories', () => ({
  MemoryPanel: () => <div data-testid="memory-panel" />,
}));

describe('MemoryModeMenu', () => {
  beforeEach(() => mockMutate.mockClear());

  it('renders its upward menu in a portal and closes it with Escape', async () => {
    render(<MemoryModeMenu />);
    const trigger = screen.getByRole('button', { name: '选择记忆模式' });

    fireEvent.click(trigger);
    const menu = await screen.findByRole('menu', { name: '选择记忆模式' });
    expect(trigger.parentElement?.contains(menu)).toBe(false);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('shows the edit action inside the manual mode row', async () => {
    render(<MemoryModeMenu />);
    fireEvent.click(screen.getByRole('button', { name: '选择记忆模式' }));

    expect(await screen.findByRole('button', { name: '编辑记忆' })).toBeInTheDocument();
  });
});
