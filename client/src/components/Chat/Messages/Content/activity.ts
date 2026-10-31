import { ContentTypes, ToolCallTypes, Tools } from 'librechat-data-provider';
import type { Agents, FunctionToolCall, TMessageContentParts } from 'librechat-data-provider';
import { isError } from './ToolOutput';
import { isBashProgrammaticToolCall } from './routing';
import type { PartWithIndex } from './ParallelContent';

export type ActivityLifecycle = 'running' | 'success' | 'failed' | 'interrupted';

export type ToolActivity = {
  name: string;
  lifecycle: ActivityLifecycle;
  output?: string;
};

export type ActivityStage = {
  key: string;
  label?: string;
  lifecycle: ActivityLifecycle;
  parts: PartWithIndex[];
};

type ToolCallRecord = Record<string, unknown> & {
  status?: string;
  progress?: number;
  output?: string;
};

const hasOutput = (output: unknown) =>
  (typeof output === 'string' && output.trim().length > 0) ||
  (Array.isArray(output) && output.length > 0);

function resolveLifecycle(
  call: ToolCallRecord,
  output: unknown,
  isSubmitting: boolean,
): ActivityLifecycle {
  const status = String(call.status ?? '').toLowerCase();
  if (
    status === 'failed' ||
    status === 'error' ||
    (typeof output === 'string' && isError(output))
  ) {
    return 'failed';
  }
  if (status === 'completed' || status === 'success' || call.progress === 1 || hasOutput(output)) {
    return 'success';
  }
  return isSubmitting ? 'running' : 'interrupted';
}

/** Maps persisted or streaming tool content to one UI lifecycle without changing the event model. */
export function getToolActivity(
  part: TMessageContentParts,
  isSubmitting: boolean,
): ToolActivity | null {
  if (part.type !== ContentTypes.TOOL_CALL) {
    return null;
  }
  const toolCall = part[ContentTypes.TOOL_CALL];
  if (!toolCall) {
    return null;
  }

  const call = toolCall as unknown as ToolCallRecord;
  const isStandard =
    'args' in toolCall && (!toolCall.type || toolCall.type === ToolCallTypes.TOOL_CALL);
  if (isStandard) {
    const standardCall = toolCall as Agents.ToolCall;
    const name = isBashProgrammaticToolCall(standardCall.name, standardCall.args)
      ? Tools.bash_tool
      : (standardCall.name ?? '');
    return {
      name,
      output: standardCall.output,
      lifecycle: resolveLifecycle(call, standardCall.output, isSubmitting),
    };
  }

  if (toolCall.type === ToolCallTypes.CODE_INTERPRETER) {
    const outputs = (toolCall as { code_interpreter?: { outputs?: unknown[] } }).code_interpreter
      ?.outputs;
    return {
      name: Tools.code_interpreter,
      lifecycle: resolveLifecycle(call, outputs, isSubmitting),
    };
  }

  if (toolCall.type === ToolCallTypes.RETRIEVAL || toolCall.type === ToolCallTypes.FILE_SEARCH) {
    return {
      name: Tools.file_search,
      output: call.output,
      lifecycle: resolveLifecycle(call, call.output, isSubmitting),
    };
  }

  if (toolCall.type === ToolCallTypes.FUNCTION && ToolCallTypes.FUNCTION in toolCall) {
    const functionCall = (toolCall as FunctionToolCall).function;
    const functionRecord = functionCall as unknown as ToolCallRecord;
    return {
      name: functionCall.name,
      output: functionCall.output ?? undefined,
      lifecycle: resolveLifecycle(functionRecord, functionCall.output, isSubmitting),
    };
  }

  return null;
}

export function summarizeToolOutput(output?: string | null, maxLength = 1200): string | undefined {
  const value = output?.trim();
  if (!value) {
    return undefined;
  }
  const lines = value.split(/\r?\n/);
  const lineLimited = lines.length > 12 ? `${lines.slice(0, 12).join('\n')}\n...` : value;
  return lineLimited.length > maxLength ? `${lineLimited.slice(0, maxLength)}...` : lineLimited;
}

function parseToolArgs(args: unknown): Record<string, unknown> {
  if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (typeof args !== 'string' || args.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(args) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const DOCUMENT_ACTION_STAGES: Record<string, { key: string; label: string }> = {
  list: { key: 'document:list', label: '查找相关文档' },
  info: { key: 'document:info', label: '查看文档信息' },
  toc: { key: 'document:toc', label: '查看文档结构' },
  search: { key: 'document:search', label: '查找相关内容' },
  read: { key: 'document:read', label: '读取相关内容' },
  read_table: { key: 'document:table', label: '读取相关表格' },
  read_adjacent: { key: 'document:adjacent', label: '读取相邻内容' },
};

function getExecuteCodeStage(args: Record<string, unknown>, output?: string) {
  const code = String(args.code ?? args.command ?? '');
  const evidence = `${code}\n${output ?? ''}`;
  const createsDocx =
    /\.docx\b/i.test(evidence) &&
    /create_docx|Document\s*\(\s*\)|\.save\s*\(|ZipFile\s*\([^\n]+['"]w|writestr|Generated files?:|已生成|created/i.test(
      evidence,
    );
  const createsXlsx =
    /\.xlsx?\b/i.test(evidence) &&
    /create_xlsx|ExcelWriter|Workbook\s*\(\s*\)|to_excel|\.save\s*\(|Generated files?:|已生成|created/i.test(
      evidence,
    );
  const createsPptx =
    /\.pptx\b/i.test(evidence) &&
    /Presentation\s*\(\s*\)|\.save\s*\(|Generated files?:|已生成|created/i.test(evidence);
  const createsPdf =
    /\.pdf\b/i.test(evidence) &&
    /convert_to_pdf|reportlab|canvas\s*\(|\.save\s*\(|Generated files?:|已生成|created/i.test(
      evidence,
    );

  if (createsDocx) return { key: 'code:create-docx', label: '生成 Word 文档' };
  if (createsXlsx) return { key: 'code:create-xlsx', label: '生成 Excel 文件' };
  if (createsPptx) return { key: 'code:create-pptx', label: '生成演示文稿' };
  if (createsPdf) return { key: 'code:create-pdf', label: '生成 PDF 文件' };
  if (/read_excel|load_workbook|read_csv|read_table|ExcelFile/i.test(code)) {
    return { key: 'code:read-data', label: '读取源数据' };
  }
  if (/fitz\.open|pymupdf\.open|pdfplumber\.open|PdfReader/i.test(code)) {
    return { key: 'code:read-pdf', label: '读取 PDF 文件' };
  }
  if (/Document\s*\(\s*[^)]|docx2txt|mammoth/i.test(code)) {
    return { key: 'code:read-docx', label: '读取 Word 文档' };
  }
  if (/matplotlib|pyplot|savefig|seaborn|plotly/i.test(code)) {
    return { key: 'code:visualize', label: '生成数据图表' };
  }
  if (
    !/\b(?:import|from|open|read|write|save|request|http)\b/i.test(code) &&
    /(?:\d|sum\s*\(|mean\s*\()[^\n]*(?:\+|-|\*|\/|%|\*\*)/.test(code)
  ) {
    return { key: 'code:calculate', label: '执行计算' };
  }
  return { key: 'code:execute', label: '执行代码' };
}

function getSemanticStage(
  part: TMessageContentParts,
  activity: ToolActivity,
): { key: string; label?: string } {
  const toolCall = part[ContentTypes.TOOL_CALL] as
    | (Agents.ToolCall & { args?: unknown; output?: string })
    | undefined;
  const args = parseToolArgs(toolCall?.args);

  if (activity.name === 'read_parsed_pdf' || activity.name === 'read_parsed_docx') {
    const action = String(args.action ?? 'read');
    const stage = DOCUMENT_ACTION_STAGES[action] ?? DOCUMENT_ACTION_STAGES.read;
    const documentType = activity.name.endsWith('pdf') ? 'pdf' : 'docx';
    return { ...stage, key: `${stage.key}:${documentType}` };
  }
  if (/execute_code|code_interpreter|bash_tool/.test(activity.name)) {
    return getExecuteCodeStage(args, activity.output);
  }
  if (/web_search/i.test(activity.name)) {
    return { key: 'search:web', label: '搜索相关资料' };
  }
  if (/file_search|retrieval/i.test(activity.name)) {
    return { key: 'search:files', label: '查找相关资料' };
  }
  return { key: `tool:${activity.name}` };
}

function mergeLifecycle(
  current: ActivityLifecycle,
  incoming: ActivityLifecycle,
): ActivityLifecycle {
  const priority: Record<ActivityLifecycle, number> = {
    success: 0,
    interrupted: 1,
    running: 2,
    failed: 3,
  };
  return priority[incoming] > priority[current] ? incoming : current;
}

/**
 * Projects raw reasoning/tool content into user-visible stages. Reasoning stays in the
 * persisted message but never becomes a timeline row. Repeated SSE snapshots are
 * de-duplicated by tool-call id, and only adjacent semantic stages are merged.
 */
export function aggregateActivityStages(
  parts: PartWithIndex[],
  isSubmitting: boolean,
): ActivityStage[] {
  const stages: ActivityStage[] = [];
  const seenToolCallIds = new Set<string>();

  for (const entry of parts) {
    const activity = getToolActivity(entry.part, isSubmitting);
    if (!activity || entry.part.type !== ContentTypes.TOOL_CALL) {
      continue;
    }
    const toolCall = entry.part[ContentTypes.TOOL_CALL] as Agents.ToolCall | undefined;
    if (toolCall?.id && seenToolCallIds.has(toolCall.id)) {
      continue;
    }
    if (toolCall?.id) {
      seenToolCallIds.add(toolCall.id);
    }

    const semantic = getSemanticStage(entry.part, activity);
    const previous = stages[stages.length - 1];
    if (previous?.key === semantic.key) {
      previous.parts.push(entry);
      previous.lifecycle = mergeLifecycle(previous.lifecycle, activity.lifecycle);
      continue;
    }
    stages.push({
      key: semantic.key,
      label: semantic.label,
      lifecycle: activity.lifecycle,
      parts: [entry],
    });
  }
  return stages;
}

export function summarizeActivityFailure(output?: string): string | undefined {
  const tracebackError = output?.includes('Traceback (most recent call last):')
    ? output.match(/[\w.]*(?:Error|Exception):[^\n]*/g)?.pop()
    : undefined;
  const firstLine = (tracebackError ?? output)
    ?.replace(/^Error:\s*(?:\[.*?\]\s*)*(?:tool call failed|execution error):\s*/i, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^Error:\s*/i, '')
    .replace(/^tool call failed:\s*/i, '');
  if (!firstLine) {
    return undefined;
  }
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
}
