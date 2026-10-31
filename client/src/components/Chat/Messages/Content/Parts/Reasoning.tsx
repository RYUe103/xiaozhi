import { memo, useEffect, useMemo, useState, useCallback, useRef, useId, useContext } from 'react';
import { useAtomValue } from 'jotai';
import { ContentTypes } from 'librechat-data-provider';
import type { FocusEvent, MouseEvent } from 'react';
import {
  ThinkingContent,
  ThinkingButton,
  FloatingThinkingBar,
  SafeThinkingPanel,
} from './Thinking';
import ExecutionPending from './ExecutionPending';
import { useLocalize, useExpandCollapse } from '~/hooks';
import { showThinkingAtom } from '~/store/showThinking';
import { useMessageContext } from '~/Providers';
import { cn } from '~/utils';
import { ProcessContext } from '../ProcessContext';

type ReasoningProps = {
  reasoning: string;
  isLast: boolean;
};

/**
 * Reasoning Component (MODERN SYSTEM)
 *
 * Used for structured content parts with ContentTypes.THINK type.
 * This handles modern message format where content is an array of typed parts.
 *
 * Pattern: `{ content: [{ type: "think", think: "<think>content</think>" }, ...] }`
 *
 * Used by:
 * - ContentParts.tsx → Part.tsx for structured messages
 * - Agent/Assistant responses (OpenAI Assistants, custom agents)
 * - O-series models (o1, o3) with reasoning capabilities
 * - Modern Claude responses with thinking blocks
 *
 * Key differences from legacy Thinking.tsx:
 * - Works with content parts array instead of plain text
 * - Strips `<think>` tags instead of `:::thinking:::` markers
 * - Each THINK part has its own independent toggle button
 * - Can be interleaved with other content types
 *
 * For legacy text-based messages, see Thinking.tsx component.
 */
const Reasoning = memo(({ reasoning, isLast }: ReasoningProps) => {
  const contentId = useId();
  const localize = useLocalize();
  const showThinking = useAtomValue(showThinkingAtom);
  const inProcessGroup = useContext(ProcessContext);
  const [isExpanded, setIsExpanded] = useState(showThinking);
  const [isBarVisible, setIsBarVisible] = useState(false);
  const [showExecutionPending, setShowExecutionPending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { style: expandStyle, ref: expandRef } = useExpandCollapse(isExpanded);
  const { isSubmitting, isLatestMessage, nextType } = useMessageContext();

  // Strip <think> tags from the reasoning content (modern format)
  const reasoningText = useMemo(() => {
    return reasoning
      .replace(/^<think>\s*/, '')
      .replace(/\s*<\/think>$/, '')
      .trim();
  }, [reasoning]);

  const handleClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsExpanded((prev) => !prev);
  }, []);

  const handleFocus = useCallback(() => {
    setIsBarVisible(true);
  }, []);

  const handleBlur = useCallback((e: FocusEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsBarVisible(false);
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsBarVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!containerRef.current?.contains(document.activeElement)) {
      setIsBarVisible(false);
    }
  }, []);

  const effectiveIsSubmitting = isLatestMessage ? isSubmitting : false;
  const canShowExecutionPending =
    !inProcessGroup &&
    effectiveIsSubmitting &&
    isLast &&
    reasoningText.length > 0 &&
    (nextType == null || nextType === ContentTypes.TOOL_CALL);

  useEffect(() => {
    if (!canShowExecutionPending) {
      setShowExecutionPending(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowExecutionPending(true);
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [canShowExecutionPending, reasoningText]);

  const label = useMemo(() => {
    if (effectiveIsSubmitting && isLast) {
      return localize('com_ui_thinking');
    }
    if (inProcessGroup) {
      return '思考内容';
    }
    return localize('com_ui_thinking_finished');
  }, [effectiveIsSubmitting, localize, isLast, inProcessGroup]);

  if (!reasoningText) {
    return null;
  }

  if (inProcessGroup) {
    return (
      <SafeThinkingPanel
        isThinking={effectiveIsSubmitting && isLast}
        label={effectiveIsSubmitting && isLast ? '正在思考' : '思考完成'}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="group/reasoning"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="group/thinking-container">
        <div className="process-step-row">
          <ThinkingButton
            isExpanded={isExpanded}
            onClick={handleClick}
            label={label}
            content={reasoningText}
            contentId={contentId}
          />
        </div>
        <div
          id={contentId}
          role="group"
          aria-label={label}
          aria-hidden={!isExpanded || undefined}
          className={cn(nextType !== ContentTypes.THINK && isExpanded && 'mb-4')}
          style={expandStyle}
        >
          <div className="relative overflow-hidden" ref={expandRef}>
            <ThinkingContent>{reasoningText}</ThinkingContent>
            <FloatingThinkingBar
              isVisible={isBarVisible && isExpanded}
              isExpanded={isExpanded}
              onClick={handleClick}
              content={reasoningText}
              contentId={contentId}
            />
          </div>
        </div>
        {showExecutionPending && <ExecutionPending />}
      </div>
    </div>
  );
});

export default Reasoning;
