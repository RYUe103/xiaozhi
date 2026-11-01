const crypto = require('crypto');
const { normalizeAssetPath } = require('./mineruCloud');
const id = (kind, ...values) =>
  kind +
  '_' +
  crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 24);
const textOf = (item) =>
  [
    ...new Set(
      [
        'text',
        'content',
        'md',
        'markdown',
        'table_body',
        'html',
        'captions',
        'image_caption',
        'image_footnote',
        'table_caption',
        'table_footnote',
        'footnotes',
      ]
        .flatMap((k) => (Array.isArray(item[k]) ? item[k] : [item[k]]))
        .filter((v) => typeof v === 'string' && v.trim()),
    ),
  ].join('\n\n');

// Geometry remains descriptive until a provider/sample has been independently calibrated.
function buildMineruStructure(payload, contentList, sourceName, identity = {}) {
  const sourceHash = identity.sourceHash || payload.provenance?.source_sha256 || null;
  const parserVersion = payload.provenance?.adapter_version || 'mineru-legacy-unknown';
  const sourceId = identity.documentId || sourceName;
  const imageEntries = Array.isArray(payload.images)
    ? payload.images.map((v, i) => [v?.name || v?.filename || 'image_' + (i + 1) + '.png', v])
    : Object.entries(payload.images || {});
  const images = imageEntries
    .map(([rawPath, value]) => {
      const normalizedPath = normalizeAssetPath(rawPath);
      const encoded =
        typeof value === 'string' ? value : value?.base64 || value?.data || value?.content;
      const base64 =
        typeof encoded === 'string'
          ? encoded.replace(/^data:image\/[^;]+;base64,/, '').replace(/\s/g, '')
          : '';
      if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
      const bytes = Buffer.from(base64, 'base64');
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      return {
        image_id: id('image', sourceId, sourceHash, normalizedPath, sha256),
        original_path: rawPath,
        normalized_path: normalizedPath,
        sha256,
      };
    })
    .filter(Boolean);
  const blocks = contentList
    .filter((item) => item && typeof item === 'object')
    .map((raw, order) => {
      const match = payload.image_mapping?.find((m) => m.source_block_index === order);
      const rawPath =
        typeof raw.img_path === 'string' && raw.img_path ? normalizeAssetPath(raw.img_path) : null;
      // Legacy inner-network paths sometimes prefix "images/" while keys contain only filenames.
      // Resolve only a unique suffix match; never silently choose among equal basenames.
      const candidates = rawPath
        ? images.filter(
            (img) =>
              img.normalized_path === (match?.normalized_path || rawPath) ||
              (!match && rawPath === 'images/' + img.normalized_path),
          )
        : [];
      const image = candidates.length === 1 ? candidates[0] : null;
      const page =
        Number.isInteger(raw.page_idx) && raw.page_idx >= 0
          ? raw.page_idx + 1
          : Number.isInteger(raw.page) && raw.page > 0
            ? raw.page
            : null;
      const blockId = id('block', sourceId, sourceHash, parserVersion, order, raw);
      return {
        block_id: blockId,
        source_document_id: sourceId,
        source_sha256: sourceHash,
        parser: 'mineru',
        parser_version: parserVersion,
        page,
        original_page_idx: raw.page_idx ?? null,
        page_mapping: page ? 'provider_index_unverified' : 'unknown',
        raw_type: raw.type || 'unknown',
        reading_order: order,
        text: textOf(raw),
        title_level: raw.text_level ?? null,
        bbox: Array.isArray(raw.bbox) ? raw.bbox : null,
        coordinate_system: 'unknown',
        geometry_verified: false,
        table_id: raw.type === 'table' ? id('table', blockId) : null,
        image_id: image?.image_id || null,
        image_path: image?.normalized_path || null,
        image_mapping_verified: Boolean(image && (match?.verified || !payload.provenance)),
        caption: raw.image_caption || raw.table_caption || [],
        source_block_index: order,
        raw,
      };
    });
  const chunks = [];
  for (const block of blocks) {
    if (['header', 'footer', 'page_number'].includes(block.raw_type) || !block.text.trim())
      continue;
    const parts = [];
    if (['table', 'equation', 'formula'].includes(block.raw_type)) parts.push(block.text);
    else {
      let rest = block.text;
      while (rest.length > 4500) {
        const paragraph = rest.lastIndexOf('\n\n', 4500);
        const end = paragraph > 2000 ? paragraph : 4500;
        parts.push(rest.slice(0, end));
        rest = rest.slice(end).trimStart();
      }
      if (rest) parts.push(rest);
    }
    parts.forEach((text, index) =>
      chunks.push({
        ...block,
        raw: undefined,
        chunk_id: id('mineru', block.block_id, index),
        text,
        text_chars: text.length,
        source: sourceName,
        ...(block.page ? { page_start: block.page, page_end: block.page } : {}),
      }),
    );
  }
  return {
    version: 'mineru-structure-v1',
    source_document_id: sourceId,
    source_sha256: sourceHash,
    parser_version: parserVersion,
    blocks,
    images,
    chunks,
  };
}
module.exports = { buildMineruStructure };
