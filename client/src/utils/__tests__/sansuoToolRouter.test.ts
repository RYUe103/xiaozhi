import { routeSanSuoTools } from '../sansuoToolRouter';
import { isSanSuoPreparseFile } from '../sansuoMode';

describe('SanSuo preparsed file routing', () => {
  it.each([
    ['report.pdf', 'application/pdf'],
    ['plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['scores.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['legacy.xls', 'application/vnd.ms-excel'],
    ['rows.csv', 'text/csv'],
    ['notes.md', 'text/markdown'],
    ['readme.txt', 'text/plain'],
  ])('recognizes %s as a preparsed attachment', (filename, type) => {
    expect(isSanSuoPreparseFile({ filename, type })).toBe(true);
  });

  it('does not force execute_code for a read-only spreadsheet question', () => {
    expect(
      routeSanSuoTools('谁的成绩最好', [
        {
          filename: '学生成绩表.xlsx',
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ]),
    ).toEqual({ executeCode: false, reason: 'file_read_deferred_to_server' });
  });

  it.each(['给我个100字的话', '给我写一段100字的介绍', '写100字的工作感想', '生成100字的说明文字'])(
    'keeps bounded plain-text writing in chat: %s',
    (text) => {
      expect(routeSanSuoTools(text)).toEqual({
        executeCode: false,
        reason: 'bounded_plain_text',
      });
    },
  );

  it('keeps an explicit downloadable format as sandbox work despite a word limit', () => {
    expect(routeSanSuoTools('生成一个100字的 Word 文件').executeCode).toBe(true);
  });

  it.each(['把这个 Word 改写后导出', '把附件转换成 PDF', '生成一张成绩柱状图'])(
    'keeps explicit sandbox work enabled: %s',
    (text) => {
      expect(routeSanSuoTools(text, [{ filename: '输入.docx' }]).executeCode).toBe(true);
    },
  );
});
