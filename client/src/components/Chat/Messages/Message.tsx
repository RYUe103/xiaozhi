import React from 'react';
import { useMessageProcess, useMemoizedChatContext } from '~/hooks';
import type { TMessageProps } from '~/common';
import MessageRender from './ui/MessageRender';
import MultiMessage from './MultiMessage';
import MessageErrorBoundary from './MessageErrorBoundary';
import { getMessageRenderRevision } from '~/utils/messageSiblingMerge';

const MessageContainer = React.memo(function MessageContainer({
  handleScroll,
  children,
}: {
  handleScroll: (event?: unknown) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="text-token-text-primary w-full border-0 bg-transparent dark:border-0 dark:bg-transparent"
      onWheel={handleScroll}
      onTouchMove={handleScroll}
    >
      {children}
    </div>
  );
});

export default function Message(props: TMessageProps) {
  const { conversation, handleScroll, isSubmitting } = useMessageProcess({
    message: props.message,
  });
  const { message, currentEditId, setCurrentEditId } = props;
  const { chatContext, effectiveIsSubmitting } = useMemoizedChatContext(message, isSubmitting);

  if (!message || typeof message !== 'object') {
    return null;
  }

  const { children, messageId = null } = message;
  const resetKey = getMessageRenderRevision(message);

  return (
    <>
      <MessageContainer handleScroll={handleScroll}>
        <div className="m-auto justify-center p-4 py-2 md:gap-6">
          <MessageErrorBoundary resetKey={resetKey}>
            <MessageRender
              {...props}
              isSubmitting={effectiveIsSubmitting}
              chatContext={chatContext}
            />
          </MessageErrorBoundary>
        </div>
      </MessageContainer>
      <MultiMessage
        messageId={messageId}
        conversation={conversation}
        messagesTree={children ?? []}
        currentEditId={currentEditId}
        setCurrentEditId={setCurrentEditId}
      />
    </>
  );
}
