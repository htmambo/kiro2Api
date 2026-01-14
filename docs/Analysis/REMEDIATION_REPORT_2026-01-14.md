# Kiro2Api 修复实施报告（安全 & 性能）

**日期**：2026-01-14  
**范围**：后端（Node.js API + UI Router + 静态资源服务）与前端（Dashboard SSE 连接）  
**目标**：按等级封堵可直接导致未授权访问/写入/泄露/DoS 的问题，并补齐基础稳健性与依赖安全基线。

---

## 1. 总览结论

本次修复聚焦于以下高危链路：

- **鉴权绕过**：API 请求在鉴权前已被业务处理并提前返回（导致 `/v1/messages` 等可绕过 API Key）。
- **限流失效**：白名单函数被硬编码为 `return true`，导致限流完全不生效。
- **未授权上传 + 路径穿越**：上传接口在路由鉴权前特殊处理，且 `provider` 参与路径拼接，可写入任意目录。
- **静态文件路径穿越**：静态服务未校验路径是否落在 `static/` 根目录。
- **敏感信息日志**：启动日志输出 API Key；鉴权失败日志输出明文 key；token refresh debug 打印完整响应体。
- **SSE/日志接口开放**：日志与事件流在未鉴权情况下对外暴露（同时日志会被广播到 SSE）。

---

## 2. 修复任务清单（按等级）

### P0（必须立即修复）

1) **修复 API 鉴权顺序导致的绕过**
- 做法：将 `/v1/*` 与 `/stats` 这类 API-key 保护路径的鉴权提前到任何 handler 处理之前。
- 证据：`src/api/request-handler.js:99`

2) **恢复限流逻辑（移除硬编码放行）**
- 做法：删除 `isRateLimitWhitelisted()` 中的 `return true`，让白名单逻辑与 `checkRateLimit()` 生效。
- 证据：`src/api/rate-limiter.js:248`

3) **修复上传接口绕过鉴权 + 路径穿越写入**
- 做法：
  - 移除 `ui-manager` 中“上传特殊处理”绕过路由鉴权的逻辑，上传回归到路由体系。
  - 将 `multer` 处理移入 `uploadCredentials()` handler 内（确保先鉴权再处理 body）。
  - 对 `provider` 做路径根目录约束（必须落在 `configs/` 下）。
- 证据：`src/ui/router/handlers/upload.handlers.js:16`  
  证据：`src/ui/router/handlers/upload.handlers.js:166`

4) **修复静态文件路径穿越 + CSP 过宽**
- 做法：
  - 统一以 `staticRoot = <cwd>/static` 作为根，使用 `path.resolve(staticRoot, relative)` 并校验前缀，阻止 `../` 逃逸。
  - 静态文件改为 stream 输出（减少 event loop 阻塞）；生产环境下将 `.html` CSP 收敛，移除 `unsafe-eval`。
- 证据：`src/ui/static.js:17`  
  证据：`src/ui/static.js:42`  
  证据：`src/ui/static.js:74`

5) **敏感日志脱敏 + 生产环境弱默认密钥拦截**
- 做法：
  - 启动时不再打印明文 API Key（生产环境仅显示 `[configured]`）。
  - 生产环境禁止使用弱默认 `REQUIRED_API_KEY`（可用 `ALLOW_WEAK_API_KEY=true` 覆盖）。
  - 鉴权失败日志不再输出明文 key，仅记录 presence 信息。
  - refresh token debug 日志对 token 字段脱敏。
- 证据：`src/api/server.js:34`  
  证据：`src/api/server.js:62`  
  证据：`src/utils/common.js:153`  
  证据：`src/kiro/auth.js:200`

---

### P1（短期内修复/稳健性补强）

1) **日志接口加鉴权**
- 做法：`/api/logs` 与 `DELETE /api/logs` 需要 UI 登录 token。
- 证据：`src/ui/router/routes/system.routes.js:54`

2) **SSE 鉴权与 UI 兼容**
- 背景：浏览器 `EventSource` 无法自定义 `Authorization` header。  
- 做法：
  - `/api/events` 路由保持 `auth:false`，但 handler 强制校验 `?token=`。
  - 前端 Dashboard 建立 SSE 时附带 `?token=`。
  - 增加 SSE 连接数上限（默认 50，可用 `MAX_SSE_CLIENTS` 调整）。
- 证据：`src/ui/router/handlers/system.handlers.js:168`  
  证据：`frontend/app/dashboard/logs/page.tsx:119`

3) **后台登录密码落盘改为哈希存储（兼容旧明文）**
- 做法：
  - `pwd` 文件写入改为 `scrypt$<saltB64>$<hashB64>`，并要求新密码至少 8 位。
  - 登录验证支持新哈希格式与旧明文格式（兼容存量）。
- 证据：`src/ui/router/handlers/config.handlers.js:145`  
  证据：`src/ui-manager.js:278`

---

## 3. 依赖与供应链

- 已执行 `npm audit fix` 同步并修复根目录高危依赖问题，当前 `npm audit --omit=dev --audit-level=high` 为 0。

---

## 4. 验证与回归

由于项目当前未配置 Jest 测试用例，`npm test` 会返回 “No tests found”。本次采用以下冒烟验证：

- ESM 模块加载校验：关键模块可被 `node -e "import(...)"` 正常加载。
- 依赖安全校验：`npm audit`（backend/ frontend）高危为 0。

