import type { ReactNode } from 'react';
import { Constants, QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { TooltipAnchor, Button, NewChatIcon } from '@librechat/client';
import { useLocalize, useNewConvo } from '~/hooks';
import { clearMessagesCache, cn } from '~/utils';

export default function NewChat({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { newConversation } = useNewConvo();

  const clickHandler: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      window.open('/c/new', '_blank');
      return;
    }
    // Keep outgoing conversations cached, including their in-flight messages.
    clearMessagesCache(queryClient, Constants.NEW_CONVO);
    queryClient.invalidateQueries([QueryKeys.allConversations]);
    newConversation({ disableParams: true });
  };

  return (
    <TooltipAnchor
      description={localize('com_ui_new_chat')}
      render={
        <Button
          size="icon"
          variant="outline"
          data-testid="new-chat-button"
          aria-label={localize('com_ui_new_chat')}
          className={cn(
            'size-9 rounded-xl bg-presentation duration-0 hover:bg-surface-active-alt max-md:hidden',
            className,
          )}
          onClick={clickHandler}
        >
          {children ?? <NewChatIcon />}
        </Button>
      }
    />
  );
}
