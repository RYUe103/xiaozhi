import { useEffect, useRef } from 'react';
import { v4 } from 'uuid';
import { cloneDeep } from 'lodash';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSetRecoilState, useResetRecoilState, useRecoilValue, useRecoilCallback } from 'recoil';
import {
  Constants,
  QueryKeys,
  ContentTypes,
  ToolCallTypes,
  EModelEndpoint,
  getEndpointField,
  isAgentsEndpoint,
  parseCompactConvo,
  replaceSpecialVars,
  isAssistantsEndpoint,
  getDefaultParamsEndpoint,
} from 'librechat-data-provider';
import type {
  TMessage,
  TSubmission,
  TConversation,
  TStartupConfig,
  TEndpointOption,
  TEndpointsConfig,
  EndpointSchemaKey,
} from 'librechat-data-provider';
import type { SetterOrUpdater } from 'recoil';
import type { TAskFunction, ExtendedFile } from '~/common';
import useSetFilesToDelete from '~/hooks/Files/useSetFilesToDelete';
import useGetSender from '~/hooks/Conversations/useGetSender';
import { logger, createDualMessageContent } from '~/utils';
import store, { useGetEphemeralAgent } from '~/store';
import { startupConfigKey } from '~/data-provider';
import { routeSanSuoTools } from '~/utils/sansuoToolRouter';
import useUserKey from '~/hooks/Input/useUserKey';
import { useAuthContext } from '~/hooks';
import { buildRapidAskKey, shouldBlockRapidAsk } from './askDedup';
import {
  getSanSuoKnowledgeAgentId,
  getSanSuoIndustryMaterialIds,
  getSanSuoMode,
  isSanSuoPreparseFile,
  SANSUO_KNOWLEDGE_SEARCH_TOOL,
} from '~/utils/sansuoMode';

const logChatRequest = (request: Record<string, unknown>) => {
  logger.log('=====================================\nAsk function called with:');
  logger.dir(request);
  logger.log('=====================================');
};

const isSameConversationMessage = (
  message: TMessage | null | undefined,
  conversationId: string | null,
) => {
  if (!message?.messageId) {
    return false;
  }
  if (!conversationId || conversationId === Constants.NEW_CONVO) {
    return true;
  }
  return !message.conversationId || message.conversationId === conversationId;
};

const findLatestAssistantMessage = (
  messages: TMessage[] | null | undefined,
  conversationId: string | null,
) => {
  const safeMessages = Array.isArray(messages) ? messages : [];
  for (let index = safeMessages.length - 1; index >= 0; index--) {
    const message = safeMessages[index];
    if (
      message &&
      !message.isCreatedByUser &&
      !message.error &&
      isSameConversationMessage(message, conversationId)
    ) {
      return message;
    }
  }
  return null;
};

export default function useChatFunctions({
  index = 0,
  files,
  setFiles,
  getMessages,
  setMessages,
  isSubmitting,
  latestMessage,
  setSubmission,
  setLatestMessage,
  conversation: immutableConversation,
}: {
  index?: number;
  isSubmitting: boolean;
  paramId?: string | undefined;
  conversation: TConversation | null;
  latestMessage: TMessage | null;
  getMessages: () => TMessage[] | undefined;
  setMessages: (messages: TMessage[]) => void;
  files?: Map<string, ExtendedFile>;
  setFiles?: SetterOrUpdater<Map<string, ExtendedFile>>;
  setSubmission: SetterOrUpdater<TSubmission | null>;
  setLatestMessage?: SetterOrUpdater<TMessage | null>;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const getSender = useGetSender();
  const { user } = useAuthContext();
  const queryClient = useQueryClient();
  const setFilesToDelete = useSetFilesToDelete();
  const getEphemeralAgent = useGetEphemeralAgent();
  const isTemporary = useRecoilValue(store.isTemporary);
  const { getExpiry } = useUserKey(immutableConversation?.endpoint ?? '');
  const setIsSubmitting = useSetRecoilState(store.isSubmittingFamily(index));
  const setShowStopButton = useSetRecoilState(store.showStopButtonByIndex(index));
  const resetLatestMultiMessage = useResetRecoilState(store.latestMessageFamily(index + 1));
  const localSubmitLockRef = useRef(false);

  useEffect(() => {
    if (!isSubmitting) {
      localSubmitLockRef.current = false;
    }
  }, [isSubmitting]);

  /**
   * Atomically read + reset the per-conversation queue of manually-invoked
   * skills from the `$` popover. Reading and resetting in a single Recoil
   * snapshot guarantees that if the user selects more skills between here and
   * the next submission, their picks are never silently lost into a reset atom.
   *
   * The `hasValue` guard is defensive: this atom has a synchronous default of
   * `[]` so `.contents` is always the resolved value in practice, but reading
   * `.contents` on a loading/errored loadable yields a Promise/Error, which
   * would make the `string[]` cast unsound.
   */
  const drainPendingManualSkills = useRecoilCallback(
    ({ snapshot, reset }) =>
      (convoId: string): string[] => {
        const loadable = snapshot.getLoadable(store.pendingManualSkillsByConvoId(convoId));
        const skills = loadable.state === 'hasValue' ? (loadable.contents as string[]) : [];
        if (skills.length > 0) {
          reset(store.pendingManualSkillsByConvoId(convoId));
        }
        return skills;
      },
    [],
  );

  const ask: TAskFunction = (
    {
      text,
      overrideConvoId,
      overrideUserMessageId,
      parentMessageId = null,
      conversationId = null,
      messageId = null,
    },
    {
      editedContent = null,
      editedMessageId = null,
      isRegenerate = false,
      isContinued = false,
      isEdited = false,
      overrideMessages,
      overrideFiles,
      overrideManualSkills,
      addedConvo,
      suppressNavigation = false,
    } = {},
  ) => {
    setShowStopButton(false);
    resetLatestMultiMessage();

    text = text.trim();
    if (!!isSubmitting || text === '') {
      return;
    }

    const conversation = cloneDeep(immutableConversation);

    const endpoint = conversation?.endpoint;
    if (endpoint === null) {
      console.error('No endpoint available');
      return;
    }

    conversationId = conversationId ?? conversation?.conversationId ?? null;
    if (conversationId == 'search') {
      console.error('cannot send any message under search view!');
      return;
    }

    let currentMessages: TMessage[] | null = overrideMessages ?? getMessages() ?? [];
    const latestMessageForConversation = isSameConversationMessage(latestMessage, conversationId)
      ? latestMessage
      : null;
    const fallbackLatestMessage =
      latestMessageForConversation ?? findLatestAssistantMessage(currentMessages, conversationId);
    const effectiveLatestMessage = latestMessageForConversation ?? fallbackLatestMessage;

    if (isContinued && !effectiveLatestMessage) {
      console.error('cannot continue AI message without latestMessage!');
      return;
    }

    const effectiveConversationId = conversationId ?? Constants.NEW_CONVO;
    const effectiveParentMessageId =
      parentMessageId ?? effectiveLatestMessage?.messageId ?? Constants.NO_PARENT;
    const rapidAskKey = buildRapidAskKey({
      index,
      conversationId: effectiveConversationId,
      editedMessageId,
      isContinued,
      isEdited,
      isRegenerate,
      parentMessageId: effectiveParentMessageId,
      text,
    });

    if (rapidAskKey && shouldBlockRapidAsk(rapidAskKey)) {
      logger.log('message_stream', 'Blocked rapid duplicate ask', {
        conversationId: effectiveConversationId,
        parentMessageId: effectiveParentMessageId,
        text,
        isRegenerate,
        isContinued,
        isEdited,
      });
      return;
    }

    if (!isRegenerate && !isContinued && !isEdited) {
      if (localSubmitLockRef.current) {
        logger.log(
          'message_stream',
          'Blocked local duplicate ask before submitting state settled',
          {
            conversationId: effectiveConversationId,
            parentMessageId: effectiveParentMessageId,
            text,
          },
        );
        return;
      }
      localSubmitLockRef.current = true;
    }

    const ephemeralAgent = getEphemeralAgent(conversationId ?? Constants.NEW_CONVO);
    /**
     * Manual skill selection resolution:
     *  - Explicit `overrideManualSkills` wins (regenerate / save-and-submit
     *    pass the original user message's persisted `manualSkills` so the
     *    resubmitted turn primes the same skills — the pills are still
     *    visible to the user, it would be strange to quietly drop them).
     *  - Regenerate / continue / edit without an override → empty, and the
     *    compose-time atom is deliberately NOT drained (those flows replay
     *    a prior turn, not compose a new one).
     *  - Fresh submit → drain the per-convo atom into the message.
     */
    let manualSkills: string[];
    if (overrideManualSkills != null) {
      manualSkills = overrideManualSkills;
    } else if (isRegenerate || isContinued || isEdited) {
      manualSkills = [];
    } else {
      manualSkills = drainPendingManualSkills(conversationId ?? Constants.NEW_CONVO);
    }
    const isEditOrContinue = isEdited || isContinued;

    if (conversation?.promptPrefix) {
      conversation.promptPrefix = replaceSpecialVars({
        text: conversation.promptPrefix,
        user,
      });
    }

    // construct the query message
    // this is not a real messageId, it is used as placeholder before real messageId returned
    const intermediateId = overrideUserMessageId ?? v4();
    parentMessageId = effectiveParentMessageId;

    logChatRequest({
      index,
      conversation,
      latestMessage,
      conversationId,
      intermediateId,
      parentMessageId,
      effectiveLatestMessage,
      currentMessages,
    });

    if (conversationId == Constants.NEW_CONVO) {
      parentMessageId = Constants.NO_PARENT;
      currentMessages = [];
      if (!suppressNavigation) {
        navigate(`/c/new${location.search ?? ''}`, { state: { focusChat: true } });
      }
    }

    const targetParentMessageId = isRegenerate
      ? messageId
      : effectiveLatestMessage?.parentMessageId;
    /**
     * If the user regenerated or resubmitted the message, the current parent is technically
     * the latest user message, which is passed into `ask`; otherwise, we can rely on the
     * latestMessage to find the parent.
     */
    const targetParentMessage = currentMessages.find(
      (msg) => msg.messageId === targetParentMessageId,
    );

    let thread_id = targetParentMessage?.thread_id ?? effectiveLatestMessage?.thread_id;
    if (thread_id == null) {
      thread_id = currentMessages.find((message) => message.thread_id)?.thread_id;
    }

    const endpointsConfig = queryClient.getQueryData<TEndpointsConfig>([QueryKeys.endpoints]);
    const startupConfig = queryClient.getQueryData<TStartupConfig>(startupConfigKey(true));
    const endpointType = getEndpointField(endpointsConfig, endpoint, 'type');
    const iconURL = conversation?.iconURL;
    const defaultParamsEndpoint = getDefaultParamsEndpoint(endpointsConfig, endpoint);

    /** This becomes part of the `endpointOption` */
    const convo = parseCompactConvo({
      endpoint: endpoint as EndpointSchemaKey,
      endpointType: endpointType as EndpointSchemaKey,
      conversation: conversation ?? {},
      defaultParamsEndpoint,
    });

    const { modelDisplayLabel } = endpointsConfig?.[endpoint ?? ''] ?? {};
    const endpointOption = Object.assign(
      {
        endpoint,
        endpointType,
        overrideConvoId,
        overrideUserMessageId,
      },
      convo,
    ) as TEndpointOption;
    const isSanSuoMain = String(endpoint) === 'SanSuoMain';
    const sansuoMode = isSanSuoMain ? getSanSuoMode() : null;
    const knowledgeAgentId = isSanSuoMain ? getSanSuoKnowledgeAgentId() : '';
    const industryMaterialIds = isSanSuoMain ? getSanSuoIndustryMaterialIds(conversationId) : [];
    const clientRequestId = v4();
    if (isSanSuoMain) {
      Object.assign(endpointOption, {
        sansuoMode,
        knowledgeAgentId: knowledgeAgentId || undefined,
        industryMaterialIds: industryMaterialIds.length ? industryMaterialIds : undefined,
      });
    }
    if (endpoint !== EModelEndpoint.agents) {
      endpointOption.key = getExpiry();
      endpointOption.thread_id = thread_id;
      endpointOption.modelDisplayLabel = modelDisplayLabel;
    } else {
      endpointOption.key = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    }
    const responseSender = getSender({ model: conversation?.model, ...endpointOption });

    const currentMsg: TMessage = {
      text,
      sender: 'User',
      clientTimestamp: new Date().toLocaleString('sv').replace(' ', 'T'),
      isCreatedByUser: true,
      parentMessageId,
      conversationId,
      messageId: isContinued && messageId != null && messageId ? messageId : intermediateId,
      thread_id,
      error: false,
      /**
       * UI-only metadata. Survives reload because the backend persists the
       * field on the message schema, and `SkillPills` reads straight
       * off the message so there's no Recoil state to clean up. Runtime
       * skill resolution reads the top-level `manualSkills` payload field.
       */
      manualSkills: manualSkills.length > 0 ? manualSkills : undefined,
      metadata:
        sansuoMode === 'knowledge' || industryMaterialIds.length > 0
          ? {
              sansuoMode,
              sansuoKnowledge: industryMaterialIds.length
                ? { sourceType: 'industry_materials' }
                : { agentId: knowledgeAgentId },
              ...(industryMaterialIds.length
                ? { sansuoIndustryMaterialIds: industryMaterialIds }
                : {}),
              sansuoClientRequestId: clientRequestId,
            }
          : { sansuoClientRequestId: clientRequestId },
    };

    const submissionFiles = overrideFiles ?? targetParentMessage?.files;
    const reuseFiles =
      (isRegenerate || (overrideFiles != null && overrideFiles.length)) &&
      submissionFiles &&
      submissionFiles.length > 0;

    if (setFiles && reuseFiles === true) {
      currentMsg.files = [...submissionFiles];
      setFiles(new Map());
      setFilesToDelete({});
    } else if (setFiles && files && files.size > 0) {
      currentMsg.files = Array.from(files.values()).map((file) => ({
        file_id: file.file_id,
        filepath: file.filepath,
        type: file.type ?? '', // Ensure type is not undefined
        height: file.height,
        width: file.width,
      }));
      setFiles(new Map());
      setFilesToDelete({});
    }

    const hasDocumentPreparse =
      sansuoMode === 'deep' && (currentMsg.files ?? []).some(isSanSuoPreparseFile);
    if (hasDocumentPreparse) {
      currentMsg.metadata = {
        ...(currentMsg.metadata || {}),
        sansuoMode: 'deep',
        sansuoFileParse: { status: 'parsing' },
      };
    }

    const sanSuoToolRoute =
      String(endpoint) === 'SanSuoMain' ? routeSanSuoTools(text, currentMsg.files ?? []) : null;
    const effectiveEphemeralAgent = sanSuoToolRoute
      ? {
          ...ephemeralAgent,
          // Only deep mode may expose execution. Its full server route decides
          // whether the current turn must force a tool call.
          execute_code: sansuoMode === 'deep',
        }
      : ephemeralAgent;
    if (sanSuoToolRoute) {
      logger.log('sansuo_tool_route', sanSuoToolRoute);
    }

    const responseMessageId =
      editedMessageId ??
      (effectiveLatestMessage?.messageId && isRegenerate
        ? effectiveLatestMessage.messageId.replace(/_+$/, '') + '_'
        : null) ??
      null;
    const initialResponseId =
      responseMessageId ?? `${isRegenerate ? messageId : intermediateId}`.replace(/_+$/, '') + '_';

    const initialResponse: TMessage = {
      sender: responseSender,
      text: '',
      endpoint: endpoint ?? '',
      parentMessageId: isRegenerate ? messageId : intermediateId,
      messageId: initialResponseId,
      thread_id,
      conversationId,
      unfinished: true,
      isCreatedByUser: false,
      model: convo?.model,
      error: false,
      iconURL,
      /**
       * Seed the assistant placeholder with the turn's manually-invoked
       * skill names so `ContentParts` can render interim `SkillCall` cards
       * from the very first render — no round-trip through the `created`
       * SSE event required. Rides along with every subsequent spread
       * (`useStepHandler` response construction, `updateContent` result
       * spreads) and drops out naturally at `finalHandler` when the
       * server-backed `responseMessage` replacement takes over.
       */
      manualSkills: manualSkills.length > 0 ? manualSkills : undefined,
      metadata:
        sansuoMode === 'knowledge' || industryMaterialIds.length > 0
          ? {
              sansuoMode,
              sansuoKnowledge: industryMaterialIds.length
                ? { sourceType: 'industry_materials' }
                : { agentId: knowledgeAgentId, status: 'searching' },
              ...(industryMaterialIds.length
                ? { sansuoIndustryMaterialIds: industryMaterialIds }
                : {}),
              sansuoClientRequestId: clientRequestId,
            }
          : hasDocumentPreparse
            ? {
                sansuoMode: 'deep',
                sansuoFileParse: { status: 'parsing' },
                sansuoClientRequestId: clientRequestId,
              }
            : { sansuoClientRequestId: clientRequestId },
    };

    initialResponse.metadata = {
      ...initialResponse.metadata,
      sansuoProcessTiming: { startedAt: new Date().toISOString() },
    };

    if (isAssistantsEndpoint(endpoint)) {
      initialResponse.model = conversation?.assistant_id ?? '';
      initialResponse.text = '';
      initialResponse.content = [
        {
          type: ContentTypes.TEXT,
          [ContentTypes.TEXT]: {
            value: '',
          },
        },
      ];
    } else if (endpoint != null) {
      initialResponse.model = isAgentsEndpoint(endpoint)
        ? (conversation?.agent_id ?? '')
        : (conversation?.model ?? '');
      initialResponse.text = '';

      if (editedContent && effectiveLatestMessage?.content) {
        initialResponse.content = cloneDeep(effectiveLatestMessage.content);
        const { index, type, ...part } = editedContent;
        if (initialResponse.content && index >= 0 && index < initialResponse.content.length) {
          const contentPart = initialResponse.content[index];
          if (type === ContentTypes.THINK && contentPart.type === ContentTypes.THINK) {
            contentPart[ContentTypes.THINK] = part[ContentTypes.THINK];
          } else if (type === ContentTypes.TEXT && contentPart.type === ContentTypes.TEXT) {
            contentPart[ContentTypes.TEXT] = part[ContentTypes.TEXT];
          }
        }
      } else if (addedConvo && conversation) {
        // Pre-populate placeholders for smooth UI - these will be overridden/extended
        // as SSE events arrive with actual content, preserving the agent-based agentId
        initialResponse.content = createDualMessageContent(
          conversation,
          addedConvo,
          endpointsConfig,
          startupConfig?.modelSpecs?.list,
        );
      } else {
        initialResponse.content =
          sansuoMode === 'knowledge' && industryMaterialIds.length === 0
            ? [
                {
                  type: ContentTypes.TOOL_CALL,
                  [ContentTypes.TOOL_CALL]: {
                    id: `knowledge-search-${initialResponseId}`,
                    name: SANSUO_KNOWLEDGE_SEARCH_TOOL,
                    args: '{}',
                    type: ToolCallTypes.TOOL_CALL,
                    progress: 0.1,
                    status: 'searching',
                  },
                },
              ]
            : [];
      }
      setIsSubmitting(true);
      setShowStopButton(true);
    }

    if (isContinued) {
      currentMessages = currentMessages.filter((msg) => msg.messageId !== responseMessageId);
    }

    logger.log('message_state', initialResponse);
    const submission = {
      clientRequestId,
      conversation: {
        ...conversation,
        conversationId,
      },
      endpointOption,
      userMessage: {
        ...currentMsg,
        responseMessageId,
        overrideParentMessageId: isRegenerate ? messageId : null,
      },
      messages: currentMessages,
      isEdited: isEditOrContinue,
      isContinued,
      isRegenerate,
      initialResponse,
      isTemporary,
      ephemeralAgent: effectiveEphemeralAgent,
      editedContent,
      addedConvo,
      suppressNavigation,
      manualSkills: manualSkills.length > 0 ? manualSkills : undefined,
    } as TSubmission & { suppressNavigation?: boolean };

    if (isRegenerate) {
      setMessages([...submission.messages, initialResponse]);
    } else {
      setMessages([...submission.messages, currentMsg, initialResponse]);
    }
    if (index === 0 && setLatestMessage) {
      setLatestMessage(initialResponse);
    }

    setSubmission(submission as TSubmission);
    logger.dir('message_stream', submission, { depth: null });
  };

  const regenerate = ({ parentMessageId }, options?: { addedConvo?: TConversation | null }) => {
    const messages = getMessages();
    const parentMessage = messages?.find((element) => element.messageId == parentMessageId);

    if (parentMessage && parentMessage.isCreatedByUser) {
      ask(
        { ...parentMessage },
        {
          isRegenerate: true,
          addedConvo: options?.addedConvo ?? undefined,
          /** Carry the original user message's manual skill picks forward
           *  so the regenerated response is primed with the same skills.
           *  The compose-time atom was drained on the first submit; without
           *  this the model sees an unprimed turn even though the pills
           *  still show on the user bubble. */
          overrideManualSkills: parentMessage.manualSkills,
        },
      );
    } else {
      console.error(
        'Failed to regenerate the message: parentMessage not found or not created by user.',
      );
    }
  };

  return {
    ask,
    regenerate,
  };
}
