import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Constants } from 'librechat-data-provider';
import { ArrowUp } from 'lucide-react';
import { useChatContext } from '~/Providers';
import { cn } from '~/utils';
import { queuePendingFolderAssignment } from '~/components/Conversations/sansuoFolders';
import AttachFileChat from './Input/Files/AttachFileChat';
import FileFormChat from './Input/Files/FileFormChat';

type ProjectChatComposerProps = {
  folderId: string;
  placeholder?: string;
};

const ProjectChatComposer = memo(function ProjectChatComposer({
  folderId,
  placeholder = '在此文件夹中新建聊天',
}: ProjectChatComposerProps) {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const { ask, files, setFiles, conversation, isSubmitting, filesLoading, setFilesLoading } =
    useChatContext();
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const composerConversation = useMemo(
    () =>
      conversation
        ? {
            ...conversation,
            conversationId: Constants.NEW_CONVO as string,
          }
        : conversation,
    [conversation],
  );

  const submit = useCallback(() => {
    if (!trimmed || isSubmitting) {
      return;
    }

    queuePendingFolderAssignment(folderId);
    ask(
      {
        text: trimmed,
        conversationId: Constants.NEW_CONVO as string,
      },
      {
        suppressNavigation: true,
      },
    );
    setText('');
    requestAnimationFrame(() => textAreaRef.current?.focus());
  }, [ask, folderId, isSubmitting, trimmed]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className="bg-surface-chat/95 mx-auto w-full max-w-3xl rounded-[26px] px-4 py-3 text-text-primary shadow-sm transition focus-within:shadow-[0_8px_28px_rgba(0,0,0,0.10)]">
      <FileFormChat
        conversation={composerConversation}
        files={files}
        setFiles={setFiles}
        setFilesLoading={setFilesLoading}
      />
      <textarea
        ref={textAreaRef}
        value={text}
        rows={1}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isSubmitting}
        placeholder={placeholder}
        className="max-h-40 min-h-11 w-full resize-none appearance-none border-0 bg-transparent px-1 py-2 text-[16px] leading-6 outline-none ring-0 placeholder:text-text-secondary focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="flex items-center gap-2 pt-1">
        <AttachFileChat
          conversation={composerConversation}
          disableInputs={isSubmitting}
          files={files}
          setFiles={setFiles}
          setFilesLoading={setFilesLoading}
        />
        <div className="flex-1" />
        <button
          type="button"
          onClick={submit}
          disabled={!trimmed || isSubmitting || filesLoading}
          className={cn(
            'grid h-9 w-9 place-items-center rounded-full transition',
            trimmed && !isSubmitting
              ? 'bg-text-primary text-white hover:opacity-90'
              : 'bg-surface-active-alt text-text-secondary opacity-60',
          )}
          aria-label="发送消息"
        >
          <ArrowUp className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});

export default ProjectChatComposer;
