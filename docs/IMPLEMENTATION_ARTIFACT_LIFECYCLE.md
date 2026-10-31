# Artifact 生命周期实施说明

实施日期：2026-10-30。
阶段恢复点：`0aa7081 checkpoint: code-api security`

## 1. 实施边界

本阶段复用 `SanSuoFile`、`SanSuoFileParseJob` 和 Code API storage，不建立平行文件库。
实现内容限定为元数据、引用视图、容量报告、清理 dry-run、逻辑隔离、恢复和审计。

本阶段明确没有：

- 物理删除或移动 storage 对象；
- 自动清理生产数据；
- 把会话删除改成文件级联删除；
- 批量回填历史 Mongo 记录；
- 新增向量库、BM25 或对象存储；
- 暴露面向普通用户的治理 HTTP 接口。

## 2. 数据合同

`SanSuoFile` 新增可选、向后兼容字段：

| 字段               | 用途                                               |
| ------------------ | -------------------------------------------------- |
| `artifactType`     | `source / derived / working / cache / deliverable` |
| `parentArtifactId` | 直接父产物 ID                                      |
| `rootArtifactId`   | 血缘根 Source ID                                   |
| `retentionPolicy`  | 保留合同                                           |
| `lastAccessedAt`   | 后端成功读取持久解析内容的最近时间                 |
| `gcState`          | `active / candidate / quarantined`                 |
| `quarantineUntil`  | 逻辑隔离恢复窗口                                   |

新记录由上传、隐藏解析产物、视觉索引和最终交付物写入入口显式分类。旧记录不要求迁移，
`ArtifactService.classifyArtifact()` 会根据 role、source 和既有 metadata 推断分类。

新增 `SanSuoArtifactAudit` 只保存治理动作和引用摘要，不保存文件正文。动作当前限定为
`dry_run`、`quarantine` 和 `restore`。

## 3. 分类与保留规则

| 类型        | 默认策略             | 自动隔离                                |
| ----------- | -------------------- | --------------------------------------- |
| Source      | `user_managed`       | 禁止；需要用户显式删除合同              |
| Derived     | `retain_with_source` | 当前禁止；MinerU/阅读产物优先保留       |
| Working     | `task_ttl`           | 仅过期、无引用且 storage ref 完整时允许 |
| Cache       | `cache_ttl`          | 仅过期、无引用且 storage ref 完整时允许 |
| Deliverable | `retain`             | 禁止按普通临时文件治理                  |

无法确认 storage 对象、存在会话/消息/ParseJob 引用、保留策略不允许或类型受保护时，
候选会带 blocker，不能进入 quarantine。

## 4. 引用与血缘

血缘解析优先使用新增顶层字段，并兼容：

- `metadata.rootSourceLibreFileId`；
- `metadata.rootSourceFileId`；
- `metadata.derivedFrom`；
- ParseJob 的 `libreFileId`、conversation 和 message 引用；
- 现有 Message 集合中 `files.file_id` 的全部真实附件引用；
- 调用方额外提供的真实 Message attachment 引用。

引用快照保留全部不同 conversation/message/ParseJob ID，不使用单个 `conversationId` 充当引用计数。
因此删除一个会话后，只要另一会话或 ParseJob 仍引用同一血缘，就会阻止隔离。

## 5. 服务接口

独立服务：`api/server/services/ArtifactService.js`。

主要接口：

- `classifyArtifact(record)`：兼容新旧记录的稳定分类；
- `resolveLineage(record)`：得到 artifact、parent、root ID；
- `buildReferenceSnapshot(record, context)`：建立引用快照；
- `evaluateGcCandidate(record, context)`：返回 reasons、blockers 和 eligible；
- `buildArtifactReport(context)`：按类型、状态和存储来源统计数量与字节；
- `dryRunArtifactGc(params)`：只生成报告并写审计，不更新 Artifact；
- `setArtifactQuarantine(params)`：重新验证 eligible 后逻辑隔离，或幂等恢复。

这些接口当前供后端服务和后续管理 UI 集成，不是公开 API。正式接管理入口时必须继续使用
LibreChat 管理员认证，并从 Message 模型提供真实 `messageReferences`。

## 6. 访问时间

后端成功下载并采用持久 PDF/DOCX/结构化正文后，会调用 `touchSanSuoArtifacts` 更新根 Source
与实际命中解析产物的 `lastAccessedAt`。更新失败只记录脱敏告警，不阻断用户回答。

普通列表、dry-run 和 UI 浏览不会伪造访问时间。

## 7. 安全与幂等

- inventory、访问时间和治理更新均按 `userId`，并在提供时同时按 `tenantId` 约束；
- quarantine 前始终重新加载 inventory 并重新计算候选；
- Source、Derived 和 Deliverable 不能通过当前服务自动隔离；
- 重复 quarantine 和重复 restore 不重复更新；
- quarantine 不改变现有 `status=ready`，所以不会意外破坏当前文件读取；
- 本阶段没有任何 storage delete 调用。

## 8. 测试

运行：

```bash
npx jest --config api/jest.config.js \
  server/services/ArtifactService.spec.js \
  models/sansuoFile.spec.js \
  app/clients/specs/BaseClient.test.js \
  --runInBand
```

结果：3 个测试套件、98 项测试全部通过。

覆盖：

- 五类 Artifact 分类和旧 MinerU metadata 血缘；
- 多会话引用；
- Source/Derived/Deliverable 保留；
- orphan 与失败产物识别；
- Working/Cache TTL 候选；
- 容量统计和 dry-run 无写入；
- quarantine 资格校验和 restore 幂等；
- Schema 元数据、访问时间和审计；
- BaseClient PDF/DOCX 持久上下文回归。

## 9. 部署与回滚

本阶段新增 Mongo 字段均为可选，旧记录可继续读取，不需要上线前数据库迁移。部署时需要让
LibreChat API 运行代码包含本阶段修改；若对应文件通过 bind mount 生效，必须先核对实际 mount。
本阶段没有 Code API 进程代码修改，不需要为 Artifact 阶段单独重启 Code API。

回滚代码到阶段恢复点：

```bash
git revert <artifact-lifecycle-commit>
```

回滚不会要求删除已经写入的可选字段或审计记录；旧代码会忽略它们。不要用 `git reset --hard`，
也不要手工清空 Mongo 集合或 Code API storage。

## 10. 后续阶段接口

Document JIT 将复用 `rootArtifactId`、`lastAccessedAt` 和血缘解析；Sources/Outputs UI 将复用
`artifactType`、visibility 和真实文件可访问状态。物理 GC 仍不在当前实施范围，只有在管理入口、
引用数据源和 Code API 删除合同完成端到端测试后，才可另行设计并请求用户确认。
