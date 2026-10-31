type FileLike = {
  type?: string;
  filename?: string;
  filepath?: string;
};

export type SanSuoToolRoute = {
  executeCode: boolean;
  reason: string;
};

const sandboxIntentPattern =
  /(生成|创建|导出|下载|保存|另存|转成|转换|转化|打包|压缩|解压|运行|执行|复现|精确计算|清洗|画|绘制|图表|可视化|折线图|柱状图|饼图|热力图|仪表盘|函数图|函数图像|曲线图|走势图|分布图|散点图|正弦|余弦|正切|sin|cos|tan|代码|脚本|报错|错误)/i;

const fileMutationPattern =
  /(修改|改写|重写|调整|替换|删除|插入|追加|扩写|续写|补充|完善|丰富|合并|拆分|重新排版|改格式|改字体|改颜色)/i;

const fileReadIntentPattern =
  /(读取|读一下|看一下|识别|解析|总结|概括|提取|检查|转换|转化|转成|导出|生成|这个文件|附件|文档|表格|pdf|docx?|xlsx?|pptx?|csv|txt)/i;

const explicitFileReferencePattern =
  /(这个文件|附件|文档|表格|上传|pdf|docx?|xlsx?|pptx?|csv|txt)/i;

const imageOnlyPattern =
  /(描述|识别|看|分析|解释).{0,12}(图片|截图|照片|图像)|图片.{0,12}(内容|是什么|说明|描述)/i;

const boundedPlainTextPattern = /[0-9０-９一二三四五六七八九十百千万]+\s*字/i;
const explicitArtifactPattern =
  /(文件|附件|下载|导出|保存|word|docx?|pdf|excel|xlsx?|pptx?|csv|txt|zip|图片|图像|图表|代码|脚本)/i;

function isImageFile(file: FileLike): boolean {
  const type = file.type ?? '';
  if (type.startsWith('image/')) {
    return true;
  }
  const name = `${file.filename ?? ''} ${file.filepath ?? ''}`.toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif|tiff?)($|\?)/.test(name);
}

export function routeSanSuoTools(text: string, files: FileLike[] = []): SanSuoToolRoute {
  const normalizedText = text.trim();
  const hasFiles = files.length > 0;
  const hasNonImageFile = files.some((file) => !isImageFile(file));
  const hasImageFile = files.some(isImageFile);

  if (
    hasImageFile &&
    imageOnlyPattern.test(normalizedText) &&
    !sandboxIntentPattern.test(normalizedText)
  ) {
    return { executeCode: false, reason: 'image_understanding_native_vision' };
  }

  if (
    boundedPlainTextPattern.test(normalizedText) &&
    !explicitArtifactPattern.test(normalizedText)
  ) {
    return { executeCode: false, reason: 'bounded_plain_text' };
  }

  if (fileMutationPattern.test(normalizedText) || sandboxIntentPattern.test(normalizedText)) {
    return { executeCode: true, reason: 'explicit_sandbox_intent' };
  }

  if (hasNonImageFile || (hasFiles && fileReadIntentPattern.test(normalizedText))) {
    return { executeCode: false, reason: 'file_read_deferred_to_server' };
  }

  if (explicitFileReferencePattern.test(normalizedText)) {
    return { executeCode: false, reason: 'referenced_file_read_deferred_to_server' };
  }

  return { executeCode: false, reason: 'plain_chat' };
}
