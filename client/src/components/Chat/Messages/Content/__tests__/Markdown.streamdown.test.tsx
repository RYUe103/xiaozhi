import React from 'react';
import { render, screen } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import { Streamdown } from 'streamdown';
import { ArtifactProvider, CodeBlockProvider } from '~/Providers';
import Markdown, { StreamdownMarkdown } from '../Markdown';

const mockStreamdown = Streamdown as unknown as jest.Mock;

jest.mock('~/components/MCPUIResource', () => ({
  mcpUIResourcePlugin: () => undefined,
  MCPUIResource: () => null,
  MCPUIResourceCarousel: () => null,
}));

function renderMarkdown(content: string, isStreaming = false) {
  return render(
    <RecoilRoot>
      <ArtifactProvider>
        <CodeBlockProvider>
          <StreamdownMarkdown content={content} isStreaming={isStreaming} />
        </CodeBlockProvider>
      </ArtifactProvider>
    </RecoilRoot>,
  );
}

describe('Streamdown AI message renderer', () => {
  beforeEach(() => {
    mockStreamdown.mockClear();
  });

  test('keeps the default build on ReactMarkdown', () => {
    render(
      <RecoilRoot>
        <Markdown content="原渲染器" isLatestMessage={false} />
      </RecoilRoot>,
    );

    expect(screen.getByText('原渲染器')).toBeInTheDocument();
    expect(mockStreamdown).not.toHaveBeenCalled();
  });

  test('uses streaming mode and incomplete-markdown repair while the answer streams', () => {
    renderMarkdown('回答包含 **尚未结束的重点', true);

    expect(screen.getByTestId('streamdown')).toHaveAttribute('data-mode', 'streaming');
    expect(mockStreamdown).toHaveBeenCalledWith(
      expect.objectContaining({
        children: '回答包含 **尚未结束的重点',
        parseIncompleteMarkdown: true,
      }),
      {},
    );
  });

  test('uses static mode after streaming completes', () => {
    renderMarkdown('完成的回答');

    expect(screen.getByTestId('streamdown')).toHaveAttribute('data-mode', 'static');
  });

  test('passes existing link, code, image, and custom renderers to Streamdown', () => {
    renderMarkdown('普通回答');

    const props = mockStreamdown.mock.calls[0][0];
    expect(Object.keys(props.components)).toEqual(
      expect.arrayContaining(['a', 'code', 'img', 'p', 'artifact', 'mcp-ui-resource']),
    );
    expect(props.remarkPlugins).toHaveLength(7);
    expect(props.rehypePlugins).toHaveLength(2);
  });
});
