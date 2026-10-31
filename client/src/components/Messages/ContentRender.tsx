import { useCallback, useMemo, memo } from 'react';
import { useRecoilValue } from 'recoil';
import type { TMessage, TMessageContentParts } from 'librechat-data-provider';
import type { TMessageProps, TMessageIcon, TMessageChatContext } from '~/common';
import { useAttachments, useLocalize, useMessageActions, useContentMetadata } from '~/hooks';
import { cn, getHeaderPrefixForScreenReader, getMessageAriaLabel } from '~/utils';
import ContentParts from '~/components/Chat/Messages/Content/ContentParts';
import PlaceholderRow from '~/components/Chat/Messages/ui/PlaceholderRow';
import SiblingSwitch from '~/components/Chat/Messages/SiblingSwitch';
import HoverButtons from '~/components/Chat/Messages/HoverButtons';
import MessageIcon from '~/components/Chat/Messages/MessageIcon';
import SubRow from '~/components/Chat/Messages/SubRow';
import store from '~/store';
import {
  getSanSuoKnowledgeStatus,
  getSanSuoFileParseStatus,
  getSanSuoProcessTiming,
} from '~/utils/sansuoMode';

type ContentRenderProps = {
  message?: TMessage;
  /**
   * Effective isSubmitting: false for non-latest messages, real value for latest.
   * Computed by the wrapper (MessageContent.tsx) so this memo'd component only re-renders
   * when the value actually matters.
   */
  isSubmitting?: boolean;
  /** Stable context object from wrapper — avoids ChatContext subscription inside memo */
  chatContext: TMessageChatContext;
} & Pick<
  TMessageProps,
  'currentEditId' | 'setCurrentEditId' | 'siblingIdx' | 'setSiblingIdx' | 'siblingCount'
>;

function isExternalKnowledgeAnswer(message?: TMessage): boolean {
  if (message?.isCreatedByUser === true || !message?.metadata) {
    return false;
  }
  const metadata = message.metadata as {
    sansuoMode?: unknown;
    sansuoKnowledge?: { knowledgeBaseId?: unknown; sourceType?: unknown };
  };
  return (
    metadata.sansuoKnowledge?.sourceType !== 'industry_materials' &&
    (metadata.sansuoMode === 'knowledge' ||
      typeof metadata.sansuoKnowledge?.knowledgeBaseId === 'string')
  );
}

/**
 * Custom comparator for React.memo: compares `message` by key fields instead of reference
 * because `buildTree` creates new message objects on every streaming update for ALL messages.
 */
function areContentRenderPropsEqual(prev: ContentRenderProps, next: ContentRenderProps): boolean {
  if (prev.isSubmitting !== next.isSubmitting) {
    return false;
  }
  if (prev.chatContext !== next.chatContext) {
    return false;
  }
  if (prev.siblingIdx !== next.siblingIdx) {
    return false;
  }
  if (prev.siblingCount !== next.siblingCount) {
    return false;
  }
  if (prev.currentEditId !== next.currentEditId) {
    return false;
  }
  if (prev.setSiblingIdx !== next.setSiblingIdx) {
    return false;
  }
  if (prev.setCurrentEditId !== next.setCurrentEditId) {
    return false;
  }

  const prevMsg = prev.message;
  const nextMsg = next.message;
  if (prevMsg === nextMsg) {
    return true;
  }
  if (!prevMsg || !nextMsg) {
    return prevMsg === nextMsg;
  }

  return (
    prevMsg.messageId === nextMsg.messageId &&
    prevMsg.text === nextMsg.text &&
    prevMsg.error === nextMsg.error &&
    prevMsg.unfinished === nextMsg.unfinished &&
    prevMsg.depth === nextMsg.depth &&
    prevMsg.isCreatedByUser === nextMsg.isCreatedByUser &&
    (prevMsg.children?.length ?? 0) === (nextMsg.children?.length ?? 0) &&
    prevMsg.content === nextMsg.content &&
    prevMsg.metadata === nextMsg.metadata &&
    prevMsg.model === nextMsg.model &&
    prevMsg.endpoint === nextMsg.endpoint &&
    prevMsg.iconURL === nextMsg.iconURL &&
    isExternalKnowledgeAnswer(prevMsg) === isExternalKnowledgeAnswer(nextMsg) &&
    prevMsg.feedback?.rating === nextMsg.feedback?.rating &&
    (prevMsg.attachments?.length ?? 0) === (nextMsg.attachments?.length ?? 0) &&
    (prevMsg.manualSkills?.length ?? 0) === (nextMsg.manualSkills?.length ?? 0) &&
    (prevMsg.alwaysAppliedSkills?.length ?? 0) === (nextMsg.alwaysAppliedSkills?.length ?? 0)
  );
}

const ContentRender = memo(function ContentRender({
  message: msg,
  siblingIdx,
  siblingCount,
  setSiblingIdx,
  currentEditId,
  setCurrentEditId,
  isSubmitting = false,
  chatContext,
}: ContentRenderProps) {
  const localize = useLocalize();
  const { attachments, searchResults } = useAttachments({
    messageId: msg?.messageId,
    attachments: msg?.attachments,
  });
  const {
    edit,
    index,
    agent,
    assistant,
    enterEdit,
    conversation,
    messageLabel,
    handleContinue,
    handleFeedback,
    latestMessageId,
    copyToClipboard,
    regenerateMessage,
    latestMessageDepth,
  } = useMessageActions({
    message: msg,
    searchResults,
    currentEditId,
    setCurrentEditId,
    chatContext,
  });
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);

  const handleRegenerateMessage = useCallback(() => regenerateMessage(), [regenerateMessage]);
  const isLast = useMemo(
    () => !(msg?.children?.length ?? 0) && (msg?.depth === latestMessageDepth || msg?.depth === -1),
    [msg?.children, msg?.depth, latestMessageDepth],
  );
  const hasNoChildren = !(msg?.children?.length ?? 0);
  const isLatestMessage = msg?.messageId === latestMessageId;

  const iconData: TMessageIcon = useMemo(
    () => ({
      endpoint: msg?.endpoint ?? conversation?.endpoint,
      model: msg?.model ?? conversation?.model,
      iconURL: msg?.iconURL,
      modelLabel: messageLabel,
      isCreatedByUser: msg?.isCreatedByUser,
    }),
    [
      messageLabel,
      conversation?.endpoint,
      conversation?.model,
      msg?.model,
      msg?.iconURL,
      msg?.endpoint,
      msg?.isCreatedByUser,
    ],
  );

  const { hasParallelContent } = useContentMetadata(msg);

  if (!msg) {
    return null;
  }

  const isUserMessage = msg.isCreatedByUser === true;
  const processTiming = getSanSuoProcessTiming(msg.metadata);
  const isKnowledgeAnswer = isExternalKnowledgeAnswer(msg);

  const getChatWidthClass = () => {
    if (maximizeChatSpace) {
      return 'w-full max-w-full md:px-5 lg:px-1 xl:px-5';
    }
    if (hasParallelContent) {
      return 'md:max-w-[58rem] xl:max-w-[70rem]';
    }
    return 'md:max-w-[47rem] xl:max-w-[55rem]';
  };

  const baseClasses = {
    common: 'group mx-auto flex flex-1 gap-3 transition-all duration-300 transform-gpu ',
    chat: getChatWidthClass(),
  };

  const conditionalClasses = {
    focus: 'focus:outline-none focus:ring-2 focus:ring-border-xheavy',
  };

  return (
    <div
      id={msg.messageId}
      aria-label={getMessageAriaLabel(msg, localize)}
      className={cn(
        baseClasses.common,
        baseClasses.chat,
        conditionalClasses.focus,
        isUserMessage && 'justify-end gap-0',
        isKnowledgeAnswer && 'sansuo-knowledge-answer',
        'message-render',
      )}
    >
      {!hasParallelContent && !isUserMessage && (
        <div className="relative flex flex-shrink-0 flex-col items-center">
          <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full">
            <MessageIcon iconData={iconData} assistant={assistant} agent={agent} />
          </div>
        </div>
      )}

      <div
        className={cn(
          'relative flex flex-col',
          isUserMessage
            ? 'ml-auto w-fit max-w-[min(75%,42rem)] items-end'
            : hasParallelContent
              ? 'w-full'
              : 'w-11/12',
          isUserMessage ? 'user-turn' : 'agent-turn',
        )}
      >
        {!hasParallelContent && !isUserMessage && (
          <span className="sr-only">{getHeaderPrefixForScreenReader(msg, localize)}</span>
        )}

        <div className={cn('flex flex-col gap-1', isUserMessage && 'items-end')}>
          <div
            className={cn(
              'flex min-h-[20px] max-w-full flex-grow flex-col gap-0',
              isUserMessage &&
                'rounded-[24px] bg-[#f4f4f4] px-4 py-2.5 text-text-primary dark:bg-surface-secondary',
            )}
          >
            <ContentParts
              edit={edit}
              isLast={isLast}
              enterEdit={enterEdit}
              siblingIdx={siblingIdx}
              messageId={msg.messageId}
              attachments={attachments}
              searchResults={searchResults}
              manualSkills={msg.manualSkills}
              knowledgeStatus={getSanSuoKnowledgeStatus(msg.metadata)}
              fileParseStatus={getSanSuoFileParseStatus(msg.metadata)}
              processStartedAt={processTiming?.startedAt}
              processElapsedMs={processTiming?.elapsedMs}
              setSiblingIdx={setSiblingIdx}
              isLatestMessage={isLatestMessage}
              isSubmitting={isSubmitting}
              isCreatedByUser={msg.isCreatedByUser}
              conversationId={conversation?.conversationId}
              content={msg.content as Array<TMessageContentParts | undefined>}
            />
          </div>
          {hasNoChildren && isSubmitting ? (
            <PlaceholderRow />
          ) : (
            <SubRow classes={cn('text-xs', isUserMessage && 'justify-end')}>
              <SiblingSwitch
                siblingIdx={siblingIdx}
                siblingCount={siblingCount}
                setSiblingIdx={setSiblingIdx}
              />
              <HoverButtons
                index={index}
                message={msg}
                isEditing={edit}
                enterEdit={enterEdit}
                isSubmitting={chatContext.isSubmitting}
                conversation={conversation ?? null}
                regenerate={handleRegenerateMessage}
                copyToClipboard={copyToClipboard}
                handleContinue={handleContinue}
                latestMessageId={latestMessageId}
                handleFeedback={handleFeedback}
                isLast={isLast}
              />
            </SubRow>
          )}
        </div>
      </div>
    </div>
  );
}, areContentRenderPropsEqual);
ContentRender.displayName = 'ContentRender';

export default ContentRender;
