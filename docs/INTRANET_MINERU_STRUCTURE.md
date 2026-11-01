# 内网 MinerU 产物结构

核对日期：2026-11-01。依据用户在内网运行只读 Mongo 查询、文件检查和 Python 结构统计的输出；样本为一份于 2026-10-31 解析的 PDF。以下是该样本的实际结果，不保证其他 PDF、MinerU 版本或配置完全相同。未记录文档正文、图片内容或凭据。

## 响应与产物

该样本保存的 `mineru_result.json` 顶层是对象，包含：

| 字段 | 实测类型 | 本样本 |
| --- | --- | --- |
| `md_content` | 字符串 | 8184 个字符 |
| `content_list` | 字符串 | 36225 个字符，内容为 JSON |
| `images` | 对象 | 18 项 |

单独持久化的 `mineru_content_list.json` 顶层为数组，共 146 项；该文件约 25 KB，`mineru_result.json` 约 554 KB。字符数和文件大小分别是不同度量，不直接比较。

同一 PDF 的 Mongo 记录还列出 MinerU Markdown、chunks JSONL、完整 result、18 个独立 JPEG 产物、profile 和 smart manifest。这证明本样本有相应持久化记录及上述两个 JSON 文件存在；本次没有逐一读取 18 个独立图片文件确认其内容。

## content_list 字段

| 字段 | 类型 | 出现次数 | 已知含义或限制 |
| --- | --- | ---: | --- |
| `type` | 字符串 | 146 | 块类型 |
| `bbox` | 数组 | 146 | 样例为 4 个整数；坐标系、单位、旋转与精度尚未验证 |
| `page_idx` | 整数 | 146 | 页索引；该样本未单独核验起始值与物理页的对应关系 |
| `text` | 字符串 | 128 | 文本内容 |
| `text_level` | 整数 | 29 | 层级字段；具体语义尚未核验 |
| `img_path` | 字符串 | 18 | 图片或表格块的图片路径；与 `images` 键的对应关系尚未逐项核对 |
| `image_caption`、`image_footnote` | 数组 | 各 16 | 图片标题和注释字段；本次展示的样例为空数组 |
| `content` | 字符串 | 16 | 图片块中存在；具体含义尚未核验 |
| `table_caption`、`table_footnote` | 数组 | 各 2 | 表格标题和注释字段；本次展示的样例为空数组 |
| `table_body` | 字符串 | 2 | 表格内容；是否为 HTML、结构是否完整尚未核验 |

块类型分别为：`text` 101、`image` 16、`header` 14、`footer` 10、`page_number` 3、`table` 2。字段统计只表明类型和存在情况，不证明 OCR、阅读顺序、表格内容或坐标准确。

## 图片编码

对本样本 `result.images` 的 18 个值逐项执行严格 Base64 解码并检查文件头：全部是带 `data:image/jpeg;base64,` 前缀的字符串，解码后均具有 JPEG 文件头。并未检查图片是否可完整解码或逐一与独立持久化图片比对。

`content_list` 中有 16 个图片块和 2 个表格块，合计 18 个 `img_path`；数量与 `images` 的 18 项一致，但尚未逐项匹配路径，因此不能断言一一对应。这些可能是图片或表格区域，不应视为完整 PDF 页面。

## 存储定位

用户内网输出确认项目目录为 `/root/ai/backend/LibreChat-main`。该样本两个 JSON 文件实际存在于：

```text
/root/ai/backend/LibreChat-main/sandbox/codeapi-data/storage/<storage_session_id>/<file_id>
```

Mongo `LibreChat` 数据库的 `sansuofiles` 中，关联产物记录有 `sandboxSessionId`、`sandboxFileId` 和 `metadata.codeEnvRef`；后者包含 `storage_session_id`、`file_id`。同一源 PDF 可通过 `userId`、`conversationId` 和 `metadata.rootSourceLibreFileId` 组合定位关联产物。这里记录的是本次核实的路径，不证明内网永远使用该配置。

## 与源码的关系

隔离 GitHub 工作分支 `codex/pdf-page-vision-wip-20261031` 的 `api/server/services/Files/Code/process.js` 会尝试把字符串 `content_list` 解析成数组，提取文字、表格正文等内容生成 chunks，并将 `page_idx + 1` 用于页码。该转换是源码行为，本次未核实内网运行文件与该分支一致，也未独立验证实际页码映射。

同一工作分支的 `DocumentTables.js` 支持从 `table_body` 解析 HTML；本样本 `table_body` 格式尚未核验，不能据此声称已成功解析表格。chunks 构建路径未写入 `bbox`；当前没有运行证据证明内网 Agent 已使用坐标读取页面证据。

## 待核实

- 不同 PDF 和 MinerU 版本的返回字段、图片格式、空字段及异常响应。
- `page_idx` 起点与物理页的映射；`bbox` 坐标系及页面旋转处理。
- 18 个 `img_path` 与 `images` 键、独立图片产物是否逐项对应，以及图片是否完整可解码。
- 两条 `table_body` 的实际格式、表头与单元格关系，以及跨页表格处理。
- 内网运行代码与 GitHub 工作分支的差异，以及 Agent 实际使用哪些字段。


## 2026-11-01 外网开发实现补充（不代表内网已升级）

本轮工作副本增加 `_mineru_blocks.json`，将本说明列出的原始字段、bbox、阅读顺序、父块ID、表格/图像关联保留在统一结构中；不再只依赖扁平 Markdown。云端 ZIP 图片以完整规范化相对路径保存映射，实际存储名使用来源绑定 image ID，manifest 记录真实 artifact ID。内网旧版字符串 content_list 与 Data URL images 继续兼容。

内网本样本的坐标、18个图片的精确匹配仍待内网运行验证；外网六份真实云端资产的验证不能替代内网验证。MinerU bbox 仍标未知，不自动作为精确裁剪坐标。FITZ原页使用实际上传PDF。

云端 `_origin.pdf` 可能经过重写，不能把其文件SHA当上传PDF的SHA：六份真实资产字节均不同，16个抽样页面渲染相同。云端使用认证任务返回的 data_id 绑定上传SHA，另存云端PDF SHA；内网无云端任务字段时保持未知，不伪造。详见 `PDF_PAGE_VISION_IMPLEMENTATION.md`。
