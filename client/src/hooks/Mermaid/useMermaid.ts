import { useContext, useMemo } from 'react';
import useSWR from 'swr';
import { Md5 } from 'ts-md5';
import { ThemeContext, isDark } from '@librechat/client';
import type { MermaidConfig } from 'mermaid';
import { inlineFlowchartConfig, sanitizeMermaidSvg } from '~/utils/mermaid';
import { validateMermaidSource } from '~/utils/mermaidSource';

// Constants
const MD5_LENGTH_THRESHOLD = 10_000;
const DEFAULT_ID_PREFIX = 'mermaid-diagram';

// Lazy load mermaid library (~2MB)
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

const loadMermaid = () => {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }

  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default);
  }

  return mermaidPromise;
};

interface UseMermaidOptions {
  /** Mermaid diagram content */
  content: string;
  /** Unique identifier for this diagram */
  id?: string;
  /** Custom mermaid theme */
  theme?: string;
  /** Custom mermaid configuration */
  config?: Partial<MermaidConfig>;
}

interface UseMermaidReturn {
  /** The rendered SVG string */
  svg: string | undefined;
  /** Loading state */
  isLoading: boolean;
  /** Error object if rendering failed */
  error: Error | undefined;
  /** Whether content is being validated */
  isValidating: boolean;
}

export const useMermaid = ({
  content,
  id = DEFAULT_ID_PREFIX,
  theme: customTheme,
  config,
}: UseMermaidOptions): UseMermaidReturn => {
  const { theme } = useContext(ThemeContext);
  const isDarkMode = isDark(theme);

  // Generate cache key based on content, theme, and ID
  const cacheKey = useMemo((): string => {
    // For large diagrams, use MD5 hash instead of full content
    const contentHash = content.length < MD5_LENGTH_THRESHOLD ? content : Md5.hashStr(content);

    // Include theme mode in cache key to handle theme switches
    const themeKey = customTheme || (isDarkMode ? 'd' : 'l');

    return [id, themeKey, contentHash].filter(Boolean).join('-');
  }, [content, id, isDarkMode, customTheme]);

  // Generate unique diagram ID (mermaid requires unique IDs in the DOM)
  // Include cacheKey to regenerate when content/theme changes, preventing mermaid internal conflicts
  const diagramId = useMemo(() => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    return `${id}-${timestamp}-${random}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cacheKey]);

  // Build mermaid configuration
  const mermaidConfig = useMemo((): MermaidConfig => {
    const defaultTheme = 'base';

    return {
      startOnLoad: false,
      theme: (customTheme as MermaidConfig['theme']) || defaultTheme,
      fontFamily: 'Inter, ui-sans-serif, system-ui, "Microsoft YaHei", sans-serif',
      themeCSS: `.node rect { rx: 10px; ry: 10px; } .node polygon { fill: ${isDarkMode ? '#46402c' : '#fff9e8'}; stroke: ${isDarkMode ? '#ae9861' : '#d1b979'}; stroke-dasharray: 4 3; }`,
      themeVariables: isDarkMode
        ? {
            background: '#212121',
            primaryColor: '#27374e',
            primaryTextColor: '#dbe7fa',
            primaryBorderColor: '#6383ab',
            lineColor: '#92999f',
            secondaryColor: '#293e36',
            tertiaryColor: '#46402c',
            fontSize: '15px',
          }
        : {
            background: '#ffffff',
            primaryColor: '#eef4ff',
            primaryTextColor: '#203c66',
            primaryBorderColor: '#a7c0e6',
            lineColor: '#737b85',
            secondaryColor: '#edf7f0',
            tertiaryColor: '#fff9e8',
            fontSize: '15px',
          },
      ...config,
      flowchart: {
        ...inlineFlowchartConfig,
        curve: 'linear',
        rankSpacing: 52,
        nodeSpacing: 36,
        ...config?.flowchart,
        htmlLabels: false,
      },
      // Security hardening: MUST come after ...config spread to prevent override
      securityLevel: 'strict',
      maxTextSize: config?.maxTextSize ?? 50000,
      maxEdges: config?.maxEdges ?? 500,
    };
  }, [customTheme, isDarkMode, config]);

  // Fetch/render function
  const fetchSvg = async (): Promise<string> => {
    // SSR guard
    if (typeof window === 'undefined' || !content.trim()) {
      return '';
    }

    try {
      // Load mermaid library (cached after first load)
      const mermaidInstance = await loadMermaid();

      if (!mermaidInstance) {
        throw new Error('Failed to load mermaid library');
      }

      // Initialize before validation so the security settings also apply to parse().
      mermaidInstance.initialize(mermaidConfig);
      let renderSource: string;
      try {
        renderSource = await validateMermaidSource(content, (code) => mermaidInstance.parse(code));
      } catch (parseError) {
        // Extract meaningful error message from mermaid's parse error
        let errorMessage = 'Invalid mermaid syntax';
        if (parseError instanceof Error) {
          errorMessage = parseError.message;
        } else if (typeof parseError === 'string') {
          errorMessage = parseError;
        }

        throw new Error(errorMessage);
      }

      // Initialize with config
      mermaidInstance.initialize(mermaidConfig);

      // Render to SVG
      const { svg } = await mermaidInstance.render(diagramId, renderSource);

      const sanitizedSvg = sanitizeMermaidSvg(svg);

      return sanitizedSvg;
    } catch (error) {
      console.error('Mermaid rendering error:', error);

      // Return last valid content if available (graceful degradation)
      throw error;
    }
  };

  // Use SWR for caching and revalidation
  const { data, error, isLoading, isValidating } = useSWR<string, Error>(cacheKey, fetchSvg, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 3000,
    errorRetryCount: 0,
    errorRetryInterval: 1000,
    shouldRetryOnError: false,
  });

  return {
    svg: data,
    isLoading,
    error,
    isValidating,
  };
};

export default useMermaid;
