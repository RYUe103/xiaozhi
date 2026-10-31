import { useEffect, useState, useRef, useCallback } from 'react';
import { v4 } from 'uuid';
import { SSE } from 'sse.js';
import { useSetRecoilState } from 'recoil';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  request,
  Constants,
  QueryKeys,
  ErrorTypes,
  StepEvents,
  apiBaseUrl,
  createPayload,
  ViolationTypes,
  removeNullishValues,
} from 'librechat-data-provider';
import type {
  TConversation,
  TMessage,
  TPayload,
  TSubmission,
  EventSubmission,
} from 'librechat-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import { useGetUserBalance, useGetStartupConfig, streamStatusQueryKey } from '~/data-provider';
import type { ActiveJobsResponse } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import useEventHandlers from './useEventHandlers';
import { addConvoToAllQueries, clearAllDrafts } from '~/utils';
import { recordSanSuoDiagnostic } from '~/utils/sansuoDiagnostics';
import store from '~/store';

type ChatHelpers = Pick<
  EventHandlerParams,
  | 'setMessages'
  | 'getMessages'
  | 'setConversation'
  | 'setIsSubmitting'
  | 'setSubmission'
  | 'clearSubmission'
  | 'newConversation'
  | 'resetLatestMessage'
>;

const MAX_RETRIES = 5;

type SubmissionLaunchEntry = {
  startedAt?: string;
  promise?: Promise<GenerationStart | null>;
  streamId?: string | null;
  conversationId?: string | null;
};

type GenerationStart = {
  startedAt?: string;
  streamId: string;
  conversationId: string;
};

const submissionLaunchCache = new Map<string, SubmissionLaunchEntry>();

export const clearSubmissionLaunchCacheForTests = () => {
  submissionLaunchCache.clear();
};

const getSubmissionLaunchKey = (submission: TSubmission) => {
  const conversationId = submission.conversation?.conversationId ?? Constants.NEW_CONVO;
  const userMessageId =
    submission.userMessage?.messageId ?? submission.initialResponse?.parentMessageId ?? 'unknown';
  return `start:${conversationId}:${userMessageId}`;
};

/**
 * Hook for resumable SSE streams.
 * Separates generation start (POST) from stream subscription (GET EventSource).
 * Supports auto-reconnection with exponential backoff.
 *
 * Key behavior:
 * - Navigation away does NOT abort the generation (just closes SSE)
 * - Only explicit abort (via stop button → backend abort endpoint) stops generation
 * - Backend emits `done` event with `aborted: true` on abort, handled via finalHandler
 */
export default function useResumableSSE(
  submission: TSubmission | null,
  chatHelpers: ChatHelpers,
  isAddedRequest = false,
  runIndex = 0,
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setActiveRunId = useSetRecoilState(store.activeRunFamily(runIndex));

  const { token, isAuthenticated } = useAuthContext();

  /**
   * Keep the active job cache keyed by conversationId, matching the backend API.
   */
  const addActiveConversation = useCallback(
    (conversationId?: string | null) => {
      if (!conversationId || conversationId === Constants.NEW_CONVO) {
        return;
      }

      queryClient.setQueryData<ActiveJobsResponse>([QueryKeys.activeJobs], (old) => ({
        activeJobIds: [...new Set([...(old?.activeJobIds ?? []), conversationId])],
      }));
    },
    [queryClient],
  );

  const removeActiveConversation = useCallback(
    (conversationId?: string | null) => {
      if (!conversationId || conversationId === Constants.NEW_CONVO) {
        return;
      }

      queryClient.setQueryData<ActiveJobsResponse>([QueryKeys.activeJobs], (old) => ({
        activeJobIds: (old?.activeJobIds ?? []).filter((id) => id !== conversationId),
      }));
    },
    [queryClient],
  );
  const [_completed, setCompleted] = useState(new Set());
  const [streamId, setStreamId] = useState<string | null>(null);
  const setAbortScroll = useSetRecoilState(store.abortScrollFamily(runIndex));
  const setShowStopButton = useSetRecoilState(store.showStopButtonByIndex(runIndex));

  const sseRef = useRef<SSE | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionGenerationRef = useRef(0);
  const submissionRef = useRef<TSubmission | null>(null);
  const submissionIdentityRef = useRef<string | null>(null);
  const launchKeyRef = useRef<string | null>(null);
  const submissionIdentity =
    submission?.clientRequestId ?? submission?.userMessage?.messageId ?? null;
  if (submissionIdentityRef.current !== submissionIdentity) {
    submissionIdentityRef.current = submissionIdentity;
    submissionRef.current = submission;
  } else if (!submissionRef.current) {
    submissionRef.current = submission;
  }

  const {
    setMessages,
    getMessages,
    setConversation,
    setIsSubmitting,
    setSubmission,
    clearSubmission,
    newConversation,
    resetLatestMessage,
  } = chatHelpers;
  const chatHelpersRef = useRef(chatHelpers);
  chatHelpersRef.current = chatHelpers;

  const promoteStartedConversation = useCallback(
    (start: GenerationStart, currentSubmission: TSubmission): TSubmission => {
      if (start.startedAt) {
        currentSubmission = {
          ...currentSubmission,
          initialResponse: {
            ...currentSubmission.initialResponse,
            metadata: {
              ...currentSubmission.initialResponse?.metadata,
              sansuoProcessTiming: { startedAt: start.startedAt },
            },
          },
        } as TSubmission;
        submissionRef.current = currentSubmission;
      }
      const previousConversationId =
        currentSubmission.conversation?.conversationId ?? Constants.NEW_CONVO;
      const conversationId = start.conversationId || start.streamId;
      if (start.startedAt) {
        const updateTiming = (message: TMessage) =>
          message.messageId === currentSubmission.initialResponse?.messageId
            ? {
                ...message,
                metadata: { ...message.metadata, ...currentSubmission.initialResponse.metadata },
              }
            : message;
        const cachedMessages = queryClient.getQueryData<TMessage[]>([
          QueryKeys.messages,
          previousConversationId,
        ]);
        if (cachedMessages)
          queryClient.setQueryData(
            [QueryKeys.messages, previousConversationId],
            cachedMessages.map(updateTiming),
          );
        if (window.location.pathname === `/c/${previousConversationId}`) {
          setMessages?.((getMessages?.() ?? []).map(updateTiming));
        }
      }
      if (
        !conversationId ||
        conversationId === Constants.NEW_CONVO ||
        previousConversationId !== Constants.NEW_CONVO
      ) {
        addActiveConversation(
          previousConversationId === Constants.NEW_CONVO ? conversationId : previousConversationId,
        );
        return currentSubmission;
      }

      const sourceMessages =
        queryClient.getQueryData<TMessage[]>([QueryKeys.messages, previousConversationId]) ??
        getMessages?.() ??
        [];
      const migratedMessages = sourceMessages.map((message) => ({
        ...message,
        conversationId,
        ...(start.startedAt && message.messageId === currentSubmission.initialResponse?.messageId
          ? { metadata: { ...message.metadata, ...currentSubmission.initialResponse.metadata } }
          : {}),
      }));
      queryClient.setQueryData<TMessage[]>([QueryKeys.messages, conversationId], migratedMessages);

      const questionTitle = String(currentSubmission.userMessage?.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      const optimisticConversation = {
        ...currentSubmission.conversation,
        conversationId,
        title:
          currentSubmission.conversation?.title &&
          currentSubmission.conversation.title !== 'New Chat'
            ? currentSubmission.conversation.title
            : questionTitle || 'New Chat',
      } as TConversation;
      const promotedSubmission = {
        ...currentSubmission,
        conversation: optimisticConversation,
        userMessage: {
          ...currentSubmission.userMessage,
          conversationId,
        },
        initialResponse: {
          ...currentSubmission.initialResponse,
          conversationId,
        },
      } as TSubmission;

      queryClient.setQueryData([QueryKeys.conversation, conversationId], optimisticConversation);
      addConvoToAllQueries(queryClient, optimisticConversation);
      addActiveConversation(conversationId);
      clearAllDrafts(previousConversationId);
      submissionRef.current = promotedSubmission;

      if (window.location.pathname === `/c/${Constants.NEW_CONVO}`) {
        setConversation?.(optimisticConversation);
        setSubmission?.(promotedSubmission);
        navigate(`/c/${conversationId}${window.location.search}`, { replace: true });
      }

      recordSanSuoDiagnostic('sse.conversation_promoted', {
        previousConversationId,
        conversationId,
        messages: migratedMessages.length,
      });
      return promotedSubmission;
    },
    [
      addActiveConversation,
      getMessages,
      navigate,
      queryClient,
      setConversation,
      setSubmission,
      setMessages,
    ],
  );

  const eventHandlers = useEventHandlers({
    setMessages,
    getMessages,
    setCompleted,
    isAddedRequest,
    setConversation,
    setIsSubmitting,
    setSubmission,
    clearSubmission,
    newConversation,
    setShowStopButton,
    resetLatestMessage,
  });
  const eventHandlersRef = useRef(eventHandlers);
  eventHandlersRef.current = eventHandlers;

  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });

  /**
   * Subscribe to stream via SSE library (supports custom headers)
   * Follows same auth pattern as useSSE
   * @param isResume - If true, adds ?resume=true to trigger sync event from server
   */
  const subscribeToStream = useCallback(
    (currentStreamId: string, currentSubmission: TSubmission, isResume = false) => {
      let { userMessage } = currentSubmission;
      let textIndex: number | null = null;
      const connectionGeneration = ++connectionGenerationRef.current;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      const baseUrl = `${apiBaseUrl()}/api/agents/chat/stream/${encodeURIComponent(currentStreamId)}`;
      const url = isResume ? `${baseUrl}?resume=true` : baseUrl;
      console.log('[ResumableSSE] Subscribing to stream:', url, { isResume });
      recordSanSuoDiagnostic('sse.subscribe', {
        streamId: currentStreamId,
        conversationId: currentSubmission.conversation?.conversationId,
        isResume,
      });

      if (sseRef.current) {
        recordSanSuoDiagnostic('sse.replace_existing', { streamId: currentStreamId });
        sseRef.current.close();
      }

      const sse = new SSE(url, {
        headers: { Authorization: `Bearer ${token}` },
        method: 'GET',
      });
      sseRef.current = sse;
      const isCurrentConnection = () => connectionGenerationRef.current === connectionGeneration;
      const getLiveSubmission = (): EventSubmission =>
        ({ ...(submissionRef.current ?? currentSubmission), userMessage }) as EventSubmission;
      const clearSubmissionDrafts = (liveConversationId?: string | null) => {
        const conversationIds = new Set([
          currentSubmission.conversation?.conversationId ?? Constants.NEW_CONVO,
          liveConversationId ?? Constants.NEW_CONVO,
        ]);
        conversationIds.forEach((conversationId) => clearAllDrafts(conversationId));
      };

      sse.addEventListener('open', () => {
        if (!isCurrentConnection()) {
          return;
        }
        console.log('[ResumableSSE] Stream connected');
        recordSanSuoDiagnostic('sse.open', {
          streamId: currentStreamId,
          conversationId: currentSubmission.conversation?.conversationId,
        });
        setAbortScroll(false);
        // Restore UI state on successful connection (including reconnection)
        setIsSubmitting(true);
        setShowStopButton(true);
        reconnectAttemptRef.current = 0;
      });

      sse.addEventListener('message', (e: MessageEvent) => {
        if (!isCurrentConnection()) {
          return;
        }
        try {
          const data = JSON.parse(e.data);

          if (data.final != null) {
            const liveSubmission = getLiveSubmission();
            const liveConversationId = liveSubmission.conversation?.conversationId;
            console.log('[ResumableSSE] Received FINAL event', {
              aborted: data.aborted,
              conversationId: data.conversation?.conversationId,
              hasResponseMessage: !!data.responseMessage,
            });
            recordSanSuoDiagnostic('sse.final', {
              streamId: currentStreamId,
              conversationId: data.conversation?.conversationId,
              responseMessageId: data.responseMessage?.messageId,
              aborted: data.aborted === true,
            });
            clearSubmissionDrafts(liveConversationId);
            try {
              eventHandlersRef.current.finalHandler(data, liveSubmission);
            } catch (error) {
              console.error('[ResumableSSE] Error in finalHandler:', error);
              setIsSubmitting(false);
              setShowStopButton(false);
            }
            // Clear handler maps on stream completion to prevent memory leaks
            eventHandlersRef.current.clearStepMaps();
            // Optimistically remove from active jobs
            removeActiveConversation(liveConversationId);
            (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();
            connectionGenerationRef.current++;
            sse.close();
            if (sseRef.current === sse) {
              sseRef.current = null;
            }
            setStreamId(null);
            return;
          }

          if (data.created != null) {
            console.log('[ResumableSSE] Received CREATED event', {
              messageId: data.message?.messageId,
              conversationId: data.message?.conversationId,
            });
            const runId = v4();
            setActiveRunId(runId);
            userMessage = {
              ...userMessage,
              ...data.message,
              overrideParentMessageId: userMessage.overrideParentMessageId,
            };
            const createdSubmission = {
              ...(submissionRef.current ?? currentSubmission),
              conversation: {
                ...(submissionRef.current?.conversation ?? currentSubmission.conversation),
                conversationId:
                  data.message?.conversationId ?? currentSubmission.conversation?.conversationId,
              },
              userMessage,
              initialResponse: {
                ...(submissionRef.current?.initialResponse ?? currentSubmission.initialResponse),
                parentMessageId: userMessage.messageId,
                messageId:
                  data.responseMessageId ??
                  submissionRef.current?.initialResponse?.messageId ??
                  currentSubmission.initialResponse?.messageId,
              },
            } as TSubmission;
            submissionRef.current = createdSubmission;
            eventHandlersRef.current.createdHandler(data, createdSubmission as EventSubmission);
            return;
          }

          if (data.event === 'attachment' && data.data) {
            eventHandlersRef.current.attachmentHandler({
              data: data.data,
              submission: getLiveSubmission(),
            });
            return;
          }

          if (data.sansuoFileParse != null) {
            eventHandlersRef.current.fileParseStatusHandler(data);
            return;
          }

          if (data.event != null) {
            eventHandlersRef.current.stepHandler(data, getLiveSubmission());
            return;
          }

          if (data.sync != null) {
            console.log('[ResumableSSE] SYNC received', {
              runSteps: data.resumeState?.runSteps?.length ?? 0,
              pendingEvents: data.pendingEvents?.length ?? 0,
            });

            const runId = v4();
            setActiveRunId(runId);

            if (data.resumeState?.aggregatedContent && userMessage?.messageId) {
              const messages = chatHelpersRef.current.getMessages() ?? [];
              const userMsgId = userMessage.messageId;
              const serverResponseId = data.resumeState.responseMessageId;

              let responseIdx = -1;
              if (serverResponseId) {
                responseIdx = messages.findIndex((m) => m.messageId === serverResponseId);
              }
              if (responseIdx < 0) {
                responseIdx = messages.findIndex(
                  (m) =>
                    !m.isCreatedByUser &&
                    (m.messageId === `${userMsgId}_` || m.parentMessageId === userMsgId),
                );
              }

              console.log('[ResumableSSE] SYNC update', {
                userMsgId,
                serverResponseId,
                responseIdx,
                foundMessageId: responseIdx >= 0 ? messages[responseIdx]?.messageId : null,
                messagesCount: messages.length,
                aggregatedContentLength: data.resumeState.aggregatedContent?.length,
              });

              if (responseIdx >= 0) {
                const updated = [...messages];
                const oldContent = updated[responseIdx]?.content;
                updated[responseIdx] = {
                  ...updated[responseIdx],
                  messageId: serverResponseId ?? updated[responseIdx]?.messageId,
                  content: data.resumeState.aggregatedContent,
                  unfinished: true,
                };
                console.log('[ResumableSSE] SYNC updating message', {
                  messageId: updated[responseIdx]?.messageId,
                  oldContentLength: Array.isArray(oldContent) ? oldContent.length : 0,
                  newContentLength: data.resumeState.aggregatedContent?.length,
                });
                chatHelpersRef.current.setMessages(updated);
                eventHandlersRef.current.resetContentHandler();
                eventHandlersRef.current.syncStepMessage(updated[responseIdx]);
                console.log('[ResumableSSE] SYNC complete, handlers synced');
              } else {
                const responseId = serverResponseId ?? `${userMsgId}_`;
                const newMessage = {
                  ...(getLiveSubmission().initialResponse as TMessage),
                  messageId: responseId,
                  parentMessageId: userMsgId,
                  conversationId: getLiveSubmission().conversation?.conversationId ?? '',
                  text: '',
                  content: data.resumeState.aggregatedContent,
                  isCreatedByUser: false,
                  unfinished: true,
                } as TMessage;
                chatHelpersRef.current.setMessages([...messages, newMessage]);
                eventHandlersRef.current.resetContentHandler();
                eventHandlersRef.current.syncStepMessage(newMessage);
              }
            }

            if (data.resumeState?.runSteps) {
              if (data.resumeState.aggregatedContent) {
                eventHandlersRef.current.syncRunSteps(data.resumeState.runSteps);
              } else {
                for (const runStep of data.resumeState.runSteps) {
                  eventHandlersRef.current.stepHandler(
                    { event: StepEvents.ON_RUN_STEP, data: runStep },
                    { ...getLiveSubmission() } as EventSubmission,
                  );
                }
              }
            }

            if (data.pendingEvents?.length > 0) {
              console.log(`[ResumableSSE] Replaying ${data.pendingEvents.length} pending events`);
              const liveSubmission = getLiveSubmission();
              for (const pendingEvent of data.pendingEvents) {
                if (pendingEvent.event != null) {
                  eventHandlersRef.current.stepHandler(pendingEvent, liveSubmission);
                } else if (pendingEvent.sansuoFileParse != null) {
                  eventHandlersRef.current.fileParseStatusHandler(pendingEvent);
                } else if (pendingEvent.type != null) {
                  eventHandlersRef.current.contentHandler({
                    data: pendingEvent,
                    submission: liveSubmission,
                  });
                }
              }
            }

            setIsSubmitting(true);
            setShowStopButton(true);
            return;
          }

          if (data.type != null) {
            const { text, index } = data;
            if (text != null && index !== textIndex) {
              textIndex = index;
            }
            eventHandlersRef.current.contentHandler({ data, submission: getLiveSubmission() });
            return;
          }

          if (data.message != null) {
            const text = data.text ?? data.response;
            const initialResponse = {
              ...(currentSubmission.initialResponse as TMessage),
              parentMessageId: data.parentMessageId,
              messageId: data.messageId,
            };
            eventHandlersRef.current.messageHandler(text, {
              ...getLiveSubmission(),
              initialResponse,
            });
          }
        } catch (error) {
          console.error('[ResumableSSE] Error processing message:', error);
        }
      });

      /**
       * Error event handler - handles BOTH:
       * 1. HTTP-level errors (responseCode present) - 404, 401, network failures
       * 2. Server-sent error events (event: error with data) - known errors like ViolationTypes/ErrorTypes
       *
       * Order matters: check responseCode first since HTTP errors may also include data
       */
      sse.addEventListener('error', async (e: MessageEvent) => {
        if (!isCurrentConnection()) {
          return;
        }
        (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();

        /* @ts-ignore - sse.js types don't expose responseCode */
        const responseCode = e.responseCode;
        recordSanSuoDiagnostic('sse.error', {
          streamId: currentStreamId,
          conversationId: currentSubmission.conversation?.conversationId,
          responseCode: typeof responseCode === 'number' ? responseCode : null,
          hasData: !!e.data,
          reconnectAttempt: reconnectAttemptRef.current,
        });

        // 404 → job completed & was cleaned up; messages are persisted in DB.
        // Invalidate cache once so react-query refetches instead of showing an error.
        if (responseCode === 404) {
          const convoId = getLiveSubmission().conversation?.conversationId;
          console.log('[ResumableSSE] Stream 404, invalidating messages for:', convoId);
          connectionGenerationRef.current++;
          sse.close();
          if (sseRef.current === sse) {
            sseRef.current = null;
          }
          removeActiveConversation(convoId);
          clearSubmissionDrafts(convoId);
          eventHandlersRef.current.clearStepMaps();
          if (convoId) {
            queryClient.setQueryData(streamStatusQueryKey(convoId), (previous: unknown) => ({
              ...(typeof previous === 'object' && previous != null ? previous : {}),
              active: false,
              status: 'complete',
              streamId: undefined,
            }));
            queryClient.invalidateQueries({ queryKey: [QueryKeys.messages, convoId] });
          }
          setIsSubmitting(false);
          setShowStopButton(false);
          clearSubmission?.();
          setStreamId(null);
          reconnectAttemptRef.current = 0;
          return;
        }

        // Check for 401 and try to refresh token (same pattern as useSSE)
        if (responseCode === 401) {
          try {
            const refreshResponse = await request.refreshToken();
            const newToken = refreshResponse?.token ?? '';
            if (!newToken) {
              throw new Error('Token refresh failed.');
            }
            sse.headers = {
              Authorization: `Bearer ${newToken}`,
            };
            request.dispatchTokenUpdatedEvent(newToken);
            sse.stream();
            return;
          } catch (error) {
            console.log('[ResumableSSE] Token refresh failed:', error);
          }
        }

        /**
         * Server-sent error event (event: error with data) - no responseCode.
         * These are known errors (ErrorTypes, ViolationTypes) that should be displayed to user.
         * Only check e.data if there's no HTTP responseCode, since HTTP errors may also have body data.
         * Note: responseCode === 0 means transport failure (connection dropped) - treat as network error,
         * not a server-sent error payload. Use `== null` to only match undefined/null (no HTTP status).
         */
        if (responseCode == null && e.data) {
          console.log('[ResumableSSE] Server-sent error event received:', e.data);
          connectionGenerationRef.current++;
          sse.close();
          if (sseRef.current === sse) {
            sseRef.current = null;
          }
          const convoId = getLiveSubmission().conversation?.conversationId;
          removeActiveConversation(convoId);
          if (convoId) {
            queryClient.setQueryData(streamStatusQueryKey(convoId), (previous: unknown) => ({
              ...(typeof previous === 'object' && previous != null ? previous : {}),
              active: false,
              status: 'error',
              streamId: undefined,
            }));
          }

          try {
            const errorData = JSON.parse(e.data);
            const errorString = errorData.error ?? errorData.message ?? JSON.stringify(errorData);

            // Check if it's a known error type (ViolationTypes or ErrorTypes)
            let isKnownError = false;
            try {
              const parsed =
                typeof errorString === 'string' ? JSON.parse(errorString) : errorString;
              const errorType = parsed?.type ?? parsed?.code;
              if (errorType) {
                const violationValues = Object.values(ViolationTypes) as string[];
                const errorTypeValues = Object.values(ErrorTypes) as string[];
                isKnownError =
                  violationValues.includes(errorType) || errorTypeValues.includes(errorType);
              }
            } catch {
              // Not JSON or parsing failed - treat as generic error
            }

            console.log('[ResumableSSE] Error type check:', { isKnownError, errorString });

            // Display the error to user via errorHandler
            eventHandlersRef.current.errorHandler({
              data: { text: errorString } as unknown as Parameters<
                typeof eventHandlers.errorHandler
              >[0]['data'],
              submission: getLiveSubmission(),
            });
          } catch (parseError) {
            console.error('[ResumableSSE] Failed to parse server error:', parseError);
            eventHandlersRef.current.errorHandler({
              data: { text: e.data } as unknown as Parameters<
                typeof eventHandlers.errorHandler
              >[0]['data'],
              submission: getLiveSubmission(),
            });
          }

          setIsSubmitting(false);
          setShowStopButton(false);
          clearSubmission?.();
          setStreamId(null);
          reconnectAttemptRef.current = 0;
          return;
        }

        // Network failure or unknown HTTP error - attempt reconnection with backoff
        console.log('[ResumableSSE] Stream error (network failure) - will attempt reconnect', {
          responseCode,
          hasData: !!e.data,
        });

        if (reconnectAttemptRef.current < MAX_RETRIES) {
          if (reconnectTimeoutRef.current) {
            return;
          }
          // Increment counter BEFORE close() so abort handler knows we're reconnecting
          reconnectAttemptRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current - 1), 30000);

          console.log(
            `[ResumableSSE] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current}/${MAX_RETRIES})`,
          );

          sse.close();
          if (sseRef.current === sse) {
            sseRef.current = null;
          }

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            if (isCurrentConnection() && submissionRef.current) {
              // Reconnect with isResume=true to get sync event with any missed content
              subscribeToStream(currentStreamId, submissionRef.current, true);
            }
          }, delay);

          // Keep UI in "submitting" state during reconnection attempts
          // so user knows we're still trying (abort handler may have reset these)
          setIsSubmitting(true);
          setShowStopButton(true);
        } else {
          console.error('[ResumableSSE] Max reconnect attempts reached');
          connectionGenerationRef.current++;
          sse.close();
          if (sseRef.current === sse) {
            sseRef.current = null;
          }
          eventHandlersRef.current.errorHandler({
            data: undefined,
            submission: getLiveSubmission(),
          });
          // Optimistically remove from active jobs on max retries
          removeActiveConversation(currentSubmission.conversation?.conversationId);
          setIsSubmitting(false);
          setShowStopButton(false);
          clearSubmission?.();
          setStreamId(null);
        }
      });

      /**
       * Abort event - fired when sse.close() is called (intentional close).
       * This happens on cleanup/navigation OR when error handler closes to reconnect.
       * Only reset state if we're NOT in a reconnection cycle.
       */
      sse.addEventListener('abort', () => {
        if (!isCurrentConnection()) {
          return;
        }
        // If we're in a reconnection cycle, don't reset state
        // (error handler will set up the reconnect timeout)
        if (reconnectAttemptRef.current > 0) {
          console.log('[ResumableSSE] Stream closed for reconnect - preserving state');
          return;
        }

        console.log('[ResumableSSE] Stream aborted (intentional close) - no reconnect');
        // Clear any pending reconnect attempts
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        // Reset UI state - useResumeOnLoad will restore if user returns to this conversation
        setIsSubmitting(false);
        setShowStopButton(false);
        setStreamId(null);
      });

      // Start the SSE connection
      sse.stream();

      // Debug hooks for testing reconnection vs clean close behavior (dev only)
      if (import.meta.env.DEV) {
        const debugWindow = window as Window & {
          __sse?: SSE;
          __killNetwork?: () => void;
          __closeClean?: () => void;
        };
        debugWindow.__sse = sse;

        /** Simulate network drop - triggers error event → reconnection */
        debugWindow.__killNetwork = () => {
          console.log('[Debug] Simulating network drop...');
          // @ts-ignore - sse.js types are incorrect, dispatchEvent actually takes Event
          sse.dispatchEvent(new Event('error'));
        };

        /** Simulate clean close (navigation away) - triggers abort event → no reconnection */
        debugWindow.__closeClean = () => {
          console.log('[Debug] Simulating clean close (navigation away)...');
          sse.close();
        };
      }
    },
    [
      token,
      setAbortScroll,
      setActiveRunId,
      setShowStopButton,
      setIsSubmitting,
      startupConfig?.balance?.enabled,
      balanceQuery,
      clearSubmission,
      removeActiveConversation,
      queryClient,
    ],
  );

  /**
   * Start generation (POST request that returns streamId)
   * Uses request.post which has axios interceptors for automatic token refresh.
   * Retries up to 3 times on network errors with exponential backoff.
   */
  const startGeneration = useCallback(
    async (currentSubmission: TSubmission): Promise<GenerationStart | null> => {
      const payloadData = createPayload(currentSubmission);
      let { payload } = payloadData;
      payload = removeNullishValues(payload) as TPayload;

      eventHandlersRef.current.clearStepMaps();

      const url = payloadData.server;

      const maxRetries = 3;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Use request.post which handles auth token refresh via axios interceptors
          const data = (await request.post(url, payload)) as {
            streamId: string;
            conversationId?: string;
            startedAt?: string;
          };
          const start = {
            streamId: data.streamId,
            conversationId: data.conversationId || data.streamId,
            startedAt: data.startedAt,
          };
          console.log('[ResumableSSE] Generation started:', start);
          return start;
        } catch (error) {
          lastError = error;
          // Check if it's a network error (retry) vs server error (don't retry)
          const isNetworkError =
            error instanceof Error &&
            'code' in error &&
            (error.code === 'ERR_NETWORK' || error.code === 'ERR_INTERNET_DISCONNECTED');

          if (isNetworkError && attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
            console.log(
              `[ResumableSSE] Network error starting generation, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          // Don't retry: either not a network error or max retries reached
          break;
        }
      }

      console.error('[ResumableSSE] Error starting generation:', lastError);

      const axiosError = lastError as { response?: { data?: Record<string, unknown> } };
      const errorData = axiosError?.response?.data;
      if (errorData) {
        eventHandlersRef.current.errorHandler({
          data: { text: JSON.stringify(errorData) } as unknown as Parameters<
            typeof eventHandlers.errorHandler
          >[0]['data'],
          submission: currentSubmission as EventSubmission,
        });
      } else {
        eventHandlersRef.current.errorHandler({
          data: undefined,
          submission: currentSubmission as EventSubmission,
        });
      }
      clearSubmission?.();
      setIsSubmitting(false);
      return null;
    },
    [clearSubmission, setIsSubmitting],
  );

  useEffect(() => {
    if (!submission || Object.keys(submission).length === 0) {
      console.log('[ResumableSSE] No submission, cleaning up');
      if (launchKeyRef.current) {
        submissionLaunchCache.delete(launchKeyRef.current);
        launchKeyRef.current = null;
      }
      // Clear reconnect timeout if submission is cleared
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // Close SSE but do NOT dispatch cancel - navigation should not abort
      if (sseRef.current) {
        connectionGenerationRef.current++;
        sseRef.current.close();
        sseRef.current = null;
      }
      setStreamId(null);
      reconnectAttemptRef.current = 0;
      submissionRef.current = null;
      return;
    }

    const resumeStreamId = (submission as TSubmission & { resumeStreamId?: string }).resumeStreamId;
    const launchKey = getSubmissionLaunchKey(submission);
    launchKeyRef.current = launchKey;
    console.log('[ResumableSSE] Effect triggered', {
      conversationId: submission.conversation?.conversationId,
      hasResumeStreamId: !!resumeStreamId,
      resumeStreamId,
      launchKey,
      userMessageId: submission.userMessage?.messageId,
    });
    recordSanSuoDiagnostic('sse.submission', {
      conversationId: submission.conversation?.conversationId,
      userMessageId: submission.userMessage?.messageId,
      resumeStreamId: resumeStreamId ?? null,
      launchKey,
    });

    submissionRef.current = submission;
    let cancelled = false;

    const initStream = async () => {
      setIsSubmitting(true);
      setShowStopButton(true);
      const optimisticConversationId =
        submission.conversation?.conversationId &&
        submission.conversation.conversationId !== Constants.NEW_CONVO
          ? submission.conversation.conversationId
          : null;

      if (resumeStreamId) {
        // Resume: just subscribe to existing stream, don't start new generation
        console.log('[ResumableSSE] Resuming existing stream:', resumeStreamId);
        if (cancelled) {
          return;
        }
        setStreamId(resumeStreamId);
        addActiveConversation(optimisticConversationId);
        subscribeToStream(resumeStreamId, submission, true); // isResume=true
      } else {
        // New generation: de-duplicate concurrent/replayed starts for the same submission.
        let cacheEntry = submissionLaunchCache.get(launchKey);
        if (cacheEntry?.streamId) {
          console.log('[ResumableSSE] Reusing existing stream for submission', {
            launchKey,
            streamId: cacheEntry.streamId,
          });
          if (cancelled) {
            return;
          }
          setStreamId(cacheEntry.streamId);
          addActiveConversation(optimisticConversationId);
          const promotedSubmission = promoteStartedConversation(
            {
              streamId: cacheEntry.streamId,
              conversationId: cacheEntry.conversationId || cacheEntry.streamId,
              startedAt: cacheEntry.startedAt,
            },
            submission,
          );
          subscribeToStream(cacheEntry.streamId, promotedSubmission, true);
          return;
        }

        if (!cacheEntry?.promise) {
          console.log('[ResumableSSE] Starting NEW generation');
          const promise = startGeneration(submission).then((start) => {
            const currentEntry = submissionLaunchCache.get(launchKey);
            if (start) {
              submissionLaunchCache.set(launchKey, start);
            } else if (currentEntry?.promise === promise) {
              submissionLaunchCache.delete(launchKey);
            }
            return start;
          });
          submissionLaunchCache.set(launchKey, { promise });
          cacheEntry = submissionLaunchCache.get(launchKey);
        } else {
          console.log('[ResumableSSE] Awaiting in-flight generation start for submission', {
            launchKey,
          });
        }

        const start = await cacheEntry?.promise;
        const promotedSubmission = start
          ? promoteStartedConversation(start, submission)
          : submission;
        if (cancelled) {
          return;
        }
        if (start?.streamId) {
          setStreamId(start.streamId);
          addActiveConversation(start.conversationId || optimisticConversationId);
          subscribeToStream(start.streamId, promotedSubmission);
        } else {
          console.error('[ResumableSSE] Failed to get streamId from startGeneration');
        }
      }
    };

    initStream();

    return () => {
      cancelled = true;
      console.log('[ResumableSSE] Cleanup - closing SSE, resetting UI state');
      recordSanSuoDiagnostic('sse.cleanup', {
        conversationId: submission.conversation?.conversationId,
        launchKey,
      });
      // Cleanup on unmount/navigation - close connection but DO NOT abort backend
      // Reset UI state so it doesn't leak to other conversations
      // If user returns to this conversation, useResumeOnLoad will restore the state
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // Reset reconnect counter before closing (so abort handler doesn't think we're reconnecting)
      reconnectAttemptRef.current = 0;
      if (sseRef.current) {
        connectionGenerationRef.current++;
        sseRef.current.close();
        sseRef.current = null;
      }
      // Clear handler maps to prevent memory leaks and stale state
      eventHandlersRef.current.clearStepMaps();
      // Reset UI state on cleanup - useResumeOnLoad will restore if needed
      setIsSubmitting(false);
      setShowStopButton(false);
    };
    // Stream ownership follows the stable request identity. The created event updates
    // conversation/message IDs inside the same request and must not restart the subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionIdentity]);

  return { streamId };
}
