import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import useMessageScrolling, { clearMessageScrollPositionsForTests } from '../useMessageScrolling';

let mockConversationId = 'a';
let mockHeight = 1800;
const mockAbort = jest.fn();
const mockResizeCallbacks: Array<() => void> = [];
const mockScrollToBottom = Object.assign(jest.fn(), { cancel: jest.fn() });
jest.mock('recoil', () => ({ useRecoilValue: () => true }));
jest.mock('~/store', () => ({ __esModule: true, default: { autoScroll: {} } }));
jest.mock('~/Providers', () => ({
  useMessagesConversation: () => ({
    conversationId: mockConversationId,
    conversation: { conversationId: mockConversationId },
  }),
  useMessagesSubmission: () => ({
    isSubmitting: true,
    abortScroll: false,
    setAbortScroll: mockAbort,
  }),
}));
jest.mock('~/hooks/useScrollToRef', () => ({
  __esModule: true,
  default: () => ({ scrollToRef: mockScrollToBottom, handleSmoothToRef: jest.fn() }),
}));

function Harness({ treeId }: { treeId: string }) {
  const state = useMessageScrolling([{ messageId: 'root', conversationId: treeId }] as TMessage[]);
  return (
    <div
      data-testid="scroll"
      ref={(node) => {
        state.scrollableRef.current = node;
        if (node) {
          Object.defineProperty(node, 'scrollHeight', {
            configurable: true,
            get: () => mockHeight,
          });
          Object.defineProperty(node, 'clientHeight', { configurable: true, value: 600 });
        }
      }}
      onScroll={state.debouncedHandleScroll}
    >
      <div ref={state.contentRef}>
        <div ref={state.messagesEndRef} />
      </div>
    </div>
  );
}

describe('conversation scroll lifecycle', () => {
  beforeEach(() => {
    clearMessageScrollPositionsForTests();
    mockConversationId = 'a';
    mockHeight = 1800;
    mockResizeCallbacks.length = 0;
    global.ResizeObserver = class {
      constructor(callback: () => void) {
        mockResizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    global.IntersectionObserver = class {
      constructor() {}
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof IntersectionObserver;
  });

  it('keeps reading position on resize after the user scrolls up', () => {
    const { getByTestId } = render(<Harness treeId="a" />);
    const scroll = getByTestId('scroll');
    scroll.scrollTop = 400;
    fireEvent.wheel(scroll, { deltaY: -100 });
    fireEvent.scroll(scroll);
    mockHeight = 2600;
    act(() => mockResizeCallbacks.forEach((callback) => callback()));
    expect(scroll.scrollTop).toBe(400);
    expect(mockAbort).toHaveBeenCalledWith(true);
  });

  it('follows growing content when the reader remains attached to the bottom', () => {
    const { getByTestId } = render(<Harness treeId="a" />);
    const scroll = getByTestId('scroll');
    expect(scroll.scrollTop).toBe(1200);
    mockHeight = 2400;
    act(() => mockResizeCallbacks.forEach((callback) => callback()));
    expect(scroll.scrollTop).toBe(1800);
  });

  it('waits for the destination tree and restores an earlier reading position', () => {
    const { getByTestId, rerender } = render(<Harness treeId="a" />);
    const scroll = getByTestId('scroll');
    scroll.scrollTop = 350;
    fireEvent.wheel(scroll, { deltaY: -100 });
    fireEvent.scroll(scroll);
    mockConversationId = 'b';
    rerender(<Harness treeId="a" />);
    expect(scroll.scrollTop).toBe(350);
    rerender(<Harness treeId="b" />);
    expect(scroll.scrollTop).toBe(1200);
    mockConversationId = 'a';
    rerender(<Harness treeId="b" />);
    expect(scroll.scrollTop).toBe(1200);
    rerender(<Harness treeId="a" />);
    expect(scroll.scrollTop).toBe(350);
  });
});
