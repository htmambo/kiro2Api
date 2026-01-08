# OAuth 领域服务使用指南

**文档版本**: 1.0
**创建日期**: 2026-01-08
**最后更新**: 2026-01-08

---

## 概述

OAuth 领域服务提供了统一的 OAuth 授权流程管理，包括状态管理、Token 存储、Web 回调处理和 AWS SSO 设备授权流程。

---

## 核心组件

### 1. OAuthFacade（统一入口）

**位置**: `src/domain/oauth/index.js`

**职责**：
- 处理 OAuth Web 回调
- 协调 StateStore 和 TokenStore
- 管理事务一致性（入池失败时回滚）
- 实现幂等性保护
- 发出领域事件

**使用示例**：
```javascript
import { OAuthFacade } from '../../../domain/oauth/index.js';

const oauthFacade = new OAuthFacade({
    accountPool: accountPoolManager  // 可选注入
});

const result = await oauthFacade.handleWebCallback({
    code: 'authorization-code',
    state: 'state-token',
    oauthConfig: KIRO_OAUTH_CONFIG
});

if (result.ok) {
    const { accountNumber, tokenFileName, provider } = result.data;
    console.log(`授权成功: 账号 #${accountNumber}`);
} else {
    console.error('授权失败:', result.error.message);
}
```

### 2. StateStore（状态管理）

**位置**: `src/domain/oauth/state-store.js`

**职责**：
- 创建和存储 OAuth state
- 验证 state 有效性
- 管理 state 生命周期（过期清理）
- 缓存已完成的 state（幂等性支持）

**使用示例**：
```javascript
import { oauthStateStore } from '../../../domain/oauth/state-store.js';

// 创建 state
const stateData = await oauthStateStore.createState({
    accountNumber: 1,
    redirectUri: 'http://localhost:3000/callback',
    code_verifier: 'random-verifier',
    machineid: 'machine-id',
    provider: 'Kiro'
});

// 验证 state
const validatedState = await oauthStateStore.validateState(state, {
    consume: true,  // 消费 state（一次性使用）
    markCompleted: true,  // 标记为已完成
    completedInfo: {
        accountNumber: 1,
        relativePath: 'configs/kiro/kiro-auth-token-1.json',
        provider: 'Kiro',
        resultOk: true
    }
});

// 获取已完成的 state 信息（幂等性）
const completedInfo = oauthStateStore.getCompletedInfo(state);
if (completedInfo) {
    console.log('State 已完成:', completedInfo.accountNumber);
}

// 清理过期 state
const stats = await oauthStateStore.cleanExpiredStates();
console.log(`清理了 ${stats.cleaned} 个过期 state`);
```

### 3. TokenStore（Token 存储）

**位置**: `src/domain/oauth/token-store.js`

**职责**：
- 保存 OAuth token 到文件
- 加载 token 文件
- 删除 token 文件
- 管理文件路径规范化

**使用示例**：
```javascript
import { tokenStore } from '../../../domain/oauth/token-store.js';

// 保存 token
const saveInfo = await tokenStore.saveToken(accountNumber, {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    provider: 'Kiro',
    machineid: 'machine-id'
}, {
    fileName: `kiro-auth-token-${accountNumber}.json`
});

console.log('Token 已保存:', saveInfo.tokenFilePath);
console.log('相对路径:', saveInfo.relativePath);

// 加载 token
const tokenData = await tokenStore.loadToken(accountNumber);
console.log('Access Token:', tokenData.accessToken);

// 删除 token
await tokenStore.deleteToken({ filePath: saveInfo.tokenFilePath });
// 或
await tokenStore.deleteToken(accountNumber);
```

### 4. AwsSsoDeviceFlow（AWS SSO 设备授权）

**位置**: `src/domain/oauth/flows/aws-sso-device.js`

**职责**：
- 启动 AWS SSO 设备授权流程
- 自动注册 Client
- 后台轮询 token
- 自动保存 token 和入池
- 发出领域事件

**使用示例**：
```javascript
import { AwsSsoDeviceFlow } from '../../../domain/oauth/flows/aws-sso-device.js';

const awsSsoFlow = new AwsSsoDeviceFlow({
    tokenStore: tokenStore,
    accountPool: accountPoolManager  // 可选注入
});

// 订阅事件
awsSsoFlow.on('oauth_completed', (event) => {
    console.log('授权完成:', event.accountNumber);
});

awsSsoFlow.on('oauth_failed', (event) => {
    console.error('授权失败:', event.message);
});

// 启动授权流程
const result = await awsSsoFlow.start(currentConfig);

console.log('请访问:', result.authUrl);
console.log('用户代码:', result.authInfo.userCode);
// 后台轮询会自动进行，完成后触发事件
```

---

## OAuth 流程详解

### 1. Web OAuth 流程（社交登录）

```
┌─────────┐                 ┌─────────┐                 ┌─────────┐
│ Browser │                 │   UI    │                 │ Domain  │
│         │                 │ Handler │                 │  Layer  │
└────┬────┘                 └────┬────┘                 └────┬────┘
     │                           │                           │
     │  1. GET /oauth/authorize  │                           │
     ├──────────────────────────>│                           │
     │                           │  createState()            │
     │                           ├──────────────────────────>│
     │                           │  { state, redirectUri }   │
     │                           │<──────────────────────────┤
     │  302 Redirect to OAuth    │                           │
     │<──────────────────────────┤                           │
     │                           │                           │
     │  2. User authorizes       │                           │
     │  (on OAuth provider)      │                           │
     │                           │                           │
     │  3. GET /oauth/callback   │                           │
     │     ?code=xxx&state=yyy   │                           │
     ├──────────────────────────>│                           │
     │                           │  handleWebCallback()      │
     │                           ├──────────────────────────>│
     │                           │  - validateState()        │
     │                           │  - exchange token         │
     │                           │  - saveToken()            │
     │                           │  - addAccount()           │
     │                           │  { ok, data }             │
     │                           │<──────────────────────────┤
     │  200 Success Page         │                           │
     │<──────────────────────────┤                           │
     │                           │                           │
```

**代码示例**：
```javascript
// UI Handler
export async function webCallback({ req, res, accountPoolManager }) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state');

    const oauthFacade = new OAuthFacade({ accountPool: accountPoolManager });
    const result = await oauthFacade.handleWebCallback({
        code,
        state,
        oauthConfig: KIRO_OAUTH_CONFIG
    });

    if (!result.ok) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(generateOAuthResultPage(false, result.error.message));
        return;
    }

    const { accountNumber, tokenFileName, provider } = result.data;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateOAuthResultPage(true, `账号 #${accountNumber} 授权成功！`, {
        accountNumber,
        tokenFile: tokenFileName,
        provider
    }));
}
```

### 2. AWS SSO 设备授权流程

```
┌─────────┐                 ┌─────────┐                 ┌─────────┐
│ Client  │                 │   UI    │                 │ Domain  │
│         │                 │ Handler │                 │  Layer  │
└────┬────┘                 └────┬────┘                 └────┬────┘
     │                           │                           │
     │  1. POST /oauth/aws-sso   │                           │
     ├──────────────────────────>│                           │
     │                           │  awsSsoFlow.start()       │
     │                           ├──────────────────────────>│
     │                           │  - registerClient()       │
     │                           │  - startDeviceAuth()      │
     │                           │  - pollDeviceToken()      │
     │                           │    (background)           │
     │                           │  { authUrl, userCode }    │
     │                           │<──────────────────────────┤
     │  200 { authUrl, userCode }│                           │
     │<──────────────────────────┤                           │
     │                           │                           │
     │  2. User visits authUrl   │                           │
     │     and enters userCode   │                           │
     │                           │                           │
     │                           │  (background polling)     │
     │                           │  - token received         │
     │                           │  - saveToken()            │
     │                           │  - addAccount()           │
     │                           │  emit('oauth_completed')  │
     │                           │<──────────────────────────┤
     │                           │  broadcastEvent()         │
     │                           │  (SSE to frontend)        │
     │                           │                           │
```

**代码示例**：
```javascript
// UI Handler
export async function awsSsoStart({ req, res, currentConfig, accountPoolManager }) {
    const body = await parseRequestBody(req);
    const { accountNumber, startUrl } = body;

    // 创建 AwsSsoDeviceFlow 实例
    const awsSsoFlow = new AwsSsoDeviceFlow({
        tokenStore: tokenStore,
        accountPool: accountPoolManager
    });

    // 订阅事件
    awsSsoFlow.on('oauth_completed', (event) => {
        broadcastEvent('oauth_success', {
            provider: 'claude-kiro-oauth-builderid',
            credPath: event.saveInfo.relativePath
        });
    });

    awsSsoFlow.on('oauth_failed', (event) => {
        broadcastEvent('oauth_error', {
            provider: 'claude-kiro-oauth-builderid',
            error: event.message
        });
    });

    // 启动授权流程
    const result = await awsSsoFlow.start(currentConfig);

    // 立即返回授权信息
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        success: true,
        accountNumber,
        userCode: result.authInfo.userCode,
        verificationUri: result.authInfo.verificationUri,
        verificationUriComplete: result.authUrl
    }));
}
```

### 3. 手动导入 RefreshToken 流程

```
┌─────────┐                 ┌─────────┐                 ┌─────────┐
│ Client  │                 │   UI    │                 │ Domain  │
│         │                 │ Handler │                 │  Layer  │
└────┬────┘                 └────┬────┘                 └────┬────┘
     │                           │                           │
     │  POST /oauth/manual       │                           │
     │  { refreshToken, ... }    │                           │
     ├──────────────────────────>│                           │
     │                           │  1. validate token        │
     │                           │     (refresh to get       │
     │                           │      accessToken)         │
     │                           │                           │
     │                           │  2. withLock(tokenHash)   │
     │                           │     withLock(accountNum)  │
     │                           │                           │
     │                           │  3. tokenStore.saveToken()│
     │                           ├──────────────────────────>│
     │                           │  { tokenFilePath }        │
     │                           │<──────────────────────────┤
     │                           │                           │
     │                           │  4. accountPool.addAccount│
     │                           │     (if fails, rollback)  │
     │                           │                           │
     │  200 { success: true }    │                           │
     │<──────────────────────────┤                           │
     │                           │                           │
```

**代码示例**：
```javascript
// UI Handler
export async function manualImport({ req, res, accountPoolManager }) {
    const body = await parseRequestBody(req);
    const { refreshToken, accountNumber } = body;

    // 1. 验证 refreshToken（锁外执行）
    const refreshResponse = await axios.post(REFRESH_URL, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken
    });

    const { accessToken, expiresAt } = refreshResponse.data;

    // 2. 双锁策略
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const tokenLockKey = `manualImport:token:${refreshTokenHash}`;
    const accountLockKey = `manualImport:account:${accountNumber}`;

    await withLock(tokenLockKey, async () => {
        await withLock(accountLockKey, async () => {
            // 3. 保存 token
            const saveInfo = await tokenStore.saveToken(accountNumber, {
                accessToken,
                refreshToken,
                expiresAt,
                provider: 'Manual'
            });

            // 4. 入池（失败时回滚）
            try {
                accountPoolManager.addAccount({
                    KIRO_OAUTH_CREDS_FILE_PATH: saveInfo.relativePath,
                    isHealthy: true
                });
            } catch (error) {
                await tokenStore.deleteToken({ filePath: saveInfo.tokenFilePath });
                throw new Error(`入池失败: ${error.message}`);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
    });
}
```

---

## 领域事件

### OAuthFacade 事件

```javascript
import { OAUTH_DOMAIN_EVENTS } from '../../../domain/oauth/index.js';

// 事件类型
OAUTH_DOMAIN_EVENTS.OAUTH_STARTED      // OAuth 流程开始
OAUTH_DOMAIN_EVENTS.OAUTH_COMPLETED    // OAuth 流程完成
OAUTH_DOMAIN_EVENTS.OAUTH_FAILED       // OAuth 流程失败
OAUTH_DOMAIN_EVENTS.TOKEN_SAVED        // Token 已保存
```

**订阅示例**：
```javascript
const oauthFacade = new OAuthFacade({ accountPool: accountPoolManager });

oauthFacade.on(OAUTH_DOMAIN_EVENTS.OAUTH_STARTED, (event) => {
    console.log('OAuth 开始:', event.timestamp);
});

oauthFacade.on(OAUTH_DOMAIN_EVENTS.OAUTH_COMPLETED, (event) => {
    console.log('OAuth 完成:', event.payload.accountNumber);
    // 转换为 SSE 事件
    broadcastEvent('oauth_success', {
        provider: event.payload.provider,
        accountNumber: event.payload.accountNumber
    });
});

oauthFacade.on(OAUTH_DOMAIN_EVENTS.OAUTH_FAILED, (event) => {
    console.error('OAuth 失败:', event.payload.message);
    broadcastEvent('oauth_error', {
        error: event.payload.message
    });
});
```

---

## 事务一致性保证

### 入池失败回滚

所有 OAuth 流程都实现了事务一致性：**入池失败时自动回滚 token 文件**。

```javascript
// OAuthFacade.handleWebCallback 中的实现
const saveInfo = await this.tokenStore.saveToken(accountNumber, tokenPayload);

try {
    await this.accountPool.addAccount({ ... });
} catch (addAccountError) {
    // 回滚：删除已保存的 token 文件
    await this.tokenStore.deleteToken({ filePath: saveInfo.tokenFilePath });
    return fail(new Error(`入池失败: ${addAccountError.message}`));
}
```

**保证**：
- ✅ Token 文件和账号池状态始终一致
- ✅ 不会出现"token 文件存在但未入池"的情况
- ✅ 失败时自动清理，无需手动干预

---

## 幂等性保护

### OAuth Callback 幂等性

使用 `completedInfo` 缓存机制，防止重复处理同一个 state。

```javascript
// 检查是否已完成
const completedInfo = this.stateStore.getCompletedInfo(state);
if (completedInfo) {
    // 返回缓存的结果，不重复执行
    return ok({
        accountNumber: completedInfo.accountNumber,
        tokenFileName: completedInfo.tokenFileName,
        provider: completedInfo.provider
    });
}

// 执行操作...

// 标记为已完成
await this.stateStore.validateState(state, {
    consume: true,
    markCompleted: true,
    completedInfo: {
        accountNumber,
        relativePath,
        provider,
        resultOk: true
    }
});
```

**保证**：
- ✅ 同一个 state 只会处理一次
- ✅ 重复请求返回相同结果
- ✅ 防止重复写 token / 重复入池

---

## 并发控制

### 双锁策略（manualImport）

```javascript
// 锁 1: refreshToken hash（防止同一 token 并发导入）
const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
const tokenLockKey = `manualImport:token:${refreshTokenHash}`;

// 锁 2: accountNumber（防止同一账号并发操作）
const accountLockKey = `manualImport:account:${accountNumber}`;

await withLock(tokenLockKey, async () => {
    await withLock(accountLockKey, async () => {
        // 导入逻辑
    });
});
```

### State 级别锁（webCallback）

```javascript
const lockKey = `oauth:callback:${state}`;
return withLock(lockKey, async () => {
    // 处理 callback
});
```

---

## 最佳实践

### 1. 始终检查返回值

```javascript
const result = await oauthFacade.handleWebCallback({ code, state, oauthConfig });

if (!result.ok) {
    logger.error('OAuth 失败:', result.error.message);
    // 处理错误
    return;
}

// 使用数据
const { accountNumber, tokenFileName } = result.data;
```

### 2. 订阅领域事件

```javascript
const oauthFacade = new OAuthFacade({ accountPool: accountPoolManager });

oauthFacade.on('oauth_completed', (event) => {
    // 转换为 SSE 事件通知前端
    broadcastEvent('oauth_success', { ... });
});
```

### 3. 使用依赖注入便于测试

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

### 4. 处理事务回滚

```javascript
try {
    const saveInfo = await tokenStore.saveToken(accountNumber, tokenData);

    try {
        await accountPoolManager.addAccount({ ... });
    } catch (poolError) {
        // 回滚 token 文件
        await tokenStore.deleteToken({ filePath: saveInfo.tokenFilePath });
        throw new Error(`入池失败: ${poolError.message}`);
    }
} catch (error) {
    logger.error('操作失败:', error);
    // 通知用户
}
```

---

## 常见问题

### Q1: 如何处理 OAuth 超时？

**A**: StateStore 会自动清理过期的 state（默认 10 分钟）。

```javascript
// 定期清理过期 state
setInterval(async () => {
    const stats = await oauthStateStore.cleanExpiredStates();
    logger.info(`清理了 ${stats.cleaned} 个过期 state`);
}, 60000); // 每分钟清理一次
```

### Q2: 如何实现自定义的 OAuth 流程？

**A**: 参考 `AwsSsoDeviceFlow` 的实现，继承 `EventEmitter` 并使用 `TokenStore` 和 `AccountPoolFacade`。

```javascript
import { EventEmitter } from 'node:events';
import { tokenStore } from '../token-store.js';

export class CustomOAuthFlow extends EventEmitter {
    constructor(options = {}) {
        super();
        this.tokenStore = options.tokenStore || tokenStore;
        this.accountPool = options.accountPool || null;
    }

    async start(params) {
        // 自定义授权逻辑
        this.emit('oauth_started', { ... });

        try {
            // 获取 token
            const tokenData = await this.customAuthLogic(params);

            // 保存 token
            const saveInfo = await this.tokenStore.saveToken(accountNumber, tokenData);

            // 入池
            if (this.accountPool) {
                await this.accountPool.addAccount({ ... });
            }

            this.emit('oauth_completed', { ... });
        } catch (error) {
            this.emit('oauth_failed', { message: error.message });
            throw error;
        }
    }
}
```

### Q3: 如何处理 Token 刷新？

**A**: Token 刷新逻辑在 Kiro 适配器中实现，不在 OAuth 领域服务中。

```javascript
// src/kiro/adapter.js
async refreshAccessToken() {
    const response = await axios.post(REFRESH_URL, {
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken
    });

    this.accessToken = response.data.accessToken;
    this.expiresAt = response.data.expiresAt;

    // 更新 token 文件
    await tokenStore.saveToken(this.accountNumber, {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        expiresAt: this.expiresAt
    });
}
```

---

## 参考资料

- [Domain 层架构设计](DOMAIN_LAYER.md)
- [AccountPoolFacade 使用指南](ACCOUNT_POOL.md)
- [事件系统文档](EVENTS.md)
- [SSE 事件使用指南](../Usage/SSE_EVENTS.md)

---

**维护者**: AI Assistant
**审核者**: Codex MCP
**版本历史**:
- v1.0 (2026-01-08): 初始版本
