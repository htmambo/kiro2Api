# UI 模块架构设计文档

## 概述

本文档说明 UI 管理模块的架构设计，该模块经过重构后采用**组合器模式（Composer Pattern）**，将职责分离到多个子模块中。

**重构日期**: 2026-01-08
**架构版本**: v2.0

---

## 架构原则

### 设计模式
- **组合器模式（Composer）**: ui-manager.js 作为组合器，协调各个子模块
- **依赖注入（DI）**: 通���回调注册实现模块解耦
- **单一职责原则（SRP）**: 每个子模块只负责一个功能领域

### 核心目标
1. **消除循环依赖**: 解决 ui-manager ↔ api/server 的循环依赖
2. **提升可维护性**: 代码模块化，便于理解和修改
3. **保持向后兼容**: 所有现有 API 保持不变

---

## 模块结构

```
src/
├── ui-manager.js          # 组合器（Composer）
└── ui/
    ├── token-store.js     # Token 管理模块
    ├── oauth-states.js    # OAuth 状态管理模块
    ├── usage-cache.js     # 使用量缓存模块
    ├── upload.js          # 文件上传模块
    ├── config-reloader.js # 配置重载模块
    ├── events.js          # UI 事件系统
    ├── static.js          # 静态文件服务
    └── router/            # 路由系统
```

---

## 模块职责

### 1. ui-manager.js（组合器）

**职责**: 协调各子模块，提供统一的 API 导出

**核心功能**:
- 导入并重导出所有子模块的 API
- 保留核心工具函数（parseErrorMessage, generateOAuthResultPage, validateCredentials, parseRequestBody）
- 处理 UI API 请求路由

**导出的 API**:
```javascript
// 子模块 API 重导出
export {
    registerAccountServiceInitializer,
    reloadConfig
} from './ui/config-reloader.js';

export {
    kiroOAuthStates,
    kiroOAuthCompletedStates,
    KIRO_OAUTH_CONFIG,
    loadOAuthStates,
    saveOAuthStates
} from './ui/oauth-states.js';

export {
    readUsageCache,
    writeUsageCache,
    readProviderUsageCache
} from './ui/usage-cache.js';

export {
    readTokenStore,
    writeTokenStore,
    generateToken,
    getExpiryTime,
    verifyToken,
    saveToken,
    deleteToken,
    cleanupExpiredTokens
} from './ui/token-store.js';

export {
    upload,
    handleUpload,
    isUploadRequest
} from './ui/upload.js';

// 核心工具函数
export function parseErrorMessage(errorMessage)
export function generateOAuthResultPage(success, message, details)
export async function validateCredentials(password)
export function parseRequestBody(req)
export async function handleUIApiRequests(method, path, req, res, config, accountPoolManager)
```

**代码统计**:
- 重构前: 641 行
- 重构后: 351 行
- 减少: 45%

---

### 2. ui/token-store.js

**职责**: Token 的生成、验证、存储和清理

**核心功能**:
- Token 存储文件读写（`./configs/token-store.json`）
- 生成随机 64 位十六进制 Token
- Token 验证和过期检查
- 自动清理过期 Token

**主要 API**:
```javascript
export async function readTokenStore()
export async function writeTokenStore(tokenStore)
export function generateToken()
export function getExpiryTime()
export async function verifyToken(token)
export async function saveToken(token, tokenInfo)
export async function deleteToken(token)
export async function cleanupExpiredTokens()
```

**定时任务**: 每 5 分钟自动清理过期 Token

---

### 3. ui/oauth-states.js

**职责**: OAuth 授权状态管理

**核心功能**:
- OAuth 状态内存存储（Map 结构）
- 状态持久化到文件（`./configs/kiro-oauth-states.json`）
- 启动时自动加载有效状态（30 分钟内）
- 状态变更时自动保存

**主要 API**:
```javascript
export const kiroOAuthStates = new Map()
export const kiroOAuthCompletedStates = new Map()
export const KIRO_OAUTH_STATE_FILE
export const KIRO_OAUTH_CONFIG
export async function loadOAuthStates()
export async function saveOAuthStates()
```

**初始化**: 模块加载时自动调用 `loadOAuthStates()`

---

### 4. ui/usage-cache.js

**职责**: API 使用量缓存管理

**核心功能**:
- 使用量缓存文件读写（`./configs/usage-cache.json`）
- 按提供商类型读取缓存
- 缓存时间戳记录

**主要 API**:
```javascript
export async function readUsageCache()
export async function writeUsageCache(usageData)
export async function readProviderUsageCache(providerType)
```

---

### 5. ui/upload.js

**职责**: 文件上传处理

**核心功能**:
- Multer 中间件配置
- 文件类型过滤（.json, .txt, .key, .pem, .p12, .pfx）
- 文件大小限制（5MB）
- 文件名安全化处理
- 上传请求检测

**主要 API**:
```javascript
export const upload = multer({ ... })
export async function handleUpload(req, res, currentConfig)
export function isUploadRequest(method, path)
```

**配置**:
- 上传目录: `./configs/temp/`
- 文件命名: `{timestamp}_{sanitized_original_name}`

---

### 6. ui/config-reloader.js

**职责**: 配置文件重载和服务重新初始化

**核心功能**:
- 动态重载配置文件
- 清理旧的服务实例
- 通过依赖注入重新初始化账号服务
- 提供注册机制供外部模块使用

**主要 API**:
```javascript
export function registerAccountServiceInitializer(fn)
export function getAccountServiceInitializer()
export async function reloadConfig()
```

**依赖注入机制**:
```javascript
// 在 api/server.js 中注册
import { registerAccountServiceInitializer } from './ui-manager.js';
registerAccountServiceInitializer(async (config) => {
    // 重新初始化账号服务
});

// 在 reloadConfig 中调用
if (accountServiceInitializer) {
    await accountServiceInitializer(CONFIG);
}
```

---

## 依赖关系图

```
┌─────────────────────────────────────────────────────────┐
│                     ui-manager.js                        │
│                     (组合器)                              │
└─────────────────────────────────────────────────────────┘
         │         │         │         │         │
         ▼         ▼         ▼         ▼         ▼
    ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐
    │ token- │ │ oauth- │ │ usage- │ │ upload │ │  config- │
    │ store  │ │ states │ │ cache  │ │        │ │ reloader │
    └────────┘ └────────┘ └────────┘ └────────┘ └──────────┘
         │         │         │         │         │
         ▼         ▼         ▼         ▼         ▼
    ┌─────────────────────────────────────────────────────┐
    │              文件系统 (configs/)                      │
    │  token-store.json │ kiro-oauth-states.json           │
    │  usage-cache.json │ temp/ (uploads)                  │
    └─────────────────────────────────────────────────────┘

外部依赖:
ui-manager ──注册──> api/server (通过依赖注入)
ui-manager ──使用──> ui/events, ui/static, ui/router
```

---

## 循环依赖解决方案

### 问题 1: ui-manager ↔ api/server

**原问题**:
- `ui-manager.js:482-504` 调用 `api/server.initAccountService()`
- `api/server.js:2-35` 导入 `ui-manager`

**解决方案**: 依赖注入

```javascript
// ui/config-reloader.js
let accountServiceInitializer = null;

export function registerAccountServiceInitializer(fn) {
    accountServiceInitializer = fn;
}

export async function reloadConfig() {
    // ...
    if (accountServiceInitializer) {
        await accountServiceInitializer(CONFIG);
    }
}

// api/server.js
import { registerAccountServiceInitializer } from './ui-manager.js';

async function initAccountService(config) {
    // 初始化账号服务
}

registerAccountServiceInitializer(initAccountService);
```

**结果**: ✅ 消除循环依赖

---

### 问题 2: utils/common ↔ kiro/adapter

**原问题**:
- `utils/common.js:1-22` 导入 `KiroService`
- `kiro/adapter.js:1-10` 导入 `MODEL_PROVIDER`

**解决方案**: JSDoc 类型注释

```javascript
// utils/common.js
// 删除: import { KiroService } from '../kiro/adapter.js'

// 使用 JSDoc 类型注释
/**
 * @typedef {import('../kiro/adapter.js').KiroService} KiroService
 */

function buildKiroMessages(...) { /**/ }
```

**结果**: ✅ 消除运行时循环依赖，保���类型提示

---

## 数据流

### Token 认证流程

```
客户端请求
    │
    ▼
handleUIApiRequests()
    │
    ▼
router (认证中间件)
    │
    ├─> verifyToken()
    │       │
    │       └─> readTokenStore() ──> token-store.json
    │
    ├─> 有效 ──> 处理请求
    │
    └─> 无效/过期 ──> 401 Unauthorized
```

### OAuth 授权流程

```
客户端请求授权
    │
    ▼
生成 OAuth state
    │
    ▼
kiroOAuthStates.set(state, payload)
    │
    ▼
saveOAuthStates() ──> kiro-oauth-states.json
    │
    ▼
用户授权完成
    │
    ▼
kiroOAuthStates.get(state)
    │
    ▼
kiroOAuthCompletedStates.set()
```

### 配置重载流程

```
UI 触发重载
    │
    ▼
reloadConfig()
    │
    ├─> initializeConfig() ──> 读取 config.json
    │
    ├─> 清理 serviceInstances
    │
    └─> accountServiceInitializer() ──> 重新初始化账号服务
            │
            └─> 由 api/server 注册的初始化函数执行
```

---

## 文件存储结构

```
configs/
├── token-store.json          # Token 存储
│   └── { tokens: { "token": { expiryTime, ... } } }
│
├── kiro-oauth-states.json    # OAuth 状态持久化
│   └── { "state": { code_verifier, machineid, timestamp, accountNumber } }
│
├── usage-cache.json          # 使用量缓存
│   └── { timestamp, providers: { ... } }
│
└── temp/                     # 文件上传临时目录
    └── {timestamp}_{filename}
```

---

## 扩展指南

### 添加新的子模块

1. **创建新模块文件** `src/ui/new-module.js`
   ```javascript
   import { createLogger } from '../lib/logger.js';

   const logger = createLogger('ui:new-module');

   export function newFeature() {
       logger.info('New feature called');
   }
   ```

2. **在 ui-manager.js 中导入并重导出**
   ```javascript
   import { newFeature } from './ui/new-module.js';
   export { newFeature };
   ```

3. **更新文档**（本文档）

**无需修改**: 其他任何模块

---

### 修改现有子模块

1. **修改模块文件**
2. **确保导出 API 保持兼容**（或更新所有调用方）
3. **运行测试验证**

---

## 性能考虑

### 启动性能
- 模块数量增加，但每个模块更小，解析更快
- OAuth 状态加载在启动时进行（异步，不阻塞）

### 运行时性能
- Token 清理: 每 5 分钟执行一次，低开销
- 文件上传: Multer 流式处理，内存占用可控
- 配置重载: 按需执行，不影响正常请求

### 内存占用
- OAuth 状态: 仅保留 30 分钟内的状态，自动过期
- Token 存储: 定期清理过期 Token
- 使用量缓存: 按需读写，不常驻内存

---

## 安全考虑

### Token 安全
- 64 字节随机 Token（crypto.randomBytes）
- 1 小时过期时间
- 自动清理过期 Token

### 文件上传安全
- 文件类型白名单
- 文件大小限制（5MB）
- 文件名安全化（移除特殊字符）
- 上传目录隔离（`configs/temp/`）

### OAuth 状态安全
- 30 分钟自动过期
- 一次性使用（完成后移除）
- 不存储敏感信息

---

## 测试建议

### 单元测试
- Token 生成和验证
- OAuth 状态加载和保存
- 文件上传处理
- 配置重载逻辑

### 集成测试
- 完整的 OAuth 授权流程
- Token 认证流程
- 配置重载对服务的影响

### 端到端测试
- UI 登录流程
- 文件上传 UI
- 配置重载 UI

---

## 未来改进方向

1. **TypeScript 迁移**: 增强类型安全
2. **单元测试覆盖**: 每个子模块达到 80%+ 覆盖率
3. **性能监控**: 添加性能指标收集
4. **错误处理**: 统一错误处理和日志记录
5. **配置管理**: 考虑使用配置中心

---

## 相关文档

- [架构重构验收报告](../Analysis/ARCHITECTURE_REFACTORING_ACCEPTANCE_REPORT.md)
- [任务计划文档](../Task/Active/ARCHITECTURE_OPTIMIZATION_PLAN.md)
- [API 文档](../Usage/) (待补充)

---

**维护者**: Development Team
**最后更新**: 2026-01-08
