import { memo, useMemo, useCallback } from 'react';
import { ContentTypes } from 'librechat-data-provider';
import type {
  TMessageContentParts,
  SearchResultData,
  TAttachment,
  Agents,
} from 'librechat-data-provider';
import { ParallelContentRenderer, type PartWithIndex } from './ParallelContent';
import { mapAttachments } from '~/utils';
import { MessageContext, SearchContext } from '~/Providers';
import { EditTextPart, EmptyText } from './Parts';
import MemoryArtifacts from './MemoryArtifacts';
import ToolCallGroup from './ToolCallGroup';
import PendingSkillCall from './Parts/PendingSkillCall';
import KnowledgeRetrievalCall from './KnowledgeRetrievalCall';
import FileParseCall from './FileParseCall';
import MessageProcessGroup from './MessageProcessGroup';
import Container from './Container';
import Part from './Part';
import FileWorkspacePanel from './FileWorkspacePanel';
import { getWorkspaceOutputs, type SanSuoFileSource } from '~/utils/fileWorkspace';
import { FileOutputContext } from './FileOutputContext';
import type { SanSuoFileParseStatus, SanSuoKnowledgeStatus } from '~/utils/sansuoMode';
import { SANSUO_FILE_PARSE_TOOL, SANSUO_KNOWLEDGE_SEARCH_TOOL } from '~/utils/sansuoMode';
import {
  aggregateActivityStages,
  getToolActivity,
  summarizeActivityFailure,
  type ToolActivity,
} from './activity';

const getToolCallId = (part: TMessageContentParts): string =>
  (part?.[ContentTypes.TOOL_CALL] as Agents.ToolCall | undefined)?.id ?? '';

const getKnowledgeToolCall = (part: TMessageContentParts) => {
  if (part.type !== ContentTypes.TOOL_CALL) {
    return undefined;
  }
  const toolCall = part[ContentTypes.TOOL_CALL] as Agents.ToolCall | undefined;
  return toolCall?.name === SANSUO_KNOWLEDGE_SEARCH_TOOL ? toolCall : undefined;
};

const getFileParseToolCall = (part: TMessageContentParts) => {
  if (part.type !== ContentTypes.TOOL_CALL) {
    return undefined;
  }
  const toolCall = part[ContentTypes.TOOL_CALL] as Agents.ToolCall | undefined;
  return toolCall?.name === SANSUO_FILE_PARSE_TOOL ? toolCall : undefined;
};

const hasNonEmptyText = (part: TMessageContentParts) => {
  if (part.type !== ContentTypes.TEXT) {
    return false;
  }
  const text = (part as unknown as { text?: string | { value?: string } }).text;
  return (typeof text === 'string' ? text : (text?.value ?? '')).trim().length > 0;
};

const isProcessPart = (part: TMessageContentParts) =>
  part.type === ContentTypes.THINK || part.type === ContentTypes.TOOL_CALL;

type PartWithContextProps = {
  part: TMessageContentParts;
  idx: number;
  isLastPart: boolean;
  messageId: string;
  conversationId?: string | null;
  nextType?: string;
  isSubmitting: boolean;
  isLatestMessage?: boolean;
  isCreatedByUser: boolean;
  isLast: boolean;
  partAttachments: TAttachment[] | undefined;
  hideAttachments?: boolean;
};

const PartWithContext = memo(function PartWithContext({
  part,
  idx,
  isLastPart,
  messageId,
  conversationId,
  nextType,
  isSubmitting,
  isLatestMessage,
  isCreatedByUser,
  isLast,
  partAttachments,
  hideAttachments,
}: PartWithContextProps) {
  const contextValue = useMemo(
    () => ({
      messageId,
      isExpanded: true as const,
      conversationId,
      partIndex: idx,
      nextType,
      isSubmitting,
      isLatestMessage,
    }),
    [messageId, conversationId, idx, nextType, isSubmitting, isLatestMessage],
  );

  return (
    <MessageContext.Provider value={contextValue}>
      <Part
        part={part}
        attachments={partAttachments}
        isSubmitting={isSubmitting}
        key={`part-${messageId}-${idx}`}
        isCreatedByUser={isCreatedByUser}
        isLast={isLastPart}
        showCursor={isLastPart && isLast}
        hideAttachments={hideAttachments}
      />
    </MessageContext.Provider>
  );
});

type ContentPartsProps = {
  content: Array<TMessageContentParts | undefined> | undefined;
  messageId: string;
  /**
   * Skill names the user invoked manually via the `$` popover on this turn.
   * `createdHandler` seeds this on the assistant placeholder from
   * `submission.manualSkills`, and `finalHandler`'s server-backed
   * `responseMessage` replacement drops it — so the field is naturally
   * present only for the lifetime of the stream. Scalar string array (not
   * the full message object) so `React.memo` stays shallow-happy.
   */
  manualSkills?: string[];
  knowledgeStatus?: SanSuoKnowledgeStatus;
  fileParseStatus?: SanSuoFileParseStatus;
  processStartedAt?: string;
  processElapsedMs?: number;
  conversationId?: string | null;
  attachments?: TAttachment[];
  fileWorkspaceSources?: SanSuoFileSource[];
  searchResults?: { [key: string]: SearchResultData };
  isCreatedByUser: boolean;
  isLast: boolean;
  isSubmitting: boolean;
  isLatestMessage?: boolean;
  edit?: boolean;
  enterEdit?: (cancel?: boolean) => void | null | undefined;
  siblingIdx?: number;
  setSiblingIdx?:
    | ((value: number) => void | React.Dispatch<React.SetStateAction<number>>)
    | null
    | undefined;
};

/**
 * ContentParts renders message content parts, handling both sequential and parallel layouts.
 *
 * For 90% of messages (single-agent, no parallel execution), this renders sequentially.
 * For multi-agent parallel execution, it uses ParallelContentRenderer to show columns.
 */
const ContentParts = memo(function ContentParts({
  edit,
  isLast,
  content,
  manualSkills,
  knowledgeStatus,
  fileParseStatus,
  processStartedAt,
  processElapsedMs,
  messageId,
  enterEdit,
  siblingIdx,
  attachments,
  fileWorkspaceSources,
  isSubmitting,
  setSiblingIdx,
  searchResults,
  conversationId,
  isCreatedByUser,
  isLatestMessage,
}: ContentPartsProps) {
  const attachmentMap = useMemo(() => mapAttachments(attachments ?? []), [attachments]);
  const fileOutputs = useMemo(() => getWorkspaceOutputs(attachments), [attachments]);
  const effectiveIsSubmitting = isLatestMessage ? isSubmitting : false;

  const pendingSkills = useMemo(
    () => (!isCreatedByUser && manualSkills != null ? manualSkills : []),
    [isCreatedByUser, manualSkills],
  );
  const hasPendingSkills = pendingSkills.length > 0;
  const hasRealContent = content?.some(Boolean) === true;

  const renderPendingSkills = () =>
    pendingSkills.map((skillName) => (
      <PendingSkillCall key={skillName} skillName={skillName} loaded={hasRealContent} />
    ));

  const renderPart = useCallback(
    (part: TMessageContentParts, idx: number, isLastPart: boolean) => {
      return (
        <PartWithContext
          key={`provider-${messageId}-${idx}`}
          idx={idx}
          part={part}
          isLast={isLast}
          messageId={messageId}
          isLastPart={isLastPart}
          conversationId={conversationId}
          isLatestMessage={isLatestMessage}
          isCreatedByUser={isCreatedByUser}
          nextType={content?.[idx + 1]?.type}
          isSubmitting={effectiveIsSubmitting}
          partAttachments={attachmentMap[getToolCallId(part)]}
        />
      );
    },
    [
      attachmentMap,
      content,
      conversationId,
      effectiveIsSubmitting,
      isCreatedByUser,
      isLast,
      isLatestMessage,
      messageId,
    ],
  );

  const renderProcessPart = useCallback(
    (part: TMessageContentParts, idx: number, isLastPart: boolean) => {
      return (
        <PartWithContext
          key={`process-provider-${messageId}-${idx}`}
          idx={idx}
          part={part}
          isLast={isLast}
          messageId={messageId}
          isLastPart={isLastPart}
          conversationId={conversationId}
          isLatestMessage={isLatestMessage}
          isCreatedByUser={isCreatedByUser}
          nextType={content?.[idx + 1]?.type}
          isSubmitting={effectiveIsSubmitting}
          partAttachments={attachmentMap[getToolCallId(part)]}
          hideAttachments
        />
      );
    },
    [
      attachmentMap,
      content,
      conversationId,
      effectiveIsSubmitting,
      isCreatedByUser,
      isLast,
      isLatestMessage,
      messageId,
    ],
  );

  const sequentialParts = useMemo<PartWithIndex[]>(() => {
    if (!content) {
      return [];
    }
    const result: PartWithIndex[] = [];
    content.forEach((part, idx) => {
      if (part && !getKnowledgeToolCall(part) && !getFileParseToolCall(part)) {
        result.push({ part, idx });
      }
    });
    return result;
  }, [content]);

  const processParts = useMemo(() => {
    const result: PartWithIndex[] = [];
    for (const entry of sequentialParts) {
      if (!isProcessPart(entry.part)) continue;
      const previous = result[result.length - 1];
      if (
        entry.part.type === ContentTypes.THINK &&
        previous?.part.type === ContentTypes.THINK &&
        previous.idx === entry.idx - 1
      ) {
        result[result.length - 1] = {
          idx: entry.idx,
          part: {
            ...entry.part,
            think: `${previous.part.think ?? ''}\n\n${entry.part.think ?? ''}`,
          },
        };
      } else {
        result.push(entry);
      }
    }
    return result;
  }, [sequentialParts]);
  const answerParts = useMemo(
    () => sequentialParts.filter(({ part }) => !isProcessPart(part)),
    [sequentialParts],
  );
  const activityStages = useMemo(
    () => aggregateActivityStages(processParts, effectiveIsSubmitting),
    [effectiveIsSubmitting, processParts],
  );
  const knowledgeToolCall = useMemo(() => {
    for (const part of content ?? []) {
      if (!part) {
        continue;
      }
      const toolCall = getKnowledgeToolCall(part);
      if (toolCall) {
        return toolCall as Agents.ToolCall & { status?: SanSuoKnowledgeStatus };
      }
    }
    return undefined;
  }, [content]);
  const fileParseToolCall = useMemo(() => {
    for (const part of content ?? []) {
      if (!part) {
        continue;
      }
      const toolCall = getFileParseToolCall(part);
      if (toolCall) {
        return toolCall as Agents.ToolCall & { status?: SanSuoFileParseStatus };
      }
    }
    return undefined;
  }, [content]);
  const hasAnswerText = useMemo(
    () => content?.some((part) => part && hasNonEmptyText(part)),
    [content],
  );
  const resolvedKnowledgeStatus = useMemo<SanSuoKnowledgeStatus | undefined>(() => {
    const status = knowledgeToolCall?.status ?? knowledgeStatus;
    if (status === 'failed') {
      return 'failed';
    }
    if (!status) {
      return undefined;
    }
    if (hasAnswerText) {
      return 'completed';
    }
    return effectiveIsSubmitting || status === 'searching' ? 'searching' : 'completed';
  }, [effectiveIsSubmitting, hasAnswerText, knowledgeStatus, knowledgeToolCall]);
  const hasModelContent = sequentialParts.length > 0;
  const resolvedFileParseStatus = useMemo<SanSuoFileParseStatus | undefined>(() => {
    const status = fileParseToolCall?.status ?? fileParseStatus;
    if (status === 'failed') {
      return 'failed';
    }
    if (!status) {
      return undefined;
    }
    if (status === 'completed' || hasModelContent) {
      return 'completed';
    }
    return 'parsing';
  }, [fileParseStatus, fileParseToolCall, hasModelContent]);
  const processStepCount =
    processParts.length +
    pendingSkills.length +
    (resolvedKnowledgeStatus ? 1 : 0) +
    (resolvedFileParseStatus ? 1 : 0);
  const toolActivities = useMemo(
    () =>
      processParts
        .map(({ part }) => getToolActivity(part, effectiveIsSubmitting))
        .filter((activity): activity is ToolActivity => activity != null),
    [effectiveIsSubmitting, processParts],
  );
  const hasProcessFailure =
    resolvedKnowledgeStatus === 'failed' ||
    resolvedFileParseStatus === 'failed' ||
    toolActivities.some((activity) => activity.lifecycle === 'failed');
  const hasProcessContent = processStepCount > 0 || (!isCreatedByUser && !!processStartedAt);
  const hasProcessInterruption =
    !effectiveIsSubmitting && !hasAnswerText && !hasProcessFailure && hasProcessContent;
  const failureReason = useMemo(() => {
    const failedActivity = [...toolActivities]
      .reverse()
      .find((activity) => activity.lifecycle === 'failed');
    return summarizeActivityFailure(failedActivity?.output);
  }, [toolActivities]);
  const isProcessActive =
    effectiveIsSubmitting && !hasAnswerText && !hasProcessFailure && hasProcessContent;
  const isProcessComplete = hasAnswerText || (!effectiveIsSubmitting && hasProcessContent);
  const currentActivityLabel = useMemo(() => {
    if (resolvedFileParseStatus === 'parsing') {
      return '正在解析文件';
    }
    if (resolvedKnowledgeStatus === 'searching') {
      return '正在检索资料';
    }
    const latestStage = activityStages[activityStages.length - 1];
    if (latestStage?.lifecycle === 'running') {
      return latestStage.label ? `正在${latestStage.label}` : '正在使用工具';
    }
    if (effectiveIsSubmitting && latestStage?.lifecycle === 'success') {
      return '正在整理结果';
    }
    return effectiveIsSubmitting ? '正在处理' : undefined;
  }, [activityStages, effectiveIsSubmitting, resolvedFileParseStatus, resolvedKnowledgeStatus]);

  // Early return: no content to render AND no pending skill cards.
  // Keep the latest assistant placeholder visible while the first SSE event is still pending.
  if (
    !content &&
    !hasPendingSkills &&
    !resolvedKnowledgeStatus &&
    !resolvedFileParseStatus &&
    !(isSubmitting && !isCreatedByUser)
  ) {
    return null;
  }
  // Edit mode: render editable text parts. Interim skill cards are a
  // mid-stream concern, not relevant in edit mode.
  if (edit === true && enterEdit && setSiblingIdx) {
    return (
      <>
        {(content ?? []).map((part, idx) => {
          if (!part) {
            return null;
          }
          const isTextPart =
            part?.type === ContentTypes.TEXT ||
            typeof (part as unknown as Agents.MessageContentText)?.text === 'string';
          const isThinkPart =
            part?.type === ContentTypes.THINK ||
            typeof (part as unknown as Agents.ReasoningDeltaUpdate)?.think === 'string';
          if (!isTextPart && !isThinkPart) {
            return null;
          }

          const isToolCall = part.type === ContentTypes.TOOL_CALL || part['tool_call_ids'] != null;
          if (isToolCall) {
            return null;
          }

          return (
            <EditTextPart
              index={idx}
              part={part as Agents.MessageContentText | Agents.ReasoningDeltaUpdate}
              messageId={messageId}
              isSubmitting={isSubmitting}
              enterEdit={enterEdit}
              siblingIdx={siblingIdx ?? null}
              setSiblingIdx={setSiblingIdx}
              key={`edit-${messageId}-${idx}`}
            />
          );
        })}
      </>
    );
  }

  const safeContent = content ?? [];
  const showEmptyCursor =
    safeContent.length === 0 &&
    !hasPendingSkills &&
    (effectiveIsSubmitting || (isSubmitting && isLast && !isCreatedByUser));
  const lastContentIdx = safeContent.length - 1;

  // Parallel content: use dedicated renderer with columns (TMessageContentParts includes ContentMetadata)
  const hasParallelContent = safeContent.some((part) => part?.groupId != null);
  if (hasParallelContent) {
    return (
      <>
        {renderPendingSkills()}
        <ParallelContentRenderer
          content={content}
          messageId={messageId}
          conversationId={conversationId}
          attachments={attachments}
          searchResults={searchResults}
          isSubmitting={effectiveIsSubmitting}
          renderPart={renderPart}
        />
      </>
    );
  }

  // Sequential content: render parts in order (90% of cases)
  return (
    <SearchContext.Provider value={{ searchResults }}>
      <MemoryArtifacts attachments={attachments} />
      {hasProcessContent && (
        <MessageProcessGroup
          key={processStartedAt ?? messageId}
          isActive={isProcessActive}
          isComplete={isProcessComplete}
          hasFailure={hasProcessFailure}
          hasInterruption={hasProcessInterruption}
          failureReason={failureReason}
          startedAt={processStartedAt}
          elapsedMs={processElapsedMs}
          statusLabel={currentActivityLabel}
        >
          {resolvedKnowledgeStatus && (
            <KnowledgeRetrievalCall
              progress={resolvedKnowledgeStatus === 'searching' ? 0.1 : 1}
              status={resolvedKnowledgeStatus}
            />
          )}
          {resolvedFileParseStatus && (
            <FileParseCall
              progress={resolvedFileParseStatus === 'parsing' ? 0.1 : 1}
              status={resolvedFileParseStatus}
            />
          )}
          {renderPendingSkills()}
          {activityStages.map((stage) => (
            <ToolCallGroup
              key={`activity-stage-${stage.key}-${stage.parts[0].idx}`}
              parts={stage.parts}
              activityLabel={stage.label}
              isSubmitting={effectiveIsSubmitting}
              isLast={stage.parts.some((p) => p.idx === lastContentIdx)}
              renderPart={renderProcessPart}
              lastContentIdx={lastContentIdx}
            />
          ))}
        </MessageProcessGroup>
      )}
      {showEmptyCursor && !hasProcessContent && (
        <Container>
          <EmptyText />
        </Container>
      )}
      {!isCreatedByUser && (
        <FileWorkspacePanel attachments={fileOutputs} isGenerating={effectiveIsSubmitting} />
      )}
      <FileOutputContext.Provider value={isCreatedByUser ? [] : fileOutputs}>
        {answerParts.map(({ part, idx }) => renderPart(part, idx, idx === lastContentIdx))}
      </FileOutputContext.Provider>
      {!isCreatedByUser && <FileWorkspacePanel sources={fileWorkspaceSources} />}
    </SearchContext.Provider>
  );
});

export default ContentParts;
