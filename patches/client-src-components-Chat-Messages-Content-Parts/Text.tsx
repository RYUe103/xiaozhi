import { memo, useMemo, ReactElement } from 'react';
import Markdown from '~/components/Chat/Messages/Content/Markdown';
import { useMessageContext } from '~/Providers';
import { cn } from '~/utils';

type TextPartProps = {
  text: string;
  showCursor: boolean;
  isCreatedByUser: boolean;
};

type ContentType = ReactElement<React.ComponentProps<typeof Markdown>> | ReactElement;

const fakeToolOutputPattern =
  /(^|\n)\s*(Tool\s*:|工具\s*:|execute_code\b|stdout\s*:|stderr\s*:|generatedFiles\s*:|outputFiles\s*:|调用\s*sandbox|解析后得到)/i;

const relativeImageMarkdownPattern =
  /(^|\n)[ \t]*!\[[^\]\n]*\]\([ \t]*(?!https?:\/\/|data:|blob:|\/)[ \t]*(?:\.\/)?[^)\s]+?\.(?:png|jpe?g|webp|gif|svg)(?:[ \t]+["'][^"']*["'])?[ \t]*\)[ \t]*(?=\n|$)/gi;

function stripRelativeImageMarkdown(value: string) {
  return value.replace(relativeImageMarkdownPattern, '$1').replace(/\n{3,}/g, '\n\n');
}

const TextPart = memo(function TextPart({ text, isCreatedByUser, showCursor }: TextPartProps) {
  const { isSubmitting = false, isLatestMessage = false } = useMessageContext();
  const showCursorState = useMemo(() => showCursor && isSubmitting, [showCursor, isSubmitting]);
  const sanitizedText = useMemo(() => {
    const displayText = isCreatedByUser ? text : stripRelativeImageMarkdown(text);
    if (isCreatedByUser || isSubmitting || !fakeToolOutputPattern.test(displayText)) {
      return displayText;
    }
    return '工具没有被实际执行，已拦截疑似工具日志正文。请重新发送请求，我会使用真实 sandbox 处理文件。';
  }, [isCreatedByUser, isSubmitting, text]);

  const content: ContentType = useMemo(() => {
    if (!isCreatedByUser) {
      return <Markdown content={sanitizedText} isLatestMessage={isLatestMessage} />;
    } else {
      return <>{sanitizedText}</>;
    }
  }, [isCreatedByUser, sanitizedText, isLatestMessage]);

  return (
    <div
      className={cn(
        isSubmitting ? 'submitting' : '',
        showCursorState && !!sanitizedText.length ? 'result-streaming' : '',
        'markdown prose message-content dark:prose-invert light w-full break-words',
        isCreatedByUser && 'max-h-[min(50vh,420px)] overflow-y-auto whitespace-pre-wrap',
        isCreatedByUser ? 'dark:text-gray-20' : 'dark:text-gray-100',
      )}
    >
      {content}
    </div>
  );
});
TextPart.displayName = 'TextPart';

export default TextPart;
