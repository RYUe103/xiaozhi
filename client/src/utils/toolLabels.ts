import { Constants } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

/**
 * Shared tool-name parsing + friendly-label mapping used by the main
 * tool-call UI and the subagent ticker. Centralized so the MCP
 * delimiter (`<tool>_mcp_<server>`) and native-tool short names read
 * consistently in every surface that renders tool lifecycle.
 */

/** Native tool id → translation key for a user-readable short name. */
export const TOOL_FRIENDLY_NAME_KEYS: Record<string, TranslationKeys> = {
  execute_code: 'com_ui_tool_name_code',
  run_tools_with_code: 'com_ui_tool_name_code',
  run_tools_with_bash: 'com_ui_tool_name_code',
  bash_tool: 'com_ui_tool_name_code',
  web_search: 'com_ui_tool_name_web_search',
  image_gen_oai: 'com_ui_tool_name_image_gen',
  image_edit_oai: 'com_ui_tool_name_image_edit',
  gemini_image_gen: 'com_ui_tool_name_image_gen',
  file_search: 'com_ui_tool_name_file_search',
  code_interpreter: 'com_ui_tool_name_code_analysis',
  retrieval: 'com_ui_tool_name_file_search',
};

export type ToolDisplayArgs = string | Record<string, unknown> | null | undefined;

export type DocumentToolIconType =
  | 'document_list'
  | 'document_info'
  | 'document_toc'
  | 'document_search'
  | 'document_read'
  | 'document_table'
  | 'document_adjacent';

interface DocumentToolPresentation {
  friendlyKey: TranslationKeys;
  iconType: DocumentToolIconType;
}

const DOCUMENT_READER_TOOLS = new Set(['read_parsed_pdf', 'read_parsed_docx']);

const DOCUMENT_TOOL_PRESENTATIONS: Record<string, DocumentToolPresentation> = {
  list: {
    friendlyKey: 'com_ui_tool_name_document_list',
    iconType: 'document_list',
  },
  info: {
    friendlyKey: 'com_ui_tool_name_document_info',
    iconType: 'document_info',
  },
  toc: {
    friendlyKey: 'com_ui_tool_name_document_toc',
    iconType: 'document_toc',
  },
  search: {
    friendlyKey: 'com_ui_tool_name_document_search',
    iconType: 'document_search',
  },
  read: {
    friendlyKey: 'com_ui_tool_name_document_read',
    iconType: 'document_read',
  },
  read_table: {
    friendlyKey: 'com_ui_tool_name_document_table',
    iconType: 'document_table',
  },
  read_adjacent: {
    friendlyKey: 'com_ui_tool_name_document_adjacent',
    iconType: 'document_adjacent',
  },
};

const DOCUMENT_TOOL_FALLBACK: DocumentToolPresentation = {
  friendlyKey: 'com_ui_tool_name_document_read',
  iconType: 'document_read',
};

function getToolAction(args: ToolDisplayArgs): string {
  if (args == null) {
    return '';
  }
  if (typeof args === 'object') {
    return typeof args.action === 'string' ? args.action : '';
  }
  try {
    const parsed = JSON.parse(args) as { action?: unknown };
    return typeof parsed?.action === 'string' ? parsed.action : '';
  } catch {
    return '';
  }
}

export function getDocumentToolPresentation(
  rawName: string,
  args?: ToolDisplayArgs,
): DocumentToolPresentation | null {
  if (!DOCUMENT_READER_TOOLS.has(rawName)) {
    return null;
  }
  return DOCUMENT_TOOL_PRESENTATIONS[getToolAction(args)] ?? DOCUMENT_TOOL_FALLBACK;
}

const DOCUMENT_SUMMARY_STRING_LIMIT = 240;
const DOCUMENT_SUMMARY_FIELD_LIMIT = 10;

function summarizeDocumentValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.length <= DOCUMENT_SUMMARY_STRING_LIMIT) {
      return value;
    }
    return `${value.slice(0, DOCUMENT_SUMMARY_STRING_LIMIT)}... (${value.length} chars)`;
  }
  if (Array.isArray(value)) {
    if (value.length <= 3 && value.every((item) => typeof item !== 'object')) {
      return value;
    }
    return `[${value.length} items]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).length} fields}`;
  }
  return value;
}

export function getDocumentToolOutputSummary(
  rawName: string,
  output?: string | null,
): string | null | undefined {
  if (!DOCUMENT_READER_TOOLS.has(rawName) || !output) {
    return output;
  }
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return String(summarizeDocumentValue(parsed));
    }
    const summary = Object.fromEntries(
      Object.entries(parsed)
        .slice(0, DOCUMENT_SUMMARY_FIELD_LIMIT)
        .map(([key, value]) => [key, summarizeDocumentValue(value)]),
    );
    if (Object.keys(parsed).length > DOCUMENT_SUMMARY_FIELD_LIMIT) {
      summary.more_fields = Object.keys(parsed).length - DOCUMENT_SUMMARY_FIELD_LIMIT;
    }
    return JSON.stringify(summary);
  } catch {
    return String(summarizeDocumentValue(output));
  }
}

export interface ParsedToolName {
  /** Original tool id (unchanged). */
  raw: string;
  /** MCP server name when the tool follows `<tool>_mcp_<server>`, else `''`. */
  mcpServer: string;
  /** Tool-specific name — the `<tool>` half of an MCP id, or the raw
   *  name for native tools. Useful as the "action" label shown in a
   *  code-style badge next to the server name. */
  toolName: string;
  /** Translation key for a user-friendly display name, when the raw
   *  name matches a built-in native tool (web_search, execute_code, …).
   *  Absent for MCP tools and unknown names. */
  friendlyKey?: TranslationKeys;
}

/**
 * Split an incoming tool id into its constituent parts:
 *
 *   - `search_code_mcp_github` → `{ mcpServer: 'github', toolName: 'search_code' }`
 *   - `web_search`             → `{ mcpServer: '', toolName: 'web_search', friendlyKey: 'com_ui_tool_name_web_search' }`
 *   - `some_custom_tool`       → `{ mcpServer: '', toolName: 'some_custom_tool' }`
 */
export function parseToolName(rawName: string): ParsedToolName {
  const idx = rawName.indexOf(Constants.mcp_delimiter);
  if (idx >= 0) {
    const mcpServer = rawName.slice(idx + Constants.mcp_delimiter.length);
    const toolName = rawName.slice(0, idx);
    return { raw: rawName, mcpServer, toolName };
  }
  const friendlyKey = TOOL_FRIENDLY_NAME_KEYS[rawName];
  return {
    raw: rawName,
    mcpServer: '',
    toolName: rawName,
    ...(friendlyKey ? { friendlyKey } : {}),
  };
}

/**
 * Resolve a tool id to a single user-facing short label. Pure string —
 * use `parseToolName` directly when you need structured parts (e.g. to
 * render a code-style badge for the tool name next to the server).
 *
 *   - MCP tool  → server name (keeps the header summary short)
 *   - Native   → localized friendly name from {@link TOOL_FRIENDLY_NAME_KEYS}
 *   - Unknown  → raw name
 */
export function getToolDisplayLabel(
  rawName: string,
  localize: (key: TranslationKeys) => string,
  args?: ToolDisplayArgs,
): string {
  const documentPresentation = getDocumentToolPresentation(rawName, args);
  if (documentPresentation) {
    return localize(documentPresentation.friendlyKey);
  }
  const parsed = parseToolName(rawName);
  if (parsed.mcpServer) return parsed.mcpServer;
  if (parsed.friendlyKey) return localize(parsed.friendlyKey);
  return parsed.toolName;
}
