# UI 路由器模块化架构设计文档

**创建时间**: 2026-01-05
**文档版本**: 1.0
**作者**: Claude + Codex 协作设计

---

## 一、目录结构总览

### 1.1 完整的文件组织结构

```
src/
├── ui/
│   ├── router/                        # 路由器核心模块
│   │   ├── Router.js                 # Router 类核心实现
│   │   ├── index.js                  # 路由器主入口
│   │   │
│   │   ├── routes/                   # 路由配置（按业务模块划分）
│   │   │   ├── index.js              # 路由注册中心
│   │   │   ├── auth.routes.js        # 认证相关路由
│   │   │   ├── account.routes.js     # 账号管理路由
│   │   │   ├── config.routes.js      # 配置管理路由
│   │   │   ├── usage.routes.js       # 用量查询路由
│   │   │   ├── oauth.routes.js       # OAuth 相关路由
│   │   │   ├── upload.routes.js      # 文件上传路由
│   │   │   └── system.routes.js      # 系统信息路由
│   │   │
│   │   ├── handlers/                 # 业务逻辑处理器
│   │   │   ├── index.js              # Handler 导出中心
│   │   │   ├── auth.handlers.js      # 认证处理器
│   │   │   ├── account.handlers.js   # 账号处理器
│   │   │   ├── config.handlers.js    # 配置处理器
│   │   │   ├── usage.handlers.js     # 用量处理器
│   │   │   ├── oauth.handlers.js     # OAuth 处理器
│   │   │   └── upload.handlers.js    # 上传处理器
│   │   │
│   │   ├── middleware/               # 中间件
│   │   │   ├── index.js              # 中间件导出
│   │   │   ├── auth.middleware.js    # 认证中间件
│   │   │   ├── log.middleware.js     # 日志中间件
│   │   │   ├── error.middleware.js   # 错误处理中间件
│   │   │   └── validation.middleware.js # 请求验证中间件
│   │   │
│   │   └── utils/                    # 路由相关工具
│   │       ├── response.js           # 响应格式化工具
│   │       ├── validation.js         # 请求验证工具
│   │       └── helpers.js            # 辅助函数
│   │
│   ├── static.js                     # 静态文件服务
│   ├── events.js                     # 事件广播系统
│   └── index.js                      # UI 模块入口
│
├── ui-manager.js                     # 原 UI 管理器（待重构）
└── uiRouter.js                       # 原路由器示例（待移除）
```

### 1.2 模块职责说明

| 模块 | 职责 | 依赖 |
|------|------|------|
| **Router.js** | 路由匹配、handler 调用、中间件管理 | 无 |
| **routes/** | 定义 API 路由配置 | handlers, middleware |
| **handlers/** | 实现业务逻辑处理 | services, utils |
| **middleware/** | 认证、日志、错误处理等横切关注点 | 无 |
| **utils/** | 响应格式化、请求验证等工具函数 | 无 |

---

## 二、核心模块实现

### 2.1 Router 类核心实现

**文件**: `src/ui/router/Router.js`

```javascript
/**
 * Router 类 - 路由器核心实现
 *
 * 功能：
 * - 路由注册与匹配
 * - 中间件管理
 * - Handler 调用
 * - 错误处理
 */
export class Router {
    constructor() {
        this.routes = [];
        this.middlewares = [];
    }

    /**
     * 注册路由
     * @param {string} method - HTTP 方法
     * @param {string|RegExp} path - 路由路径（支持正则）
     * @param {Function} handler - 处理函数
     * @param {Object} options - 路由选项
     * @param {boolean} options.auth - 是否需要认证（默认 true）
     * @param {string} options.description - 路由描述
     */
    addRoute(method, path, handler, options = {}) {
        // 标准化路径（去除尾部斜杠）
        const normalizedPath = typeof path === 'string'
            ? path.replace(/\/+$/, '') || '/'
            : path;

        this.routes.push({
            method: method.toUpperCase(),
            path: normalizedPath,
            handler,
            auth: options.auth !== false, // 默认需要认证
            description: options.description || '',
            metadata: options.metadata || {}
        });

        return this; // 支持链式调用
    }

    /**
     * 注册全局中间件
     * @param {Function} middleware - 中间件函数
     */
    use(middleware) {
        this.middlewares.push(middleware);
        return this;
    }

    /**
     * 匹配路由
     * @param {string} method - HTTP 方法
     * @param {string} path - 请求路径
     * @returns {Object|null} 匹配结果 { route, match, params }
     */
    match(method, path) {
        // 标准化请求路径
        const normalizedPath = path.replace(/\/+$/, '') || '/';

        for (const route of this.routes) {
            // 方法不匹配则跳过
            if (route.method !== method.toUpperCase()) continue;

            // 正则路径匹配
            if (route.path instanceof RegExp) {
                const match = normalizedPath.match(route.path);
                if (match) {
                    return {
                        route,
                        match,
                        params: this.extractParams(match)
                    };
                }
            }
            // 精确匹配
            else if (route.path === normalizedPath) {
                return {
                    route,
                    match: null,
                    params: {}
                };
            }
        }

        return null;
    }

    /**
     * 从正则匹配结果中提取参数
     * @param {Array} match - 正则匹配结果
     * @returns {Object} 参数对象
     */
    extractParams(match) {
        // match[0] 是完整匹配，从 match[1] 开始是捕获组
        const params = {};
        for (let i = 1; i < match.length; i++) {
            params[`param${i}`] = match[i];
        }
        return params;
    }

    /**
     * 获取所有路由信息（用于文档生成）
     * @returns {Array} 路由列表
     */
    getRoutes() {
        return this.routes.map(route => ({
            method: route.method,
            path: route.path instanceof RegExp ? route.path.toString() : route.path,
            auth: route.auth,
            description: route.description,
            metadata: route.metadata
        }));
    }

    /**
     * 根据方法获取路由
     * @param {string} method - HTTP 方法
     * @returns {Array} 路由列表
     */
    getRoutesByMethod(method) {
        return this.routes.filter(route =>
            route.method === method.toUpperCase()
        );
    }

    /**
     * 清空所有路由（主要用于测试）
     */
    clear() {
        this.routes = [];
        this.middlewares = [];
    }
}
```

### 2.2 路由器主入口

**文件**: `src/ui/router/index.js`

```javascript
import { Router } from './Router.js';
import { setupAuthRoutes } from './routes/auth.routes.js';
import { setupAccountRoutes } from './routes/account.routes.js';
import { setupConfigRoutes } from './routes/config.routes.js';
import { setupUsageRoutes } from './routes/usage.routes.js';
import { setupOAuthRoutes } from './routes/oauth.routes.js';
import { setupUploadRoutes } from './routes/upload.routes.js';
import { setupSystemRoutes } from './routes/system.routes.js';

/**
 * 创建并配置路由器实例
 * @returns {Router} 配置好的路由器实例
 */
export function createRouter() {
    const router = new Router();

    // 注册所有路由模块
    setupAuthRoutes(router);
    setupAccountRoutes(router);
    setupConfigRoutes(router);
    setupUsageRoutes(router);
    setupOAuthRoutes(router);
    setupUploadRoutes(router);
    setupSystemRoutes(router);

    return router;
}

// 导出 Router 类供其他模块使用
export { Router };
```

---

## 三、路由配置模块

### 3.1 认证路由模块

**文件**: `src/ui/router/routes/auth.routes.js`

```javascript
import * as authHandlers from '../handlers/auth.handlers.js';

/**
 * 设置认证相关路由
 * @param {Router} router - 路由器实例
 */
export function setupAuthRoutes(router) {
    // 登录接口（无需认证）
    router.addRoute('POST', '/api/login', authHandlers.login, {
        auth: false,
        description: '用户登录，获取访问 token'
    });

    // Token 刷新（需要认证）
    router.addRoute('POST', '/api/refresh-token', authHandlers.refreshToken, {
        auth: true,
        description: '刷新访问 token'
    });

    // 退出登录（需要认证）
    router.addRoute('POST', '/api/logout', authHandlers.logout, {
        auth: true,
        description: '退出登录，注销 token'
    });
}
```

### 3.2 账号管理路由模块

**文件**: `src/ui/router/routes/account.routes.js`

```javascript
import * as accountHandlers from '../handlers/account.handlers.js';

/**
 * 设置账号管理路由
 * @param {Router} router - 路由器实例
 */
export function setupAccountRoutes(router) {
    // 获取账号列表
    router.addRoute('GET', '/api/accounts', accountHandlers.getAccounts, {
        auth: true,
        description: '获取所有账号列表及统计信息'
    });

    // 添加新账号
    router.addRoute('POST', '/api/accounts', accountHandlers.addAccount, {
        auth: true,
        description: '添加新账号'
    });

    // 删除指定账号（正则路由）
    router.addRoute('DELETE', /^\/api\/accounts\/([^\/]+)$/, accountHandlers.deleteAccount, {
        auth: true,
        description: '删除指定 UUID 的账号'
    });

    // 切换账号启用/禁用状态
    router.addRoute('POST', /^\/api\/accounts\/([^\/]+)\/toggle$/, accountHandlers.toggleAccount, {
        auth: true,
        description: '切换账号的启用/禁用状态'
    });

    // 批量删除账号
    router.addRoute('POST', '/api/accounts/batch-delete', accountHandlers.batchDeleteAccounts, {
        auth: true,
        description: '批量删除账号（支持按状态筛选）'
    });

    // 重置所有账号健康状态
    router.addRoute('POST', '/api/accounts/reset-health', accountHandlers.resetAllHealth, {
        auth: true,
        description: '重置所有账号的健康状态'
    });

    // 重置单个账号健康状态
    router.addRoute('POST', /^\/api\/accounts\/([^\/]+)\/reset-health$/, accountHandlers.resetAccountHealth, {
        auth: true,
        description: '重置指定账号的健康状态'
    });

    // 批量健康检查
    router.addRoute('POST', '/api/accounts/health-check', accountHandlers.healthCheckAll, {
        auth: true,
        description: '对所有启用的账号进行健康检查'
    });

    // 单个账号健康检查
    router.addRoute('POST', /^\/api\/accounts\/([^\/]+)\/health-check$/, accountHandlers.healthCheckAccount, {
        auth: true,
        description: '对指定账号进行强制健康检查'
    });

    // 测试账号（最小请求）
    router.addRoute('POST', /^\/api\/accounts\/([^\/]+)\/test$/, accountHandlers.testAccount, {
        auth: true,
        description: '测试指定账号（发送最小请求）'
    });

    // 生成 OAuth 授权 URL
    router.addRoute('POST', '/api/accounts/generate-auth-url', accountHandlers.generateAuthUrl, {
        auth: true,
        description: '生成 Kiro OAuth 授权 URL'
    });

    // 清理重复账号
    router.addRoute('POST', '/api/accounts/cleanup-duplicates', accountHandlers.cleanupDuplicates, {
        auth: false,
        description: '清理重复的账号（基于 userId）'
    });
}
```

### 3.3 配置管理路由模块

**文件**: `src/ui/router/routes/config.routes.js`

```javascript
import * as configHandlers from '../handlers/config.handlers.js';

/**
 * 设置配置管理路由
 * @param {Router} router - 路由器实例
 */
export function setupConfigRoutes(router) {
    // 获取配置
    router.addRoute('GET', '/api/config', configHandlers.getConfig, {
        auth: true,
        description: '获取当前系统配置'
    });

    // 更新配置
    router.addRoute('POST', '/api/config', configHandlers.updateConfig, {
        auth: true,
        description: '更新系统配置'
    });

    // 重载配置文件
    router.addRoute('POST', '/api/reload-config', configHandlers.reloadConfig, {
        auth: true,
        description: '重载配置文件（从磁盘重新读取）'
    });
}
```

### 3.4 用量查询路由模块

**文件**: `src/ui/router/routes/usage.routes.js`

```javascript
import * as usageHandlers from '../handlers/usage.handlers.js';

/**
 * 设置用量查询路由
 * @param {Router} router - 路由器实例
 */
export function setupUsageRoutes(router) {
    // 获取所有账号用量
    router.addRoute('GET', '/api/usage', usageHandlers.getAllUsage, {
        auth: true,
        description: '获取所有账号的用量信息'
    });

    // 获取指定所有账号或单个账号的用量（单段路径）
    router.addRoute('GET', /^\/api\/usage\/([^\/]+)$/, usageHandlers.getUsageBySegment, {
        auth: true,
        description: '获取指定所有账号或账号 UUID 的用量'
    });

    // 获取指定账号的详细用量（双段路径）
    router.addRoute('GET', /^\/api\/usage\/([^\/]+)\/([^\/]+)$/, usageHandlers.getAccountUsage, {
        auth: true,
        description: '获取指定账号的详细用量信息'
    });

    // 获取可用模型列表
    router.addRoute('GET', '/api/full-models', usageHandlers.getFullModels, {
        auth: true,
        description: '获取所有可用模型列表'
    });
}
```

### 3.5 OAuth 路由模块

**文件**: `src/ui/router/routes/oauth.routes.js`

```javascript
import * as oauthHandlers from '../handlers/oauth.handlers.js';

/**
 * 设置 OAuth 相关路由
 * @param {Router} router - 路由器实例
 */
export function setupOAuthRoutes(router) {
    // OAuth 网页回调（返回 HTML）
    router.addRoute('GET', '/kiro/oauth/web-callback', oauthHandlers.webCallback, {
        auth: false,
        description: 'Kiro OAuth 网页回调（返回 HTML 结果页）'
    });

    // 检查 OAuth state 状态
    router.addRoute('GET', '/api/kiro/oauth/check-state', oauthHandlers.checkState, {
        auth: false,
        description: '检查 OAuth 授权是否已完成'
    });

    // 手动导入 refreshToken
    router.addRoute('POST', '/api/kiro/oauth/manual-import', oauthHandlers.manualImport, {
        auth: false,
        description: '手动导入 Kiro OAuth refreshToken'
    });

    // AWS SSO 设备授权启动
    router.addRoute('POST', '/api/kiro/oauth/aws-sso/start', oauthHandlers.awsSsoStart, {
        auth: false,
        description: '启动 AWS SSO BuilderId 设备授权流程'
    });
}
```

### 3.6 文件上传路由模块

**文件**: `src/ui/router/routes/upload.routes.js`

```javascript
import * as uploadHandlers from '../handlers/upload.handlers.js';

/**
 * 设置文件上传路由
 * @param {Router} router - 路由器实例
 */
export function setupUploadRoutes(router) {
    // 上传 OAuth 凭据文件
    router.addRoute('POST', '/api/upload-oauth-credentials', uploadHandlers.uploadCredentials, {
        auth: true,
        description: '上传 OAuth 凭据文件（支持 multipart/form-data）'
    });

    // 获取已上传的配置文件列表
    router.addRoute('GET', '/api/upload-configs', uploadHandlers.getUploadConfigs, {
        auth: true,
        description: '扫描并获取已上传的配置文件列表'
    });

    // 查看指定配置文件内容
    router.addRoute('GET', /^\/api\/upload-configs\/view\/(.+)$/, uploadHandlers.viewConfig, {
        auth: true,
        description: '查看指定配置文件的详细内容'
    });

    // 删除指定配置文件
    router.addRoute('GET', /^\/api\/upload-configs\/delete\/(.+)$/, uploadHandlers.deleteConfig, {
        auth: true,
        description: '删除指定的配置文件'
    });

    // 快速关联配置文件
    router.addRoute('POST', '/api/quick-link-provider', uploadHandlers.quickLink, {
        auth: true,
        description: '快速关联配置文件到对应号池'
    });

    // 批量快速关联
    router.addRoute('POST', '/api/quick-link-provider/bulk', uploadHandlers.bulkQuickLink, {
        auth: true,
        description: '批量快速关联多个配置文件'
    });
}
```

### 3.7 系统信息路由模块

**文件**: `src/ui/router/routes/system.routes.js`

```javascript
import * as systemHandlers from '../handlers/system.handlers.js';

/**
 * 设置系统信息路由
 * @param {Router} router - 路由器实例
 */
export function setupSystemRoutes(router) {
    // 健康检查
    router.addRoute('GET', '/api/health', systemHandlers.healthCheck, {
        auth: false,
        description: '健康检查接口（用于前端 token 验证）'
    });

    // 获取系统信息
    router.addRoute('GET', '/api/system', systemHandlers.getSystemInfo, {
        auth: true,
        description: '获取系统运行信息（内存、CPU、运行时间等）'
    });

    // 重启服务器（Worker 模式）
    router.addRoute('POST', '/api/restart', systemHandlers.restartServer, {
        auth: true,
        description: '重启服务器（仅 Worker 模式支持）'
    });

    // 获取日志
    router.addRoute('GET', '/api/logs', systemHandlers.getLogs, {
        auth: false,
        description: '获取系统运行日志'
    });

    // 清空日志
    router.addRoute('DELETE', '/api/logs', systemHandlers.clearLogs, {
        auth: false,
        description: '清空系统日志缓冲区'
    });

    // SSE 实时事件推送
    router.addRoute('GET', '/api/events', systemHandlers.eventStream, {
        auth: false,
        description: 'Server-Sent Events 实时事件推送'
    });
}
```

---

## 四、Handler 处理器模块

### 4.1 Handler 模块组织原则

1. **单一职责**: 每个 handler 函数只处理一个业务逻辑
2. **参数解构**: 使用解构获取需要的上下文对象
3. **错误处理**: 统一的 try-catch 错误处理
4. **响应格式**: 使用统一的响应格式化工具

### 4.2 Handler 函数签名

```javascript
/**
 * 标准 Handler 函数签名
 * @param {Object} context - 上下文对象
 * @param {IncomingMessage} context.req - 请求对象
 * @param {ServerResponse} context.res - 响应对象
 * @param {Object} context.currentConfig - 当前配置
 * @param {AccountPoolManager} context.providerPoolManager - 账号池管理器
 * @param {Array} context.match - 正则匹配结果（仅正则路由）
 * @param {Object} context.params - 路径参数对象
 */
async function handler({ req, res, currentConfig, providerPoolManager, match, params }) {
    // 业务逻辑
}
```

### 4.3 Handler 示例：账号管理

**文件**: `src/ui/router/handlers/account.handlers.js`

```javascript
import { readAccountsFromStorage } from '../../ui-manager.js';
import { broadcastEvent } from '../../events.js';
import { getRequestBody } from '../../../utils/common.js';

/**
 * 获取所有账号列表
 */
export async function getAccounts({ res, currentConfig, providerPoolManager }) {
    const { accountPool, filePath } = readAccountsFromStorage(currentConfig, providerPoolManager);

    // 统计数据
    let healthyCount = 0;
    let checkingCount = 0;
    let bannedCount = 0;
    let totalUsageCount = 0;
    let totalErrorCount = 0;

    for (const account of accountPool.accounts) {
        totalUsageCount += account.usageCount || 0;
        totalErrorCount += account.errorCount || 0;

        if (account.lastErrorMessage) {
            account.errorStatus = parseErrorMessage(account.lastErrorMessage);
        } else {
            account.errorStatus = { status: '正常', message: '', statusType: 'ok' };
        }

        if (account.isDisabled) {
            account.poolType = 'disabled';
            bannedCount++;
        } else if (!account.isHealthy) {
            account.poolType = 'banned';
            bannedCount++;
        } else if (account.errorCount > 0 && account.isHealthy) {
            account.poolType = 'checking';
            checkingCount++;
        } else {
            account.poolType = 'healthy';
            healthyCount++;
        }
    }

    const stats = {
        healthy: healthyCount,
        checking: checkingCount,
        banned: bannedCount,
        total: healthyCount + checkingCount + bannedCount,
        totalUsageCount,
        totalErrorCount,
        cacheHitRate: '0%'
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        accounts: accountPool.accounts,
        _accountPoolStats: stats,
        _filePath: filePath
    }));
}

/**
 * 添加新账号
 */
export async function addAccount({ req, res, providerPoolManager }) {
    try {
        const body = await getRequestBody(req);
        const accountConfig = body?.accountConfig || body;

        if (!accountConfig || typeof accountConfig !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'accountConfig is required' } }));
            return;
        }

        const newAccount = providerPoolManager.addAccount(accountConfig);

        broadcastEvent('account_update', {
            action: 'add',
            uuid: newAccount.uuid,
            accountConfig: newAccount,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, account: newAccount }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 删除账号
 */
export async function deleteAccount({ res, providerPoolManager, match }) {
    const uuid = decodeURIComponent(match[1]);

    try {
        const removed = providerPoolManager.removeAccount(uuid);

        if (!removed) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Account not found' } }));
            return;
        }

        broadcastEvent('account_update', {
            action: 'delete',
            uuid,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

// ... 其他 handlers
```

---

## 五、中间件模块

### 5.1 认证中间件

**文件**: `src/ui/router/middleware/auth.middleware.js`

```javascript
/**
 * 认证中间件
 * 检查请求是否包含有效的认证 token
 */
export async function requireAuth(req, res) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.writeHead(401, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end(JSON.stringify({
            error: { message: '未授权访问，请先登录', code: 'UNAUTHORIZED' }
        }));
        return false; // 认证失败
    }

    const token = authHeader.substring(7);
    const tokenInfo = await verifyToken(token);

    if (!tokenInfo) {
        res.writeHead(401, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end(JSON.stringify({
            error: { message: 'Token 无效或已过期', code: 'INVALID_TOKEN' }
        }));
        return false;
    }

    // 将用户信息附加到请求对象
    req.user = tokenInfo;
    return true; // 认证成功
}

// Token 验证函数（从 ui-manager.js 导入）
async function verifyToken(token) {
    // ... 实现细节
}
```

### 5.2 日志中间件

**文件**: `src/ui/router/middleware/log.middleware.js`

```javascript
/**
 * 日志中间件
 * 记录所有 API 请求日志
 */
export function logMiddleware(req, res, next) {
    const startTime = Date.now();
    const { method, url } = req;

    // 记录请求开始
    console.log(`[${new Date().toISOString()}] ${method} ${url} - Start`);

    // 监听响应结束
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const { statusCode } = res;
        console.log(`[${new Date().toISOString()}] ${method} ${url} - ${statusCode} (${duration}ms)`);
    });

    next();
}
```

### 5.3 错误处理中间件

**文件**: `src/ui/router/middleware/error.middleware.js`

```javascript
/**
 * 错误处理中间件
 * 统一的错误处理和响应格式
 */
export function errorMiddleware(err, req, res, next) {
    console.error('[Error Middleware]', err);

    // 如果响应已发送，无法处理
    if (res.headersSent) {
        return;
    }

    // 根据错误类型返回不同的状态码
    let statusCode = 500;
    let message = 'Internal Server Error';

    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = err.message;
    } else if (err.name === 'UnauthorizedError') {
        statusCode = 401;
        message = 'Unauthorized';
    } else if (err.name === 'NotFoundError') {
        statusCode = 404;
        message = 'Not Found';
    }

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        error: {
            message,
            code: err.name || 'INTERNAL_ERROR',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        }
    }));
}
```

---

## 六、工具函数模块

### 6.1 响应格式化工具

**文件**: `src/ui/router/utils/response.js`

```javascript
/**
 * 响应格式化工具
 * 提供统一的响应格式
 */
export const sendJson = (res, data, statusCode = 200) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};

export const sendSuccess = (res, message, data = {}) => {
    sendJson(res, {
        success: true,
        message,
        ...data
    });
};

export const sendError = (res, message, statusCode = 500, code = 'ERROR') => {
    sendJson(res, {
        success: false,
        error: {
            message,
            code
        }
    }, statusCode);
};

export const sendUnauthorized = (res, message = '未授权访问，请先登录') => {
    sendError(res, message, 401, 'UNAUTHORIZED');
};

export const sendNotFound = (res, message = '资源不存在') => {
    sendError(res, message, 404, 'NOT_FOUND');
};

export const sendValidationError = (res, message) => {
    sendError(res, message, 400, 'VALIDATION_ERROR');
};
```

### 6.2 请求验证工具

**文件**: `src/ui/router/utils/validation.js`

```javascript
/**
 * 请求验证工具
 * 提供常用的请求验证函数
 */
export const validateRequired = (value, fieldName) => {
    if (value === undefined || value === null || value === '') {
        throw new Error(`${fieldName} 不能为空`);
    }
};

export const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw new Error('邮箱格式不正确');
    }
};

export const validateUuid = (uuid) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(uuid)) {
        throw new Error('UUID 格式不正确');
    }
};

export const validateRequestBody = async (req, requiredFields = []) => {
    const body = await getRequestBody(req);

    for (const field of requiredFields) {
        if (!body[field]) {
            throw new Error(`缺少必填字段: ${field}`);
        }
    }

    return body;
};
```

---

## 七、模块间依赖关系

### 7.1 依赖图

```
┌─────────────────────────────────────────────────────────────┐
│                         ui-manager.js                       │
│                    (主入口、请求分发)                        │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      router/index.js                        │
│                    (路由器主入口)                            │
└───────────────────────────┬─────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ↓             ↓             ↓
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │ Router.js   │ │  routes/    │ │ middleware/ │
    │ (路由核心)  │ │ (路由配置)  │ │  (中间件)   │
    └─────────────┘ └──────┬──────┘ └─────────────┘
                           │
                           ↓
                  ┌────────────────┐
                  │   handlers/    │
                  │  (业务逻辑)    │
                  └────────────────┘
```

### 7.2 数据流向

```
HTTP Request
    ↓
ui-manager.js (handleUIApiRequests)
    ↓
Router.match(method, path)  // 路由匹配
    ↓
middleware (认证、日志等)   // 中间件处理
    ↓
handler (业务逻辑)          // Handler 处理
    ↓
HTTP Response
```

---

## 八、使用示例

### 8.1 添加新路由

```javascript
// 1. 在 handlers 中添加业务逻辑
// handlers/myfeature.handlers.js
export async function getMyData({ res, currentConfig }) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: '...' }));
}

// 2. 在 routes 中注册路由
// routes/myfeature.routes.js
import * as myHandlers from '../handlers/myfeature.handlers.js';

export function setupMyFeatureRoutes(router) {
    router.addRoute('GET', '/api/mydata', myHandlers.getMyData, {
        auth: true,
        description: '获取我的数据'
    });
}

// 3. 在 router/index.js 中注册
import { setupMyFeatureRoutes } from './routes/myfeature.routes.js';

export function createRouter() {
    const router = new Router();
    // ...
    setupMyFeatureRoutes(router);
    return router;
}
```

### 8.2 添加中间件

```javascript
// middleware/rateLimit.middleware.js
export function rateLimitMiddleware(maxRequests = 100, windowMs = 60000) {
    const requests = new Map();

    return (req, res, next) => {
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        const windowStart = now - windowMs;

        // 清理过期记录
        let userRequests = requests.get(ip) || [];
        userRequests = userRequests.filter(time => time > windowStart);

        if (userRequests.length >= maxRequests) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Too Many Requests' }));
            return;
        }

        userRequests.push(now);
        requests.set(ip, userRequests);

        next();
    };
}

// 在 Router.js 中使用
router.use(rateLimitMiddleware(100, 60000));
```

---

## 九、最佳实践

### 9.1 命名规范

- **路由文件**: `*.routes.js`
- **Handler 文件**: `*.handlers.js`
- **中间件文件**: `*.middleware.js`
- **函数命名**: 动词 + 名词（如 `getAccounts`, `deleteAccount`）
- **路由路径**: 小写 + 连字符（如 `/api/health-check`）

### 9.2 代码组织

1. **路由配置保持简洁**：只包含路由定义，不包含业务逻辑
2. **Handler 保持纯粹**：专注于业务逻辑，不包含路由规则
3. **中间件保持独立**：可复用、可组合
4. **工具函数保持通用**：不依赖具体业务

### 9.3 错误处理

1. **Handler 内部捕获错误**：使用 try-catch
2. **统一的错误响应格式**：使用 `sendError`
3. **记录错误日志**：使用 `console.error`
4. **不暴露敏感信息**：生产环境隐藏堆栈跟踪

### 9.4 性能优化

1. **避免重复计算**：缓存计算结果
2. **使用流处理**：大文件使用流式传输
3. **合理使用索引**：Map 查找优于数组遍历
4. **异步不阻塞**：正确使用 async/await

---

## 十、测试策略

### 10.1 单元测试

```javascript
// test/router/Router.test.js
import { Router } from '../../src/ui/router/Router.js';

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

### 10.2 集成测试

```javascript
// test/integration/api.test.js
import { createRouter } from '../../src/ui/router/index.js';
import { handleUIApiRequests } from '../../src/ui-manager.js';

describe('API Integration Tests', () => {
    test('GET /api/health should return 200', async () => {
        const res = createMockResponse();
        await handleUIApiRequests('GET', '/api/health', {}, res, {}, {});

        expect(res.statusCode).toBe(200);
    });

    test('POST /api/accounts without auth should return 401', async () => {
        const req = { headers: {} };
        const res = createMockResponse();
        await handleUIApiRequests('POST', '/api/accounts', req, res, {}, {});

        expect(res.statusCode).toBe(401);
    });
});
```

---

**文档结束**
