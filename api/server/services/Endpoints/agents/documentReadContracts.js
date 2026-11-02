// Pure tool contracts: no request, user, Repository or file state.
const DOCX_READ_TOOL = 'read_parsed_docx';
const PDF_READ_TOOL = 'read_parsed_pdf';
const { zodToJsonSchema } = require('zod-to-json-schema');
function modelDefinition(definition, schema) {
  const generated = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none', effectStrategy: 'input' });
  for (const [name, field] of Object.entries(generated.properties || {})) {
    const description = definition.parameters.properties[name]?.description;
    if (description) field.description = description;
  }
  if (definition.name === PDF_READ_TOOL) generated.required = ['action'];
  return { ...definition, parameters: generated };
}


function createDocxReadContract() {
    const { z } = require('zod');
    const definition = {
      name: DOCX_READ_TOOL,
      description:
        '查阅当前聊天中已成功解析的 Word/DOCX 正文，不执行代码、不启动沙箱、不重新解析。' +
        'action 支持 list、info、toc、search、read、read_table、read_adjacent；已有上下文不足时按关键词、章节、段落、表格或相邻内容补读。' +
        '多份文件时必须使用 list 返回的 document_id；返回结果标注截断和 next_offset，必要时继续读取。' +
        '需要图片时先 list_images 获取 image_id，再 inspect_image 携带 image_id 和 query 按需核对；不能把未命中当成全文没有该内容。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'info', 'toc', 'search', 'read', 'read_table', 'read_adjacent', 'list_images', 'inspect_image'],
          },
          document_id: { type: 'string', description: 'list 返回的稳定 Word document_id' },
          image_id: { type: 'string', description: 'list_images 返回的图片 ID' },
          file_id: { type: 'string', description: '当前聊天 DOCX 文件列表里的 file_id' },
          query: { type: 'string', description: '查找关键词；留空则按文档顺序读取' },
          chunk_id: { type: 'string' },
          section_id: { type: 'string' },
          table_id: { type: 'string' },
          adjacent_count: { type: 'integer', minimum: 1, maximum: 3 },
          paragraph_start: { type: 'integer', description: '起始段落编号，从 1 开始' },
          paragraph_end: { type: 'integer', description: '结束段落编号，包含该段落' },
          offset: { type: 'integer', description: '续读时使用上次返回的 next_offset，默认 0' },
          max_chars: { type: 'integer', description: '本次最多返回字符数，默认 20000，最大 20000' },
        },
      },
    };
    const schema = z
      .object({
        action: z
          .enum(['list', 'info', 'toc', 'search', 'read', 'read_table', 'read_adjacent', 'list_images', 'inspect_image'])
          .optional(),
        document_id: z.string().max(200).optional(),
        image_id: z.string().max(200).optional(),
        file_id: z.string().max(200).optional(),
        query: z.string().max(1000).optional(),
        chunk_id: z.string().max(200).optional(),
        section_id: z.string().max(200).optional(),
        table_id: z.string().max(200).optional(),
        adjacent_count: z.number().int().min(1).max(3).optional(),
        paragraph_start: z.number().int().min(1).max(10000000).optional(),
        paragraph_end: z.number().int().min(1).max(10000000).optional(),
        offset: z.number().int().min(0).max(1000000000).optional(),
        max_chars: z.number().int().min(100).max(20000).optional(),
      })
      .refine(
        ({ paragraph_start, paragraph_end }) =>
          paragraph_start == null || paragraph_end == null || paragraph_end >= paragraph_start,
        { message: 'paragraph_end must be greater than or equal to paragraph_start' },
      );
  return { definition: modelDefinition(definition, schema), schema };
}

function createPdfReadContract() {
    const { z } = require('zod');
    const definition = {
      name: PDF_READ_TOOL,
      description:
        '按需查阅当前聊天中已完成持久解析的 PDF，不执行代码、不启动沙箱、不重新解析。' +
        'action 支持 list、info、toc、search、find_exact、read、read_table、read_adjacent、visual_page、visual_search、inspect_page；find_exact只查不可变原文并返回真实chunk/page/上下文，视觉摘要与正文分离，续读使用 continuation_token。' +
        '正文或表格不足、乱码、图例不清或需核对原页时，先检索正文或图注定位物理页，再调用本工具 read_parsed_pdf，action=inspect_page，指定 document_id、page、具体 query 和 mode 查看原图；视觉识别不等于已验证全文 OCR。' +
        '多份 PDF 必须使用 list 返回的 document_id；只使用返回的 chunk_id、section_id、table_id 继续读取。' +
        '逐字定位、按原文顺序列出某短语的出现位置或续列匹配，使用find_exact；query填写待查原话，limit控制本次匹配数。search只返回相关性候选，不枚举出现次数；其continuation_token为空不表示全文匹配已列完。find_exact返回continuation_token时，后续轮次用同action、document_id和该令牌继续，不从旧答案猜后续命中。' +
        'find_exact的limit应与本次需要展示的匹配数一致；match_index是服务端返回的匹配序号，不可自行重编号。续读令牌越过本次返回的全部匹配，不能只展示部分后声称令牌紧接已展示处；令牌仅供工具续读，不必向用户输出长串。' +
        'search未命中或返回节选不证明全文不存在；原话数字可find_exact，默认literal保留大小写空格，必要时显式match_mode=nfkc。原文未提供的人数、因果和时态不能靠常识补全；计划与已完成分开，多项事实逐一核对。' +
        '搜索命中页不等于问题已核对：跨页问题应覆盖所有子问题，需要时read_adjacent；continuation_token表示证据尚有续文。证据充分时直接回答，避免重复相同读取。' +
        'inspect_page的status=ok仅说明输出结构完整，并非独立事实验证；partial、uncertainties或unavailable不得用于确定性补全图例、数字或单位。不清楚时说明限制，不能猜测。' +
        'inspect_page的query应保留用户原问题的年份、比较范围和需要回答的属性，不要缩成几个主题关键词。整页小字看不清且返回resolution_limited时，可依据刚读到的页面布局用region核对；不得猜MinerU bbox坐标系。回答不要附加没有证据支持的数量。' +
        'read_table可带query聚焦具体型号或术语；表格rows为原始行列，保留行号。不能根据其他型号推断空白单元格。需要多步、批量或精确小数运算时，可把已核实且带页码的数据交给execute_code计算，简单计算可直接完成。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'info', 'toc', 'search', 'find_exact', 'read', 'read_table', 'read_adjacent', 'visual_page', 'visual_search', 'inspect_page'],
            description: 'search发现相关证据；find_exact按解析原文顺序逐字匹配和分页；read/read_adjacent核对正文；inspect_page核对原图。',
          },
          document_id: { type: 'string' },
          query: { type: 'string' },
          context_chars: { type: 'integer', minimum: 0, maximum: 2000 },
          page: { type: 'integer', minimum: 1, maximum: 100000 },
          mode: { type: 'string', enum: ['auto', 'text', 'table', 'figure', 'formula'] },
          block_id: { type: 'string', description: '检索返回的 MinerU 块 ID，可读取已验证映射的图块；图例或坐标轴上下文不全时省略此项读取原页。不能与 region 同用。' },
          region: { type: 'object', description: '旋转后页面图像的归一化坐标，左上角为原点，范围 0 到 1。', properties: { x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } }, required: ['x0', 'y0', 'x1', 'y1'] },
          pages: { type: 'array', items: { type: 'integer' } },
          chunk_id: { type: 'string' },
          section_id: { type: 'string' },
          table_id: { type: 'string' },
          adjacent_count: { type: 'integer', minimum: 1, maximum: 3 },
          offset: { type: 'integer', enum: [0], description: '仅兼容首次读取；续读必须使用 continuation_token。' },
          coverage_offset: { type: 'integer', minimum: 0, maximum: 100000 },
          catalog_offset: { type: 'integer', minimum: 0, maximum: 100000 },
          max_chars: { type: 'integer', minimum: 100, maximum: 20000 },
          limit: { type: 'integer', minimum: 1, maximum: 12 },
          continuation_token: { type: 'string' },
          include_visual_summary: { type: 'boolean' },
        },
        required: ['action'],
      },
    };
    const schema = z.object({
      action: z.enum(['list', 'info', 'toc', 'search', 'find_exact', 'read', 'read_table', 'read_adjacent', 'visual_page', 'visual_search', 'inspect_page']).optional(),
      document_id: z.string().max(200).optional(),
      query: z.string().max(1000).optional(),
      match_mode: z.enum(['literal', 'nfkc']).optional(),
      context_chars: z.number().int().min(0).max(2000).optional(),
      page: z.preprocess(value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? Number(value) : value, z.number().int().min(1).max(100000)).optional(),
      mode: z.enum(['auto', 'text', 'table', 'figure', 'formula']).optional(),
      block_id: z.string().optional(),
      region: z.object({ x0: z.number().min(0).max(1), y0: z.number().min(0).max(1), x1: z.number().min(0).max(1), y1: z.number().min(0).max(1) }).strict().optional(),
      pages: z.array(z.number().int().min(1).max(100000)).max(30).optional(),
      chunk_id: z.string().max(200).optional(),
      section_id: z.string().max(200).optional(),
      table_id: z.string().max(200).optional(),
      adjacent_count: z.number().int().min(1).max(3).optional(),
      offset: z.literal(0).optional(),
      coverage_offset: z.number().int().min(0).max(100000).optional(),
      catalog_offset: z.number().int().min(0).max(100000).optional(),
      max_chars: z.number().int().min(100).max(20000).optional(),
      limit: z.number().int().min(1).max(12).optional(),
      continuation_token: z.string().max(16384).optional(),
      include_visual_summary: z.boolean().optional(),
    });
  return { definition: modelDefinition(definition, schema), schema };
}

module.exports = { createDocxReadContract, createPdfReadContract };
