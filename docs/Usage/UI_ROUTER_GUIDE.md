# UI Router 使用指南

## 概述

UI Router 是一个基于模块化设计的路由系统，用于处理 UI 管理控制台的所有 API 请求。该系统采用声明式路由配置、中间件模式和 Handler 模式，提供清晰、可维护的代码结构。

## 目录

- [快速开始](#快速开始)
- [路由配置](#路由配置)
- [Handler 开发](#handler-开发)
- [中间件使用](#中间件使用)
- [认证机制](#认证机制)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)

## 快速开始

### 1. 路由系统初始化

路由系统在 `src/ui-manager.js` 中自动初始化：

```javascript
import { createRouter } from './ui/router/index.js';

// 开发模式下自动热重载
if (!global.uiRouter || process.env.NODE_ENV === 'development') {
    global.uiRouter = createRouter();
}
```

### 2. 请求处理流程

```
请求到达 → 文件上传处理 → 路由匹配 → 认证检查 → Handler 执行 → 响应返回
```

## 路由配置

### 基本路由注册

在 `src/ui/router/routes/` 目录下的文件中注册路由：

```javascript
import * as handlers from '../handlers/system.handlers.js';

export function setupSystemRoutes(router) {
    router.addRoute('GET', '/api/system', handlers.getSystemInfo, {
        auth: true,
        description: '获取系统运行信息',
        metadata: {
            category: 'system',
            tags: ['system', 'monitoring']
        }
    });
}
```

### 动态路由参数

使用正则表达式定义动态路由：

```javascript
// 匹配 /api/accounts/:uuid
router.addRoute('GET', /^\/api\/accounts\/([a-f0-9-]+)$/, handlers.getAccountByUuid, {
    auth: true,
    description: '获取指定账号信息'
});
```

### 路由选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `auth` | boolean | `true` | 是否需要认证 |
| `description` | string | `''` | 路由描述 |
| `metadata` | object | `{}` | 额外的元数据 |

## Handler 开发

### Handler 函数签名

```javascript
export async function myHandler({ req, res, currentConfig, providerPoolManager, match }) {
    // req: IncomingMessage - HTTP 请求对象
    // res: ServerResponse - HTTP 响应对象
    // currentConfig: Object - 当前配置
    // providerPoolManager: AccountPoolManager - 账号池管理器
    // match: RegExpMatchArray - 正则匹配结果（动态路由）

    try {
        // 业务逻辑
        const data = await processData();

        // 返回响应
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data }));
    } catch (error) {
        // 错误处理
        console.error('[Handler] Error:', error);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: 'Internal Server Error' }
            }));
        }
    }
}
```

### Handler 最佳实践

#### 1. 始终使用 try-catch

```javascript
export async function handler({ req, res }) {
    try {
        // ���务逻辑
    } catch (error) {
        // 错误处理
    }
}
```

#### 2. 检查响应是否已发送

```javascript
if (!res.headersSent) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Error' } }));
}
```

#### 3. 使用辅助函数

从 `ui-manager.js` 导入需要的辅助函数：

```javascript
import { broadcastEvent } from '../../events.js';
import { scanConfigFiles } from '../../../ui-manager.js';

export async function handler({ req, res, currentConfig, providerPoolManager }) {
    const configFiles = await scanConfigFiles(currentConfig, providerPoolManager);

    broadcastEvent('config_update', {
        action: 'scan',
        timestamp: new Date().toISOString()
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(configFiles));
}
```

## 中间件使用

### 认证中间件

系统内置了认证中间件，通过路由选项 `auth` 控制：

```javascript
// 需要认证
router.addRoute('GET', '/api/accounts', handlers.getAccounts, {
    auth: true  // 默认值
});

// 无需认证
router.addRoute('POST', '/api/login', handlers.login, {
    auth: false
});
```

### 自定义中间件

可以扩展 Router 类添加自定义中间件：

```javascript
router.use(async (req, res, next) => {
    // 前置处理
    console.log(`[Middleware] ${req.method} ${req.url}`);

    // 调用下一个
    await next();

    // 后置处理
    console.log('[Middleware] Response sent');
});
```

## 认证机制

### Token 验证流程

1. 客户端在请求头中携带 Token：
   ```
   Authorization: Bearer <token>
   ```

2. 路由系统自动验证 Token：
   - 从 `configs/token-store.json` 读取 Token 存储
   - 检查 Token 是否存在且未过期
   - 验证通过后执行 Handler，否则返回 401

### Token 生成（登录）

```javascript
import { generateToken, saveToken } from '../../../ui-manager.js';

export async function login({ req, res }) {
    // 验证用户凭证
    const isValid = await validateCredentials(req.body);

    if (isValid) {
        // 生成 Token
        const token = generateToken();

        // 保存 Token
        await saveToken(token, {
            username: req.body.username,
            createdAt: Date.now()
        });

        // 返回 Token
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            token: token
        }));
    }
}
```

### 无需认证的路由

以下路由默认无需认证：

- `/api/login` - 用户登录
- `/api/health` - 健康检查
- `/api/events` - SSE 事件推送
- `/api/logs` - 日志查看

## 最佳实践

### 1. 文件组织

按功能模块组织 Handler 文件：

```
src/ui/router/handlers/
├── system.handlers.js      # 系统相关
├── account.handlers.js     # 账号管理
├── config.handlers.js      # 配置管理
├── usage.handlers.js       # 用量统计
├── oauth.handlers.js       # OAuth 认证
└── upload.handlers.js      # 文件上传
```

### 2. 错误处理

统一错误响应格式：

```javascript
res.writeHead(500, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({
    error: {
        message: '错误描述',
        code: 'ERROR_CODE'
    }
}));
```

### 3. 事件广播

重要操作后广播事件：

```javascript
import { broadcastEvent } from '../../events.js';

broadcastEvent('config_update', {
    action: 'add',
    filePath: relativePath,
    timestamp: new Date().toISOString()
});
```

### 4. 路由日志

通过 `ROUTER_CONFIG.ENABLE_ROUTER_LOGGING` 控制日志：

```javascript
export const ROUTER_CONFIG = {
    ENABLE_ROUTER_LOGGING: true  // 启用路由日志
};
```

### 5. 开发模式热重载

开发模式下自动重载路由：

```javascript
if (!global.uiRouter || process.env.NODE_ENV === 'development') {
    global.uiRouter = createRouter();
}
```

## 常见问题

### Q: 如何添加新的 API 端点？

A:
1. 在 `src/ui/router/handlers/` 中创建 Handler 函数
2. 在 `src/ui/router/routes/` 中注册路由
3. 在 `src/ui/router/index.js` 中导入路由设置函数

### Q: 如何处理文件上传？

A: 文件上传在路由器之前特殊处理：

```javascript
if (method === 'POST' && pathParam === '/api/upload-oauth-credentials') {
    const uploadMiddleware = upload.single('file');
    // ...
}
```

### Q: 如何获取动态路由参数？

A: 通过 `match` 参数获取：

```javascript
export async function handler({ match }) {
    const uuid = match[1];  // 第一个捕获组
    // 使用 uuid
}
```

### Q: 如何禁用某个路由的认证？

A: 设置 `auth: false`：

```javascript
router.addRoute('GET', '/api/public', handler, {
    auth: false
});
```

### Q: 如何查看所有已注册的路由？

A: 使用 Router 提供的方法：

```javascript
const routes = global.uiRouter.getRoutes();
console.log(routes);
```

或访问路由文档（如果已生成）。

## 相关文档

- [架构设计](../Architecture/UI_ROUTER_MODULE_STRUCTURE.md)
- [迁移计划](../Task/Archive/UI_ROUTER_MIGRATION_PLAN.md)
- [SSE 事件](./SSE_EVENTS.md)
