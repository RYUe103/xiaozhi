import React from 'react';
import { render, screen } from '@testing-library/react';
import { codeNoExecution } from '../MarkdownComponents';

jest.mock('~/components/Messages/Content/Mermaid', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mermaid-render">{children}</div>
  ),
  MermaidErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('Markdown Mermaid rendering', () => {
  test('routes a mermaid code block through the inline diagram renderer', () => {
    render(
      React.createElement(codeNoExecution, {
        className: 'language-mermaid',
        children: 'flowchart TD\nA[问题] --> B[解释]',
      }),
    );

    expect(screen.getByTestId('mermaid-render')).toHaveTextContent('flowchart TD');
    expect(screen.getByTestId('mermaid-render')).toHaveTextContent('A[问题] --> B[解释]');
  });
});
