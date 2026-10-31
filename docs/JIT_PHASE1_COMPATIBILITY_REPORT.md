审计/实施日期：2026-10-31。
实际源码目录：/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main。
本阶段按 Phase 1A → 1B → 1C 完成最小侵入实施。未修改 MinerU、FITZ、VL 外部协议、ToolNode 对外 schema、数据库 schema，未迁移旧文件，未进入 Phase 2。

# JIT Phase 1 兼容性报告

## 历史 PDF

旧 _mineru.md、_mineru_chunks.jsonl、_mineru_content_list.json、_visual_chunks.jsonl 和 visualIndex 均按读取时转换。原始文件不改写。MinerU/FITZ 文字层继续进入现有 PDF document records；纯扫描页只有页图或视觉摘要时，不会伪造成正文。

## 历史 Word

未改变 Word blocks、heading、table 和旧 createWordDocumentContextService。相关旧回归继续通过。

## 老工具与引用

未改变 ToolNode schema、read_pdf/read_parsed_pdf 对外参数、document_id/file_id/chunk_id/table_id 引用结构。现有 documentId、chunkId、tableId 生成规则保留。Adapter 通过 sourceRecordId 兼容旧 chunk_id。PDF section read 的范围更可靠，无法确定范围时增加 warning，不删除历史引用。

## 权限和会话

visualIndex 仍必须来自当前 userId、conversationId 和根文件过滤结果；新增校验拒绝显式不匹配的版本、根文件、用户或会话。缺少历史绑定字段时不会伪造可信版本，现有旧聊天查询仍可继续返回并带不确定性。

## 数据迁移

没有需要的迁移。没有覆盖、删除、重命名或批量重解析任何旧产物。
