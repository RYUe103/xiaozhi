import { Constants } from 'librechat-data-provider';
import {
  parseToolName,
  getToolDisplayLabel,
  getDocumentToolPresentation,
  getDocumentToolOutputSummary,
  TOOL_FRIENDLY_NAME_KEYS,
} from '../toolLabels';

describe('parseToolName', () => {
  it('splits an MCP tool id into server + tool name', () => {
    const parsed = parseToolName('search_code_mcp_github');
    expect(parsed).toEqual({
      raw: 'search_code_mcp_github',
      mcpServer: 'github',
      toolName: 'search_code',
    });
  });

  it('handles an MCP id whose tool-name portion contains underscores', () => {
    const parsed = parseToolName('deeply_nested_sub_tool_mcp_some-server');
    expect(parsed.mcpServer).toBe('some-server');
    expect(parsed.toolName).toBe('deeply_nested_sub_tool');
  });

  it('returns empty mcpServer + friendlyKey for a known native tool', () => {
    const parsed = parseToolName('web_search');
    expect(parsed).toEqual({
      raw: 'web_search',
      mcpServer: '',
      toolName: 'web_search',
      friendlyKey: TOOL_FRIENDLY_NAME_KEYS.web_search,
    });
  });

  it('returns empty mcpServer + no friendlyKey for an unknown native tool', () => {
    const parsed = parseToolName('custom_tool');
    expect(parsed).toEqual({
      raw: 'custom_tool',
      mcpServer: '',
      toolName: 'custom_tool',
    });
  });

  it('handles an MCP id with an empty server segment (pathological)', () => {
    /** `<tool>_mcp_` with nothing after the delimiter — treat as MCP
     *  with an empty server name rather than falling through to the
     *  native-tool path, so the display logic can surface "broken" ids
     *  rather than silently showing the whole thing as a tool name. */
    const parsed = parseToolName('foo_mcp_');
    expect(parsed.mcpServer).toBe('');
    expect(parsed.toolName).toBe('foo');
  });
});

describe('getToolDisplayLabel', () => {
  const identityLocalize = (key: string): string => key;

  it('returns the MCP server name for an MCP tool', () => {
    expect(getToolDisplayLabel('search_code_mcp_github', identityLocalize)).toBe('github');
  });

  it('returns the friendly translation key for a known native tool', () => {
    /** The identity-localize stub returns the translation key itself,
     *  which is what the real `useLocalize` would resolve at render time. */
    expect(getToolDisplayLabel('web_search', identityLocalize)).toBe(
      TOOL_FRIENDLY_NAME_KEYS.web_search,
    );
  });

  it('returns the code translation key for bash PTC tool calls', () => {
    expect(getToolDisplayLabel(Constants.BASH_PROGRAMMATIC_TOOL_CALLING, identityLocalize)).toBe(
      TOOL_FRIENDLY_NAME_KEYS[Constants.BASH_PROGRAMMATIC_TOOL_CALLING],
    );
  });

  it('returns the code translation key for bash_tool calls', () => {
    expect(getToolDisplayLabel('bash_tool', identityLocalize)).toBe(
      TOOL_FRIENDLY_NAME_KEYS.bash_tool,
    );
  });

  it('returns the raw name for an unknown native tool', () => {
    expect(getToolDisplayLabel('custom_tool', identityLocalize)).toBe('custom_tool');
  });

  it.each([
    ['list', 'com_ui_tool_name_document_list'],
    ['info', 'com_ui_tool_name_document_info'],
    ['toc', 'com_ui_tool_name_document_toc'],
    ['search', 'com_ui_tool_name_document_search'],
    ['read', 'com_ui_tool_name_document_read'],
    ['read_table', 'com_ui_tool_name_document_table'],
    ['read_adjacent', 'com_ui_tool_name_document_adjacent'],
  ])('maps document action %s to a friendly label', (action, friendlyKey) => {
    expect(getToolDisplayLabel('read_parsed_pdf', identityLocalize, { action })).toBe(friendlyKey);
    expect(
      getToolDisplayLabel('read_parsed_docx', identityLocalize, JSON.stringify({ action })),
    ).toBe(friendlyKey);
  });

  it('uses a safe document-reading fallback for unknown or partial arguments', () => {
    expect(getToolDisplayLabel('read_parsed_pdf', identityLocalize, '{"action":')).toBe(
      'com_ui_tool_name_document_read',
    );
    expect(getToolDisplayLabel('read_parsed_docx', identityLocalize, { action: 'future' })).toBe(
      'com_ui_tool_name_document_read',
    );
  });
});

describe('getDocumentToolPresentation', () => {
  it('keeps document UI mapping separate from unrelated execution tools', () => {
    expect(getDocumentToolPresentation('execute_code', { action: 'search' })).toBeNull();
    expect(getDocumentToolPresentation('read_parsed_pdf', { action: 'search' })).toEqual({
      friendlyKey: 'com_ui_tool_name_document_search',
      iconType: 'document_search',
    });
  });
});

describe('getDocumentToolOutputSummary', () => {
  it('leaves unrelated tool output unchanged', () => {
    expect(getDocumentToolOutputSummary('execute_code', '{"value":"full"}')).toBe(
      '{"value":"full"}',
    );
  });

  it('keeps short document metadata and summarizes large content', () => {
    const summary = JSON.parse(
      getDocumentToolOutputSummary(
        'read_parsed_pdf',
        JSON.stringify({
          status: 'ok',
          page: 19,
          content: '甲'.repeat(500),
          matches: Array.from({ length: 12 }, (_, index) => ({ index })),
          metadata: { document_id: 'doc-1', source: 'mineru' },
        }),
      ) ?? '{}',
    );

    expect(summary.status).toBe('ok');
    expect(summary.page).toBe(19);
    expect(summary.content).toContain('(500 chars)');
    expect(summary.matches).toBe('[12 items]');
    expect(summary.metadata).toBe('{2 fields}');
  });

  it('summarizes plain long output and preserves empty output', () => {
    expect(getDocumentToolOutputSummary('read_parsed_docx', '段'.repeat(500))).toContain(
      '(500 chars)',
    );
    expect(getDocumentToolOutputSummary('read_parsed_docx', '')).toBe('');
  });
});
