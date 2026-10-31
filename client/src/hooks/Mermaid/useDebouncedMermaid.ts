import { useContext, useEffect, useState } from 'react';
import { MermaidStreamContext } from '~/components/Chat/Messages/Content/ProcessContext';
import { useMermaid } from './useMermaid';

interface UseDebouncedMermaidOptions {
  content: string;
  id?: string;
  theme?: string;
  delay?: number;
  minLength?: number;
  key?: number;
}

/** Streaming fragments may fail to parse; only report errors for settled source. */
export const useDebouncedMermaid = ({
  content,
  id,
  theme,
  delay = 350,
  key = 0,
}: UseDebouncedMermaidOptions) => {
  const isStreaming = useContext(MermaidStreamContext);
  const [settled, setSettled] = useState({ content, key });
  useEffect(() => {
    if (!isStreaming) {
      setSettled({ content, key });
      return;
    }
    const timer = window.setTimeout(() => setSettled({ content, key }), delay);
    return () => window.clearTimeout(timer);
  }, [content, key, delay, isStreaming]);
  const renderContent = isStreaming ? settled.content : content;
  const renderKey = isStreaming ? settled.key : key;
  const result = useMermaid({
    content: renderContent,
    id: `${id ?? 'diagram'}-${settled.key}`,
    theme,
  });
  const isPending = isStreaming && (settled.content !== content || settled.key !== key);
  return {
    ...result,
    isLoading: result.isLoading || isPending || (isStreaming && !!result.error),
    error: isStreaming || isPending ? undefined : result.error,
  };
};

export default useDebouncedMermaid;
