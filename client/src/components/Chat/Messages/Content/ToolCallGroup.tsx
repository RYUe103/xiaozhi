import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { ChevronDown } from 'lucide-react';
import { ContentTypes, Tools, ToolCallTypes } from 'librechat-data-provider';
import type { Agents, TAttachment, TMessageContentParts } from 'librechat-data-provider';
import type { ToolDisplayArgs } from '~/utils';
import type { PartWithIndex } from './ParallelContent';
import { AttachmentGroup } from './Parts';
import { StackedToolIcons } from './ToolOutput';
import { useLocalize, useExpandCollapse } from '~/hooks';
import { useMCPIconMap } from '~/hooks/MCP';
import { cn, getToolDisplayLabel } from '~/utils';
import { isBashProgrammaticToolCall } from './routing';
import { getToolActivity, type ActivityLifecycle } from './activity';
import store from '~/store';

interface ToolMeta {
  name: string;
  args?: ToolDisplayArgs;
  lifecycle: ActivityLifecycle;
}

function getToolMeta(part: TMessageContentParts, isSubmitting: boolean): ToolMeta | null {
  const activity = getToolActivity(part, isSubmitting);
  if (!activity) {
    return null;
  }
  if (part.type !== ContentTypes.TOOL_CALL) {
    return null;
  }
  const toolCall = part[ContentTypes.TOOL_CALL];
  if (!toolCall) {
    return null;
  }

  const isStandard =
    'args' in toolCall && (!toolCall.type || toolCall.type === ToolCallTypes.TOOL_CALL);
  if (isStandard) {
    const standardCall = toolCall as Agents.ToolCall;
    const name = isBashProgrammaticToolCall(standardCall.name, standardCall.args)
      ? Tools.bash_tool
      : (standardCall.name ?? '');
    return { name, args: standardCall.args, lifecycle: activity.lifecycle };
  }
  return { name: activity.name, lifecycle: activity.lifecycle };
}

interface ToolCallGroupProps {
  parts: PartWithIndex[];
  isSubmitting: boolean;
  isLast: boolean;
  renderPart: (part: TMessageContentParts, idx: number, isLastPart: boolean) => React.ReactNode;
  lastContentIdx: number;
  groupAttachments?: TAttachment[];
  activityLabel?: string;
}

export default function ToolCallGroup({
  parts,
  isSubmitting,
  isLast,
  renderPart,
  lastContentIdx,
  groupAttachments,
  activityLabel,
}: ToolCallGroupProps) {
  const localize = useLocalize();
  const mcpIconMap = useMCPIconMap();
  const count = parts.length;

  const toolMetadata = useMemo(
    () => parts.map(({ part }) => getToolMeta(part, isSubmitting)),
    [isSubmitting, parts],
  );
  const allSettled = useMemo(
    () => toolMetadata.every((metadata) => metadata?.lifecycle !== 'running'),
    [toolMetadata],
  );
  const groupLifecycle = useMemo<ActivityLifecycle>(() => {
    if (toolMetadata.some((metadata) => metadata?.lifecycle === 'failed')) return 'failed';
    if (toolMetadata.some((metadata) => metadata?.lifecycle === 'running')) return 'running';
    if (toolMetadata.some((metadata) => metadata?.lifecycle === 'interrupted')) {
      return 'interrupted';
    }
    return 'success';
  }, [toolMetadata]);
  const groupStatusLabel = useMemo(() => {
    if (groupLifecycle === 'running') return '进行中';
    if (groupLifecycle === 'failed') return '失败';
    if (groupLifecycle === 'interrupted') return '已中断';
    return '已完成';
  }, [groupLifecycle]);
  const tools = useMemo(
    () =>
      toolMetadata
        .filter((metadata): metadata is ToolMeta => metadata != null && metadata.name.length > 0)
        .map(({ name, args }) => ({ name, args })),
    [toolMetadata],
  );
  const toolNameSummary = useMemo(() => {
    const labels = Array.from(
      new Set(tools.map(({ name, args }) => getToolDisplayLabel(name, localize, args))),
    );
    if (labels.length <= 3) {
      return labels.join(', ');
    }
    return `${labels.slice(0, 3).join(', ')}, +${labels.length - 3}`;
  }, [localize, tools]);

  const autoExpand = useRecoilValue(store.autoExpandTools);
  const isSemanticStage = activityLabel != null;
  const autoCollapse = isSemanticStage || (!autoExpand && allSettled);
  const [isExpanded, setIsExpanded] = useState(isSemanticStage ? false : autoExpand);
  const [userOverride, setUserOverride] = useState(false);
  const { style: expandStyle, ref: expandRef } = useExpandCollapse(isExpanded);
  useEffect(() => {
    if (autoCollapse && !userOverride) {
      setIsExpanded(false);
    }
  }, [autoCollapse, userOverride]);

  const handleToggle = useCallback(() => {
    setUserOverride(true);
    setIsExpanded((expanded) => !expanded);
  }, []);

  return (
    <div className="mb-1 mt-0.5 min-w-0">
      <button
        type="button"
        className="inline-flex min-h-7 w-full min-w-0 items-center gap-2 py-0.5 text-left text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
        onClick={handleToggle}
        aria-expanded={isExpanded}
        aria-label={activityLabel ?? localize('com_ui_used_n_tools', { 0: String(count) })}
      >
        <StackedToolIcons
          tools={tools}
          mcpIconMap={mcpIconMap}
          maxIcons={4}
          isAnimating={groupLifecycle === 'running'}
        />
        <span className="tool-status-text shrink-0 font-medium">
          {activityLabel ||
            toolNameSummary ||
            localize('com_ui_used_n_tools', { 0: String(count) })}
          {!activityLabel && count > 1 ? ` × ${count}` : ''}
        </span>
        <span
          className={cn(
            'hidden min-w-0 truncate text-xs font-normal text-text-tertiary sm:inline',
            groupLifecycle === 'failed' && 'text-red-600 dark:text-red-400',
            groupLifecycle === 'success' && 'text-green-700 dark:text-green-400',
          )}
        >
          {groupStatusLabel}
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-text-secondary transition-transform duration-200 ease-out',
            isExpanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
      <div style={expandStyle}>
        <div className="overflow-hidden" ref={expandRef}>
          <div className="py-0.5 pl-4">
            {parts.map(({ part, idx }) => renderPart(part, idx, isLast && idx === lastContentIdx))}
          </div>
        </div>
      </div>
      {groupAttachments && groupAttachments.length > 0 && (
        <AttachmentGroup attachments={groupAttachments} />
      )}
    </div>
  );
}
