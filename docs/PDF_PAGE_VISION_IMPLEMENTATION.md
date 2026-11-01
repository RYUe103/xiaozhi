# Phase 5 最终验收更新（2026-11-01）

本轮权威入口为 `evidence/phase5-final-20261101/REPORT.md`。HEAD `0730ded`，最终未提交改动绑定 `final-source.json`；r6实验另绑定`r6-source.json`，不可混淆。**未达到生产部署门槛，没有总体准确率或速度改善的可靠结论。**

已核实r5实际完整：基线/候选各7题，核心gold匹配5/7与4/7；附加事实错误另计。补跑独立r6，基线完成5/7、核心2/7，候选完成6/7、核心4/7；候选表格仍自然流中断，海报/树图仍视觉事实错误。小样本及外部服务抖动明显，P50/P95不代表SLA。

保留修复：Repository无selector的read+query使用原异步检索；资产授权签名加入解析代际/完成状态/版本；FITZ长文档布局用临时JSON文件传递，修复真实72页结果超过stdout 1MiB。原页/局部按需视觉能力保留。自动追加局部VL真实实验无收益，已撤回，补丁和失败证据保存。

最终15组257项测试通过，真实缓存/权限/版本/查询工具级12项通过。普通聊天、Word跨轮、CSV实际执行、Excel真实HTTP已有通过；人工ECONNRESET在工具前后各安全重试一次、工具只执行一次成功。自然流中断能明确保存失败，但连接稳定性、视觉整答准确率、最终完整A/B、真实内容更新后重解析恢复仍未验收。全100题未扩展，gold及历史失败未改，生产/内网/.env未改。报告详细记录实验版本、性能分段、未完成项和所有失败。

---

# Phase 5：真实 Agent 稳定性、准确率和性能（2026-11-01，实施中）

本节及 `evidence/phase5-20261101/REPORT.md` 为本轮入口。下方旧阶段文字保留历史语境；其中“未持久化视觉结果”“未保存云端 ZIP”等已被后续 MinerU 实施替代，不能视为当前状态。当前基线为 `f345e17`（远端已核对），不将历史 B6 定点成绩与本轮混算。

本轮沿用现有 Repository、MinerU/FITZ/Qwen VL 与 read_parsed_pdf。新增模型 HTTP 有界瞬时重试；已交付的流不重播，不重跑工具图。无法恢复时保存明确失败文本及 error 标志。视觉识别保留原始输出，图例绑定缺证据或截断为 partial，结构完整不代表事实正确。

A0 海报旧失败发生在 VL 之前：180DPI 渲染超过 4000 万像素解码上限。FITZ 现按像素预算渲染整页，局部区域从 PDF 直接重渲染，并绑定 source hash、renderer version、region 与实际 DPI。布局坐标导出仍是可选辅助；不把未经验证的 MinerU bbox 直接当裁剪坐标。

真实 r4 海报 Agent 自动定位 → inspect_page → FITZ → Qwen VL 已取得正确学期，但附加数值仍有事实错误。缓存/撤权/源版本变化工具级真实验证已通过。当前不能据此宣称全部准确率或性能验收完成，更不能部署内网生产。最终逐批结果及未完成项以独立报告为准。

---

# MinerU 云端与按需视觉读取实施记录

更新：2026-11-01。本地分支/HEAD与GitHub远端已核对为ff2304f；main为5fe1760。首次远端请求超时，后续重查成功，证据为remote-check.json（临时工作副本无origin remote，使用明确仓库URL核对）。代码恢复点/对照基线：`ff2304fb7853673393b5e69eec2fdcbc6db3b3b0`；分支 `codex/pdf-page-vision-wip-20261031`。开发副本 `/tmp/xiaozhi-publish-20261031`。以下为本轮事实；后文历史段落中的“ZIP 未保存、视觉结果无引用、只有合成 PDF 测试”等说法已被本轮实现取代，历史失败没有删除。

## 结论与部署边界

本轮已改源码，并运行真实公开 PDF 的云端解析、隔离 HTTP 上传、Agent/ToolNode、Qwen VL、追问、普通聊天、Word 和权限回归。**链路已有成功记录，整体准确率和性能验收仍有失败，不可据此直接部署内网生产。** 模型输出 `ok` 只表示完整且通过结构检查，不证明数字和图例事实正确。

未改实际 `.env`、内网服务、生产数据库、原百题 gold 或旧结果；没有自动提交/推送。测试 API 为容器中的独立副本、端口 3183（候选）/3184（基线），分别使用 `LibreChatMineruVision20261101` / `LibreChatMineruVisionBaseline20261101` 数据库。默认仍为内网同步 `/pdf_parse`；云端模式仅允许服务端配置 SHA256 白名单中的测试 PDF。

## 文件与关键实现

| 文件 / 函数 | 实际缺陷与修改 |
| --- | --- |
| `api/server/services/Files/Code/mineruCloud.js`：`normalizeAssetPath`, `validateTarget`, `readArchive`, `convertArchive`, `parseMineruCloud` | 保留 ZIP 相对路径；拒绝绝对路径/穿越/重复路径/符号链接/加密和未知文件类型。主 Markdown 优先明确的 `full.md`，兼容唯一旧式 MD；多候选、坏 JSON、缺图映射明确报错。逐流计数实际解压字节，校验 CRC32、SHA256，图片全解码与像素上限。 |
| 同上：网络及来源 | HTTPS、精确主机白名单、DNS 公网检查并固定连接地址、禁用环境代理；下载重定向逐跳检查，带认证请求不重定向。总期限与取消传给请求、轮询、DNS等待和解包；仅 GET/PUT 的临时网络错误有限重试，创建任务 POST 不盲重试。通过上传字节 SHA256、认证 batch 和返回 `data_id` 联合绑定来源；缺失/错配 data_id 拒绝。ZIP 中 `_origin.pdf` 是云端重写资产，单独记录其 SHA 和差异警告，不能冒充上传源。错误只保留阶段、任务 ID、HTTP/网络错误码及耗时，不保存签名 URL/认证头。 |
| `api/server/services/Files/Code/mineruStructure.js`：`buildMineruStructure` | 新结构化块生成器，直接接入原上传/Repository 链路。稳定且来源绑定的 block/image/table ID，保留原始块、阅读顺序、页索引、标题级别、bbox、图注、脚注及公式。正文按段落切片，表格/公式整块保留；页眉页脚页码保存在 blocks，退出普通正文检索。 |
| `api/server/services/Files/Code/process.js`：`buildSanSuoMineruArtifacts`, `preparseSanSuoPdfOnUpload`, `recordSanSuoHiddenCodeOutput` | 原始 ZIP、清单、脱敏 provenance 与 blocks 真实持久化；磁盘/存储文件名用 image ID，路径保存在元数据及最终 manifest 的 `image_artifacts`，映射到真实 `image_artifact_id`。最后写入提交 manifest，未完整保存不报告完整 ready；Repository 只使用已提交 generation，避免部分失败/并发代际混合。 |
| 同上：`ensureSanSuoPdfPageArtifacts` | 修复真实 Agent 中“渲染成功却找不到图片”的返回结构不兼容：返回 `libreFileId/displayFilename/sandboxSessionId/sandboxFileId/metadata`，同时保留旧字段。原 PDF SHA 核验、页面图片 SHA 持久化及读取核验。 |
| `api/server/services/Files/Pdf/render_pages.py` | 新增 `--metadata-only` 独立读取真实物理页数，不把 content_list 最大页索引当完整性证据；`--text-only --layout` 用于 FITZ fallback，保存块、行、span、坐标、page rect，不提前渲染整份 PDF。 |
| `api/server/services/DocumentArtifactRepository.js` / `DocumentContextService.js` | 加载 blocks 并贯穿 chunk/hit 元数据，保留表格/图块关联；按源 hash 和已提交 generation 选择资产。已有FITZ产物时为MinerU缺页补证据，明显乱码页有可用FITZ时替换，避免同页重复堆积。保留标题层级。未知页码继续未知。 |
| `api/server/services/DocumentTables.js`, `DocumentTableFocus.js`, `DocumentToolResult.js` | 结构化表格关联真实父块；聚焦行保留合并组；紧凑输出和预算计算保留 rowspan/colspan，防止把同一实体拆成多行独立实体。本轮在论文 Table II 真实验收中发现此问题。 |
| `api/server/services/DocumentPageVisionService.js` | 原始模型输出与结构化 text/cells/series/uncertainties 同时保留；截断、`finish_reason=length`、schema 错误及显式不确定均返回 partial。保留真实原页引用，新增持久结果缓存接口、请求内并发去重及同页渲染合并。缓存绑定用户、会话、文档、源 SHA、同页解析证据版本、模型、提示版本及问题。 |
| `api/app/clients/BaseClient.js` | 有 Repository/原页读取能力时移除阻塞式全页 VL 摘要；MinerU成功直接检索。无正文的扫描 fallback 也注册读取工具。真实引用通过原有消息元数据保存和追问恢复；视觉原始结果写入隔离的 `sansuo_page_vision_results`，7天TTL，先授权后读缓存。 |
| `api/server/services/Endpoints/agents/sansuoToolPolicy.js` | 沿用 `read_parsed_pdf` 的 `action=inspect_page`，未增加独立工具。加入 block_id、数字页码字符串兼容与缺 action 的明确错误；缺摘要返回正文候选页与准确的下一步工具名称，避免模型把 inspect_page 误当独立工具。 |

## 关键定位（当前工作副本）

- `mineruCloud.js:28/78/128/228/305`：路径、目标地址、流式ZIP校验、主产物及图片映射、上传与任务绑定。
- `mineruStructure.js:30`：统一结构化块与父块chunk。
- `process.js:287/905/1065/2468`：按需原页、产物生成、上传预解析和隐藏资产记录。
- `DocumentArtifactRepository.js:99/166/496`：提交代际选择、blocks加载、不可用视觉摘要的真实原页入口与词法候选页。
- `DocumentPageVisionService.js:13/78/229`：结构验证、授权/缓存/预算、实际渲染和Qwen请求。
- `BaseClient.js:2191/2195/3553/4737`：持久视觉结果、图片hash检查、跳过全页摘要、跨轮引用恢复。
- `DocumentToolResult.js:14`：紧凑输出保留合并单元格；`render_pages.py:14`：布局/仅元数据/仅文字渲染参数。
- `DocumentVisualPolicy.js:5`：当前已使用 `plausible`，不是 `verified`；`DocumentArtifactRepository` 生成文字质量指标。该字段不证明OCR事实准确，新按需链路也不依赖逐页摘要兜底。

## 向量冷索引的实际修复

final5扫描件虽读出正确核心答案，但Vector在40次请求后触发 `VECTOR_REQUEST_BUDGET_EXCEEDED`，耗时16.108s却无向量候选；这由结构化块变多暴露。`DocumentVectorSearch.js` 保留现有分段、原文、向量缓存和RRF，增加完整缺失量预检、4批并发及默认256次有限预算；百炼每批仍10段，不删证据。预算不足先失败，避免花完请求后丢弃整条通道；批次失败等待已启动请求收尾。450块尾部证据与并发上限测试通过。final6单独重新验收扫描件/普通文档，结果不能混入final5。

## 统一产物契约

云端转换和内网输出均进入原 `buildSanSuoMineruArtifacts`：`md_content` 为完整 Markdown，`content_list` 可为 JSON字符串或数组，`images` 可为 Base64/Data URL 映射。原 content_list 保留，不将 VL summary 写作完整 OCR 正文。

新增派生产物：

- `_mineru_blocks.json`：`version=mineru-structure-v1`, `source_document_id`（根 LibreChat file ID）, `source_sha256`, `parser_version`, `blocks[]`, `images[]`。工具 `document_id` 仍是用户范围内 Repository 的逻辑 ID。
- block：`block_id`, `source_document_id`, `source_sha256`, `parser`, `parser_version`, `page`, `original_page_idx`, `page_mapping`, `raw_type`, `reading_order`, `text`, `title_level`, `bbox`, `coordinate_system`, `geometry_verified`, `table_id`, `image_id`, `image_path`, `image_mapping_verified`, `caption`, `source_block_index`, `raw`。
- chunk：父块信息加 `chunk_id/text/text_chars/page_start/page_end`。超长正文可多 chunk 共用父 block；table/equation/formula 不任意切开。旧 sparse content_list 仍允许以完整 Markdown 一次性兜底，页码未知，原结构另存，不重复索引两份全文。
- `_mineru_original.zip`：云端原始归档，包括原 PDF、layout/model/v2 清单等原始文件；转换不支持的 v2-only 输出明确失败。
- `_mineru_provenance.json`：provider/protocol/adapter/model（服务未返回实际版本则 null）、任务 ID、状态、时间分段、PDF/ZIP SHA、输出文件原路径/规范路径/大小/SHA及警告。`_mineru_result.json` 是规范化转换结果，不能称作原始云端HTTP响应。
- `_smart_manifest.json`：最后提交的 generation、来源 hash、完整状态、`image_artifacts[]`（原始路径、规范路径、image ID、真实 artifact ID、存储文件名）。同名不同目录的图片不冲突。
- 内网没有云端任务/ZIP时保留缺省未知字段，继续使用既有同步Provider；内网图片路径只做精确或唯一 `images/` 前缀兼容，不能凭 basename 猜多义关联。

真实资产复核发现六份 `_origin.pdf` 均与上传源字节 SHA 不同；六份页数一致，首/中/末共16个抽样页面尺寸和渲染像素SHA完全一致。此前直接要求字节相等的修复错误触发fallback，batch4失败保留；final5改为认证任务返回data_id校验。证据：`provider-pdf-reserialization.json`。此采样不证明每个provider资产逐字相同；原页渲染始终使用实际上传源。

ZIP预算：压缩归档100 MiB；通常单条目32 MiB，归档内原PDF独立100 MiB；总实际解压256 MiB；10000条目；压缩比1000；单图4000万像素。91页真实扫描件原PDF为33,875,317字节，曾触发原单条目限额；失败保留后才调整原PDF独立上限，未取消总量和实际流计数。

## 坐标、原页与图块的使用边界

- 六份真实PDF的 `page_idx` 都在原PDF范围内；分别覆盖全部72、21、1、91、30、6个物理页。
- 四份有文字层PDF抽样97个可匹配文本块，在 `bbox/1000 × page size` 假设下都覆盖目标文字超过50%；财务图块与原页裁剪也做了并排像素内容核对。**这不是对任意 MinerU 版本/旋转页坐标协议的全面认证**，所以 MinerU bbox 仍标 unknown / geometry_verified=false，不直接用它自动精确裁剪。
- FITZ fallback 的 layout 已进入 chunks/hits（PDF points、page_rect）。`inspect_page.region` 使用旋转后页面图像的0–1坐标，不能直接填 MinerU bbox 或 PDF points。
- 已验证路径和hash的图块可用于 text/formula 模式；figure/table/auto 默认原页，以保留图例/表头/单位上下文。真实财务图块只有饼图，图例在图块外，证明“图像存在且数量匹配”不足以判成功。
- 视觉引用包含 document_id/page/source_sha256/image_id/visual_result_id/vision_version/model/region，以及可靠时的 block/table关联。缺关联返回null，不捏造 chunk ID。追问按源版本/用户/会话检查后恢复原物理页。

## 真实样本与证据

固定选自既有百题，问题及 gold 原样冻结在独立批次，未传给解析器或Agent。完整原始资产在本机工程记忆目录 `evidence/mineru-vision-20261101/`；仓库交付仅包含必要的测试记录/摘要，避免重复提交大型公共PDF、Base64图片和签名链接。

| PDF | 页数 | 原始块 | 图片 / 映射块 | 首个成功云端适配器耗时 |
| --- | ---: | ---: | ---: | ---: |
| NETFLIX_2015_10K.pdf | 72 | 793 | 56 / 55 | 103.584s |
| 2312.10997v5.pdf | 21 | 398 | 10 / 10 | 43.369s |
| academic--DUDE_65b9e17aa028acda5ec3d594f2327ad0.pdf | 1 | 37 | 7 / 7 | 3.588s |
| mi_phone.pdf | 30 | 222 | 80 / 80 | 33.619s |
| finance--DUDE_2879a049d77aae9eccbedf4e9af7ac70.pdf | 6 | 33 | 7 / 7 | 9.959s |
| 41489021-892f-5f2a-9c49-d0515dad08a2.pdf | 91 | 1142 | 65 / 65 | 183.267s（第4次独立资产批次） |

最初批次5/6成功，扫描件先后有请求/转换失败、原PDF大小超限、宿主休眠期间超时；不能把最后一次成功包装为首次100%成功。Netflix多出1张无content_list引用的图片保留在资产清单，不能擅自分配给某块。

真实资产离线 Repository：图像hash映射全部核对，所有检索chunk可追溯父块；论文4表、Netflix53表、财务6表能解析为结构化表。这是结构有效性，不是所有单元格内容准确率。扫描题三段原始标注（65/81页共266个规范化字符）均完整出现在OCR结果；仅为这三段标注覆盖，不是91页全文OCR准确率。

离线 Keyword/BM25/RRF 在这六份文档24道原题上，21道有标注页的宏平均页召回为78.57%；它不包含Vector、重排、Agent和最终答案，也不是片段事实召回率。完整线上阶段与最终答案另见本轮A/B记录。

## 端到端、性能和失败记录

- 已有真实HTTP上传→云端任务→持久资产→Repository→Agent自动定位→按需FITZ→真实QwenVL→最终回答→引用保存的成功记录。财务第3次运行自动定位第2页，首次162.376s；VL24.858s/3950 tokens，追问18.492s。该答案含图中1%与类别，但不等于通过原gold（原gold还要求颜色）；后续运行确有颜色/类别错绑。
- 独立基线A为ff2304f，候选B分别保留batch2/batch3/batch4；不删除早期失败，不把各批次最好答案拼成一个成功批次。A/B各自有真实上传和Agent，页码由Agent选择。`read_parsed_pdf` 原图能力不是通过测试代码指定答案页验证。
- 在真实追问中记录到 `DocumentReferenceRestored` 的 original_pdf_page、visual_result_id 和第2页，随后Agent读取同页。持久缓存有单测；实际命中数量以运行事件为准，不能把复用页面PNG算成复用VL答案。
- 宿主系统发生多次睡眠/唤醒，已保存 `host-sleep-wake.txt`；受影响的分钟/小时级样本仍保留，单独标明，不用于“速度提升”的主张。
- 不再默认逐页VL摘要。91页源在云端失败后的FITZ文字/布局fallback曾约441ms，只存3份元数据产物且没有预生成页面PNG；该扫描件没有文字层，不能因此声称完成OCR。原历史475s全页VL与本次数据不是严格同环境同模型A/B，不能直接给出提速倍数。
- 普通聊天真实HTTP、合成Word上传读取17天、跨用户消息隔离通过；Word是回归夹具，不冒充真实复杂PDF验收。普通聊天有较大模型响应波动，不能由一次回归声称性能稳定。

最终数值与逐题判定见 `evidence/mineru-vision-20261101/` 的批次摘要。对未独立人工逐字标注的正文/表格/公式不提供虚假的“解析准确率”；图例、细小数字、跨页表格/型号关系及普通文字PDF的稳定P50/P95仍需更多固定重复样本验收。

## 本轮最终验收结论

详见仓库 `evidence/mineru-vision-20261101/REPORT.md`，逐题结果、旧失败、冻结gold、实际工具输出、脱敏事件与源码hash同目录保存。

- 最新源码14组270项单测通过。真实六份复杂PDF均有成功云端资产；最初成功率5/6，不能抹掉扫描件重试。真实HTTP聊天、Word、外用户隔离通过。
- B5真实财务完整链路：首次88.544s，Agent自动选第2页，按需FITZ，1次成功QwenVL（23.140s、4386tokens），原页引用保存及追问恢复已验证。最终颜色与冻结gold不一致，严格答案验收仍失败。
- B5复杂表II已正确回答PopQA/MS MARCO/SST-2；Netflix数值正确。学术海报VL失败、树图VL超时及主模型连接错误、phone连接错误全部保留，不能包装成完整成功批次。
- B6仅定点扫描件/phone：两题核心答案均匹配。扫描件自动检索/读81页，首轮证据含65/81；0次VL，完整答复256.946s，解析任务182.463s。Vector完整索引9.429s返回30候选，替代B5预算耗尽16.108s无候选。phone85.649s。
- 固定共同六题A核心匹配4/6（树图附加计数不可靠）、B5匹配2/6（含两题连接失败）。B6的2/2是独立定点回归，不并入B5、不代表100题准确率。原gold字节SHA与原百题完全一致。
- A共同六题P50/P95为128.237/154.007s；B5为117.867/374.623s。无证据证明总体尾延迟改善或普通文字非退化；详细分段数据、失败与宿主睡眠单列。
- OCR精度没有全文gold；扫描三条标注266字符全部覆盖只能报告标注召回。实际Tool片段覆盖与首轮页级交付分开统计。未出现可确认的持久VL缓存命中，不能把单测和页面PNG复用当实际模型缓存命中。
- 3183/3184隔离测试API已停止，数据库/原资产保留；实际服务/.env/内网未替换，未提交推送。**目标尚未全部验收通过，不能直接部署生产。**

## 可重复验证与遗留项

使用隔离服务端环境，不覆盖实际 `.env`：设置 `SANSUO_MINERU_MODE=cloud`、`SANSUO_MINERU_CLOUD_URL`、`SANSUO_MINERU_CLOUD_API_KEY`，并将获许可PDF的SHA加入 `SANSUO_MINERU_CLOUD_ALLOWED_SHA256`。额外主机只能由服务端 `SANSUO_MINERU_CLOUD_ALLOWED_HOSTS` 精确配置。大文档测试进程将现有解析任务/门控超时统一配置为600s；默认生产配置没有改动。

脚本：`run-mineru-assets.cjs`（真实云端、必须新输出目录）、`check-mineru-repository.cjs`（真实资产离线加载）、`measure-mineru-retrieval.cjs`（离线词法指标）、`run-page-vision-e2e.cjs`（真实上传/Agent/追问）、`run-mineru-regression.cjs`（独立HTTP普通聊天/Word/权限）。Mock单测与工具级记录不能替代Agent验收。

仍待完成或不足：全量100题新批次、全面OCR/公式与单元格内容gold、旋转/裁切页面坐标协议认证、更多真实跨页表格/型号对应、网络故障/源更新后的完整HTTP恢复矩阵、跨进程同页渲染互斥，以及足够重复次数的普通文字PDF性能非退化证明。已有缓存/版本/部分失败单测不能替代这些真实场景。云端任务失败时继续提供明确的部分能力，不能把FITZ空文字层伪称成功OCR。

---

# 历史记录（保留，当前状态以上述更新为准）

# PDF 按需视觉读取：阶段性实现

日期：2026-10-31。基线：`5fe17600c59598f0eee19fe2f48bbe62b5876f07`。

## 2026-11-01 真实 Agent 进展

- 隔离 API 和独立 Mongo 库中，真实 HTTP 首次上传原百题 PDF 后，Agent 自动定位物理第 81 页，先调用 `visual_page`，再两次调用 `inspect_page`；两次真实 Qwen VL 分别耗时 4032ms、8674ms，使用 2830、3042 tokens。完整请求耗时 573836ms；此前 91 页首次视觉摘要约 475533ms。仅此一次无法计算 P50/P95，也不能代表普通文字 PDF 性能。此运行使用复制时的代码，未包含随后修改的 BaseClient 隐藏指令和其他最新修复。
- 本次最终回答补充了此前缺失的民族互促互融等内容，但原页复核记录指出受访者姓名不同，且回答遗漏宣讲深入浅出及获得掌声；因此不能判定该题通过。视觉结果的 `status=ok` 仅表示返回格式及结束状态合格，不证明识别事实正确。引用元数据指向 `visual_page` 的摘要 chunk，而非两次原页视觉结果，精确证据绑定仍待实现。该运行复用预处理生成的页图，不能证明缺图时按需 FITZ 渲染的端到端链路。
- 真正的 ToolNode 测试以原百题题目和指定页调用真实 Qwen VL，返回结构化结果，耗时 15028ms、2774 tokens；由测试代码指定页并注入授权，不能替代完整 Agent 验收。
- `process.spec.js` 依赖问题已通过隔离目录依赖链接解决，113 项通过。文档上下文（含 Word）、文件权限、通用权限及 Repository 安全测试另外 4 组 113 项通过；这些为单元测试，并非真实 Word 对话或跨用户 HTTP 访问。
- 完整原方案/新方案 A/B、其余视觉失败矩阵、正常文字 PDF 性能及真实 Word、普通聊天、权限回归仍未完成；缓存命中率及 P50/P95 未取得。当前不能部署。需优先处理全页预处理延迟、识别可靠性及原页结果引用，再使用最新代码重新执行端到端和冻结样本对照。原百题 gold 和旧结果未修改。

## 本机 MinerU 云端测试接入

- 工作副本新增 `api/server/services/Files/Code/mineruCloud.js`，云端模式创建上传任务、上传 PDF、轮询并转换结果 ZIP 为既有 MinerU 产物。启用需在隔离测试进程设置 `SANSUO_MINERU_MODE=cloud`、`SANSUO_MINERU_CLOUD_URL` 和 `SANSUO_MINERU_CLOUD_API_KEY`；不设置云端模式时原同步接口不变。云端服务会接收上传的 PDF。
- 真实云端合成 PDF：适配器直接调用约 16991ms，返回 Markdown 和 2 个块。独立 API、独立 Mongo 中真实上传后，解析任务 ready，约 10064ms，保存 Markdown、chunks、content_list、result、profile 和 manifest。云端请求阶段约 9208ms；样本没有图片。同步 PDF 测试 113 项和云端适配测试 2 项通过。
- 云端 ZIP 内容被转换为现有产物格式，保存的 result 不是原始云端状态响应；原始 ZIP 当前不持久化。真实图像、表格、大文件、失败恢复、对话引用和用户界面尚未端到端验证；`ready` 不代表答案准确。现有 3080 服务未切换，仍使用原配置；没有修改实际 `.env` 或内网配置。

本分支是尚未完成端到端验收的工作成果，不应直接部署。保留已有百题评测、gold 和失败记录；本分支包含本次隔离 Agent 和 ToolNode 结果，不包含原百题完整数据或模型密钥。原始结果位于 `evidence/pdf-page-vision-20261101/`。

## 2026-10-31 后续修复

- `textQuality === 'verified'` 原条件没有生产赋值路径，导致无法跳过普通文字文档的视觉准备。Repository 现在对单页片段做保守字符质量筛查，提供 `plausible`、`suspect`、`unknown`；仅完整已知页数且各页 `plausible` 时允许普通文字请求跳过。替换符、控制符、私用区字符及过低文字比例标记为可疑，稀少文字为未知。该启发式不能证明文字正确或完整，也不能识别所有乱码。
- 视觉模型按 JSON 契约返回 `answer`、`evidence_text`、表格 `cells`、图例数据 `series` 和 `uncertainties`；未知字段值可为 null。保留 `raw_model_output`；JSON 或结构校验失败、输出超长、模型 `finish_reason=length` 或其他非 `stop` 结束时标记 `status=partial`、`ok=false`，不作为完整结果缓存。字段内容依然是未经人工核验的模型输出。
- 布局坐标目前只在手工调用渲染器 `--layout` 时输出，并未写入默认解析产物、Repository 或 Agent 页面证据。区域视觉裁剪使用的是用户指定的归一化图像坐标，不依赖这些布局块。
- 本轮 7 组 64 项单元测试通过。真实 Qwen VL 对 `NETFLIX_2015_10K.pdf` 第 2 页一次服务级结构化识别返回有效 JSON，耗时 2088ms、1082 tokens；另对原百题 `citevqa:41489021-892f-5f2a-9c49-d0515dad08a2_xhop_0` 的原题与物理 81 页原图做单次服务级调用，返回先前缺失的群众评价与融合成效，耗时约 13169ms、2679 tokens。该测试由测试代码指定页面并注入已有图片，来源哈希使用测试占位值，未验证上传、自动定位或真实权限，不构成完整 A/B 或正确率统计。
- 该段原记录时真实 Agent/ToolNode、A/B 和回归尚未完成；后续进展以本文 2026-11-01 记录为准。

## 已实现

- `read_parsed_pdf` 新增 `inspect_page` 动作，可指定文档逻辑 ID、1 起算的物理页码、问题、任务模式和可选区域。区域使用旋转后页面图像的归一化坐标，左上角为原点。
- `DocumentPageVisionService` 在请求范围内检查文档、页码、来源哈希和授权；使用页面 PNG 及原始问题调用 Qwen VL，标明这是视觉识别而非完整 OCR。处理模式包括文字、表格、图表、公式和自动模式。
- 对相同任务做请求内缓存和并发去重；加入调用次数、并发数、图片大小、模型超时和截断提示。视觉失败返回不可用，不能当作正文缺失的证明。
- 接入现有 `ensureSanSuoPdfPageArtifacts`：已有图片仅在来源哈希匹配时复用；缺页时验证源 PDF 哈希并只请求指定页渲染。无效指定页不再自动回退为渲染整份 PDF。
- Repository 在 MinerU 缺少整页时补入 FITZ 片段，并保留来源标记；当前不解决 MinerU 同页部分缺失或低质量文字的识别。
- FITZ 页面提取保留文本行；以 `--layout` 可选输出文本块、行、文字及坐标，避免默认输出膨胀。文字质量未验证时，视觉准备不再仅因文字非空就被跳过。

主要代码位置：`api/server/services/DocumentPageVisionService.js`、`api/server/services/Endpoints/agents/sansuoToolPolicy.js`、`api/app/clients/BaseClient.js`、`api/server/services/DocumentArtifactRepository.js`、`api/server/services/Files/Code/process.js` 和 `api/server/services/Files/Pdf/render_pages.py`。

## 已验证

- 隔离副本中，视觉服务、工具策略、Repository、视觉策略、文档上下文、检索和表格相关的 7 组 Jest 测试，共 61 项通过。测试不构成完整 Agent 端到端验收。
- 使用既有公开样本 `NETFLIX_2015_10K.pdf` 的物理第 2 页，在本机容器中通过新服务调用真实 Qwen VL：整页识别公司名和目录标题成功，约 2.1 秒、986 tokens；顶部 30% 区域识别相同文字成功，约 2.4 秒、407 tokens。该验证通过服务级注入图片，不是生产 Agent/ToolNode 调用。
- 真实 PDF 的第 2 页布局提取检查得到 41 行、27 个带坐标的文本块；不代表扫描页、复杂表格或全文布局已正确。

## 已知限制和未完成项

- 已在旧测试副本运行一次真实 Agent/ToolNode 链路，但该题未通过，最新代码和缺图按需渲染尚未端到端验证；扫描小字、数字、复杂表格、图例和跨页关系的固定样本矩阵未完成。
- 未开展要求的独立 A/B 批次，无法报告对照准确率、证据交付率、引用错误率或 P50/P95 的变化。
- 问题驱动视觉结果缓存仅存在于请求内，不是跨请求持久缓存；图片产物来源、版本、并发写入和失败恢复仍需完整审查及验证。
- 文字质量只采用启发式筛查，可能误判，普通文字与混合扫描文件的实际延迟尚未比较。
- 视觉结果采用结构化字段并保留原始输出，但字段正确性未被独立验证；跨页检索、重排多样性及证据交付问题仍待专项验证。
- PDF `process.spec.js` 已通过；Word 和普通聊天端到端回归未运行。
- 本分支没有部署、迁移生产数据或修改实际环境配置。完成上述验证并复核安全和性能后才可考虑上线。
