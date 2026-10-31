import { Constants, ContentTypes, ToolCallTypes } from 'librechat-data-provider';
import type { TMessageContentParts, Agents } from 'librechat-data-provider';
import type { PartWithIndex } from '~/components/Chat/Messages/Content/ParallelContent';

export type GroupedPart =
  | { type: 'single'; part: PartWithIndex }
  | { type: 'tool-group'; parts: PartWithIndex[] };

function isGroupableToolCall(part: TMessageContentParts): boolean {
  if (part.type !== ContentTypes.TOOL_CALL) {
    return false;
  }
  const toolCall = part[ContentTypes.TOOL_CALL] as Agents.ToolCall | undefined;
  if (!toolCall) {
    return false;
  }
  const isStandardToolCall =
    'args' in toolCall && (!toolCall.type || toolCall.type === ToolCallTypes.TOOL_CALL);
  if (isStandardToolCall && toolCall.name?.startsWith(Constants.LC_TRANSFER_TO_)) {
    return false;
  }
  return true;
}

function getToolGroupKey(part: TMessageContentParts): string {
  if (part.type !== ContentTypes.TOOL_CALL) {
    return '';
  }
  const toolCall = part[ContentTypes.TOOL_CALL] as Agents.ToolCall | undefined;
  if (!toolCall) {
    return '';
  }
  if ('args' in toolCall && (!toolCall.type || toolCall.type === ToolCallTypes.TOOL_CALL)) {
    return `standard:${toolCall.name ?? ''}`;
  }
  return `typed:${toolCall.type ?? 'unknown'}`;
}

export function groupSequentialToolCalls(parts: PartWithIndex[]): GroupedPart[] {
  const result: GroupedPart[] = [];
  let currentGroup: PartWithIndex[] = [];
  let currentGroupKey = '';

  const flushGroup = () => {
    if (currentGroup.length >= 2) {
      result.push({ type: 'tool-group', parts: [...currentGroup] });
    } else {
      for (const p of currentGroup) {
        result.push({ type: 'single', part: p });
      }
    }
    currentGroup = [];
    currentGroupKey = '';
  };

  for (const item of parts) {
    if (isGroupableToolCall(item.part)) {
      const nextKey = getToolGroupKey(item.part);
      if (currentGroup.length > 0 && currentGroupKey !== nextKey) {
        flushGroup();
      }
      currentGroupKey = nextKey;
      currentGroup.push(item);
    } else {
      flushGroup();
      result.push({ type: 'single', part: item });
    }
  }
  flushGroup();

  return result;
}
