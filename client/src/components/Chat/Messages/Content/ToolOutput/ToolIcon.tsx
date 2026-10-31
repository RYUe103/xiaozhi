import { Constants, isActionTool } from 'librechat-data-provider';
import {
  Terminal,
  Globe,
  ImageIcon,
  ArrowRightLeft,
  Files,
  FileSearch,
  FileText,
  ListTree,
  Search,
  BookOpen,
  Table,
  ScrollText,
  Zap,
  Wrench,
} from 'lucide-react';
import LangIcon from '~/components/Messages/Content/LangIcon';
import type { DocumentToolIconType, ToolDisplayArgs } from '~/utils';
import { cn, getDocumentToolPresentation } from '~/utils';

function BashIcon({ className }: { className?: string }) {
  return <LangIcon lang="bash" className={className} />;
}

export type ToolIconType =
  | DocumentToolIconType
  | 'mcp'
  | 'execute_code'
  | 'web_search'
  | 'image_gen'
  | 'agent_handoff'
  | 'file_search'
  | 'skill'
  | 'read_file'
  | 'bash_tool'
  | 'action'
  | 'generic';

const ICON_MAP: Record<ToolIconType, React.ComponentType<{ className?: string }>> = {
  mcp: Wrench,
  execute_code: Terminal,
  web_search: Globe,
  image_gen: ImageIcon,
  agent_handoff: ArrowRightLeft,
  file_search: FileSearch,
  skill: ScrollText,
  read_file: FileText,
  document_list: Files,
  document_info: FileText,
  document_toc: ListTree,
  document_search: Search,
  document_read: BookOpen,
  document_table: Table,
  document_adjacent: ArrowRightLeft,
  bash_tool: BashIcon,
  action: Zap,
  generic: Wrench,
};

export function getToolIconType(name: string, args?: ToolDisplayArgs): ToolIconType {
  if (!name) {
    return 'generic';
  }
  if (name.includes(Constants.mcp_delimiter)) {
    return 'mcp';
  }
  const documentPresentation = getDocumentToolPresentation(name, args);
  if (documentPresentation) {
    return documentPresentation.iconType;
  }
  if (name === 'execute_code' || name === Constants.PROGRAMMATIC_TOOL_CALLING) {
    return 'execute_code';
  }
  if (name === 'web_search') {
    return 'web_search';
  }
  if (name === 'image_gen_oai' || name === 'image_edit_oai' || name === 'gemini_image_gen') {
    return 'image_gen';
  }
  if (name === 'file_search' || name === 'retrieval') {
    return 'file_search';
  }
  if (name === 'code_interpreter') {
    return 'execute_code';
  }
  if (name === 'skill') {
    return 'skill';
  }
  if (name === 'read_file') {
    return 'read_file';
  }
  if (name === 'bash_tool' || name === Constants.BASH_PROGRAMMATIC_TOOL_CALLING) {
    return 'bash_tool';
  }
  if (name.startsWith(Constants.LC_TRANSFER_TO_)) {
    return 'agent_handoff';
  }
  if (isActionTool(name)) {
    return 'action';
  }
  return 'generic';
}

/** Extracts the MCP server name from a tool name with format `tool<delimiter>server`. */
export function getMCPServerName(toolName: string): string {
  const idx = toolName.indexOf(Constants.mcp_delimiter);
  if (idx < 0) {
    return '';
  }
  const afterDelimiter = toolName.slice(idx + Constants.mcp_delimiter.length);
  return afterDelimiter || '';
}

interface ToolIconProps {
  type: ToolIconType;
  iconUrl?: string;
  isAnimating?: boolean;
  className?: string;
}

export default function ToolIcon({ type, iconUrl, isAnimating = false, className }: ToolIconProps) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        className={cn(
          'size-4 shrink-0 rounded-full object-cover',
          isAnimating && 'animate-pulse',
          className,
        )}
        aria-hidden="true"
      />
    );
  }

  const IconComponent = ICON_MAP[type];
  return (
    <IconComponent
      className={cn(
        'size-4 shrink-0 text-text-secondary',
        isAnimating && 'animate-pulse',
        className,
      )}
      aria-hidden="true"
    />
  );
}
