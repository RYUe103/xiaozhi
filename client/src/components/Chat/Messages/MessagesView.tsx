import { useMemo, useState, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { useRecoilValue } from 'recoil';
import { CSSTransition } from 'react-transition-group';
import type { TMessage } from 'librechat-data-provider';
import { useScreenshot, useMessageScrolling, useLocalize } from '~/hooks';
import ScrollToBottom from '~/components/Messages/ScrollToBottom';
import { MessagesViewProvider, useMessagesViewContext } from '~/Providers';
import { fontSizeAtom } from '~/store/fontSize';
import MultiMessage from './MultiMessage';
import MessageNav from './MessageNav';
import { cn } from '~/utils';
import store from '~/store';

const hasMessage = (messages: TMessage[] | null | undefined, messageId: string): boolean =>
  messages?.some(
    (message) => message.messageId === messageId || hasMessage(message.children, messageId),
  ) === true;

export function attachPendingResponse(
  messages: TMessage[] | null | undefined,
  userMessageId: string,
  pendingResponse: TMessage,
): TMessage[] | null | undefined {
  if (!messages || hasMessage(messages, pendingResponse.messageId)) {
    return messages;
  }

  let attached = false;
  const attach = (nodes: TMessage[]): TMessage[] =>
    nodes.map((message) => {
      const children = message.children ?? [];
      if (message.messageId === userMessageId) {
        const hasAssistantResponse = children.some((child) => !child.isCreatedByUser);
        if (hasAssistantResponse) {
          return message;
        }
        attached = true;
        return {
          ...message,
          children: [
            ...children,
            { ...pendingResponse, parentMessageId: userMessageId, children: [] },
          ],
        };
      }
      const nextChildren = attach(children);
      return nextChildren === children ? message : { ...message, children: nextChildren };
    });

  const nextMessages = attach(messages);
  return attached ? nextMessages : messages;
}

function MessagesViewContent({
  messagesTree: _messagesTree,
}: {
  messagesTree?: TMessage[] | null;
}) {
  const localize = useLocalize();
  const fontSize = useAtomValue(fontSizeAtom);
  const { index, isSubmitting, conversationId: viewedConversationId } = useMessagesViewContext();
  const submission = useRecoilValue(store.submissionByIndex(index));
  const { screenshotTargetRef } = useScreenshot();
  const scrollButtonPreference = useRecoilValue(store.showScrollButton);
  const [currentEditId, setCurrentEditId] = useState<number | string | null>(-1);
  const scrollToBottomRef = useRef<HTMLDivElement>(null);

  const messagesTree = useMemo(() => {
    const initialResponse = submission?.initialResponse as TMessage | undefined;
    const submissionId = submission?.conversation?.conversationId;
    if (submissionId && viewedConversationId && submissionId !== viewedConversationId)
      return _messagesTree;
    const userMessageId = initialResponse?.parentMessageId || submission?.userMessage?.messageId;
    if (!isSubmitting || !initialResponse?.messageId || !userMessageId) {
      return _messagesTree;
    }
    let tree = _messagesTree;
    const userMessage = submission?.userMessage as TMessage | undefined;
    if (userMessage && !hasMessage(tree, userMessageId)) {
      const parentId = userMessage.parentMessageId;
      const append = (nodes: TMessage[]): TMessage[] =>
        nodes.map((node) =>
          node.messageId === parentId
            ? { ...node, children: [...(node.children ?? []), { ...userMessage, children: [] }] }
            : { ...node, children: append(node.children ?? []) },
        );
      tree =
        parentId && hasMessage(tree, parentId)
          ? append(tree ?? [])
          : [...(tree ?? []), { ...userMessage, children: [] }];
    }
    return attachPendingResponse(tree, userMessageId, initialResponse);
  }, [_messagesTree, isSubmitting, submission, viewedConversationId]);

  const {
    conversation,
    scrollableRef,
    contentRef,
    messagesEndRef,
    showScrollButton,
    handleSmoothToRef,
    debouncedHandleScroll,
  } = useMessageScrolling(messagesTree);

  const { conversationId } = conversation ?? {};

  return (
    <>
      <div className="relative flex-1 overflow-hidden overflow-y-auto">
        <div className="relative h-full">
          <div
            className="scrollbar-gutter-stable"
            onScroll={debouncedHandleScroll}
            ref={scrollableRef}
            style={{
              height: '100%',
              overflowY: 'auto',
              width: '100%',
            }}
          >
            <div ref={contentRef} className="flex flex-col pb-9 pt-14 dark:bg-transparent">
              {(messagesTree && messagesTree.length == 0) || messagesTree === null ? (
                <div
                  className={cn(
                    'flex w-full items-center justify-center p-3 text-text-secondary',
                    fontSize,
                  )}
                >
                  {localize('com_ui_nothing_found')}
                </div>
              ) : (
                <>
                  <div ref={screenshotTargetRef}>
                    <MultiMessage
                      messagesTree={messagesTree}
                      messageId={conversationId ?? null}
                      setCurrentEditId={setCurrentEditId}
                      currentEditId={currentEditId ?? null}
                    />
                  </div>
                </>
              )}
              <div
                id="messages-end"
                className="group h-0 w-full flex-shrink-0"
                ref={messagesEndRef}
              />
            </div>
          </div>

          <CSSTransition
            in={showScrollButton && scrollButtonPreference}
            timeout={{
              enter: 300,
              exit: 250,
            }}
            classNames="scroll-animation"
            unmountOnExit={true}
            appear={true}
            nodeRef={scrollToBottomRef}
          >
            <ScrollToBottom ref={scrollToBottomRef} scrollHandler={handleSmoothToRef} />
          </CSSTransition>

          <MessageNav scrollableRef={scrollableRef} />
        </div>
      </div>
    </>
  );
}

export default function MessagesView({ messagesTree }: { messagesTree?: TMessage[] | null }) {
  return (
    <MessagesViewProvider>
      <MessagesViewContent messagesTree={messagesTree} />
    </MessagesViewProvider>
  );
}
