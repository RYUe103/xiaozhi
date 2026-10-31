import { useEffect, useRef } from 'react';
import { useSetRecoilState, useRecoilValue } from 'recoil';
import { Constants, tMessageSchema, isAssistantsEndpoint } from 'librechat-data-provider';
import type { TMessage, TConversation, TSubmission, Agents } from 'librechat-data-provider';
import { useActiveJobs, useStreamStatus } from '~/data-provider';
import store from '~/store';
import { getSanSuoProcessTiming } from '~/utils/sansuoMode';

/**
 * Build a submission object from resume state for reconnected streams.
 * This provides the minimum data needed for useResumableSSE to subscribe.
 */
function buildSubmissionFromResumeState(
  resumeState: Agents.ResumeState,
  streamId: string,
  messages: TMessage[],
  conversationId: string,
  currentConversation?: TConversation | null,
  createdAt?: number,
): TSubmission {
  const userMessageData = resumeState.userMessage;
  const responseMessageId =
    resumeState.responseMessageId ?? `${userMessageData?.messageId ?? 'resume'}_`;

  // Try to find existing user message in the messages array (from database)
  const existingUserMessage = messages.find(
    (m) => m.isCreatedByUser && m.messageId === userMessageData?.messageId,
  );

  // Try to find existing response message in the messages array (from database)
  const existingResponseMessage = messages.find(
    (m) =>
      !m.isCreatedByUser &&
      (m.messageId === responseMessageId || m.parentMessageId === userMessageData?.messageId),
  );

  // Create or use existing user message
  const userMessage: TMessage =
    existingUserMessage ??
    (userMessageData
      ? (tMessageSchema.parse({
          messageId: userMessageData.messageId,
          parentMessageId: userMessageData.parentMessageId ?? Constants.NO_PARENT,
          conversationId: userMessageData.conversationId ?? conversationId,
          text: userMessageData.text ?? '',
          isCreatedByUser: true,
          role: 'user',
        }) as TMessage)
      : (messages[messages.length - 2] ??
        ({
          messageId: 'resume_user_msg',
          conversationId,
          text: '',
          isCreatedByUser: true,
        } as TMessage)));

  // ALWAYS use aggregatedContent from resumeState - it has the latest content from the running job.
  // DB content may be stale (saved at disconnect, but generation continued).
  const initialResponse: TMessage = {
    messageId: existingResponseMessage?.messageId ?? responseMessageId,
    parentMessageId: existingResponseMessage?.parentMessageId ?? userMessage.messageId,
    conversationId,
    text: '',
    // aggregatedContent is authoritative - it reflects actual job state
    content: (resumeState.aggregatedContent as TMessage['content']) ?? [],
    isCreatedByUser: false,
    role: 'assistant',
    sender: existingResponseMessage?.sender ?? resumeState.sender,
    model: existingResponseMessage?.model,
    unfinished: true,
    metadata: {
      ...existingResponseMessage?.metadata,
      ...(createdAt
        ? {
            sansuoProcessTiming: {
              ...getSanSuoProcessTiming(existingResponseMessage?.metadata),
              startedAt: new Date(createdAt).toISOString(),
            },
          }
        : {}),
    },
  } as TMessage;

  const conversation: TConversation = {
    ...(currentConversation ?? {}),
    conversationId,
    title: currentConversation?.title ?? 'Resumed Chat',
    endpoint: currentConversation?.endpoint ?? null,
  } as TConversation;

  return {
    messages,
    userMessage,
    initialResponse,
    conversation,
    isRegenerate: false,
    isTemporary: false,
    endpointOption: {},
    // Signal to useResumableSSE to subscribe to existing stream instead of starting new
    resumeStreamId: streamId,
  } as TSubmission & { resumeStreamId: string };
}

/**
 * Hook to resume streaming if navigating to a conversation with active generation.
 * Checks stream status via React Query and sets submission if active job found.
 *
 * This hook:
 * 1. Uses useStreamStatus to check for active jobs on navigation
 * 2. If active job found, builds a submission with streamId and sets it
 * 3. useResumableSSE picks up the submission and subscribes to the stream
 *
 * @param messagesLoaded - Whether the messages query has finished loading (prevents race condition)
 */
export default function useResumeOnLoad(
  conversationId: string | undefined,
  getMessages: () => TMessage[] | undefined,
  runIndex = 0,
  messagesLoaded = true,
) {
  const setSubmission = useSetRecoilState(store.submissionByIndex(runIndex));
  const setIsSubmitting = useSetRecoilState(store.isSubmittingFamily(runIndex));
  const setShowStopButton = useSetRecoilState(store.showStopButtonByIndex(runIndex));
  const currentSubmission = useRecoilValue(store.submissionByIndex(runIndex));
  const currentConversation = useRecoilValue(store.conversationByIndex(runIndex));
  const endpoint = currentConversation?.endpoint;
  const endpointType = currentConversation?.endpointType;
  const actualEndpoint = endpointType ?? endpoint;
  const resumableEnabled = !isAssistantsEndpoint(actualEndpoint);
  // Track conversations we've already processed (either resumed or skipped)
  const processedConvoRef = useRef<string | null>(null);

  // Check for active stream when conversation changes.
  // We intentionally keep this enabled even if a submission object already exists
  // for the current conversation so we can self-heal stale local state after
  // HMR/page reloads/completed runs that were never cleared on the client.
  const submissionConvoId = currentSubmission?.conversation?.conversationId;
  const hasActiveSubmissionForThisConvo = currentSubmission && submissionConvoId === conversationId;
  const { data: activeJobsData, isSuccess: activeJobsLoaded } = useActiveJobs(resumableEnabled);
  const hasServerActiveJobForThisConvo =
    !!conversationId &&
    conversationId !== Constants.NEW_CONVO &&
    (activeJobsData?.activeJobIds ?? []).includes(conversationId);

  const shouldCheck =
    resumableEnabled &&
    messagesLoaded && // Wait for messages to load before checking
    !!conversationId &&
    conversationId !== Constants.NEW_CONVO &&
    (hasServerActiveJobForThisConvo || !!hasActiveSubmissionForThisConvo) &&
    processedConvoRef.current !== conversationId; // Don't re-check processed convos

  const {
    data: streamStatus,
    isSuccess,
    isFetching,
  } = useStreamStatus(conversationId, shouldCheck);

  useEffect(() => {
    console.log('[ResumeOnLoad] Effect check', {
      resumableEnabled,
      conversationId,
      messagesLoaded,
      hasCurrentSubmission: !!currentSubmission,
      currentSubmissionConvoId: currentSubmission?.conversation?.conversationId,
      activeJobsLoaded,
      hasServerActiveJobForThisConvo,
      isSuccess,
      isFetching,
      streamStatusActive: streamStatus?.active,
      streamStatusStatus: streamStatus?.status,
      streamStatusStreamId: streamStatus?.streamId,
      processedConvoRef: processedConvoRef.current,
    });

    if (!resumableEnabled || !conversationId || conversationId === Constants.NEW_CONVO) {
      console.log('[ResumeOnLoad] Skipping - not enabled or new convo');
      return;
    }

    // Wait for messages to load to avoid race condition where sync overwrites then DB overwrites
    if (!messagesLoaded) {
      console.log('[ResumeOnLoad] Waiting for messages to load');
      return;
    }

    if (!activeJobsLoaded && !hasActiveSubmissionForThisConvo) {
      console.log('[ResumeOnLoad] Waiting for active jobs query');
      return;
    }

    // If there's a stale submission for a different conversation, log it but continue
    if (currentSubmission && submissionConvoId !== conversationId) {
      console.log(
        '[ResumeOnLoad] Found stale submission for different conversation, will check for resume',
        {
          staleConvoId: submissionConvoId,
          currentConvoId: conversationId,
        },
      );
    }

    if (!hasServerActiveJobForThisConvo && !hasActiveSubmissionForThisConvo) {
      console.log('[ResumeOnLoad] Conversation is not locally or remotely active');
      processedConvoRef.current = conversationId;
      return;
    }

    // Wait for stream status query to complete (including background refetches
    // that may replace a stale cached result with fresh data)
    if (!isSuccess || !streamStatus || isFetching) {
      console.log('[ResumeOnLoad] Waiting for stream status query');
      return;
    }

    // Don't process the same conversation twice
    if (processedConvoRef.current === conversationId) {
      console.log('[ResumeOnLoad] Skipping - already processed this conversation');
      return;
    }

    if (
      !streamStatus.active ||
      !streamStatus.streamId ||
      (streamStatus.status != null && streamStatus.status !== 'running')
    ) {
      if (hasActiveSubmissionForThisConvo) {
        console.log('[ResumeOnLoad] Clearing stale local submission for inactive conversation', {
          conversationId,
          submissionConvoId,
          status: streamStatus.status,
        });
        setSubmission(null);
        setIsSubmitting(false);
        setShowStopButton(false);
      }
      console.log('[ResumeOnLoad] No active job to resume for:', conversationId);
      processedConvoRef.current = conversationId;
      return;
    }

    if (hasActiveSubmissionForThisConvo) {
      console.log('[ResumeOnLoad] Active job already represented locally');
      processedConvoRef.current = conversationId;
      return;
    }

    processedConvoRef.current = conversationId;

    console.log('[ResumeOnLoad] Found active job, creating submission...', {
      streamId: streamStatus.streamId,
      status: streamStatus.status,
      resumeState: streamStatus.resumeState,
    });

    const messages = getMessages() || [];

    // Build submission from resume state if available
    if (streamStatus.resumeState) {
      const submission = buildSubmissionFromResumeState(
        streamStatus.resumeState,
        streamStatus.streamId,
        messages,
        conversationId,
        currentConversation,
        streamStatus.createdAt,
      );
      setSubmission(submission);
    } else {
      // Minimal submission without resume state
      const lastUserMessage = [...messages].reverse().find((m) => m.isCreatedByUser);
      const submission = {
        messages,
        userMessage:
          lastUserMessage ?? ({ messageId: 'resume', conversationId, text: '' } as TMessage),
        initialResponse: {
          messageId: 'resume_',
          conversationId,
          text: '',
          content: streamStatus.aggregatedContent ?? [{ type: 'text', text: '' }],
          unfinished: true,
          metadata: streamStatus.createdAt
            ? { sansuoProcessTiming: { startedAt: new Date(streamStatus.createdAt).toISOString() } }
            : undefined,
        } as TMessage,
        conversation: {
          ...(currentConversation ?? {}),
          conversationId,
          title: currentConversation?.title ?? 'Resumed Chat',
          endpoint: currentConversation?.endpoint ?? null,
        } as TConversation,
        isRegenerate: false,
        isTemporary: false,
        endpointOption: {},
        // Signal to useResumableSSE to subscribe to existing stream instead of starting new
        resumeStreamId: streamStatus.streamId,
      } as TSubmission & { resumeStreamId: string };
      setSubmission(submission);
    }
  }, [
    conversationId,
    resumableEnabled,
    messagesLoaded,
    hasActiveSubmissionForThisConvo,
    hasServerActiveJobForThisConvo,
    activeJobsLoaded,
    submissionConvoId,
    currentSubmission,
    currentConversation,
    isSuccess,
    isFetching,
    streamStatus,
    getMessages,
    setSubmission,
    setIsSubmitting,
    setShowStopButton,
  ]);

  // Reset processedConvoRef when conversation changes to allow re-checking
  useEffect(() => {
    // Always reset when conversation changes - this allows resuming when navigating back
    if (conversationId !== processedConvoRef.current) {
      console.log('[ResumeOnLoad] Resetting processedConvoRef for new conversation:', {
        old: processedConvoRef.current,
        new: conversationId,
      });
      processedConvoRef.current = null;
    }
  }, [conversationId]);
}
