import {
  MESSAGE_FOLLOW_DISTANCE,
  getMessageScrollPosition,
  getRestoredMessageScrollTop,
} from '../useMessageScrolling';

describe('message scroll position helpers', () => {
  it('records the exact reading position and distance from the bottom', () => {
    expect(
      getMessageScrollPosition({ scrollTop: 480, scrollHeight: 1200, clientHeight: 600 }),
    ).toEqual({ top: 480, distanceFromBottom: 120 });
  });

  it('keeps a reader at the same content offset when they have scrolled up', () => {
    expect(
      getRestoredMessageScrollTop(
        { top: 420, distanceFromBottom: MESSAGE_FOLLOW_DISTANCE + 1 },
        { scrollHeight: 2400, clientHeight: 700 },
      ),
    ).toBe(420);
  });

  it('keeps a near-bottom conversation pinned relative to new streamed content', () => {
    expect(
      getRestoredMessageScrollTop(
        { top: 480, distanceFromBottom: 24 },
        { scrollHeight: 1800, clientHeight: 600 },
      ),
    ).toBe(1176);
  });

  it('clamps a saved position when the restored conversation is shorter', () => {
    expect(
      getRestoredMessageScrollTop(
        { top: 900, distanceFromBottom: MESSAGE_FOLLOW_DISTANCE + 1 },
        { scrollHeight: 800, clientHeight: 600 },
      ),
    ).toBe(200);
  });
});
