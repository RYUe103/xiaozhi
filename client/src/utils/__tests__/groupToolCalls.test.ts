import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import { groupSequentialToolCalls } from '../groupToolCalls';

const tool = (idx: number, name: string) => ({
  idx,
  part: {
    type: ContentTypes.TOOL_CALL,
    tool_call: { id: `call-${idx}`, name, args: '{}' },
  } as unknown as TMessageContentParts,
});

describe('groupSequentialToolCalls', () => {
  it('merges only consecutive calls to the same tool', () => {
    const groups = groupSequentialToolCalls([
      tool(0, 'execute_code'),
      tool(1, 'execute_code'),
      tool(2, 'web_search'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ type: 'tool-group' });
    expect(groups[1]).toMatchObject({ type: 'single' });
  });

  it('keeps different tools as separate timeline events', () => {
    const groups = groupSequentialToolCalls([tool(0, 'execute_code'), tool(1, 'web_search')]);
    expect(groups.map((group) => group.type)).toEqual(['single', 'single']);
  });

  it('does not merge similar tools across a reasoning milestone', () => {
    const groups = groupSequentialToolCalls([
      tool(0, 'execute_code'),
      {
        idx: 1,
        part: { type: ContentTypes.THINK, think: 'next step' } as TMessageContentParts,
      },
      tool(2, 'execute_code'),
    ]);
    expect(groups.map((group) => group.type)).toEqual(['single', 'single', 'single']);
  });
});
