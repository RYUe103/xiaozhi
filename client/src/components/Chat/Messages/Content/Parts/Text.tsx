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

const relativeImageMarkdownPattern =
  /(^|\n)[ \t]*!\[[^\]\n]*\]\([ \t]*(?!https?:\/\/|data:|blob:|\/)[ \t]*(?:\.\/)?[^)\s]+?\.(?:png|jpe?g|webp|gif|svg)(?:[ \t]+["'][^"']*["'])?[ \t]*\)[ \t]*(?=\n|$)/gi;

function stripRelativeImageMarkdown(value: string) {
  return value.replace(relativeImageMarkdownPattern, '$1').replace(/\n{3,}/g, '\n\n');
}

const TextPart = memo(function TextPart({ text, isCreatedByUser, showCursor }: TextPartProps) {
  const { isSubmitting = false, isLatestMessage = false } = useMessageContext();
  const showCursorState = useMemo(() => showCursor && isSubmitting, [showCursor, isSubmitting]);
  const sanitizedText = useMemo(() => {
    return isCreatedByUser ? text : stripRelativeImageMarkdown(text);
  }, [isCreatedByUser, text]);

  const content: ContentType = useMemo(() => {
    if (!isCreatedByUser) {
      return (
        <Markdown
          content={sanitizedText}
          isLatestMessage={isLatestMessage}
          isStreaming={isSubmitting && isLatestMessage}
        />
      );
    } else {
      return <>{sanitizedText}</>;
    }
  }, [isCreatedByUser, sanitizedText, isLatestMessage, isSubmitting]);

  return (
    <div
      className={cn(
        isSubmitting ? 'submitting' : '',
        showCursorState && !!sanitizedText.length ? 'result-streaming' : '',
        'markdown prose message-content dark:prose-invert light w-full break-words [overflow-wrap:anywhere] [text-wrap:pretty]',
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
