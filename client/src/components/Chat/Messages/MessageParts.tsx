import React, { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useRecoilValue } from 'recoil';
import type { TMessageContentParts } from 'librechat-data-provider';
import type { TMessageProps, TMessageIcon } from '~/common';
import { useMessageHelpers, useLocalize, useAttachments, useContentMetadata } from '~/hooks';
import { cn, getHeaderPrefixForScreenReader, getMessageAriaLabel } from '~/utils';
import MessageIcon from '~/components/Chat/Messages/MessageIcon';
import ContentParts from './Content/ContentParts';
import { fontSizeAtom } from '~/store/fontSize';
import SiblingSwitch from './SiblingSwitch';
import MultiMessage from './MultiMessage';
import HoverButtons from './HoverButtons';
import PlaceholderRow from './ui/PlaceholderRow';
import SubRow from './SubRow';
import store from '~/store';
import {
  getSanSuoFileParseStatus,
  getSanSuoKnowledgeStatus,
  getSanSuoProcessTiming,
} from '~/utils/sansuoMode';
import { normalizeSanSuoFileSources } from '~/utils/fileWorkspace';

export default function Message(props: TMessageProps) {
  const localize = useLocalize();
  const { message, siblingIdx, siblingCount, setSiblingIdx, currentEditId, setCurrentEditId } =
    props;
  const { attachments, searchResults } = useAttachments({
    messageId: message?.messageId,
    attachments: message?.attachments,
  });
  const {
    edit,
    index,
    agent,
    isLast,
    enterEdit,
    assistant,
    handleScroll,
    conversation,
    isSubmitting,
    latestMessageId,
    handleContinue,
    copyToClipboard,
    regenerateMessage,
  } = useMessageHelpers(props);

  const fontSize = useAtomValue(fontSizeAtom);
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);
  const { children, messageId = null, isCreatedByUser } = message ?? {};

  const name = useMemo(() => {
    let result = '';
    if (isCreatedByUser === true) {
      result = localize('com_user_message');
    } else if (assistant) {
      result = assistant.name ?? localize('com_ui_assistant');
    } else if (agent) {
      result = agent.name ?? localize('com_ui_agent');
    }

    return result;
  }, [assistant, agent, isCreatedByUser, localize]);

  const iconData: TMessageIcon = useMemo(
    () => ({
      endpoint: message?.endpoint ?? conversation?.endpoint,
      model: message?.model ?? conversation?.model,
      iconURL: message?.iconURL ?? conversation?.iconURL,
      modelLabel: name,
      isCreatedByUser: message?.isCreatedByUser,
    }),
    [
      name,
      conversation?.endpoint,
      conversation?.iconURL,
      conversation?.model,
      message?.model,
      message?.iconURL,
      message?.endpoint,
      message?.isCreatedByUser,
    ],
  );

  const { hasParallelContent } = useContentMetadata(message);
  const processTiming = useMemo(
    () => getSanSuoProcessTiming(message?.metadata),
    [message?.metadata],
  );
  const fileWorkspaceSources = useMemo(
    () =>
      normalizeSanSuoFileSources(
        (message?.metadata as { sansuoSources?: unknown } | undefined)?.sansuoSources,
      ),
    [message?.metadata],
  );

  const isKnowledgeAnswer = useMemo(() => {
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
  }, [message?.isCreatedByUser, message?.metadata]);

  if (!message) {
    return null;
  }

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
    common: 'group mx-auto flex flex-1 gap-3 transition-all duration-300 transform-gpu',
    chat: getChatWidthClass(),
  };

  return (
    <>
      <div
        className="w-full border-0 bg-transparent dark:border-0 dark:bg-transparent"
        onWheel={handleScroll}
        onTouchMove={handleScroll}
      >
        <div className="m-auto justify-center p-4 py-2 md:gap-6">
          <div
            id={messageId ?? ''}
            aria-label={getMessageAriaLabel(message, localize)}
            className={cn(
              baseClasses.common,
              baseClasses.chat,
              isKnowledgeAnswer && 'sansuo-knowledge-answer',
              'message-render',
            )}
          >
            {!hasParallelContent && (
              <div className="relative flex flex-shrink-0 flex-col items-center">
                <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full pt-0.5">
                  <MessageIcon iconData={iconData} assistant={assistant} agent={agent} />
                </div>
              </div>
            )}
            <div
              className={cn(
                'relative flex flex-col',
                hasParallelContent ? 'w-full' : 'w-11/12',
                isCreatedByUser ? 'user-turn' : 'agent-turn',
              )}
            >
              {!hasParallelContent && (
                <h2 className={cn('select-none font-semibold text-text-primary', fontSize)}>
                  <span className="sr-only">
                    {getHeaderPrefixForScreenReader(message, localize)}
                  </span>
                  {name}
                </h2>
              )}
              <div className="flex flex-col gap-1">
                <div className="flex min-h-[20px] max-w-full flex-grow flex-col gap-0">
                  <ContentParts
                    edit={edit}
                    isLast={isLast}
                    enterEdit={enterEdit}
                    siblingIdx={siblingIdx}
                    attachments={attachments}
                    fileWorkspaceSources={fileWorkspaceSources}
                    isSubmitting={isSubmitting}
                    searchResults={searchResults}
                    manualSkills={message.manualSkills}
                    knowledgeStatus={getSanSuoKnowledgeStatus(message.metadata)}
                    fileParseStatus={getSanSuoFileParseStatus(message.metadata)}
                    processStartedAt={processTiming?.startedAt ?? message.createdAt}
                    processElapsedMs={processTiming?.elapsedMs}
                    messageId={message.messageId}
                    setSiblingIdx={setSiblingIdx}
                    isCreatedByUser={message.isCreatedByUser}
                    conversationId={conversation?.conversationId}
                    isLatestMessage={messageId === latestMessageId}
                    content={message.content as Array<TMessageContentParts | undefined>}
                  />
                </div>
                {isLast && isSubmitting ? (
                  <PlaceholderRow />
                ) : (
                  <SubRow classes="text-xs">
                    <SiblingSwitch
                      siblingIdx={siblingIdx}
                      siblingCount={siblingCount}
                      setSiblingIdx={setSiblingIdx}
                    />
                    <HoverButtons
                      index={index}
                      isEditing={edit}
                      message={message}
                      enterEdit={enterEdit}
                      isSubmitting={isSubmitting}
                      conversation={conversation ?? null}
                      regenerate={() => regenerateMessage()}
                      copyToClipboard={copyToClipboard}
                      handleContinue={handleContinue}
                      latestMessageId={latestMessageId}
                      isLast={isLast}
                    />
                  </SubRow>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <MultiMessage
        messageId={messageId}
        conversation={conversation}
        messagesTree={children ?? []}
        currentEditId={currentEditId}
        setCurrentEditId={setCurrentEditId}
      />
    </>
  );
}
