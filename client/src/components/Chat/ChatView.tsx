import { memo, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { useForm } from 'react-hook-form';
import { Spinner } from '@librechat/client';
import { useParams, useSearchParams } from 'react-router-dom';
import { Constants, buildTree } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { ChatFormValues } from '~/common';
import { ChatContext, AddedChatContext, ChatFormProvider, useFileMapContext } from '~/Providers';
import { useAddedResponse, useResumeOnLoad, useAdaptiveSSE, useChatHelpers } from '~/hooks';
import ConversationStarters from './Input/ConversationStarters';
import { useGetMessagesByConvoId } from '~/data-provider';
import MessagesView from './Messages/MessagesView';
import Presentation from './Presentation';
import ChatForm from './Input/ChatForm';
import FolderHome from './FolderHome';
import Landing from './Landing';
import Header from './Header';
import Footer from './Footer';
import { cn } from '~/utils';
import store from '~/store';

function LoadingSpinner() {
  return (
    <div className="relative flex-1 overflow-hidden overflow-y-auto">
      <div className="relative flex h-full items-center justify-center">
        <Spinner className="text-text-primary" />
      </div>
    </div>
  );
}

function ChatView({ index = 0 }: { index?: number }) {
  const { conversationId } = useParams();
  const [searchParams] = useSearchParams();
  const folderId = searchParams.get('folderId');
  const rootSubmission = useRecoilValue(store.submissionByIndex(index));
  const centerFormOnLanding = useRecoilValue(store.centerFormOnLanding);
  const submissionConversationId = rootSubmission?.conversation?.conversationId ?? null;
  const hasInFlightSubmission =
    !!rootSubmission &&
    Object.keys(rootSubmission).length > 0 &&
    submissionConversationId === (conversationId ?? Constants.NEW_CONVO);

  const methods = useForm<ChatFormValues>({
    defaultValues: { text: '' },
  });

  const fileMap = useFileMapContext();

  const { data: messagesTree = null, isLoading } = useGetMessagesByConvoId(conversationId ?? '', {
    select: useCallback(
      (data: TMessage[]) => {
        const dataTree = buildTree({ messages: data, fileMap });
        return dataTree ?? null;
      },
      [fileMap],
    ),
    enabled: !!fileMap,
  });

  const chatHelpers = useChatHelpers(index, conversationId);
  const addedChatHelpers = useAddedResponse();

  useAdaptiveSSE(rootSubmission, chatHelpers, false, index);

  // Auto-resume if navigating back to conversation with active job
  // Wait for messages to load before resuming to avoid race condition
  useResumeOnLoad(conversationId, chatHelpers.getMessages, index, !isLoading);

  let content: JSX.Element | null | undefined;
  const isLandingPage =
    (!messagesTree || messagesTree.length === 0) &&
    (conversationId === Constants.NEW_CONVO || !conversationId);
  const isFolderHome = conversationId === Constants.NEW_CONVO && !!folderId;
  const isNavigating =
    isLoading &&
    (!messagesTree || messagesTree.length === 0) &&
    conversationId != null &&
    conversationId !== Constants.NEW_CONVO;
  const isRecoveringActiveConversation =
    conversationId != null &&
    conversationId !== Constants.NEW_CONVO &&
    hasInFlightSubmission &&
    (!messagesTree || messagesTree.length === 0);
  let surfaceClassName = 'h-full overflow-y-auto overscroll-y-contain';
  if (isLandingPage) {
    surfaceClassName = 'flex-1 items-center justify-end px-2 sm:justify-center';
  }
  if (isFolderHome) {
    surfaceClassName = 'h-full overflow-y-auto overscroll-y-contain';
  }

  if (isLoading && conversationId !== Constants.NEW_CONVO) {
    content = <LoadingSpinner />;
  } else if (isFolderHome) {
    content = <FolderHome />;
  } else if ((isLoading || isNavigating || isRecoveringActiveConversation) && !isLandingPage) {
    content = <LoadingSpinner />;
  } else if (!isLandingPage) {
    content = <MessagesView messagesTree={messagesTree} />;
  } else {
    content = <Landing centerFormOnLanding={centerFormOnLanding} />;
  }

  return (
    <ChatFormProvider {...methods}>
      <ChatContext.Provider value={chatHelpers}>
        <AddedChatContext.Provider value={addedChatHelpers}>
          <Presentation>
            <div className="relative flex h-full w-full flex-col">
              <Header />
              <>
                <div className={cn('sansuo-chat-surface flex flex-col', surfaceClassName)}>
                  {isFolderHome ? (
                    content
                  ) : (
                    <>
                      {content}
                      <div
                        className={cn(
                          'w-full',
                          isLandingPage && 'max-w-3xl transition-all duration-200 xl:max-w-4xl',
                        )}
                      >
                        <ChatForm index={index} />
                        {isLandingPage ? <ConversationStarters /> : <Footer />}
                      </div>
                    </>
                  )}
                </div>
                {isLandingPage && !isFolderHome && <Footer />}
              </>
            </div>
          </Presentation>
        </AddedChatContext.Provider>
      </ChatContext.Provider>
    </ChatFormProvider>
  );
}

export default memo(ChatView);
