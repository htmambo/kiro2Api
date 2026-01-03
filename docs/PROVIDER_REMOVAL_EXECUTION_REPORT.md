---
created_at: 2026-01-03
cwd: /Volumes/Workarea/usr/htdocs/kiro2Api
source_plan: docs/PROVIDER_REMOVAL_PLAN.md
mode: execution_report
---

# Provider 层彻底移除 - 执行报告

## 🎯 目标

- 将核心链路从“provider 分组”切换为“单一账号池（accounts）”
- 引入 `ACCOUNT_POOL_MODE` 开关，并在代码层面完成 account mode 的完整链路
- 配置文件迁移：`provider_pools.json` → `account_pool.json`
- SQLite schema 迁移：`providers` → `accounts`（删除 `provider_type`）
- UI API 与前端请求路径迁移到 `/api/accounts/*`
- 清理 provider 相关 manager 文件

## 📋 任务执行明细（T01-T08）

### ✅ T01: 添加重构开关

**变更**：
- 新增 `ACCOUNT_POOL_MODE` 环境变量读取（默认 `legacy`，但最终会映射到 account 模式）  
  - `src/config-manager.js:8`
- 服务初始化打印当前模式，并为后续切换点提供基础能力  
  - `src/service-manager.js:15`

**语法验证**：
- `node --check src/config-manager.js`
- `node --check src/service-manager.js`

---

### ✅ T02: 定义 Account 数据模型

**变更**：
- 重写 `src/account-pool-manager.js` 为单一账号池管理器，提供核心接口：  
  - `listAccounts()` / `selectAccount()` / `markAccountUnhealthy()` / `markAccountHealthy()`  
  - `disableAccount()` / `enableAccount()` / `performHealthChecks()`
- 新增 `src/sqlite-account-pool-manager.js`（SQLite 账号池管理器，后续由 T07 支撑）

**语法验证**：
- `node --check src/account-pool-manager.js`
- `node --check src/sqlite-account-pool-manager.js`

---

### ✅ T03: 核心请求链路改造

**变更**：
- 核心服务选择从“provider 池”切换到“账号池”：
  - `src/service-manager.js:78`
- 重试逻辑与健康标记从 provider API 兼容升级为 poolManager 泛化（优先走 account 方法）：
  - `src/common.js:145`
- 请求入口在获取服务失败时，按账号维度标记不健康：
  - `src/request-handler.js:55`
- 服务器启动时向 request handler 注入 active pool manager：
  - `src/api-server.js:29`
- API manager 透传 pool manager：
  - `src/api-manager.js:15`

**语法验证**：
- `node --check src/service-manager.js`
- `node --check src/common.js`
- `node --check src/request-handler.js`
- `node --check src/api-manager.js`
- `node --check src/api-server.js`

---

### ✅ T04: 配置加载迁移

**变更**：
- `src/config-manager.js` 支持 `account_pool.json`：
  - 自动迁移：当 `account_pool.json` 不存在但发现 `provider_pools.json` 时，会备份并生成新文件
  - 账号池缺失时会创建空的 `account_pool.json`
  - `src/config-manager.js:280`

**语法验证**：
- `node --check src/config-manager.js`

---

### ✅ T05: OAuth 入池链路改造

**变更**：
- OAuth 授权完成后统一写入 `account_pool.json` 并广播 `account_update`：
  - `src/oauth-handlers.js:144`

**语法验证**：
- `node --check src/oauth-handlers.js`

---

### ✅ T06: UI API 重构

**变更**：
- 后端新增并启用账号 API：
  - `GET /api/accounts`：账号列表 + `_accountPoolStats`
  - `POST /api/accounts`：新增账号
  - `DELETE /api/accounts/:uuid`
  - `POST /api/accounts/:uuid/toggle`
  - `POST /api/accounts/batch-delete`（支持 `uuids` 与 `deleteByStatus`）
  - `POST /api/accounts/reset-health`
  - `POST /api/accounts/health-check`
  - `POST /api/accounts/:uuid/health-check`
  - `POST /api/accounts/:uuid/reset-health`
  - `POST /api/accounts/:uuid/test`
  - `POST /api/accounts/cleanup-duplicates`
  - `POST /api/accounts/generate-auth-url`
  - 主要实现位置：`src/ui-manager.js:1259`
- 用量查询新增 `/api/usage/:uuid` 形式（兼容旧的 `/api/usage/:providerType` 逻辑）：
  - `src/ui-manager.js:2870`
- 前端将所有 `/api/providers/*` 调整为 `/api/accounts/*`：
  - `frontend/app/dashboard/page.tsx:155`
  - `frontend/app/dashboard/providers/page.tsx:144`
  - `frontend/app/dashboard/usage/page.tsx:157`

**语法验证**：
- `node --check src/ui-manager.js`

---

### ✅ T07: SQLite Schema 迁移

**变更**：
- 重写 `src/sqlite-db.js`：
  - `PRAGMA user_version` 迁移到 v2
  - 自动备份并迁移：`providers` → `accounts`，并迁移 `usage_cache` 与 `health_check_history`
  - 保留部分旧方法名作为兼容映射（内部统一落到 accounts 表）
  - `src/sqlite-db.js:1`
- 修正 `src/sqlite-account-pool-manager.js` 适配新 schema 的字段命名
  - `src/sqlite-account-pool-manager.js:49`
- 为避免旧实现依赖 providers 表，更新 `src/sqlite-provider-pool-manager.js` 的 SQL 表名到 `accounts`
  - `src/sqlite-provider-pool-manager.js:67`

**语法验证**：
- `node --check src/sqlite-db.js`
- `node --check src/sqlite-account-pool-manager.js`
- `node --check src/sqlite-provider-pool-manager.js`
- `node --check src/service-manager.js`

---

### ✅ T08: 清理遗留代码

**变更**：
- 删除 provider pool manager 文件：
  - `src/provider-pool-manager.js`
  - `src/sqlite-provider-pool-manager.js`
- 移除 `src/core/constants.js` 中的目录映射常量（provider 目录映射已不再作为核心能力）：
  - `src/core/constants.js:1`
- 将 `src/provider-utils.js` 重命名为 `src/account-utils.js` 并更新引用：
  - `src/account-utils.js:1`
  - `src/ui-manager.js:12`
- `src/service-manager.js` 重写为“仅账号池”的实现，legacy 作为别名存在：
  - `src/service-manager.js:1`

**语法验证**：
- `node --check src/service-manager.js`
- `node --check src/ui-manager.js`
- `node --check src/account-utils.js`

## ⚠️ 风险与注意事项

- `src/ui-manager.js` 内仍保留部分旧 `/api/providers/*` 路由与旧逻辑片段（当前前端已切换到 `/api/accounts/*`，但建议后续彻底删除旧路由分支以降低维护成本）。
- SQLite 迁移会对现有数据库做结构性变更，虽然会自动备份，但仍建议在首次启用 `USE_SQLITE_POOL=true` 前手动确认 `data/provider_pool.db.bak-*` 备份生成。

## 🧪 建议的后续验证

- 启动服务后访问：
  - `GET /api/accounts`
  - `POST /api/accounts/health-check`
  - `GET /api/usage?refresh=true`
  - `GET /api/usage/:uuid?refresh=true`
- 如启用 SQLite：
  - 设置 `USE_SQLITE_POOL=true` 后启动，检查日志中的迁移输出与 `PRAGMA user_version`

