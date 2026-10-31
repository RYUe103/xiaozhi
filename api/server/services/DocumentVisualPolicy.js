/** Avoid eager VL only when every attached PDF has a plausible complete text layer.
 * Missing/partial coverage, unknown artifacts and explicit visual requests fail open
 * to the existing visual route. No document facts or answer heuristics are encoded.
 */
function canDeferPdfVisualPreparation({ fileIds, documents, query = '' }) {
  if (!fileIds?.length || !documents) return false;
  if (/扫描|图片|图像|图表|截图|图中|图里|图上|流程图|结构图|示意图|接线图|连线|表格|视觉|版面|布局|水印|印章|手写|原页|页面细节|复核|核对|ocr|diagram|image|figure|chart|table|scan/i.test(String(query))) return false;
  const all = [...documents.values()];
  return fileIds.every(fileId => {
    const doc = all.find(d => d.fileId === fileId);
    return doc && doc.pageCount > 0 && doc.pageCountSource !== 'observed_lower_bound' && doc.pageCoverage?.length === doc.pageCount &&
      doc.pageCoverage.every(p => p.hasExtractedText === true && p.textStatus === 'available' && p.textQuality === 'plausible');
  });
}
module.exports = { canDeferPdfVisualPreparation };
