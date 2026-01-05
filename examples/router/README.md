# UI 路由器示例代码

本目录包含完整的路由器实现示例，可直接用于参考和学习。

## 文件结构

```
examples/router/
├── README.md                      # 本文件
├── Router.js                      # Router 类核心实现
├── routes/                        # 路由配置示例
│   ├── system.routes.example.js   # 系统路由配置
│   └── account.routes.example.js  # 账号路由配置
├── handlers/                      # Handler 示例
│   ├── system.handlers.example.js  # 系统 Handler
│   └── account.handlers.example.js # 账号 Handler
└── utils/                         # 工具函数示例
    └── response.example.js        # 响应格式化工具
```

## 快速开始

### 1. 复制 Router 类

将 `Router.js` 复制到项目中：

```bash
cp examples/router/Router.js src/ui/router/Router.js
```

### 2. 创建路由配置

参考 `routes/` 目录中的示例，创建自己的路由配置：

```javascript
// src/ui/router/routes/myfeature.routes.js
import * as myHandlers from '../handlers/myfeature.handlers.js';

export function setupMyFeatureRoutes(router) {
    router.addRoute('GET', '/api/mydata', myHandlers.getData, {
        auth: true,
        description: '获取我的数据'
    });
}
```

### 3. 创建 Handler

参考 `handlers/` 目录中的示例，创建业务逻辑处理函数：

```javascript
// src/ui/router/handlers/myfeature.handlers.js
export async function getData({ res, currentConfig }) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: '...' }));
}
```

### 4. 集成到项目

在主入口文件中集成路由器：

```javascript
// src/ui/router/index.js
import { Router } from './Router.js';
import { setupSystemRoutes } from './routes/system.routes.js';
import { setupMyFeatureRoutes } from './routes/myfeature.routes.js';

export function createRouter() {
    const router = new Router();

    // 注册所有路由模块
    setupSystemRoutes(router);
    setupMyFeatureRoutes(router);

    return router;
}

// src/ui-manager.js
import { createRouter } from './router/index.js';

const router = createRouter();

export async function handleUIApiRequests(method, pathParam, req, res, currentConfig, providerPoolManager) {
    const matched = router.match(method, pathParam);

    if (matched) {
        const { route, match } = matched;

        // 认证检查
        if (route.auth) {
            const isAuth = await checkAuth(req);
            if (!isAuth) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: { message: '未授权访问，请先登录', code: 'UNAUTHORIZED' }
                }));
                return true;
            }
        }

        // 调用 handler
        try {
            await route.handler({
                req,
                res,
                currentConfig,
                providerPoolManager,
                match
            });
        } catch (error) {
            console.error(`Error handling ${method} ${pathParam}:`, error);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Internal Server Error' } }));
            }
        }

        return true;
    }

    return false;
}
```

## 核心概念

### 1. Router 类

路由器核心，负责路由匹配和 handler 调用。

**主要方法**:
- `addRoute(method, path, handler, options)` - 注册路由
- `match(method, path)` - 匹配路由
- `getRoutes()` - 获取所有路由信息

### 2. 路由配置

声明式定义 API 路由。

**示例**:
```javascript
router.addRoute('GET', '/api/users', getUsers, {
    auth: true,
    description: '获取用户列表'
});
```

### 3. Handler 函数

处理业务逻辑的纯函数。

**函数签名**:
```javascript
async function handler({ req, res, currentConfig, providerPoolManager, match }) {
    // 业务逻辑
}
```

**参数说明**:
- `req` - 请求对象
- `res` - 响应对象
- `currentConfig` - 当前配置
- `providerPoolManager` - 账号池管理器
- `match` - 正则匹配结果（仅正则路由）

### 4. 路径参数

使用正则表达式捕获路径参数。

**示例**:
```javascript
// 路由配置
router.addRoute('DELETE', /^\/api\/users\/([^\/]+)$/, deleteUser);

// Handler 中提取参数
export async function deleteUser({ res, match }) {
    const userId = match[1]; // 提取路径参数
    // ...
}
```

## 工具函数

### 响应格式化

使用 `utils/response.example.js` 中的工具函数：

```javascript
import { sendSuccess, sendError, sendNotFound } from '../utils/response.example.js';

export async function getUser({ res, match }) {
    const userId = match[1];

    const user = findUser(userId);
    if (!user) {
        return sendNotFound(res, '用户不存在');
    }

    sendSuccess(res, '获取成功', { user });
}
```

## 测试

### 单元测试示例

```javascript
import { Router } from './Router.js';

describe('Router', () => {
    let router;

    beforeEach(() => {
        router = new Router();
    });

    test('should match static route', () => {
        const handler = jest.fn();
        router.addRoute('GET', '/api/test', handler);

        const matched = router.match('GET', '/api/test');

        expect(matched).not.toBeNull();
        expect(matched.route.path).toBe('/api/test');
    });

    test('should match regex route', () => {
        const handler = jest.fn();
        router.addRoute('GET', /^\/api\/users\/([^\/]+)$/, handler);

        const matched = router.match('GET', '/api/users/123');

        expect(matched).not.toBeNull();
        expect(matched.match[1]).toBe('123');
    });

    test('should return null for unmatched route', () => {
        const matched = router.match('GET', '/api/nonexistent');

        expect(matched).toBeNull();
    });
});
```

## 最佳实践

### 1. 命名规范

- 路由文件: `*.routes.js`
- Handler 文件: `*.handlers.js`
- 函数命名: 动词 + 名词（如 `getUsers`, `deleteUser`）
- 路由路径: 小写 + 连字符（如 `/api/health-check`）

### 2. 代码组织

- **路由配置保持简洁**: 只包含路由定义，不包含业务逻辑
- **Handler 保持纯粹**: 专注于业务逻辑，不包含路由规则
- **使用工具函数**: 复用 `sendSuccess`, `sendError` 等工具

### 3. 错误处理

- 每个 Handler 都使用 try-catch
- 使用统一的错误响应格式
- 记录错误日志
- 不暴露敏感信息

### 4. 性能优化

- 避免在 Handler 中重复计算
- 使用流处理大文件
- 合理使用缓存
- 正确使用 async/await

## 相关文档

- [完整架构设计](../../../docs/Architecture/UI_ROUTER_MODULE_STRUCTURE.md)
- [迁移分析](../../../docs/Task/Active/UI_ROUTER_MIGRATION_ANALYSIS.md)
- [迁移实施计划](../../../docs/Task/Active/UI_ROUTER_MIGRATION_PLAN.md)

## 常见问题

### Q: 如何处理查询参数？

A: 在 Handler 中解析 `req.url`：

```javascript
export async function getData({ req, res }) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const page = parseInt(url.searchParams.get('page') || '1');
    // ...
}
```

### Q: 如何处理文件上传？

A: 使用 multer 中间件，参考 `ui-manager.js` 中的实现。

### Q: 如何返回 HTML 而非 JSON？

A: 直接设置 Content-Type：

```javascript
export async function webCallback({ res }) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body>...</body></html>');
}
```

### Q: 如何处理 SSE 长连接？

A: 参考 `handlers/system.handlers.example.js` 中的 `eventStream` 函数。

---

**文档版本**: 1.0
**最后更新**: 2026-01-05
