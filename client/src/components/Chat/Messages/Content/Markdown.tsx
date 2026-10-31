import React, { memo, useMemo, useContext } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import supersub from 'remark-supersub';
import rehypeKatex from 'rehype-katex';
import { useRecoilValue } from 'recoil';
import ReactMarkdown from 'react-markdown';
import { Streamdown, type StreamdownProps } from 'streamdown';
import rehypeHighlight from 'rehype-highlight';
import remarkDirective from 'remark-directive';
import type { Pluggable } from 'unified';
import { Citation, CompositeCitation, HighlightedText } from '~/components/Web/Citation';
import {
  mcpUIResourcePlugin,
  MCPUIResource,
  MCPUIResourceCarousel,
} from '~/components/MCPUIResource';
import { Artifact, artifactPlugin } from '~/components/Artifacts/Artifact';
import { ArtifactProvider, CodeBlockProvider } from '~/Providers';
import MarkdownErrorBoundary from './MarkdownErrorBoundary';
import { langSubset, preprocessLaTeX } from '~/utils';
import { unicodeCitation } from '~/components/Web';
import { code, a, p, img, table, stripInaccessibleSandboxImages } from './MarkdownComponents';
import store from '~/store';
import { FileOutputContext } from './FileOutputContext';
import remarkFileOutputs from '~/utils/remarkFileOutputs';
import { MermaidStreamContext } from './ProcessContext';

type TContentProps = {
  content: string;
  isLatestMessage: boolean;
  isStreaming?: boolean;
};

const useStreamdown = import.meta.env.VITE_SANSUO_STREAMDOWN === 'true';

let cachedMarkdownComponents: { [nodeType: string]: React.ElementType } | undefined;

function getMarkdownComponents() {
  cachedMarkdownComponents ??= {
    code,
    a,
    p,
    img,
    table,
    artifact: Artifact,
    citation: Citation,
    'highlighted-text': HighlightedText,
    'composite-citation': CompositeCitation,
    'mcp-ui-resource': MCPUIResource,
    'mcp-ui-carousel': MCPUIResourceCarousel,
  };
  return cachedMarkdownComponents;
}

const streamdownRemarkPlugins = [
  supersub,
  remarkGfm,
  remarkDirective,
  artifactPlugin,
  [remarkMath, { singleDollarTextMath: false }],
  unicodeCitation,
  mcpUIResourcePlugin,
] as unknown as NonNullable<StreamdownProps['remarkPlugins']>;

const streamdownRehypePlugins = [
  [rehypeKatex],
  [
    rehypeHighlight,
    {
      detect: true,
      ignoreMissing: true,
      subset: langSubset,
    },
  ],
] as unknown as NonNullable<StreamdownProps['rehypePlugins']>;

type StreamdownMarkdownProps = {
  content: string;
  isStreaming: boolean;
};

export function StreamdownMarkdown({ content, isStreaming }: StreamdownMarkdownProps) {
  const outputs = useContext(FileOutputContext);
  const plugins = useMemo(
    () =>
      outputs.length
        ? ([...streamdownRemarkPlugins, [remarkFileOutputs, outputs]] as NonNullable<
            StreamdownProps['remarkPlugins']
          >)
        : streamdownRemarkPlugins,
    [outputs],
  );
  return (
    <Streamdown
      mode={isStreaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={true}
      remarkPlugins={plugins}
      rehypePlugins={streamdownRehypePlugins}
      components={getMarkdownComponents()}
    >
      {content}
    </Streamdown>
  );
}

const Markdown = memo(function Markdown({
  content = '',
  isLatestMessage,
  isStreaming = false,
}: TContentProps) {
  const outputs = useContext(FileOutputContext);
  const LaTeXParsing = useRecoilValue<boolean>(store.LaTeXParsing);
  const isInitializing = content === '';

  const currentContent = useMemo(() => {
    if (isInitializing) {
      return '';
    }
    const visibleContent = stripInaccessibleSandboxImages(content);
    return LaTeXParsing ? preprocessLaTeX(visibleContent) : visibleContent;
  }, [content, LaTeXParsing, isInitializing]);

  const rehypePlugins = useMemo(
    () => [
      [rehypeKatex],
      [
        rehypeHighlight,
        {
          detect: true,
          ignoreMissing: true,
          subset: langSubset,
        },
      ],
    ],
    [],
  );

  const remarkPlugins: Pluggable[] = [
    supersub,
    remarkGfm,
    remarkDirective,
    artifactPlugin,
    [remarkMath, { singleDollarTextMath: false }],
    unicodeCitation,
    mcpUIResourcePlugin,
  ];

  if (outputs.length) remarkPlugins.push([remarkFileOutputs, outputs]);

  if (isInitializing) {
    return (
      <div className="relative inline-flex h-5 w-5 items-center justify-center">
        <p className="relative">
          <span className={isLatestMessage ? 'result-thinking' : ''} />
        </p>
      </div>
    );
  }

  return (
    <MermaidStreamContext.Provider value={isStreaming}>
      <MarkdownErrorBoundary content={content} codeExecution={true}>
        <ArtifactProvider>
          <CodeBlockProvider>
            {useStreamdown ? (
              <StreamdownMarkdown content={currentContent} isStreaming={isStreaming} />
            ) : (
              <ReactMarkdown
                /** @ts-ignore */
                remarkPlugins={remarkPlugins}
                /* @ts-ignore */
                rehypePlugins={rehypePlugins}
                components={getMarkdownComponents()}
              >
                {currentContent}
              </ReactMarkdown>
            )}
          </CodeBlockProvider>
        </ArtifactProvider>
      </MarkdownErrorBoundary>
    </MermaidStreamContext.Provider>
  );
});
Markdown.displayName = 'Markdown';

export default Markdown;
