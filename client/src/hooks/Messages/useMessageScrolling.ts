import { useRecoilValue } from 'recoil';
import { Constants } from 'librechat-data-provider';
import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import type { TMessage } from 'librechat-data-provider';
import { useMessagesConversation, useMessagesSubmission } from '~/Providers';
import useScrollToRef from '~/hooks/useScrollToRef';
import store from '~/store';

const threshold = 0.85;
const debounceRate = 150;
export const MESSAGE_FOLLOW_DISTANCE = 120;
const savedPositionLimit = 80;

type SavedScrollPosition = {
  top: number;
  distanceFromBottom: number;
  anchorId?: string;
  anchorOffset?: number;
};

const scrollPositions = new Map<string, SavedScrollPosition>();

type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export function getMessageScrollPosition(metrics: ScrollMetrics): SavedScrollPosition {
  return {
    top: metrics.scrollTop,
    distanceFromBottom: Math.max(
      0,
      metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight,
    ),
  };
}

export function getRestoredMessageScrollTop(
  saved: SavedScrollPosition,
  metrics: Pick<ScrollMetrics, 'scrollHeight' | 'clientHeight'>,
): number {
  const maximum = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  if (saved.distanceFromBottom <= MESSAGE_FOLLOW_DISTANCE) {
    return Math.max(0, maximum - saved.distanceFromBottom);
  }
  return Math.min(saved.top, maximum);
}

function rememberScrollPosition(conversationId: string, position: SavedScrollPosition) {
  scrollPositions.delete(conversationId);
  scrollPositions.set(conversationId, position);
  if (scrollPositions.size > savedPositionLimit) {
    const oldestConversationId = scrollPositions.keys().next().value;
    if (oldestConversationId) {
      scrollPositions.delete(oldestConversationId);
    }
  }
}

export const clearMessageScrollPositionsForTests = () => scrollPositions.clear();

export default function useMessageScrolling(messagesTree?: TMessage[] | null) {
  const autoScroll = useRecoilValue(store.autoScroll);

  const scrollableRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const { conversation, conversationId } = useMessagesConversation();
  const { setAbortScroll, isSubmitting, abortScroll } = useMessagesSubmission();

  const timeoutIdRef = useRef<NodeJS.Timeout>();
  const shouldFollowRef = useRef(true);
  const previousConversationIdRef = useRef<string | null | undefined>(conversationId);
  const restoredConversationRef = useRef<string | null>(null);
  const lastTopRef = useRef(0);
  const programmaticRef = useRef(false);
  const renderedConversationRef = useRef(messagesTree?.[0]?.conversationId);
  renderedConversationRef.current = messagesTree?.[0]?.conversationId;

  const capturePosition = useCallback((): SavedScrollPosition | undefined => {
    const container = scrollableRef.current;
    if (!container) return;
    const position = getMessageScrollPosition(container);
    const top = container.getBoundingClientRect().top;
    const row = Array.from(container.querySelectorAll<HTMLElement>('.message-render[id]')).find(
      (node) => node.getBoundingClientRect().bottom > top + 1,
    );
    return row
      ? { ...position, anchorId: row.id, anchorOffset: row.getBoundingClientRect().top - top }
      : position;
  }, []);

  const reconcile = useCallback(() => {
    const container = scrollableRef.current;
    if (
      !container ||
      !conversationId ||
      restoredConversationRef.current !== conversationId ||
      (renderedConversationRef.current && renderedConversationRef.current !== conversationId)
    )
      return;
    const saved = scrollPositions.get(conversationId);
    programmaticRef.current = true;
    if (shouldFollowRef.current && autoScroll) {
      container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    } else if (saved?.anchorId) {
      const row = Array.from(container.querySelectorAll<HTMLElement>('.message-render[id]')).find(
        (node) => node.id === saved.anchorId,
      );
      if (row)
        container.scrollTop +=
          row.getBoundingClientRect().top -
          container.getBoundingClientRect().top -
          (saved.anchorOffset ?? 0);
    }
    lastTopRef.current = container.scrollTop;
    const position = capturePosition();
    if (position) rememberScrollPosition(conversationId, position);
    requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
  }, [autoScroll, capturePosition, conversationId]);

  const debouncedSetShowScrollButton = useCallback((value: boolean) => {
    clearTimeout(timeoutIdRef.current);
    timeoutIdRef.current = setTimeout(() => {
      setShowScrollButton(value);
    }, debounceRate);
  }, []);

  useEffect(() => {
    if (!messagesEndRef.current || !scrollableRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        debouncedSetShowScrollButton(!entry.isIntersecting);
      },
      { root: scrollableRef.current, threshold },
    );

    observer.observe(messagesEndRef.current);

    return () => {
      observer.disconnect();
      clearTimeout(timeoutIdRef.current);
    };
  }, [messagesEndRef, scrollableRef, debouncedSetShowScrollButton]);

  const debouncedHandleScroll = useCallback(() => {
    const container = scrollableRef.current;
    if (!container) {
      return;
    }
    const position = capturePosition() ?? getMessageScrollPosition(container);
    const isNearBottom = position.distanceFromBottom <= MESSAGE_FOLLOW_DISTANCE;
    if (!programmaticRef.current) {
      const movingUp = container.scrollTop < lastTopRef.current - 1;
      if (movingUp) shouldFollowRef.current = false;
      else if (isNearBottom) shouldFollowRef.current = true;
    }
    lastTopRef.current = container.scrollTop;
    if (
      conversationId &&
      restoredConversationRef.current === conversationId &&
      (!renderedConversationRef.current || renderedConversationRef.current === conversationId)
    ) {
      rememberScrollPosition(conversationId, position);
    }
    if (isSubmitting) {
      setAbortScroll(!shouldFollowRef.current);
    }
    debouncedSetShowScrollButton(!isNearBottom);
  }, [capturePosition, conversationId, debouncedSetShowScrollButton, isSubmitting, setAbortScroll]);

  const scrollCallback = () => {
    shouldFollowRef.current = true;
    debouncedSetShowScrollButton(false);
  };

  const { scrollToRef: scrollToBottom, handleSmoothToRef } = useScrollToRef({
    targetRef: messagesEndRef,
    callback: scrollCallback,
    smoothCallback: () => {
      scrollCallback();
      setAbortScroll(false);
    },
  });

  useEffect(() => {
    if (!messagesTree || messagesTree.length === 0) {
      return;
    }

    if (!messagesEndRef.current || !scrollableRef.current) {
      return;
    }

    if (isSubmitting && scrollToBottom && shouldFollowRef.current && abortScroll !== true) {
      reconcile();
    }

    return () => {
      if (abortScroll === true) {
        scrollToBottom && scrollToBottom.cancel();
      }
    };
  }, [isSubmitting, messagesTree, scrollToBottom, abortScroll, reconcile]);

  useEffect(() => {
    const element = contentRef.current;
    const container = scrollableRef.current;
    if (!element || !container) return;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reconcile);
    observer?.observe(element);
    const release = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        shouldFollowRef.current = false;
        setAbortScroll(true);
      }
    };
    container.addEventListener('wheel', release, { passive: true });
    return () => {
      observer?.disconnect();
      container.removeEventListener('wheel', release);
    };
  }, [reconcile, setAbortScroll]);

  useLayoutEffect(() => {
    restoredConversationRef.current = null;
  }, [conversationId]);

  useLayoutEffect(() => {
    const container = scrollableRef.current;
    if (!messagesEndRef.current || !container) {
      return;
    }
    const renderedId = messagesTree?.[0]?.conversationId;
    if (!messagesTree?.length || (renderedId && renderedId !== conversationId)) return;
    if (restoredConversationRef.current === conversationId) return;

    {
      if (!conversationId || scrollableRef.current !== container) {
        return;
      }
      const previousConversationId = previousConversationIdRef.current;
      let saved = scrollPositions.get(conversationId);
      if (
        !saved &&
        previousConversationId === Constants.NEW_CONVO &&
        conversationId !== Constants.NEW_CONVO
      ) {
        saved = scrollPositions.get(Constants.NEW_CONVO);
        if (saved) {
          rememberScrollPosition(conversationId, saved);
        }
      }
      if (saved) {
        container.scrollTop = getRestoredMessageScrollTop(saved, container);
        shouldFollowRef.current = saved.distanceFromBottom <= MESSAGE_FOLLOW_DISTANCE;
        setAbortScroll(isSubmitting && !shouldFollowRef.current);
      } else if (scrollToBottom && autoScroll && conversationId !== Constants.NEW_CONVO) {
        shouldFollowRef.current = true;
        scrollToBottom();
      }
      restoredConversationRef.current = conversationId ?? null;
      previousConversationIdRef.current = conversationId;
      reconcile();
    }
  }, [
    autoScroll,
    capturePosition,
    conversationId,
    isSubmitting,
    messagesTree,
    reconcile,
    scrollToBottom,
    setAbortScroll,
  ]);

  return {
    conversation,
    scrollableRef,
    contentRef,
    messagesEndRef,
    scrollToBottom,
    showScrollButton,
    handleSmoothToRef,
    debouncedHandleScroll,
  };
}
