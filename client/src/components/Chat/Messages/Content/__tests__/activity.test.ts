import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import {
  aggregateActivityStages,
  getToolActivity,
  summarizeActivityFailure,
  summarizeToolOutput,
} from '../activity';

const toolPart = (overrides: Record<string, unknown> = {}) =>
  ({
    type: ContentTypes.TOOL_CALL,
    tool_call: {
      id: 'call-1',
      name: 'execute_code',
      args: '{}',
      ...overrides,
    },
  }) as unknown as TMessageContentParts;

const indexedTool = (idx: number, overrides: Record<string, unknown> = {}) => ({
  idx,
  part: toolPart({ id: `call-${idx}`, progress: 1, output: 'done', ...overrides }),
});

const thinking = (idx: number) => ({
  idx,
  part: { type: ContentTypes.THINK, think: `internal-${idx}` } as TMessageContentParts,
});

describe('agent activity projection', () => {
  it('recognizes a persisted Python traceback without treating stderr warnings as failures', () => {
    const output =
      'stdout: Empty.\nstderr:\nTraceback (most recent call last):  File "test.py", line 1\nRuntimeError: intentional failure';
    expect(getToolActivity(toolPart({ progress: 1, output }), false)?.lifecycle).toBe('failed');
    expect(summarizeActivityFailure(output)).toBe('RuntimeError: intentional failure');
    expect(
      getToolActivity(
        toolPart({ progress: 1, output: 'stdout: done\nstderr:\nUserWarning: deprecated' }),
        false,
      )?.lifecycle,
    ).toBe('success');
  });
  it('reports a newly observed tool call as running', () => {
    expect(getToolActivity(toolPart(), true)).toMatchObject({
      name: 'execute_code',
      lifecycle: 'running',
    });
  });

  it('reports the persisted completion event as successful', () => {
    expect(getToolActivity(toolPart({ progress: 1, output: '42' }), false)?.lifecycle).toBe(
      'success',
    );
  });

  it('reports a real tool error as failed', () => {
    expect(
      getToolActivity(toolPart({ progress: 1, output: 'Error: tool call failed: timeout' }), false)
        ?.lifecycle,
    ).toBe('failed');
  });

  it('reports the real Code API execution-error envelope as failure', () => {
    const output =
      'Error: Execution error:\n\nCodeAPI request failed: returned 503, body: {"error":"auth_not_configured"}\n Please fix your mistakes.';
    expect(getToolActivity(toolPart({ progress: 1, output }), false)?.lifecycle).toBe('failed');
    expect(summarizeActivityFailure(output)).toContain('auth_not_configured');
  });

  it('reports an unfinished call after SSE stops as interrupted', () => {
    expect(getToolActivity(toolPart({ progress: 0.2 }), false)?.lifecycle).toBe('interrupted');
  });

  it('limits returned details to a summary', () => {
    const output = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');
    const summary = summarizeToolOutput(output);
    expect(summary).toContain('line 12');
    expect(summary).not.toContain('line 13');
    expect(summary?.endsWith('...')).toBe(true);
  });

  it('does not create timeline stages for reasoning-only messages', () => {
    expect(aggregateActivityStages([thinking(0), thinking(1)], false)).toEqual([]);
  });

  it('classifies a simple execute_code call as a calculation', () => {
    const stages = aggregateActivityStages(
      [
        indexedTool(0, {
          args: JSON.stringify({ lang: 'py', code: 'print(12345 + 67890)' }),
          output: 'stdout:\n80235',
        }),
      ],
      false,
    );
    expect(stages).toMatchObject([{ key: 'code:calculate', label: '执行计算' }]);
  });

  it('merges repeated Word generation calls across reasoning without losing raw calls', () => {
    const wordCode = "from docx import Document\ndoc = Document()\ndoc.save('/mnt/data/a.docx')";
    const stages = aggregateActivityStages(
      [
        indexedTool(0, { args: { code: wordCode } }),
        thinking(1),
        indexedTool(2, { args: { code: wordCode } }),
        thinking(3),
      ],
      false,
    );
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ key: 'code:create-docx', label: '生成 Word 文档' });
    expect(stages[0].parts).toHaveLength(2);
  });

  it('keeps Excel reading and generation as separate ordered stages', () => {
    const stages = aggregateActivityStages(
      [
        indexedTool(0, { args: { code: "import pandas as pd\npd.read_excel('source.xlsx')" } }),
        thinking(1),
        indexedTool(2, {
          args: { code: "import pandas as pd\ndf.to_excel('/mnt/data/result.xlsx')" },
        }),
      ],
      false,
    );
    expect(stages.map(({ label }) => label)).toEqual(['读取源数据', '生成 Excel 文件']);
  });

  it('maps PDF chunk actions to distinct semantic stages', () => {
    const stages = aggregateActivityStages(
      [
        indexedTool(0, { name: 'read_parsed_pdf', args: { action: 'search' } }),
        indexedTool(1, { name: 'read_parsed_pdf', args: { action: 'read' } }),
        indexedTool(2, { name: 'read_parsed_pdf', args: { action: 'read_adjacent' } }),
      ],
      false,
    );
    expect(stages.map(({ label }) => label)).toEqual([
      '查找相关内容',
      '读取相关内容',
      '读取相邻内容',
    ]);
  });

  it('keeps different tools in their real order', () => {
    const stages = aggregateActivityStages(
      [indexedTool(0, { name: 'web_search' }), indexedTool(1, { args: { code: 'print(6 * 7)' } })],
      false,
    );
    expect(stages.map(({ label }) => label)).toEqual(['搜索相关资料', '执行计算']);
  });

  it('preserves a failed lifecycle when repeated calls share one stage', () => {
    const stages = aggregateActivityStages(
      [
        indexedTool(0, { args: { code: 'print(6 * 7)' } }),
        indexedTool(1, {
          args: { code: 'print(6 * 7)' },
          output: 'Error: tool call failed: timeout',
        }),
      ],
      false,
    );
    expect(stages).toHaveLength(1);
    expect(stages[0].lifecycle).toBe('failed');
  });

  it('marks an unfinished semantic stage as interrupted when SSE stops', () => {
    const stages = aggregateActivityStages(
      [indexedTool(0, { progress: 0.2, output: '', args: { code: 'print(6 * 7)' } })],
      false,
    );
    expect(stages[0].lifecycle).toBe('interrupted');
  });

  it('deduplicates repeated snapshots of the same tool call id', () => {
    const duplicate = indexedTool(0, { id: 'same-call', args: { code: 'print(6 * 7)' } });
    const stages = aggregateActivityStages([duplicate, { ...duplicate, idx: 1 }], false);
    expect(stages).toHaveLength(1);
    expect(stages[0].parts).toHaveLength(1);
  });

  it('uses a real error line for the top-level failure summary', () => {
    expect(summarizeActivityFailure('Error: tool call failed: timeout\ntrace')).toBe('timeout');
  });
});
