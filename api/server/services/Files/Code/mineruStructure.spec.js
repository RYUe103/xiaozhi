const { buildMineruStructure } = require('./mineruStructure');
test('preserves table/formula boundaries, page uncertainty and all source blocks', () => {
  const raw = [
    { type: 'header', text: 'repeat', page_idx: 0 },
    {
      type: 'table',
      table_body: '<table>' + 'x'.repeat(6000) + '</table>',
      page_idx: 0,
      bbox: [0, 0, 100, 100],
    },
    { type: 'equation', text: 'x'.repeat(5000) },
    { type: 'text', text: 'p'.repeat(10000), page_idx: 1 },
  ];
  const data = buildMineruStructure({}, raw, 'file.pdf', { documentId: 'doc', sourceHash: 'sha' });
  expect(data.blocks).toHaveLength(4);
  expect(data.chunks).toHaveLength(5);
  expect(data.chunks[0].text.length).toBeGreaterThan(6000);
  expect(data.chunks[1].page).toBeNull();
  expect(data.chunks[0].coordinate_system).toBe('unknown');
  expect(data.chunks[0].geometry_verified).toBe(false);
  expect(data.chunks.slice(2).every((c) => c.block_id === data.blocks[3].block_id)).toBe(true);
  expect(
    buildMineruStructure({}, raw, 'file.pdf', { documentId: 'doc', sourceHash: 'sha' }).blocks,
  ).toEqual(data.blocks);
  expect(
    buildMineruStructure({}, raw, 'file.pdf', { documentId: 'doc', sourceHash: 'new' }).blocks[0]
      .block_id,
  ).not.toBe(data.blocks[0].block_id);
});
test('same basename in distinct directories gets distinct asset identity', () => {
  const data = buildMineruStructure(
    {
      images: { 'a/x.png': 'YQ==', 'b/x.png': 'Yg==' },
      image_mapping: [{ source_block_index: 0, normalized_path: 'b/x.png', verified: true }],
    },
    [{ type: 'image', img_path: 'b/x.png', page_idx: 0 }],
    'file.pdf',
  );
  expect(data.images[0].image_id).not.toBe(data.images[1].image_id);
  expect(data.blocks[0].image_id).toBe(data.images[1].image_id);
});
test('empty provider img_path is absence, not an illegal ZIP path', () => {
  const value = buildMineruStructure(
    {},
    [{ type: 'text', text: 'normal text', img_path: '', page_idx: 0 }],
    'file.pdf',
  );
  expect(value.blocks[0].image_id).toBeNull();
  expect(value.chunks).toHaveLength(1);
});
