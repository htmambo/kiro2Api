# Domain 层架构设计

**文档版本**: 1.0
**创建日期**: 2026-01-08
**最后更新**: 2026-01-08

---

## 概述

本项目采用 **领域驱动设计 (DDD)** 架构，将业务逻辑封装在独立的 Domain 层中，实现关注点分离和高内聚低耦合。

### 核心原则

1. **依赖方向单向**: UI 层 → Domain 层，Domain 层不依赖 UI 层
2. **业务逻辑集中**: 所有业务规则、验证、事务逻辑在 Domain 层实现
3. **可独立测试**: Domain 层不依赖 HTTP、数据库等基础设施，可独立单元测试
4. **事件驱动**: Domain 层通过事件（EventEmitter）与外部通信，解耦依赖

---

## 目录结构

```
src/domain/
├── oauth/                      # OAuth 领域
│   ├── index.js               # OAuthFacade（统一入口）
│   ├── state-store.js         # OAuth 状态管理
│   ├── token-store.js         # Token 存储管理
│   └── flows/                 # OAuth 授权流程
│       └── aws-sso-device.js  # AWS SSO 设备授权流程
│
└── account-pool/              # 账号池领域
    ├── index.js               # AccountPoolFacade（统一入口）
    ├── json-store.js          # JSON 存储实现
    └── sqlite-store.js        # SQLite 存储实现
```

---

## 核心概念

### 1. Facade（门面模式）

每个领域提供一个 **Facade** 作为统一入口，封装复杂的内部逻辑。

**优势**：
- 简化外部调用
- 隐藏实现细节
- 便于重构和替换实现

**示例**：
```javascript
// OAuthFacade 统一处理所有 OAuth 操作
const oauthFacade = new OAuthFacade({ accountPool: accountPoolManager });
const result = await oauthFacade.handleWebCallback({ code, state, oauthConfig });
```

### 2. Store（存储抽象）

将数据持久化逻辑封装在 **Store** 中，与业务逻辑分离。

**优势**：
- 业务逻辑不关心存储细节（文件、数据库、内存）
- 便于切换存储实现
- 便于测试（可 mock Store）

**示例**：
```javascript
// TokenStore 封装 token 文件操作
const saveInfo = await tokenStore.saveToken(accountNumber, credentialsData, {
    fileName: `kiro-auth-token-${accountNumber}.json`
});
```

### 3. Domain Events（领域事件）

Domain 层通过 **EventEmitter** 发出领域事件，UI 层订阅并转换为 SSE 事件。

**优势**：
- Domain 层不依赖 UI 层
- 解耦业务逻辑和 UI 通知
- 便于扩展（可添加多个事件监听器）

**示例**：
```javascript
// Domain 层发出事件
this._emitDomainEvent(OAUTH_DOMAIN_EVENTS.OAUTH_COMPLETED, {
    accountNumber,
    tokenFileName
});

// UI 层订阅事件（在 handler 中）
broadcastEvent('oauth_success', {
    provider: 'claude-kiro-oauth',
    credPath: saveInfo.relativePath
});
```

---

## 设计模式

### 1. 统一返回格式

所有 Domain 层方法返回统一的结果对象：

```javascript
// 成功
{
    ok: true,
    data: { /* 业务数据 */ },
    error: null,
    events: [ /* 领域事件列表 */ ]
}

// 失败
{
    ok: false,
    data: null,
    error: { message: '错误信息' },
    events: [ /* 领域事件列表 */ ]
}
```

**优势**：
- 调用方可统一处理成功/失败
- 包含完整的事件历史（便于调试）
- 类型安全（TypeScript 友好）

### 2. 依赖注入

Facade 通过构造函数接收依赖，便于测试和替换实现。

```javascript
export class OAuthFacade {
    constructor(options = {}) {
        this.stateStore = options.stateStore || oauthStateStore;
        this.tokenStore = options.tokenStore || tokenStore;
        this.accountPool = options.accountPool || null; // 可选注入
    }
}

// 使用时注入依赖
const oauthFacade = new OAuthFacade({
    stateStore: mockStateStore,  // 测试时可注入 mock
    tokenStore: mockTokenStore,
    accountPool: accountPoolManager
});
```

### 3. 事务一致性

Domain 层保证操作的原子性，失败时自动回滚。

```javascript
// 示例：入池失败时回滚 token 文件
const saveInfo = await this.tokenStore.saveToken(accountNumber, tokenPayload);

try {
    await this.accountPool.addAccount({ /* ... */ });
} catch (addAccountError) {
    // 回滚：删除已保存的 token 文件
    await this.tokenStore.deleteToken({ filePath: saveInfo.tokenFilePath });
    return fail(new Error(`入池失败: ${addAccountError.message}`));
}
```

### 4. 幂等性保护

关键操作（如 OAuth callback）实现幂等性，防止重复执行。

```javascript
// 检查是否已完成
const completedInfo = this.stateStore.getCompletedInfo(state);
if (completedInfo) {
    // 返回缓存的结果，不重复执行
    return ok({ accountNumber: completedInfo.accountNumber, ... });
}

// 执行操作...

// 标记为已完成
await this.stateStore.validateState(state, {
    consume: true,
    markCompleted: true,
    completedInfo: { accountNumber, relativePath, provider, resultOk: true }
});
```

---

## 分层职责

### Domain 层（业务逻辑层）

**职责**：
- 实现业务规则和验证
- 管理领域对象的生命周期
- 发出领域事件
- 保证事务一致性

**不应该做**：
- ❌ 解析 HTTP 请求
- ❌ 序列化 HTTP 响应
- ❌ 直接调用 UI 层方法
- ❌ 依赖具体的基础设施（如 Express）

### UI 层（适配层）

**职责**：
- 解析 HTTP 请求（req.body, req.query, req.params）
- 调用 Domain 层方法
- 序列化 HTTP 响应（res.json, res.end）
- 订阅 Domain 事件并转换为 SSE 事件

**示例**：
```javascript
// UI Handler（纯适配层）
export async function webCallback({ req, res, accountPoolManager }) {
    // 1. 解析 HTTP 请求
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state');

    // 2. 调用 Domain 层
    const oauthFacade = new OAuthFacade({ accountPool: accountPoolManager });
    const result = await oauthFacade.handleWebCallback({ code, state, oauthConfig });

    // 3. 序列化 HTTP 响应
    if (!result.ok) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(generateOAuthResultPage(false, result.error.message));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateOAuthResultPage(true, '授权成功', result.data));
}
```

---

## 依赖关系图

```
┌─────────────────────────────────────────────────────────┐
│                      UI 层 (Adapters)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ OAuth        │  │ Account      │  │ Upload       │  │
│  │ Handlers     │  │ Handlers     │  │ Handlers     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                  │                  │          │
└─────────┼──────────────────┼──────────────────┼──────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│                    Domain 层 (Business Logic)            │
│  ┌──────────────┐                    ┌──────────────┐  │
│  │ OAuthFacade  │                    │ AccountPool  │  │
│  │              │                    │ Facade       │  │
│  │ ┌──────────┐ │                    │              │  │
│  │ │StateStore│ │                    │ ┌──────────┐ │  │
│  │ │TokenStore│ │                    │ │JsonStore │ │  │
│  │ │AwsSsoDev │ │                    │ │SQLiteStr │ │  │
│  │ └──────────┘ │                    │ └──────────┘ │  │
│  └──────────────┘                    └──────────────┘  │
│         │                                     │         │
│         └─────────────┬───────────────────────┘         │
│                       │ (Domain Events)                 │
└───────────────────────┼─────────────────────────────────┘
                        │
                        ▼
                  ┌──────────┐
                  │   SSE    │
                  │  Events  │
                  └──────────┘
```

**依赖规则**：
- ✅ UI 层可以依赖 Domain 层
- ❌ Domain 层不能依赖 UI 层
- ✅ Domain 层通过事件与外部通信

---

## 测试策略

### 1. Domain 层单元测试

Domain 层可独立测试，不需要启动 HTTP 服务器。

```javascript
// 示例：测试 OAuthFacade
import { OAuthFacade } from '../src/domain/oauth/index.js';

describe('OAuthFacade', () => {
    it('should handle web callback successfully', async () => {
        const mockStateStore = { /* mock 实现 */ };
        const mockTokenStore = { /* mock 实现 */ };
        const mockAccountPool = { /* mock 实现 */ };

        const facade = new OAuthFacade({
            stateStore: mockStateStore,
            tokenStore: mockTokenStore,
            accountPool: mockAccountPool
        });

        const result = await facade.handleWebCallback({
            code: 'test-code',
            state: 'test-state',
            oauthConfig: { /* ... */ }
        });

        expect(result.ok).toBe(true);
        expect(result.data.accountNumber).toBeDefined();
    });
});
```

### 2. UI 层集成测试

测试 HTTP 请求 → Domain 层 → HTTP 响应的完整流程。

```javascript
// 示例：测试 OAuth callback 路由
import request from 'supertest';
import { app } from '../src/api/server.js';

describe('OAuth Callback', () => {
    it('should return success page', async () => {
        const response = await request(app)
            .get('/api/oauth/callback')
            .query({ code: 'test-code', state: 'test-state' });

        expect(response.status).toBe(200);
        expect(response.text).toContain('授权成功');
    });
});
```

---

## 迁移指南

### 从旧代码迁移到 Domain 层

**旧代码（直接文件操作）**：
```javascript
// ❌ 旧代码：UI handler 直接写文件
const tokenFilePath = path.join('configs/kiro', `kiro-auth-token-${accountNumber}.json`);
fs.writeFileSync(tokenFilePath, JSON.stringify(tokenData, null, 2));
```

**新代码（使用 Domain 层）**：
```javascript
// ✅ 新代码：通过 TokenStore
import { tokenStore } from '../../../domain/oauth/token-store.js';

const saveInfo = await tokenStore.saveToken(accountNumber, tokenData, {
    fileName: `kiro-auth-token-${accountNumber}.json`
});
```

**旧代码（直接操作账号池）**：
```javascript
// ❌ 旧代码：直接读写 account_pool.json
const poolData = JSON.parse(fs.readFileSync('configs/account_pool.json', 'utf8'));
poolData.accounts.push(newAccount);
fs.writeFileSync('configs/account_pool.json', JSON.stringify(poolData, null, 2));
```

**新代码（使用 Domain 层）**：
```javascript
// ✅ 新代码：通过 AccountPoolManager
const newAccount = accountPoolManager.addAccount({
    KIRO_OAUTH_CREDS_FILE_PATH: saveInfo.relativePath,
    isHealthy: true,
    // ...
});
```

---

## 最佳实践

### 1. 始终通过 Facade 访问 Domain 层

```javascript
// ✅ 推荐
const oauthFacade = new OAuthFacade({ accountPool: accountPoolManager });
const result = await oauthFacade.handleWebCallback({ code, state, oauthConfig });

// ❌ 不推荐：直接调用内部方法
const stateData = await oauthStateStore.getState(state);
const tokenData = await tokenStore.saveToken(...);
```

### 2. 检查返回值的 ok 字段

```javascript
const result = await oauthFacade.handleWebCallback({ code, state, oauthConfig });

if (!result.ok) {
    // 处理错误
    logger.error('OAuth callback failed:', result.error.message);
    return;
}

// 使用数据
const { accountNumber, tokenFileName } = result.data;
```

### 3. 订阅 Domain 事件（可选）

```javascript
const oauthFacade = new OAuthFacade({ accountPool: accountPoolManager });

// 订阅领域事件
oauthFacade.on('oauth_completed', (event) => {
    logger.info('OAuth completed:', event);
    // 转换为 SSE 事件
    broadcastEvent('oauth_success', { ... });
});

await oauthFacade.handleWebCallback({ code, state, oauthConfig });
```

### 4. 使用依赖注入便于测试

```javascript
// 生产环境
const oauthFacade = new OAuthFacade({
    stateStore: oauthStateStore,
    tokenStore: tokenStore,
    accountPool: accountPoolManager
});

// 测试环境
const oauthFacade = new OAuthFacade({
    stateStore: mockStateStore,
    tokenStore: mockTokenStore,
    accountPool: mockAccountPool
});
```

---

## 常见问题

### Q1: Domain 层可以调用外部 API 吗？

**A**: 可以，但建议通过依赖注入的方式。

```javascript
// 示例：注入 HTTP 客户端
export class OAuthFacade {
    constructor(options = {}) {
        this.httpClient = options.httpClient || axios; // 可注入 mock
    }

    async exchangeToken(code) {
        const response = await this.httpClient.post(TOKEN_ENDPOINT, { code });
        return response.data;
    }
}
```

### Q2: Domain 层可以访问数据库吗？

**A**: 可以，但应该通过 Store 抽象。

```javascript
// ✅ 推荐：通过 Store 抽象
const accounts = accountPoolManager.listAccounts();

// ❌ 不推荐：直接访问数据库
const accounts = sqliteDB.query('SELECT * FROM accounts');
```

### Q3: 如何处理跨领域的操作？

**A**: 通过 Facade 协调多个领域。

```javascript
// 示例：OAuth 完成后自动入池
export class OAuthFacade {
    async handleWebCallback({ code, state, oauthConfig }) {
        // 1. 交换 token
        const tokenData = await this.exchangeToken(code);

        // 2. 保存 token
        const saveInfo = await this.tokenStore.saveToken(accountNumber, tokenData);

        // 3. 入池（跨领域操作）
        if (this.accountPool) {
            await this.accountPool.addAccount({ ... });
        }

        return ok({ accountNumber, tokenFileName: saveInfo.tokenFileName });
    }
}
```

---

## 参考资料

- [OAuth 领域服务使用指南](OAUTH_FLOW.md)
- [AccountPoolFacade 使用指南](ACCOUNT_POOL.md)
- [事件系统文档](EVENTS.md)
- [UI 路由模块结构](UI_ROUTER_MODULE_STRUCTURE.md)

---

**维护者**: AI Assistant
**审核者**: Codex MCP
**版本历史**:
- v1.0 (2026-01-08): 初始版本
