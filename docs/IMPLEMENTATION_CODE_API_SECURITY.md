# Code API 安全认证实施记录

## 结果

Code API 的 `/v1/*` 业务接口现在统一执行服务认证、用户/租户主体解析、
storage session 所有权校验、file ref 校验和路径约束。`/health` 保持匿名，
但只返回认证是否配置，不返回密钥、公钥内容或用户信息。

## 认证协议

推荐生产配置为 `CODEAPI_AUTH_PROVIDER=librechat-jwt`：

- LibreChat 根据已认证的 `req.user` 签发最长 300 秒的 EdDSA 或 RS256 JWT。
- JWT 固定校验 `kid`、签名、`iss`、`aud`、`iat/nbf/exp`、`sub` 和 `tenant_id`。
- Code API 只配置公钥，LibreChat API 只配置私钥。
- `both` 支持 JWT 与旧 API Key 并行迁移；`SANSUO_CODE_API_KEYS` 可并列新旧 key。
- 旧 key 模式仍要求 `User-Id`，并按 tenant/user 做对象授权；它不等同于最终的 JWT 模式。

## 对象授权

上传时根据 `kind/id/version` 和认证主体建立 `.session.json`：

```text
user  -> tenant:user:authenticated-user
agent -> tenant:agent:agent-id
skill -> tenant:skill:skill-id:v:version
```

下载、列举、freshness 查询和 `/v1/exec` 文件挂载均重新计算 session key 并比对。
执行输出始终归当前认证用户。文件 ID 与 session ID 只接受安全 opaque 字符；
所有路径经 `resolve` 限制在 storage root 内，且拒绝 symlink 文件。

用户文件按现有 `CodeEnvRef(kind=user)` 语义在同一用户的多个会话间复用；
会话引用仍由 LibreChat File/SanSuoFile 层授权。Code API 不把用户私有文件错误地
硬绑定到单个 conversation，否则会破坏现有跨会话引用和新会话 `new -> id` 迁移。

## 存量 session 迁移

安全升级前创建的 storage session 没有 `.session.json`。默认策略 `deny` 会拒绝它们，
不会静默把无主数据交给第一个调用者。受控升级可临时使用：

```dotenv
CODEAPI_AUTH_PROVIDER=both
CODEAPI_LEGACY_SESSION_POLICY=claim
```

只有已通过认证且持有现有随机 session/file ref 的请求才能触发认领，并记录
`security.legacy_session_claimed`。完成存量访问或迁移后必须恢复 `deny`，再移除旧 key。
本次没有修改生产 storage、数据库或密钥，也没有执行自动认领。

## 构建与部署

1. 生成 Ed25519 密钥对，将私钥只配置给 LibreChat API，公钥只配置给宿主 Code API。
2. 运行 `npm run build`（目录 `packages/api`），同步实际运行的 `packages/api/dist` 或补丁 bundle。
3. 同步 `sandbox/code-api-server.js`、`sandbox/code-api-security.js` 和调用端源码。
4. 先以 `both + claim` 做存量兼容验证，再切换 `librechat-jwt + deny`。
5. 宿主 `node sandbox/code-api-server.js` 是独立进程；只重启 LibreChat 容器不会加载它。
6. 验证 `/health` 中 `auth.configured=true` 后，再跑上传、下载、execute_code 最小业务链。

不得把真实私钥、旧 key 或生产 session 元数据提交进 Git。

## 测试证据

- `sandbox/code-api-security.spec.js`：无/错 key、正常上传下载、跨用户、跨租户、
  伪造 ref、路径标识、symlink、执行前挂载授权、正确/错误 JWT。
- `packages/api/src/auth/codeapi.spec.ts`：签名、claims、tenant、缓存和旧 key 过渡头。
- `api/server/services/Files/Code/{crud,process}.spec.js`：上传、下载、预解析和文件处理回归。
- `api/app/clients/specs/BaseClient.test.js`：持久文档上下文与直接 Code API 调用回归。

本阶段没有启动 OpenSandbox 做真实代码执行；服务路由测试使用不支持的语言，验证在
不创建 Sandbox 的前提下，授权通过后能进入执行处理，越权文件则在启动前返回 403。
