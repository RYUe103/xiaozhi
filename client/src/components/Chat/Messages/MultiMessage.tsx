import { useRecoilState } from 'recoil';
import { useEffect, useCallback, useMemo } from 'react';
import { isAssistantsEndpoint } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { TMessageProps } from '~/common';
import MessageContent from '~/components/Messages/MessageContent';
import MessageParts from './MessageParts';
import Message from './Message';
import MessageErrorBoundary from './MessageErrorBoundary';
import {
  collapseTransientMessageSiblings,
  getMessageRenderRevision,
} from '~/utils/messageSiblingMerge';
import store from '~/store';

export default function MultiMessage({
  // messageId is used recursively here
  messageId,
  messagesTree,
  currentEditId,
  setCurrentEditId,
}: TMessageProps) {
  const [siblingIdx, setSiblingIdx] = useRecoilState(store.messagesSiblingIdxFamily(messageId));

  const visibleMessagesTree = useMemo(() => {
    return messagesTree ? collapseTransientMessageSiblings(messagesTree) : messagesTree;
  }, [messagesTree]);

  const setSiblingIdxRev = useCallback(
    (value: number) => {
      setSiblingIdx((visibleMessagesTree?.length ?? 0) - value - 1);
    },
    [visibleMessagesTree?.length, setSiblingIdx],
  );

  useEffect(() => {
    // reset siblingIdx when the tree changes, mostly when a new message is submitting.
    setSiblingIdx(0);
  }, [visibleMessagesTree?.length, setSiblingIdx]);

  useEffect(() => {
    if (visibleMessagesTree?.length && siblingIdx >= visibleMessagesTree.length) {
      setSiblingIdx(0);
    }
  }, [siblingIdx, visibleMessagesTree?.length, setSiblingIdx]);

  if (!(visibleMessagesTree && visibleMessagesTree.length)) {
    return null;
  }

  const currentSiblingIdx = visibleMessagesTree.length - siblingIdx - 1;
  const message = visibleMessagesTree[currentSiblingIdx] as TMessage | undefined;

  if (!message) {
    return null;
  }

  /**
   * No explicit key — React uses positional reconciliation since MultiMessage
   * always renders exactly one child at this position.
   *
   * Both messageId and parentMessageId change during the SSE lifecycle
   * (client UUID → createdHandler ID → server ID), so neither can serve as a
   * stable key. Using either caused React to unmount/remount the entire subtree
   * on each SSE event, destroying memoized state and causing visible flickering.
   *
   * Without a key, React reuses the component instance and updates props in place.
   * The memo comparators on ContentRender/MessageRender handle field-level diffing,
   * and sibling switches work correctly because the message prop changes entirely.
   */
  const sharedProps = {
    message,
    currentEditId,
    setCurrentEditId,
    siblingIdx: currentSiblingIdx,
    siblingCount: visibleMessagesTree.length,
    setSiblingIdx: setSiblingIdxRev,
  };

  const resetKey = getMessageRenderRevision(message);

  let renderedMessage: JSX.Element;
  if (isAssistantsEndpoint(message.endpoint) && message.content) {
    renderedMessage = <MessageParts {...sharedProps} />;
  } else if (message.content) {
    renderedMessage = <MessageContent {...sharedProps} />;
  } else {
    renderedMessage = <Message {...sharedProps} />;
  }

  return <MessageErrorBoundary resetKey={resetKey}>{renderedMessage}</MessageErrorBoundary>;
}
