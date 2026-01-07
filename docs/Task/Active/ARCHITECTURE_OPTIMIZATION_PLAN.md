# 架构优化任务计划

**状态**: ⏳ 待执行
**创建时间**: 2026-01-07
**优先级**: 高

## 任务目标

解决项目中的循环依赖问题，并优化 `ui-manager.js` 的职责划分，提升代码可维护性。

## 背景分析

### 当前问题

1. **循环依赖问题**（严重）
   - `api/server` ↔ `ui-manager`：`api/server.js:2-35` 导入 `ui-manager`，而 `ui-manager.js:482-504` 又调用 `api/server.initAccountService()`
   - `utils/common` ↔ `kiro/adapter`：`utils/common.js:1-22` 导入 `KiroService`，而 `kiro/adapter.js:1-10` 导入 `MODEL_PROVIDER`

2. **职责不清**
   - `ui-manager.js` 承担了过多职责：token 管理、OAuth 状态、文件上传、配置重载、路由处理等

3. **已完成的改进**
   - ✅ 已移除空壳 `services/manager.js`

### 项目约束

- 短期内只支持 Kiro 提供商，不需要过度抽象
- 优先解决循环依赖，再考虑模块拆分
- 保持现有 API 兼容性

## 任务分解

### 阶段 1：解决循环依赖（最高优先级）

#### 子任务 1.1：解耦 `ui-manager` ↔ `api/server` ✅

**改动内容**：
- 在 `ui-manager.js` 中新增依赖注入机制：
  ```javascript
  let accountServiceInitializer = null;
  export function registerAccountServiceInitializer(fn) {
    accountServiceInitializer = fn;
  }
  ```
- 修改 `reloadConfig()` 使用注册的回调而非直接导入
- 在 `api/server.js` 启动时注册 `initAccountService`

**预期效果**：
- ✅ 消除双向依赖
- ✅ `ui-manager` 不再直接导入 `api/server`

**风险评估**：
- ✅ 已添加日志保护（未注册时输出警告）
- ✅ 注册在 UI 启动后立即执行

**测试点**：
- ⏳ 通过 UI 触发配置重载，验证账号池更新
- ⏳ 检查日志确认回调被正确调用

**完成时间**: 2026-01-07

---

#### 子任务 1.2：解耦 `utils/common` ↔ `kiro/adapter` ✅

**改动内容**：
- 删除 `utils/common.js` 中的 `import { KiroService }`
- 改用 JSDoc 类型注释：`/** @typedef {import('../kiro/adapter.js').KiroService} KiroService */`

**预期效果**：
- ✅ 消除运行时循环依赖
- ✅ 保留类型提示（用于 IDE 和文档）

**风险评估**：
- ✅ 已限制 `common.js` 只做类型建模
- ✅ 通过 JSDoc 保留类型提示

**测试点**：
- ⏳ 启动服务，确认不再出现 "Cannot access before initialization" 错误
- ⏳ 运行现有集成测试

**完成时间**: 2026-01-07

**Codex Review**: 循环依赖已彻底消除，实现合理，无需额外错误处理

---

### 阶段 2：拆分 `ui-manager.js`（中等优先级）

#### 子任务 2.1：创建 `ui/token-store.js` ✅

**改动内容**：
- 迁移 token 相关逻辑：
  - `TOKEN_STORE_FILE` 读写
  - `readTokenStore()`
  - `saveToken()`
  - `generateToken()`
  - `verifyToken()`

**预期效果**：
- ✅ Token 管理逻辑独立，便于测试和维护
- ✅ 新增 `cleanupExpiredTokens()` 功能

**完成时间**: 2026-01-07

---

#### 子任务 2.2：创建 `ui/oauth-states.js` ✅

**改动内容**：
- 迁移 OAuth 状态管理：
  - `kiroOAuthStates` / `kiroOAuthCompletedStates`
  - `loadOAuthStates()`
  - `saveOAuthStates()`
  - 持久化到 `kiro-oauth-states.json`

**预期效果**：
- ✅ OAuth 状态管理独立
- ✅ 导出 OAuth 配置常量

**完成时间**: 2026-01-07

---

#### 子任务 2.3：创建 `ui/usage-cache.js` ✅

**改动内容**：
- 迁移使用量缓存逻辑：
  - `USAGE_CACHE_FILE` 读写
  - `readProviderUsageCache()`

**预期效果**：
- ✅ 使用量缓存逻辑独立

**完成时间**: 2026-01-07

---

#### 子任务 2.4：创建 `ui/upload.js` ✅

**改动内容**：
- 迁移文件上传逻辑：
  - `multer` storage 配置
  - `fileFilter`
  - `upload` 中间件
  - `/api/upload-oauth-credentials` 处理流程
  - 新增 `handleUpload()` 和 `isUploadRequest()` 辅助函数

**预期效果**：
- ✅ 文件上传逻辑独立
- ✅ 提供清晰的 API 接口

**完成时间**: 2026-01-07

---

#### 子任务 2.5：创建 `ui/config-reloader.js` ✅

**改动内容**：
- 迁移配置重载逻辑：
  - `reloadConfig()` 函数
  - `registerAccountServiceInitializer()` 函数
  - `getAccountServiceInitializer()` 函数
  - 使用注册的钩子触发重载
  - 清理 `serviceInstances`

**预期效果**：
- ✅ 配置重载逻辑独立
- ✅ 提供清晰的 API 接口

**完成时间**: 2026-01-07

---

#### 子任务 2.6：重构 `ui-manager.js` 为组合器 ✅

**改动内容**：
- 删除已迁移的代码（Token、OAuth、使用量缓存、multer、reloadConfig）
- 添加子模块导入和重导出
- 更新 `handleUIApiRequests` 使用新模块
- 保留��心职责：parseErrorMessage, generateOAuthResultPage, validateCredentials, parseRequestBody

**预期效果**：
- ✅ `ui-manager.js` 职责清晰，仅作为组合器
- ✅ 各子模块独立可测试
- ✅ 代码从 641 行减少到 351 行（减少约 45%）
- ✅ 所有原有导出 API 保持不变

**测试结果**：
- ✅ 服务成功启动并加载所有模块
- ✅ 配置重载初始化器正常注册
- ✅ UI 事件广播系统正常初始化

**完成时间**: 2026-01-07

---

### 阶段 3：验收和文档（低优先级）

#### 子任务 3.1：完整测试 ⏳

**测试清单**：
- [ ] API 服务正常启动
- [ ] UI 管理界面可访问
- [ ] Token 认证功能正常
- [ ] OAuth 授权流程正常
- [ ] 配置重载功能正常
- [ ] 文件上传功能正常
- [ ] 账号池管理正常
- [ ] 无循环依赖错误

---

#### 子任务 3.2：更新文档 ⏳

**文档更新**：
- 更新架构文档，说明新的模块划分
- 添加依赖注入机制的使用说明
- 补充各模块的职责说明

---

## 实施顺序

1. **阶段 1.1** → 解耦 `ui-manager` ↔ `api/server`（最高优先级）
2. **阶段 1.2** → 解耦 `utils/common` ↔ `kiro/adapter`（最高优先级）
3. **阶段 2.1-2.6** → 拆分 `ui-manager.js`（可并行进行）
4. **阶段 3** → 验收和文档

## 验收标准

- ✅ 无循环依赖错误
- ✅ 所有现有功能正常工作
- ✅ 代码结构清晰，职责分明
- ✅ 通过所有测试用例
- ✅ 文档更新完整

## 风险缓解

1. **循环依赖风险**：分步骤解决，每步验证
2. **功能破坏风险**：保持 API 兼容，分阶段迁移
3. **测试覆盖风险**：每个子任务完成后立即测试

## 备注

- 本次重构聚焦于解决架构问题，不涉及功能新增
- 短期内只支持 Kiro，避免过度抽象
- 每个子任务完成后需要 git 提交并通过测试
