import React from 'react';
import { render, screen } from '@testing-library/react';
import KnowledgeRetrievalCall from '../KnowledgeRetrievalCall';

jest.mock('../ToolOutput', () => ({
  ToolIcon: ({ isAnimating }: { isAnimating?: boolean }) => (
    <span data-testid="knowledge-icon" data-animating={String(Boolean(isAnimating))} />
  ),
}));

describe('KnowledgeRetrievalCall', () => {
  it('shows an animated search state while retrieval is running', () => {
    render(<KnowledgeRetrievalCall progress={0.1} status="searching" />);

    expect(screen.getAllByText('检索知识库中').length).toBeGreaterThan(0);
    expect(screen.getByTestId('knowledge-icon')).toHaveAttribute('data-animating', 'true');
  });

  it('keeps the completed state visible from persisted progress', () => {
    render(<KnowledgeRetrievalCall progress={1} status="completed" />);

    expect(screen.getAllByText('检索完成').length).toBeGreaterThan(0);
    expect(screen.getByTestId('knowledge-icon')).toHaveAttribute('data-animating', 'false');
  });

  it('shows a stable failed state', () => {
    render(<KnowledgeRetrievalCall progress={1} status="failed" />);

    expect(screen.getAllByText('检索失败').length).toBeGreaterThan(0);
  });
});
