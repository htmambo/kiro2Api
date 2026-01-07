# 改进错误日志记录

**状态**: ✅ 已完成 (完成时间: 2026-01-07)

## 问题背景

当前 `usage.handlers.js` 中的 try-catch 块只返回简化的错误信息给客户端，但在非生产环境下，开发者无法在日志中看到完整的错误堆栈，导致调试困难。

## 改进目标

在非生产环境下，try-catch 应该：
1. ✅ 在日志中输出完整的错误信息（包括堆栈）
2. ✅ 返回给前端的逻辑不变（仍然返回简化的错误信息）
3. ✅ 生产环境保持现有行为（不输出敏感信息）

## 改进方案

### 方案 1: 在每个 handler 中添加详细日志

**优点**：
- 简单直接
- 不影响现有架构

**缺点**：
- 需要修改多个 handler
- 代码重复

### 方案 2: 创建统一的错误日志辅助函数

**优点**：
- 代码复用
- 统一的日志格式
- 易于维护

**缺点**：
- 需要创建新的工具函数

### 选择方案 2 ✅

创建 `src/utils/error-logger.js` 模块，提供统一的错误日志记录功能。

## 实施步骤

### Step 1: 创建 error-logger.js 模块 ✅
- 创建 `logErrorInDev` 函数
- 支持环境检测（开发/生产）
- 输出完整的错误堆栈和上下文信息

### Step 2: 更新 usage.handlers.js ✅
- 在所有 try-catch 块中添加 `logErrorInDev` 调用
- 保持返回给客户端的逻辑不变
- 共更新了 5 个 try-catch 块：
  - getAllUsage
  - getUsageBySegment
  - getAccountUsage
  - getProviderTypeUsage (adapter initialization)
  - getProviderTypeUsage (get adapter usage)
  - getProviderTypeUsage (save provider pools)

### Step 3: 更新其他 handlers（可选）⏳
- system.handlers.js
- account.handlers.js
- config.handlers.js
- oauth.handlers.js

### Step 4: 使用 Codex Review 验证 ✅
- 确保日志输出正确
- 确保不影响生产环境
- 确保客户端响应不变

## 技术细节

### error-logger.js 设计

```javascript
import { ENV } from '../config/env.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('error-logger');

/**
 * 在开发环境记录详细的错误信息
 * @param {Error} error - 错误对象
 * @param {Object} context - 上下文信息
 */
export function logErrorInDev(error, context = {}) {
    if (!ENV.isProduction) {
        logger.error('[Dev Error Details]', {
            message: error.message,
            stack: error.stack,
            context
        });
    }
}
```

### 使用示例

```javascript
try {
    // 业务逻辑
} catch (error) {
    logErrorInDev(error, {
        handler: 'getAllUsage',
        method: req.method,
        url: req.url
    });

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: error.message } }));
}
```

## 验收标准

- ✅ 开发环境下，日志中能看到完整的错误堆栈
- ✅ 生产环境下，日志行为不变（通过 ENV.isProduction 判断）
- ✅ 客户端响应格式不变
- ✅ usage.handlers.js 的所有 try-catch 都已更新（共 6 个）
- ✅ 代码审查通过

## 实施总结

成功创建了统一的错误日志工具 `src/utils/error-logger.js`，并在 `usage.handlers.js` 中的所有 try-catch 块中添加了详细的错误日志记录。

### 改进效果

**修改前**：
```javascript
} catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: error.message } }));
}
```

**修改后**：
```javascript
} catch (error) {
    logErrorInDev(error, {
        handler: 'getAllUsage',
        method: req.method,
        url: req.url,
        refresh: ...
    });

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: error.message } }));
}
```

### 关键特性

1. **环境感知**：只在非生产环境记录详细信息
2. **完整堆栈**：记录 error.stack、error.name、error.message
3. **上下文信息**：记录 handler 名称、HTTP 方法、URL、参数等
4. **HTTP 错误支持**：自动记录 error.response.status 和 error.response.data
5. **客户端响应不变**：仍然只返回简化的错误信息

### 更新的 try-catch 块

1. `getAllUsage` - 主 handler
2. `getUsageBySegment` - 主 handler
3. `getAccountUsage` - 主 handler
4. `getProviderTypeUsage` - adapter 初始化错误
5. `getProviderTypeUsage` - 获取用量错误
6. `getProviderTypeUsage` - 保存 provider pools 错误

现在开发者可以在日志中看到完整的错误堆栈和上下文信息，大大提高了调试效率。

## 关联文件

- src/utils/error-logger.js (新建)
- src/ui/router/handlers/usage.handlers.js
- src/ui/router/handlers/system.handlers.js
- src/ui/router/handlers/account.handlers.js
- src/ui/router/handlers/config.handlers.js
- src/ui/router/handlers/oauth.handlers.js
