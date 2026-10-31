const crypto = require('crypto');

const PROMPT_VERSION = 'inspect-page-v1';
const MODES = new Set(['auto', 'text', 'table', 'figure', 'formula']);
const INSTRUCTIONS = {
  auto: '依据问题选择识别方式，保留问题中的全部条件。',
  text: '逐字读取相关原文，保留型号、数字、单位及上下文，模糊处标记不确定。',
  table: '辨认目标表头、行列和单元格，保留单位；行列或跨页归属不清时明确指出。',
  figure: '识别图例、标记和对应数据系列；区分标注数值与估计值，不确定的对应关系不得猜测。',
  formula: '保留公式、上下标和符号结构，区分原文与解释；模糊符号标记不确定。',
};

class DocumentPageVisionService {
  constructor({ repository, getPage, baseURL, apiKey, model, fetchImpl = fetch, timeoutMs = 60000 }) {
    Object.assign(this, { repository, getPage, baseURL, apiKey, model, fetchImpl, timeoutMs });
    this.pending = new Map();
    this.cache = new Map();
    this.calls = 0;
    this.active = 0;
  }

  async inspect(input) {
    const { document_id: id, page, query, region, mode = 'auto', max_chars = 4000 } = input;
    const invalid = (code) => ({ ok: false, status: 'unavailable', error: { code } });
    if (typeof id !== 'string' || !Number.isInteger(page) || page < 1 ||
        typeof query !== 'string' || !query.trim() || query.length > 1000 || !MODES.has(mode) ||
        !Number.isInteger(max_chars) || max_chars < 100 || max_chars > 12000) return invalid('INVALID_INSPECTION');
    if (region && (!['x0', 'y0', 'x1', 'y1'].every((k) => Number.isFinite(region[k]) && region[k] >= 0 && region[k] <= 1) ||
        region.x0 >= region.x1 || region.y0 >= region.y1)) return invalid('INVALID_REGION');
    const doc = this.repository.documents.get(id);
    if (!doc || !doc.pageCount || page > doc.pageCount) return invalid('PAGE_NOT_FOUND');
    const denied = await this.repository.checkAuthorization([doc]);
    if (denied) return denied;
    if (!doc.sourceHash || !this.baseURL || !this.apiKey || !this.model) return invalid('VISION_NOT_CONFIGURED_OR_SOURCE_UNKNOWN');
    const key = crypto.createHash('sha256').update(JSON.stringify([this.repository.userId, this.repository.conversationId,
      doc.sourceHash, page, region || null, query.trim(), mode, max_chars, this.model, PROMPT_VERSION])).digest('hex');
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.calls >= 12) return invalid('VISION_BUDGET_EXCEEDED');
    if (this.active >= 2) return invalid('VISION_CONCURRENCY_LIMIT');
    this.calls++;
    this.active++;
    const task = this.run({ doc, page, query, region, mode, max_chars }).then((result) => {
      if (result.ok) this.cache.set(key, result);
      return result;
    }).finally(() => { this.pending.delete(key); this.active--; });
    this.pending.set(key, task);
    return task;
  }

  async run({ doc, page, query, region, mode, max_chars }) {
    const started = Date.now();
    try {
      const image = await this.getPage(doc, page);
      if (!image?.bytes?.length || image.bytes.length > 12 * 1024 * 1024) throw new Error('PAGE_IMAGE_UNAVAILABLE');
      let bytes = image.bytes;
      const sharp = require('sharp');
      const metadata = await sharp(bytes, { limitInputPixels: 40000000 }).metadata();
      if (metadata.format !== 'png' || !metadata.width || !metadata.height || metadata.width * metadata.height > 40000000) throw new Error('PAGE_IMAGE_INVALID');
      if (region) {
        const left = Math.floor(region.x0 * metadata.width), top = Math.floor(region.y0 * metadata.height);
        const right = Math.ceil(region.x1 * metadata.width), bottom = Math.ceil(region.y1 * metadata.height);
        bytes = await sharp(bytes, { limitInputPixels: 40000000 }).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
      }
      const response = await this.fetchImpl(`${this.baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({ model: this.model, temperature: 0.1, max_tokens: 3000,
          messages: [{ role: 'user', content: [
            { type: 'text', text: `只依据原始页面图像回答，不能辨认的内容标为不确定。${INSTRUCTIONS[mode]}\n问题：${query}\n返回与问题相关的原文、答案、数值及不确定性，不要虚构。` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } },
          ] }] }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error('VISION_REQUEST_FAILED');
      const choice = payload?.choices?.[0];
      const answer = String(choice?.message?.content || '').trim();
      if (!answer) throw new Error('VISION_EMPTY_RESULT');
      const truncated = answer.length > max_chars || choice.finish_reason === 'length';
      return { ok: true, status: 'ok', document_id: doc.documentId, page, mode,
        result: { answer: answer.slice(0, max_chars), uncertainties: truncated ? ['视觉结果可能不完整'] : [] },
        source: { type: 'original_pdf_page', engine: 'qwen_vl', source_content_hash: doc.sourceHash, page_image_id: image.id, region: region || null },
        warnings: ['视觉识别结果未经人工核验，不等同于完整 OCR 正文', ...(truncated ? ['VISION_RESULT_TRUNCATED'] : [])],
        telemetry: { elapsed_ms: Date.now() - started, usage: payload.usage || null, finish_reason: choice.finish_reason || null } };
    } catch (error) {
      return { ok: false, status: 'unavailable', error: { code: error.name === 'TimeoutError' ? 'VISION_TIMEOUT' : 'VISION_INSPECTION_FAILED' },
        warnings: ['已解析正文不受影响'] };
    }
  }
}
module.exports = { DocumentPageVisionService };
