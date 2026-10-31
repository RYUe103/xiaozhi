const { parseHtmlTables } = require('./DocumentTables');
const { DocumentArtifactRepository } = require('./DocumentArtifactRepository');
const repo = () => new DocumentArtifactRepository({ userId: 'u', conversationId: 'c', secret: 's' });

describe('real structured table reading', () => {
  test('preserves merged HTML cell coordinates, entities and expanded grid', () => {
    const [table] = parseHtmlTables('<table><tr><th rowspan="2">设备</th><th colspan="2">参数</th></tr><tr><td>温度</td><td>压力</td></tr><tr><td>A&amp;B</td><td>80</td><td>2</td></tr></table>');
    expect(table.readable).toBe(true);
    expect(table.rows).toEqual([['设备', '参数', '参数'], ['设备', '温度', '压力'], ['A&B', '80', '2']]);
    expect(table.cells[0]).toMatchObject({ row: 0, column: 0, rowspan: 2, colspan: 1 });
  });
  test('rejects malformed spans and incomplete table markup', () => {
    expect(parseHtmlTables('<table><tr><td rowspan="999999">x</td></tr></table>')[0].readable).toBe(false);
    expect(parseHtmlTables('<table><tr><td>x</td></tr>')[0].warnings).toContain('TABLE_FRAGMENT_INCOMPLETE');
  });
  test('joins adjacent Markdown continuation with verified column count and retains page provenance', () => {
    const repository = repo();
    const doc = repository.add({ fileId: 'f', engine: 'mineru', records: [
      { page: 1, text: '| 设备 | 温度 |\n| --- | --- |\n| A | 80 |' },
      { page: 2, text: '| B | 90 |\n\n# 下一章\n无关内容' },
    ] });
    expect(doc.tables).toHaveLength(1);
    const output = repository.execute({ action: 'read_table', table_id: doc.tables[0].tableId });
    expect(output.content).toContain('| B | 90 |');
    expect(output.content).not.toContain('无关内容');
    expect(output.hits[0]).toMatchObject({ page_start: 1, page_end: 2, engine: 'mineru' });
    expect(output.table.row_provenance[2].page_start).toBe(2);
    expect(output.warnings).toContain('TABLE_CONTINUATION_INFERRED');
  });
  test('does not merge independent tables or different-width fragments', () => {
    const repository = repo();
    const doc = repository.add({ fileId: 'f', records: [
      { page: 1, text: '| A | B |\n| --- | --- |\n| x | y |' },
      { page: 2, text: '| C | D |\n| --- | --- |\n| z | q |' },
      { page: 3, text: '| no | same | columns |' },
    ] });
    expect(doc.tables).toHaveLength(2);
    expect(doc.tables[0].rows).toHaveLength(2);
    expect(repository.execute({ action: 'read_table', table_id: doc.tables[1].tableId }).error.code).toBe('TABLE_STRUCTURE_INCOMPLETE');
  });
  test('joins explicit structured table identities and exposes actual rows', () => {
    const repository = repo();
    const doc = repository.add({ fileId: 'f', contentList: [
      { table_id: 't1', page_idx: 0, table_body: '<table><tr><th>设备</th><th>温度</th></tr><tr><td>A</td><td>80</td></tr></table>' },
      { table_id: 't1', page_idx: 1, rows: [['设备', '温度'], ['B', '90']] },
    ] });
    expect(doc.tables).toHaveLength(1);
    const result = repository.execute({ action: 'read_table', table_id: doc.tables[0].tableId });
    expect(result.table.rows).toEqual([['设备', '温度'], ['A', '80'], ['B', '90']]);
    expect(result.hits[0].page_end).toBe(2);
  });
  test('reassembles a split HTML table from contiguous native chunks', () => {
    const repository = repo();
    const doc = repository.add({ fileId: 'f', engine: 'mineru', records: [
      { page: 1, text: '<table><tr><th>A</th><th>B</th></tr>' },
      { page: 2, text: '<tr><td>motor</td><td>2</td></tr></table>' },
    ] });
    const result = repository.execute({ action: 'read_table', table_id: doc.tables[0].tableId });
    expect(result.table.rows[1]).toEqual(['motor', '2']);
    expect(result.hits[0]).toMatchObject({ page_start: 1, page_end: 2 });
  });
  test('flat native text and visual summaries never become invented tables', () => {
    const repository = repo();
    const doc = repository.add({ fileId: 'f', engine: 'fitz', records: [{ page: 1, text: 'A 80 B 90' }], summaries: [{ page: 2, summary: 'table has A 80' }] });
    expect(doc.tables).toEqual([]);
  });
  test('native FITZ geometry tables retain a usable adjacent-text anchor', async () => {
    const repository = repo();
    const doc = repository.add({ fileId: 'native-geometry', engine: 'fitz', records: [{ page: 1, text: 'before table' }, { page: 2, text: 'Pressure 1.6 MPa' }], pageRecords: [{ page: 2, tables: [{ page: 2, engine: 'fitz', rows: [['Item', 'Limit'], ['Pressure', '1.6']] }] }] });
    await repository.executeAsync({ action: 'read_table', table_id: doc.tables[0].tableId });
    const adjacent = await repository.executeAsync({ action: 'read_adjacent' });
    expect(adjacent.content).toContain('Pressure 1.6 MPa');
    expect(adjacent.content).toContain('before table');
  });

});
