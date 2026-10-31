import type { TFile } from './types/files';
import type { TMessage } from './types';

export type ParentMessage = TMessage & { children: TMessage[]; depth: number };
export function buildTree({
  messages,
  fileMap,
}: {
  messages: (TMessage | undefined)[] | null;
  fileMap?: Record<string, TFile>;
}) {
  if (messages === null) {
    return null;
  }

  const messageMap: Record<string, ParentMessage> = {};
  const rootMessages: TMessage[] = [];
  const childrenCount: Record<string, number> = {};

  // Build every node before linking the tree. Persisted messages can be returned
  // out of parent-first order when a streamed response receives its timestamp
  // before the user message finishes file preprocessing and is saved.
  messages.forEach((message) => {
    if (!message) {
      return;
    }
    const parentId = message.parentMessageId ?? '';
    childrenCount[parentId] = (childrenCount[parentId] || 0) + 1;

    const extendedMessage: ParentMessage = {
      ...message,
      children: [],
      depth: 0,
      siblingIndex: childrenCount[parentId] - 1,
    };

    if (message.files && fileMap) {
      extendedMessage.files = message.files.map((file) => fileMap[file.file_id ?? ''] ?? file);
    }

    messageMap[message.messageId] = extendedMessage;
  });

  messages.forEach((message) => {
    if (!message) {
      return;
    }
    const extendedMessage = messageMap[message.messageId];
    const parentId = message.parentMessageId ?? '';
    const parentMessage = messageMap[parentId];
    if (parentMessage && parentMessage !== extendedMessage) {
      parentMessage.children.push(extendedMessage);
    } else {
      rootMessages.push(extendedMessage);
    }
  });

  const setDepth = (message: ParentMessage, depth: number, path: Set<string>) => {
    message.depth = depth;
    if (path.has(message.messageId)) {
      return;
    }
    const nextPath = new Set(path).add(message.messageId);
    message.children.forEach((child) => setDepth(child as ParentMessage, depth + 1, nextPath));
  };
  rootMessages.forEach((message) => setDepth(message as ParentMessage, 0, new Set()));

  return rootMessages;
}
