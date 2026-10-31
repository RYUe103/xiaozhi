import { useMemo } from 'react';
import { MessagesSquare } from 'lucide-react';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type { NavLink } from '~/common';
import { useHasAccess } from '~/hooks';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';

export default function useUnifiedSidebarLinks() {
  const links = useMemo(() => {
    const conversationLink: NavLink = {
      title: 'com_ui_chat_history',
      label: '',
      icon: MessagesSquare,
      id: 'conversations',
      Component: ConversationsSection,
    };

    const nextLinks: NavLink[] = [conversationLink];

    return nextLinks;
  }, []);

  return links;
}
