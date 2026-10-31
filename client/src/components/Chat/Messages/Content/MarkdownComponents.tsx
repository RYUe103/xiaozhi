import React, { memo, useMemo, useRef, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useToastContext } from '@librechat/client';
import { PermissionTypes, Permissions, apiBaseUrl } from 'librechat-data-provider';
import Mermaid, { MermaidErrorBoundary } from '~/components/Messages/Content/Mermaid';
import CodeBlock from '~/components/Messages/Content/CodeBlock';
import useHasAccess from '~/hooks/Roles/useHasAccess';
import { useFileDownload } from '~/data-provider';
import { useCodeBlockContext } from '~/Providers';
import { handleDoubleClick, triggerDownload } from '~/utils';
import { useLocalize } from '~/hooks';
import store from '~/store';

type TCodeProps = {
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
};

const isSingleLineCode = (children: React.ReactNode): boolean => {
  if (typeof children === 'string') {
    return !children.includes('\n');
  }
  if (Array.isArray(children)) {
    return children.every((child) => typeof child === 'string' && !child.includes('\n'));
  }
  return false;
};

export const table: React.ElementType = memo(function MarkdownTable({
  children,
  node: _node,
  ...props
}: React.ComponentPropsWithoutRef<'table'> & { node?: unknown }) {
  return (
    <div className="sansuo-table-scroll" tabIndex={0} role="region" aria-label="表格，可横向滚动">
      <table {...props}>{children}</table>
    </div>
  );
});

export const code: React.ElementType = memo(function MarkdownCode({
  className,
  children,
}: TCodeProps) {
  const canRunCode = useHasAccess({
    permissionType: PermissionTypes.RUN_CODE,
    permission: Permissions.USE,
  });
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match && match[1];
  const isMath = lang === 'math';
  const isMermaid = lang === 'mermaid';
  const isSingleLine = isSingleLineCode(children);

  const { getNextIndex, resetCounter } = useCodeBlockContext();
  const blockIndex = useRef(getNextIndex(isMath || isMermaid || (isSingleLine && !lang))).current;

  useEffect(() => {
    resetCounter();
  }, [children, resetCounter]);

  if (isMath) {
    return <>{children}</>;
  } else if (isMermaid) {
    const content = typeof children === 'string' ? children : String(children);
    return (
      <MermaidErrorBoundary code={content}>
        <Mermaid id={`mermaid-${blockIndex}`}>{content}</Mermaid>
      </MermaidErrorBoundary>
    );
  } else if (isSingleLine && !lang) {
    return (
      <code onDoubleClick={handleDoubleClick} className={className}>
        {children}
      </code>
    );
  } else {
    return (
      <CodeBlock
        lang={lang ?? 'text'}
        codeChildren={children}
        blockIndex={blockIndex}
        allowExecution={canRunCode}
      />
    );
  }
});
code.displayName = 'MarkdownCode';

export const codeNoExecution: React.ElementType = memo(function MarkdownCodeNoExecution({
  className,
  children,
}: TCodeProps) {
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match && match[1];

  if (lang === 'math') {
    return children;
  } else if (lang === 'mermaid') {
    const content = typeof children === 'string' ? children : String(children);
    return <Mermaid>{content}</Mermaid>;
  } else if (isSingleLineCode(children) && !lang) {
    return (
      <code onDoubleClick={handleDoubleClick} className={className}>
        {children}
      </code>
    );
  } else {
    return <CodeBlock lang={lang ?? 'text'} codeChildren={children} allowExecution={false} />;
  }
});
codeNoExecution.displayName = 'MarkdownCodeNoExecution';

type TAnchorProps = {
  href: string;
  title?: string;
  children: React.ReactNode;
};

const KNOWLEDGE_SOURCE_TITLE = 'sansuo-knowledge-source';
const KNOWLEDGE_NUMBER_TITLE = 'sansuo-knowledge-number';
const KNOWLEDGE_CITATION_TITLE = 'sansuo-knowledge-citation';

export function getReactNodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(getReactNodeText).join('');
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getReactNodeText(node.props.children);
  }
  return '';
}

export function getKnowledgeCitationNumber(node: React.ReactNode): string {
  const text = getReactNodeText(node).trim();
  const bracketedNumber = text.match(/\[(\d+)\]/)?.[1];
  if (bracketedNumber) {
    return bracketedNumber;
  }

  const digits = text.replace(/\D/g, '');
  if (digits.length >= 3 && digits.length % 3 === 0) {
    const partLength = digits.length / 3;
    const firstPart = digits.slice(0, partLength);
    if (
      firstPart === digits.slice(partLength, partLength * 2) &&
      firstPart === digits.slice(partLength * 2)
    ) {
      return firstPart;
    }
  }
  return digits;
}

export const KnowledgeCitation = memo(function KnowledgeCitation({
  href,
  children,
}: Pick<TAnchorProps, 'href' | 'children'>) {
  const citationNumber = getKnowledgeCitationNumber(children);
  return (
    <sup className="relative -top-[0.12em] mx-[0.08em] inline-block text-[0.72em] font-medium leading-none text-[#c2410c] dark:text-[#fb923c]">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="!text-[#c2410c] !no-underline hover:!text-[#ea580c] hover:underline hover:decoration-1 hover:underline-offset-1 dark:!text-[#fb923c] dark:hover:!text-[#fdba74]"
      >
        [{citationNumber}]
      </a>
    </sup>
  );
});
KnowledgeCitation.displayName = 'KnowledgeCitation';

export const a: React.ElementType = memo(function MarkdownAnchor({
  href,
  title,
  children,
}: TAnchorProps) {
  const user = useRecoilValue(store.user);
  const { showToast } = useToastContext();
  const localize = useLocalize();

  const {
    file_id = '',
    filename = '',
    filepath,
  } = useMemo(() => {
    const pattern = new RegExp(`(?:files|outputs)/${user?.id}/([^\\s]+)`);
    const match = href.match(pattern);
    if (match && match[0]) {
      const path = match[0];
      const parts = path.split('/');
      const name = parts.pop();
      const file_id = parts.pop();
      return { file_id, filename: name, filepath: path };
    }
    return { file_id: '', filename: '', filepath: '' };
  }, [user?.id, href]);

  const { refetch: downloadFile } = useFileDownload(user?.id ?? '', file_id, { direct: false });
  const props: { target?: string; onClick?: React.MouseEventHandler } = { target: '_blank' };

  if (!file_id || !filename) {
    if (title === KNOWLEDGE_CITATION_TITLE) {
      return <KnowledgeCitation href={href}>{children}</KnowledgeCitation>;
    }

    if (title === KNOWLEDGE_NUMBER_TITLE) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="mr-1 !font-medium !text-[#c2410c] !no-underline hover:!text-[#ea580c] hover:underline hover:decoration-1 hover:underline-offset-2 dark:!text-[#fb923c] dark:hover:!text-[#fdba74]"
        >
          [{children}]
        </a>
      );
    }

    if (title === KNOWLEDGE_SOURCE_TITLE) {
      const label = getReactNodeText(children);
      const positionMatch = label.match(/^(.*?)(（[^（）]+）)$/u);
      const sourceName = positionMatch?.[1] || label;
      const sourcePosition = positionMatch?.[2] || '';

      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="group !text-[15px] !font-medium !leading-6 !text-[#c2410c] !no-underline hover:!text-[#ea580c] dark:!text-[#fb923c] dark:hover:!text-[#fdba74] sm:!text-base"
        >
          <span className="break-words group-hover:underline group-hover:decoration-1 group-hover:underline-offset-2">
            {sourceName}
          </span>
          {sourcePosition && (
            <span className="ml-1 !text-[13px] !font-normal !text-[#9a3412] group-hover:!text-[#c2410c] dark:!text-[#fdba74] dark:group-hover:!text-[#fed7aa]">
              {sourcePosition}
            </span>
          )}
        </a>
      );
    }

    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }

  const handleDownload = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    try {
      const stream = await downloadFile();
      if (stream.data == null || stream.data === '') {
        console.error('Error downloading file: No data found');
        showToast({
          status: 'error',
          message: localize('com_ui_download_error'),
        });
        return;
      }
      triggerDownload(stream.data, filename);
    } catch (error) {
      console.error('Error downloading file:', error);
    }
  };

  props.onClick = handleDownload;
  props.target = '_blank';

  const domainServerBaseUrl = `${apiBaseUrl()}/api`;

  return (
    <a
      href={
        filepath?.startsWith('files/')
          ? `${domainServerBaseUrl}/${filepath}`
          : `${domainServerBaseUrl}/files/${filepath}`
      }
      {...props}
    >
      {children}
    </a>
  );
});
a.displayName = 'MarkdownAnchor';

type TParagraphProps = {
  children: React.ReactNode;
};

export const p: React.ElementType = memo(function MarkdownParagraph({ children }: TParagraphProps) {
  return <p className="mb-2 whitespace-pre-wrap">{children}</p>;
});
p.displayName = 'MarkdownParagraph';

type TImageProps = {
  src?: string;
  alt?: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
};

const inaccessibleSandboxImageRegex =
  /!\[[^\]]*\]\(\s*(?:sandbox:|file:\/\/)?\/mnt\/data\/[^)\s]+(?:\s+["'][^"']*["'])?\s*\)/g;

export function stripInaccessibleSandboxImages(content = ''): string {
  return content.replace(inaccessibleSandboxImageRegex, '').replace(/\n{3,}/g, '\n\n');
}

function isInaccessibleSandboxImage(src = ''): boolean {
  return /^(?:sandbox:|file:\/\/)?\/mnt\/data\//.test(src.trim());
}

export const img: React.ElementType = memo(function MarkdownImage({
  src,
  alt,
  title,
  className,
  style,
}: TImageProps) {
  // Get the base URL from the API endpoints
  const baseURL = apiBaseUrl();

  // If src starts with /images/, prepend the base URL
  const fixedSrc = useMemo(() => {
    if (!src) return src;

    // If it's already an absolute URL or doesn't start with /images/, return as is
    if (src.startsWith('http') || src.startsWith('data:') || !src.startsWith('/images/')) {
      return src;
    }

    // Prepend base URL to the image path
    return `${baseURL}${src}`;
  }, [src, baseURL]);

  if (isInaccessibleSandboxImage(src)) {
    return null;
  }

  return <img src={fixedSrc} alt={alt} title={title} className={className} style={style} />;
});
img.displayName = 'MarkdownImage';
