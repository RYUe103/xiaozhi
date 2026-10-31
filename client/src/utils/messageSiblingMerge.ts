import type { TMessage } from 'librechat-data-provider';

type MessagePart = NonNullable<TMessage['content']>[number];

const getPartKeys = (content: TMessage['content'] = []): Array<[string, MessagePart]> => {
  const typeCounts = new Map<string, number>();
  return content.filter(Boolean).map((part) => {
    const type = part.type ?? 'unknown';
    const toolId =
      type === 'tool_call' && 'tool_call' in part ? String(part.tool_call?.id ?? '') : '';
    const identity = toolId || `${type}:${typeCounts.get(type) ?? 0}`;
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    return [`${type}:${identity}`, part];
  });
};

export const mergeStreamedMessageIntoFinal = (
  current: TMessage | undefined,
  incoming: TMessage,
): TMessage => {
  if (!current || current.isCreatedByUser || incoming.isCreatedByUser) {
    return incoming;
  }

  const currentEntries = getPartKeys(current.content);
  const incomingEntries = getPartKeys(incoming.content);
  if (currentEntries.length === 0) {
    return { ...incoming, metadata: { ...current.metadata, ...incoming.metadata } };
  }
  if (incomingEntries.length === 0) {
    return {
      ...incoming,
      content: current.content,
      text: incoming.text || current.text,
      metadata: { ...(current.metadata ?? {}), ...(incoming.metadata ?? {}) },
    };
  }

  const incomingByKey = new Map(incomingEntries);
  const mergedEntries = currentEntries.map(([key, part]) => [
    key,
    incomingByKey.get(key) ?? part,
  ]) as Array<[string, MessagePart]>;
  const mergedKeys = new Set(mergedEntries.map(([key]) => key));

  for (let index = 0; index < incomingEntries.length; index++) {
    const entry = incomingEntries[index];
    if (mergedKeys.has(entry[0])) {
      continue;
    }
    const nextKnownKey = incomingEntries
      .slice(index + 1)
      .map(([key]) => key)
      .find((key) => mergedKeys.has(key));
    const insertAt = nextKnownKey
      ? mergedEntries.findIndex(([key]) => key === nextKnownKey)
      : mergedEntries.length;
    mergedEntries.splice(insertAt, 0, entry);
    mergedKeys.add(entry[0]);
  }

  return {
    ...incoming,
    content: mergedEntries.map(([, part]) => part),
    text: incoming.text || current.text,
    metadata: { ...(current.metadata ?? {}), ...(incoming.metadata ?? {}) },
    files: incoming.files ?? current.files,
  };
};

const getClientRequestId = (message: TMessage): string => {
  const metadata = message.metadata as { sansuoClientRequestId?: unknown } | undefined;
  return typeof metadata?.sansuoClientRequestId === 'string' ? metadata.sansuoClientRequestId : '';
};

const mergeChildren = (current: TMessage, candidate: TMessage): TMessage[] | undefined => {
  const children = [...(current.children ?? []), ...(candidate.children ?? [])];
  if (children.length === 0) {
    return undefined;
  }
  const seen = new Set<string>();
  return children.filter((child) => {
    const key = child.messageId ?? JSON.stringify(child);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const preferCanonicalMessage = (current: TMessage, candidate: TMessage): TMessage => {
  let preferred: TMessage;
  if (current.unfinished && !candidate.unfinished) {
    preferred = candidate;
  } else if (!current.unfinished && candidate.unfinished) {
    preferred = current;
  } else {
    const currentParts = current.content?.filter(Boolean).length ?? 0;
    const candidateParts = candidate.content?.filter(Boolean).length ?? 0;
    if (candidateParts !== currentParts) {
      preferred = candidateParts > currentParts ? candidate : current;
    } else {
      preferred =
        (candidate.text?.length ?? 0) >= (current.text?.length ?? 0) ? candidate : current;
    }
  }

  const children = mergeChildren(current, candidate);
  return children ? { ...preferred, children } : preferred;
};

export const collapseTransientMessageSiblings = (messagesTree: TMessage[]): TMessage[] => {
  if (messagesTree.length < 2) {
    return messagesTree;
  }
  const result: TMessage[] = [];
  const requestIndexes = new Map<string, number>();
  const duplicateIndexes = new Map<string, number>();
  const userTurnIndexes = new Map<string, number>();
  for (const candidate of messagesTree) {
    const clientRequestId = getClientRequestId(candidate);
    const role = candidate.isCreatedByUser ? 'user' : 'assistant';
    if (clientRequestId) {
      const requestKey = `${role}:${clientRequestId}`;
      const requestIndex = requestIndexes.get(requestKey);
      if (requestIndex !== undefined) {
        result[requestIndex] = preferCanonicalMessage(result[requestIndex], candidate);
        continue;
      }
    }

    if (candidate.isCreatedByUser) {
      const userTurnKey = `${candidate.parentMessageId ?? ''}:${candidate.text ?? ''}`;
      const userTurnIndex = userTurnIndexes.get(userTurnKey);
      if (userTurnIndex !== undefined) {
        const existing = result[userTurnIndex];
        const existingHasAnswer = (existing.children?.length ?? 0) > 0;
        const candidateHasAnswer = (candidate.children?.length ?? 0) > 0;
        if (!existingHasAnswer || !candidateHasAnswer) {
          result[userTurnIndex] = preferCanonicalMessage(existing, candidate);
          if (clientRequestId) {
            requestIndexes.set(`${role}:${clientRequestId}`, userTurnIndex);
          }
          continue;
        }
      }
    }

    const signature = JSON.stringify({
      parentMessageId: candidate.parentMessageId,
      sender: candidate.sender,
      isCreatedByUser: candidate.isCreatedByUser,
      text: candidate.text,
      content: candidate.content,
      attachments: candidate.attachments,
      files: candidate.files,
    });
    const existingIndex = duplicateIndexes.get(signature);
    if (existingIndex !== undefined) {
      const existing = result[existingIndex];
      const existingRequestId = getClientRequestId(existing);
      const hasConflictingRequestIds =
        existingRequestId && clientRequestId && existingRequestId !== clientRequestId;
      if (
        !hasConflictingRequestIds &&
        (existingRequestId || clientRequestId || existing.unfinished || candidate.unfinished)
      ) {
        result[existingIndex] = preferCanonicalMessage(existing, candidate);
        if (clientRequestId) {
          requestIndexes.set(`${role}:${clientRequestId}`, existingIndex);
        }
        continue;
      }
    }

    const nextIndex = result.length;
    result.push(candidate);
    duplicateIndexes.set(signature, nextIndex);
    if (clientRequestId) {
      requestIndexes.set(`${role}:${clientRequestId}`, nextIndex);
    }
    if (candidate.isCreatedByUser) {
      userTurnIndexes.set(`${candidate.parentMessageId ?? ''}:${candidate.text ?? ''}`, nextIndex);
    }
  }
  return result;
};

export const getMessageRenderRevision = (message: TMessage): string => {
  const lastPart = message.content?.[message.content.length - 1] as
    | {
        type?: string;
        text?: string;
        think?: string;
        tool_call?: { id?: string; status?: string; output?: unknown };
      }
    | undefined;
  const metadata = message.metadata as
    | {
        sansuoFileParse?: { status?: unknown };
        sansuoKnowledge?: { status?: unknown; unavailable?: unknown };
      }
    | undefined;
  const toolOutputSize =
    typeof lastPart?.tool_call?.output === 'string' ? lastPart.tool_call.output.length : 0;
  return [
    message.messageId ?? '',
    message.text?.length ?? 0,
    message.content?.length ?? 0,
    lastPart?.type ?? '',
    lastPart?.text?.length ?? 0,
    lastPart?.think?.length ?? 0,
    lastPart?.tool_call?.id ?? '',
    lastPart?.tool_call?.status ?? '',
    toolOutputSize,
    metadata?.sansuoFileParse?.status ?? '',
    metadata?.sansuoKnowledge?.status ?? '',
    metadata?.sansuoKnowledge?.unavailable === true ? 1 : 0,
    message.files?.length ?? 0,
    message.attachments?.length ?? 0,
  ].join(':');
};
