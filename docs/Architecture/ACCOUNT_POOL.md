# AccountPoolFacade 使用指南

**文档版本**: 1.0
**创建日期**: 2026-01-08
**最后更新**: 2026-01-08

---

## 概述

AccountPoolFacade 是账号池的领域层门面，提供了统一的账号管理接口。它封装了底层的 AccountPoolManager，提供更清晰的 API 和更好的错误处理。

---

## 核心概念

### 单一数据源原则

所有账号数据都存储在 `configs/accounts.json` 中，这是唯一的真实数据源（Single Source of Truth）。

```json
{
  "accounts": [
    {
      "accountNumber": 1,
      "KIRO_OAUTH_CREDS_FILE_PATH": "configs/kiro/kiro-auth-token-1.json",
      "isHealthy": true,
      "lastUsed": "2026-01-08T10:30:00.000Z",
      "usageCount": 42
    }
  ]
}
```

### 自动持久化

AccountPoolManager 使用 **debounce 机制**自动保存更改：
- 修改后 500ms 内没有新修改，自动保存到文件
- 无需手动调用 `save()` 方法
- 保证数据一致性

---

## API 参考

### 1. 添加账号

```javascript
addAccount(accountData)
```

**参数**：
- `accountData.KIRO_OAUTH_CREDS_FILE_PATH` (string, required): Token 文件相对路径
- `accountData.isHealthy` (boolean, optional): 账号健康状态，默认 `true`
- `accountData.accountNumber` (number, optional): 账号编号，不提供则自动分配

**返回值**：
- `accountNumber` (number): 分配的账号编号

**示例**：
```javascript
import { accountPoolFacade } from '../../../domain/account-pool/index.js';

// 自动分配账号编号
const accountNumber = accountPoolFacade.addAccount({
    KIRO_OAUTH_CREDS_FILE_PATH: 'configs/kiro/kiro-auth-token-1.json',
    isHealthy: true
});

console.log(`账号 #${accountNumber} 已添加`);

// 指定账号编号
const accountNumber = accountPoolFacade.addAccount({
    accountNumber: 5,
    KIRO_OAUTH_CREDS_FILE_PATH: 'configs/kiro/kiro-auth-token-5.json',
    isHealthy: true
});
```

**注意事项**：
- ✅ 自动去重：相同 `KIRO_OAUTH_CREDS_FILE_PATH` 不会重复添加
- ✅ 自动分配编号：不提供 `accountNumber` 时自动分配下一个可用编号
- ✅ 自动持久化：添加后 500ms 自动保存到文件

---

### 2. 更新账号

```javascript
updateAccount(accountNumber, updates)
```

**参数**：
- `accountNumber` (number, required): 账号编号
- `updates` (object, required): 要更新的字段

**可更新字段**：
- `isHealthy` (boolean): 健康状态
- `lastUsed` (string): 最后使用时间（ISO 8601 格式）
- `usageCount` (number): 使用次数
- `KIRO_OAUTH_CREDS_FILE_PATH` (string): Token 文件路径

**返回值**：
- `boolean`: 更新成功返回 `true`，账号不存在返回 `false`

**示例**：
```javascript
// 更新健康状态
accountPoolFacade.updateAccount(1, { isHealthy: false });

// 更新使用信息
accountPoolFacade.updateAccount(1, {
    lastUsed: new Date().toISOString(),
    usageCount: 43
});

// 更新 Token 文件路径
accountPoolFacade.updateAccount(1, {
    KIRO_OAUTH_CREDS_FILE_PATH: 'configs/kiro/kiro-auth-token-1-new.json'
});

// 批量更新
const success = accountPoolFacade.updateAccount(1, {
    isHealthy: true,
    lastUsed: new Date().toISOString(),
    usageCount: 44
});

if (!success) {
    console.error('账号不存在');
}
```

**注意事项**：
- ✅ 自动持久化：更新后 500ms 自动保存
- ✅ 部分更新：只更新提供的字段，其他字段保持不变
- ⚠️ 不存在的账号：返回 `false`，不抛出异常

---

### 3. 移除账号

```javascript
removeAccount(accountNumber)
```

**参数**：
- `accountNumber` (number, required): 账号编号

**返回值**：
- `boolean`: 移除成功返回 `true`，账号不存在返回 `false`

**示例**：
```javascript
const success = accountPoolFacade.removeAccount(1);

if (success) {
    console.log('账号已移除');
} else {
    console.error('账号不存在');
}
```

**注意事项**：
- ✅ 自动持久化：移除后 500ms 自动保存
- ⚠️ 不删除 Token 文件：只从账号池移除，Token 文件需要手动删除
- ⚠️ 不存在的账号：返回 `false`，不抛出异常

---

### 4. 获取账号信息

```javascript
getAccount(accountNumber)
```

**参数**：
- `accountNumber` (number, required): 账号编号

**返回值**：
- `object | null`: 账号信息对象，不存在返回 `null`

**示例**：
```javascript
const account = accountPoolFacade.getAccount(1);

if (account) {
    console.log('Token 文件:', account.KIRO_OAUTH_CREDS_FILE_PATH);
    console.log('健康状态:', account.isHealthy);
    console.log('使用次数:', account.usageCount);
} else {
    console.error('账号不存在');
}
```

---

### 5. 获取所有账号

```javascript
getAllAccounts()
```

**返回值**：
- `Array<object>`: 所有账号的数组

**示例**：
```javascript
const accounts = accountPoolFacade.getAllAccounts();

console.log(`共有 ${accounts.length} 个账号`);

accounts.forEach(account => {
    console.log(`账号 #${account.accountNumber}: ${account.KIRO_OAUTH_CREDS_FILE_PATH}`);
});
```

---

### 6. 获取健康账号

```javascript
getHealthyAccounts()
```

**返回值**：
- `Array<object>`: 所有健康账号的数组（`isHealthy: true`）

**示例**：
```javascript
const healthyAccounts = accountPoolFacade.getHealthyAccounts();

console.log(`有 ${healthyAccounts.length} 个健康账号`);

if (healthyAccounts.length === 0) {
    console.error('没有可用的健康账号！');
}
```

---

### 7. 检查账号是否存在

```javascript
hasAccount(accountNumber)
```

**参数**：
- `accountNumber` (number, required): 账号编号

**返回值**：
- `boolean`: 存在返回 `true`，不存在返回 `false`

**示例**：
```javascript
if (accountPoolFacade.hasAccount(1)) {
    console.log('账号存在');
} else {
    console.log('账号不存在');
}
```

---

### 8. 获取账号数量

```javascript
getAccountCount()
```

**返回值**：
- `number`: 账号总数

**示例**：
```javascript
const count = accountPoolFacade.getAccountCount();
console.log(`账号池中有 ${count} 个账号`);
```

---

## 使用场景

### 场景 1: OAuth 授权完成后添加账号

```javascript
import { accountPoolFacade } from '../../../domain/account-pool/index.js';
import { tokenStore } from '../../../domain/oauth/token-store.js';

async function handleOAuthSuccess(tokenData, accountNumber) {
    // 1. 保存 token
    const saveInfo = await tokenStore.saveToken(accountNumber, tokenData);

    // 2. 添加到账号池
    try {
        const assignedNumber = accountPoolFacade.addAccount({
            accountNumber,
            KIRO_OAUTH_CREDS_FILE_PATH: saveInfo.relativePath,
            isHealthy: true
        });

        console.log(`账号 #${assignedNumber} 已添加到账号池`);
    } catch (error) {
        // 回滚：删除 token 文件
        await tokenStore.deleteToken({ filePath: saveInfo.tokenFilePath });
        throw new Error(`入池失败: ${error.message}`);
    }
}
```

### 场景 2: 账号健康检查

```javascript
import { accountPoolFacade } from '../../../domain/account-pool/index.js';

async function checkAccountHealth(accountNumber) {
    const account = accountPoolFacade.getAccount(accountNumber);

    if (!account) {
        console.error(`账号 #${accountNumber} 不存在`);
        return;
    }

    try {
        // 尝试使用账号
        await someApiCall(account.KIRO_OAUTH_CREDS_FILE_PATH);

        // 成功：标记为健康
        accountPoolFacade.updateAccount(accountNumber, {
            isHealthy: true,
            lastUsed: new Date().toISOString()
        });
    } catch (error) {
        // 失败：标记为不健康
        accountPoolFacade.updateAccount(accountNumber, {
            isHealthy: false
        });

        console.error(`账号 #${accountNumber} 不健康: ${error.message}`);
    }
}
```

### 场景 3: 轮询选择健康账号

```javascript
import { accountPoolFacade } from '../../../domain/account-pool/index.js';

let currentIndex = 0;

function getNextHealthyAccount() {
    const healthyAccounts = accountPoolFacade.getHealthyAccounts();

    if (healthyAccounts.length === 0) {
        throw new Error('没有可用的健康账号');
    }

    // 轮询选择
    const account = healthyAccounts[currentIndex % healthyAccounts.length];
    currentIndex++;

    // 更新使用信息
    accountPoolFacade.updateAccount(account.accountNumber, {
        lastUsed: new Date().toISOString(),
        usageCount: (account.usageCount || 0) + 1
    });

    return account;
}
```

### 场景 4: 批量导入账号

```javascript
import { accountPoolFacade } from '../../../domain/account-pool/index.js';
import { tokenStore } from '../../../domain/oauth/token-store.js';

async function batchImportAccounts(tokens) {
    const results = [];

    for (const tokenData of tokens) {
        try {
            // 1. 保存 token
            const saveInfo = await tokenStore.saveToken(null, tokenData);

            // 2. 添加到账号池
            const accountNumber = accountPoolFacade.addAccount({
                KIRO_OAUTH_CREDS_FILE_PATH: saveInfo.relativePath,
                isHealthy: true
            });

            results.push({ success: true, accountNumber });
        } catch (error) {
            results.push({ success: false, error: error.message });
        }
    }

    console.log(`成功导入 ${results.filter(r => r.success).length} 个账号`);
    return results;
}
```

### 场景 5: 账号使用统计

```javascript
import { accountPoolFacade } from '../../../domain/account-pool/index.js';

function getAccountStats() {
    const accounts = accountPoolFacade.getAllAccounts();
    const healthyAccounts = accountPoolFacade.getHealthyAccounts();

    const stats = {
        total: accounts.length,
        healthy: healthyAccounts.length,
        unhealthy: accounts.length - healthyAccounts.length,
        totalUsage: accounts.reduce((sum, acc) => sum + (acc.usageCount || 0), 0),
        mostUsed: accounts.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))[0],
        leastUsed: accounts.sort((a, b) => (a.usageCount || 0) - (b.usageCount || 0))[0]
    };

    return stats;
}

// 使用示例
const stats = getAccountStats();
console.log(`总账号数: ${stats.total}`);
console.log(`健康账号: ${stats.healthy}`);
console.log(`不健康账号: ${stats.unhealthy}`);
console.log(`总使用次数: ${stats.totalUsage}`);
console.log(`最常用账号: #${stats.mostUsed?.accountNumber} (${stats.mostUsed?.usageCount} 次)`);
```

---

## 与 AccountPoolManager 的关系

### AccountPoolFacade（推荐使用）

```javascript
import { accountPoolFacade } from '../../../domain/account-pool/index.js';

// 简洁的 API
accountPoolFacade.addAccount({ ... });
accountPoolFacade.updateAccount(1, { isHealthy: false });
```

**特点**：
- ✅ 领域层接口，符合 DDD 原则
- ✅ 更清晰的 API 设计
- ✅ 更好的错误处理
- ✅ 便于测试和 mock

### AccountPoolManager（底层实现）

```javascript
import { accountPoolManager } from '../../../services/account-pool-manager.js';

// 直接操作底层
accountPoolManager.addAccount({ ... });
accountPoolManager.accounts[0].isHealthy = false;
accountPoolManager.save(); // 需要手动保存
```

**特点**：
- ⚠️ 基础设施层，直接操作数据
- ⚠️ 需要手动调用 `save()`（虽然有 debounce）
- ⚠️ 暴露内部实现细节

**建议**：
- 新代码使用 `accountPoolFacade`
- 旧代码逐步迁移到 `accountPoolFacade`
- 只在需要直接访问底层数据时使用 `accountPoolManager`

---

## 数据持久化机制

### Debounce 自动保存

```javascript
// AccountPoolManager 内部实现
class AccountPoolManager {
    constructor() {
        this.saveDebounced = debounce(() => {
            fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(this.data, null, 2));
        }, 500); // 500ms 延迟
    }

    addAccount(accountData) {
        // 修改数据
        this.accounts.push(accountData);

        // 触发自动保存
        this.saveDebounced();
    }
}
```

**工作原理**：
1. 调用 `addAccount()` / `updateAccount()` / `removeAccount()`
2. 触发 `saveDebounced()`
3. 等待 500ms
4. 如果 500ms 内没有新的修改，执行保存
5. 如果 500ms 内有新的修改，重新计时

**优点**：
- ✅ 自动持久化，无需手动调用
- ✅ 批量操作时只保存一次
- ✅ 减少磁盘 I/O

**注意事项**：
- ⚠️ 修改后最多 500ms 才会保存到文件
- ⚠️ 进程异常退出可能丢失未保存的数据
- ✅ 正常退出时会立即保存（process.on('exit')）

---

## 错误处理

### 添加账号失败

```javascript
try {
    accountPoolFacade.addAccount({
        KIRO_OAUTH_CREDS_FILE_PATH: 'configs/kiro/kiro-auth-token-1.json',
        isHealthy: true
    });
} catch (error) {
    if (error.message.includes('已存在')) {
        console.log('账号已存在，跳过添加');
    } else {
        console.error('添加账号失败:', error.message);
    }
}
```

### 更新不存在的账号

```javascript
const success = accountPoolFacade.updateAccount(999, { isHealthy: false });

if (!success) {
    console.error('账号 #999 不存在');
}
```

### 移除不存在的账号

```javascript
const success = accountPoolFacade.removeAccount(999);

if (!success) {
    console.log('账号 #999 不存在，无需移除');
}
```

---

## 测试示例

### 单元测试

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { AccountPoolFacade } from '../../../domain/account-pool/index.js';

describe('AccountPoolFacade', () => {
    let facade;
    let mockManager;

    beforeEach(() => {
        mockManager = {
            accounts: [],
            addAccount: vi.fn(),
            updateAccount: vi.fn(),
            removeAccount: vi.fn()
        };

        facade = new AccountPoolFacade(mockManager);
    });

    it('should add account', () => {
        const accountNumber = facade.addAccount({
            KIRO_OAUTH_CREDS_FILE_PATH: 'configs/kiro/token-1.json',
            isHealthy: true
        });

        expect(mockManager.addAccount).toHaveBeenCalled();
        expect(accountNumber).toBe(1);
    });

    it('should update account', () => {
        mockManager.accounts = [
            { accountNumber: 1, isHealthy: true }
        ];

        const success = facade.updateAccount(1, { isHealthy: false });

        expect(success).toBe(true);
        expect(mockManager.updateAccount).toHaveBeenCalledWith(1, { isHealthy: false });
    });
});
```

---

## 最佳实践

### 1. 使用 Facade 而非直接访问 Manager

```javascript
// ✅ 推荐
import { accountPoolFacade } from '../../../domain/account-pool/index.js';
accountPoolFacade.addAccount({ ... });

// ❌ 不推荐
import { accountPoolManager } from '../../../services/account-pool-manager.js';
accountPoolManager.addAccount({ ... });
```

### 2. 检查操作结果

```javascript
// ✅ 推荐
const success = accountPoolFacade.updateAccount(1, { isHealthy: false });
if (!success) {
    console.error('更新失败：账号不存在');
}

// ❌ 不推荐
accountPoolFacade.updateAccount(1, { isHealthy: false });
// 不检查结果，可能导致静默失败
```

### 3. 使用事务模式（入池失败回滚）

```javascript
// ✅ 推荐
const saveInfo = await tokenStore.saveToken(accountNumber, tokenData);

try {
    accountPoolFacade.addAccount({
        accountNumber,
        KIRO_OAUTH_CREDS_FILE_PATH: saveInfo.relativePath,
        isHealthy: true
    });
} catch (error) {
    // 回滚：删除 token 文件
    await tokenStore.deleteToken({ filePath: saveInfo.tokenFilePath });
    throw error;
}

// ❌ 不推荐
await tokenStore.saveToken(accountNumber, tokenData);
accountPoolFacade.addAccount({ ... });
// 入池失败时 token 文件仍然存在，导致数据不一致
```

### 4. 定期清理不健康账号

```javascript
// ✅ 推荐
setInterval(() => {
    const accounts = accountPoolFacade.getAllAccounts();

    accounts.forEach(account => {
        if (!account.isHealthy) {
            console.log(`移除不健康账号 #${account.accountNumber}`);
            accountPoolFacade.removeAccount(account.accountNumber);
        }
    });
}, 3600000); // 每小时清理一次
```

---

## 迁移指南

### 从 AccountPoolManager 迁移到 AccountPoolFacade

**步骤 1**: 替换导入

```javascript
// 旧代码
import { accountPoolManager } from '../../../services/account-pool-manager.js';

// 新代码
import { accountPoolFacade } from '../../../domain/account-pool/index.js';
```

**步骤 2**: 替换 API 调用

```javascript
// 旧代码
accountPoolManager.addAccount({ ... });
accountPoolManager.accounts[0].isHealthy = false;
accountPoolManager.save();

// 新代码
accountPoolFacade.addAccount({ ... });
accountPoolFacade.updateAccount(1, { isHealthy: false });
// 自动保存，无需手动调用
```

**步骤 3**: 更新错误处理

```javascript
// 旧代码
try {
    accountPoolManager.addAccount({ ... });
} catch (error) {
    // 处理错误
}

// 新代码
const success = accountPoolFacade.addAccount({ ... });
if (!success) {
    // 处理失败
}
```

---

## 参考资料

- [Domain 层架构设计](DOMAIN_LAYER.md)
- [OAuth 流程文档](OAUTH_FLOW.md)
- [事件系统文档](EVENTS.md)

---

**维护者**: AI Assistant
**审核者**: Codex MCP
**版本历史**:
- v1.0 (2026-01-08): 初始版本
