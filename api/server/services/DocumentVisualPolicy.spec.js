const { canDeferPdfVisualPreparation: defer } = require('./DocumentVisualPolicy');
const document = (fileId, coverage = [{ hasExtractedText: true, textStatus: 'available', textQuality: 'verified' }]) => ({ fileId, pageCount: 1, pageCoverage: coverage });
test('pure text requests with complete scoped text coverage avoid eager vision, including explicit page reads', () => {
  const documents = new Map([['a', document('a')]]);
  expect(defer({ fileIds: ['a'], documents, query: '提取第1页关于法律责任的原文' })).toBe(true);
  expect(defer({ fileIds: ['a'], documents, query: '计算已知金额与数量的乘积' })).toBe(true);
});
test('nonempty text without independently verified quality must not suppress visual preparation', () => {
  const documents = new Map([['a', document('a', [{ hasExtractedText: true, textStatus: 'available' }])]]);
  expect(defer({ fileIds: ['a'], documents, query: '读取这一页' })).toBe(false);
});
test('scan, incomplete, unknown and mixed attachment coverage retain visual processing', () => {
  for (const docs of [[], [document('a', [])], [document('a', [{ hasExtractedText: false, textStatus: 'empty' }])], [document('a', [{ hasExtractedText: true, textStatus: 'partial' }])]]) {
    expect(defer({ fileIds: ['a'], documents: new Map(docs.map(d => [d.fileId, d])), query: '提取内容' })).toBe(false);
  }
  expect(defer({ fileIds: ['a', 'b'], documents: new Map([['a', document('a')]]), query: '提取内容' })).toBe(false);
});
test('diagrams, tables, visual verification and OCR retain the existing route even with complete text', () => {
  for (const query of ['读取接线图', '提取所有表格', '原页复核', '识别扫描文字', 'show the figure', 'read the diagram', 'image OCR']) {
    expect(defer({ fileIds: ['a'], documents: new Map([['a', document('a')]]), query })).toBe(false);
  }
});
