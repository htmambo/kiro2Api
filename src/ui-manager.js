import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import multer from 'multer';
import crypto from 'crypto';
import { getRequestBody } from './utils/common.js';
import { CONFIG } from './config/manager.js';
import { serviceInstances, getServiceAdapter } from './kiro/adapter.js';
import { initApiService, getAccountPoolManager, isSQLiteMode } from './services/manager.js';
import { sqliteDB } from './services/storage/sqlite-db.js';
import { handleKiroOAuth } from './services/oauth-handlers.js';
import {
    findDuplicateUserId
} from './utils/account-utils.js';
import { serveStaticFiles } from './ui/static.js';
import { initializeUIManagement, broadcastEvent } from './ui/events.js';
import { createLogger } from './lib/logger.js';

// 路由器相关导入
import { createRouter } from './ui/router/index.js';
import { requireAuth as routerCheckAuth } from './ui/router/middleware/auth.middleware.js';

// 路由器配置
export const ROUTER_CONFIG = {
    ENABLE_ROUTER_LOGGING: true // 启用路由日志
};

// Token存储到本地文件中
const TOKEN_STORE_FILE = './configs/token-store.json';

// 用量缓存文件路径
const USAGE_CACHE_FILE = './configs/usage-cache.json';
const ACCOUNT_POOL_FILE = './configs/account_pool.json';
export const DEFAULT_PROVIDER_TYPE_FOR_ACCOUNTS = 'claude-kiro-oauth';
const logger = createLogger('ui:manager');

function isAccountMode(config) {
    // Provider 层已彻底移除，始终使用 account 模式
    // legacy 模式作为别名保留，实际行为与 account 模式相同
    return true;
}

/**
 * 从 AccountPoolManager 读取账号池数据
 * @param {Object} currentConfig - 当前配置
 * @param {Object} poolManager - AccountPoolManager 实例
 * @returns {Object} { accountMode, filePath, accountPool }
 */
export function readAccountsFromStorage(currentConfig, poolManager = null) {
    const filePath = currentConfig.ACCOUNT_POOL_FILE_PATH || ACCOUNT_POOL_FILE;

    if (poolManager && typeof poolManager.listAccounts === 'function') {
        // 使用 AccountPoolManager 作为唯一数据源
        return {
            accountMode: true,
            filePath,
            accountPool: { accounts: poolManager.listAccounts() }
        };
    }

    // 降级处理：如果没有 poolManager，返回空数据
    logger.warn('[UI API] No poolManager available, returning empty account pool');
    return {
        accountMode: true,
        filePath,
        accountPool: { accounts: [] }
    };
}

/**
 * 生成不缓存的响应头
 * @param {Object} additionalHeaders - 额外的响应头
 * @returns {Object} 包含禁用缓存的响应头
 */
function getNoCacheHeaders(additionalHeaders = {}) {
    return {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        ...additionalHeaders
    };
}

/**
 * 解析错误消息，转换为友好的中文提示
 * @param {string} errorMessage - 原始错误消息
 * @returns {object} { status: '封禁'|'过期'|'额度用尽'|'限流'|'未知错误', message: '友好提示' }
 */
export function parseErrorMessage(errorMessage) {
    if (!errorMessage) return { status: '正常', message: '' };

    const msg = errorMessage.toLowerCase();

    // 403 - 封禁/禁止访问
    if (msg.includes('403') || msg.includes('forbidden') || msg.includes('suspended') || msg.includes('locked')) {
        return { status: '封禁', message: '账号已被封禁，无法使用', statusType: 'banned' };
    }

    // 402 - 额度用尽
    if (msg.includes('402') || msg.includes('payment') || msg.includes('quota') || msg.includes('limit exceeded')) {
        return { status: '额度用尽', message: '账号额度已用完', statusType: 'quota_exceeded' };
    }

    // 401 - Token 无效/过期
    if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid token') || msg.includes('expired')) {
        return { status: '过期', message: 'Token 已失效，需要重新授权', statusType: 'expired' };
    }

    // 429 - 限流
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
        return { status: '限流', message: '请求过于频繁，稍后自动恢复', statusType: 'rate_limit' };
    }

    // 500/502/503 - 服务器错误
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('server error')) {
        return { status: '服务异常', message: '服务器暂时不可用', statusType: 'server_error' };
    }

    // 网络错误
    if (msg.includes('timeout') || msg.includes('network') || msg.includes('econnrefused')) {
        return { status: '网络错误', message: '网络连接失败', statusType: 'network_error' };
    }

    // 默认
    return { status: '异常', message: errorMessage, statusType: 'unknown' };
}

// Kiro OAuth 状态存储（内存 + 文件持久化）
export const kiroOAuthStates = new Map(); // state -> {code_verifier, machineid, timestamp, accountNumber}
export const kiroOAuthCompletedStates = new Map(); // state -> {accountNumber, completedAt} 已完成的授权，保留5分钟供前端查询
const KIRO_OAUTH_STATE_FILE = './configs/kiro-oauth-states.json'; // 持久化文件
export const PROVIDER_POOLS_FILE = './configs/provider_pools.json'

// 加载持久化的OAuth状态
async function loadOAuthStates() {
    try {
        if (existsSync(KIRO_OAUTH_STATE_FILE)) {
            const content = await fs.readFile(KIRO_OAUTH_STATE_FILE, 'utf8');
            const data = JSON.parse(content);

            // 清理过期的state（超过30分钟）
            const now = Date.now();
            const validStates = Object.entries(data).filter(([state, stateData]) => {
                const age = now - stateData.timestamp;
                return age < 30 * 60 * 1000; // 30分钟
            });

            // 加载到内存
            for (const [state, stateData] of validStates) {
                kiroOAuthStates.set(state, stateData);
            }

            logger.info(`[Kiro OAuth] Loaded ${validStates.length} valid states from file`);
        }
    } catch (error) {
        logger.warn('[Kiro OAuth] Failed to load OAuth states from file', error);
    }
}

// 保存OAuth状态到文件
async function saveOAuthStates() {
    try {
        const statesObject = Object.fromEntries(kiroOAuthStates.entries());
        await fs.writeFile(KIRO_OAUTH_STATE_FILE, JSON.stringify(statesObject, null, 2));
    } catch (error) {
        logger.error('[Kiro OAuth] Failed to save OAuth states to file', error);
    }
}

// 启动时加载OAuth状态
loadOAuthStates().catch(err => {
    logger.warn('[Kiro OAuth] Error during initial state loading', err);
});

// Kiro OAuth 配置
export const KIRO_OAUTH_CONFIG = {
    REDIRECT_URI: 'kiro://kiro.kiroAgent/authenticate-success',
    REDIRECT_URI_WEB: null,  // 动态生成，基于实际监听端口
    IDE_VERSION: '0.7.45',  // 更新到最新版本
    TOKEN_ENDPOINT: 'https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token',
    LOGIN_ENDPOINT: 'https://prod.us-east-1.auth.desktop.kiro.dev/login'
};

/**
 * 生成 OAuth 结果页面 HTML
 */
export function generateOAuthResultPage(success, message, details = null) {
    const iconColor = success ? '#10b981' : '#ef4444';
    const icon = success ? '✓' : '✗';
    const title = success ? '授权成功' : '授权失败';

    let detailsHtml = '';
    if (details) {
        detailsHtml = `
            <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: left; max-width: 400px; margin: 0 auto 32px;">
                ${details.provider ? `<div style="color: #9ca3af; margin-bottom: 8px;">登录方式: <span style="color: #3b82f6; font-weight: 600;">${details.provider}</span></div>` : ''}
                ${details.accountNumber ? `<div style="color: #9ca3af; margin-bottom: 8px;">账号编号: <span style="color: #10b981; font-weight: 600;">#${details.accountNumber}</span></div>` : ''}
                ${details.tokenFile ? `<div style="color: #9ca3af; margin-bottom: 8px;">Token 文件: <code style="color: #f59e0b; background: rgba(245,158,11,0.1); padding: 2px 6px; border-radius: 4px;">${details.tokenFile}</code></div>` : ''}
                <div style="color: #9ca3af;">状态: <span style="color: #10b981;">已保存</span></div>
            </div>
        `;
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kiro OAuth - ${title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            min-height: 100vh;
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 40px;
            animation: fadeIn 0.5s ease-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, ${iconColor} 0%, ${iconColor}cc 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            box-shadow: 0 0 40px ${iconColor}66;
        }
        .icon span { font-size: 40px; }
        h1 { font-size: 32px; margin-bottom: 12px; }
        .message { color: #9ca3af; font-size: 18px; margin-bottom: 32px; max-width: 500px; }
        .btn {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 14px 32px;
            font-size: 16px;
            cursor: pointer;
            font-weight: 500;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
        }
        .hint { color: #6b7280; font-size: 14px; margin-top: 16px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon"><span>${icon}</span></div>
        <h1>${title}</h1>
        <p class="message">${message}</p>
        ${detailsHtml}
        <button class="btn" onclick="window.close()">关闭此页面</button>
        <p class="hint">此页面可以安全关闭</p>
    </div>
</body>
</html>`;
}

/**
 * 读取用量缓存文件
 * @returns {Promise<Object|null>} 缓存的用量数据，如果不��在或读取失败则返回 null
 */
export async function readUsageCache() {
    try {
        if (existsSync(USAGE_CACHE_FILE)) {
            const content = await fs.readFile(USAGE_CACHE_FILE, 'utf8');
            return JSON.parse(content);
        }
        return null;
    } catch (error) {
        logger.warn('[Usage Cache] Failed to read usage cache', error);
        return null;
    }
}

/**
 * 写入用量缓存文件
 * @param {Object} usageData - 用量数据
 */
export async function writeUsageCache(usageData) {
    try {
        await fs.writeFile(USAGE_CACHE_FILE, JSON.stringify(usageData, null, 2), 'utf8');
        logger.info(`[Usage Cache] Usage data cached to ${USAGE_CACHE_FILE}`);
    } catch (error) {
        logger.error('[Usage Cache] Failed to write usage cache', error);
    }
}

/**
 * 读取特定提供商类型的用量缓存
 * @param {string} providerType - 提供商类型
 * @returns {Promise<Object|null>} 缓存的用量数据
 */
export async function readProviderUsageCache(providerType) {
    const cache = await readUsageCache();
    if (cache && cache.providers && cache.providers[providerType]) {
        return {
            ...cache.providers[providerType],
            cachedAt: cache.timestamp,
            fromCache: true
        };
    }
    return null;
}

/**
 * 读取token存储文件
 */
export async function readTokenStore() {
    try {
        if (existsSync(TOKEN_STORE_FILE)) {
            const content = await fs.readFile(TOKEN_STORE_FILE, 'utf8');
            return JSON.parse(content);
        } else {
            // 如果文件不存在，创建一个默认的token store
            await writeTokenStore({ tokens: {} });
            return { tokens: {} };
        }
    } catch (error) {
        logger.error('读取token存储文件失败', error);
        return { tokens: {} };
    }
}

/**
 * 写入token存储文件
 */
export async function writeTokenStore(tokenStore) {
    try {
        await fs.writeFile(TOKEN_STORE_FILE, JSON.stringify(tokenStore, null, 2), 'utf8');
    } catch (error) {
        logger.error('写入token存储文件失败', error);
    }
}

/**
 * 生成简单的token
 */
export function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * 生成token过期时间
 */
export function getExpiryTime() {
    const now = Date.now();
    const expiry = 60 * 60 * 1000; // 1小时
    return now + expiry;
}

/**
 * 验证简单token
 */
async function verifyToken(token) {
    const tokenStore = await readTokenStore();
    const tokenInfo = tokenStore.tokens[token];
    if (!tokenInfo) {
        return null;
    }
    
    // 检查是否过期
    if (Date.now() > tokenInfo.expiryTime) {
        await deleteToken(token);
        return null;
    }
    
    return tokenInfo;
}

/**
 * 保存token到本地文件
 */
export async function saveToken(token, tokenInfo) {
    const tokenStore = await readTokenStore();
    tokenStore.tokens[token] = tokenInfo;
    await writeTokenStore(tokenStore);
}

/**
 * 删除token
 */
async function deleteToken(token) {
    const tokenStore = await readTokenStore();
    if (tokenStore.tokens[token]) {
        delete tokenStore.tokens[token];
        await writeTokenStore(tokenStore);
    }
}

/**
 * 清理过期的token
 */
async function cleanupExpiredTokens() {
    const tokenStore = await readTokenStore();
    const now = Date.now();
    let hasChanges = false;
    
    for (const token in tokenStore.tokens) {
        if (now > tokenStore.tokens[token].expiryTime) {
            delete tokenStore.tokens[token];
            hasChanges = true;
        }
    }
    
    if (hasChanges) {
        await writeTokenStore(tokenStore);
    }
}

/**
 * 读取密码
 */
async function readPasswordFile() {
    // 兼容旧的 pwd 文件方式
    try {
        const password = await fs.readFile('./pwd', 'utf8');
        return password.trim();
    } catch (error) {
        logger.error('读取密码文件失败', error);
        return null;
    }
}

/**
 * 验证登录凭据
 */
export async function validateCredentials(password) {
    const storedPassword = await readPasswordFile();
    return storedPassword && password === storedPassword;
}

/**
 * 解析请求体JSON
 */
export function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                if (!body.trim()) {
                    resolve({});
                } else {
                    resolve(JSON.parse(body));
                }
            } catch (error) {
                reject(new Error('无效的JSON格式'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * 检查token验证
 */
async function checkAuth(req) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }

    const token = authHeader.substring(7);
    const tokenInfo = await verifyToken(token);
    
    return tokenInfo !== null;
}

/**
 * 处理登录请求
 */
async function handleLoginRequest(req, res) {
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: '仅支持POST请求' }));
        return true;
    }

    try {
        const requestData = await parseRequestBody(req);
        const { password } = requestData;
        
        if (!password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: '密码不能为空' }));
            return true;
        }

        const isValid = await validateCredentials(password);
        
        if (isValid) {
            // 生成简单token
            const token = generateToken();
            const expiryTime = getExpiryTime();
            
            // 存储token信息到本地文件
            await saveToken(token, {
                username: 'admin',
                loginTime: Date.now(),
                expiryTime
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: '登录成功',
                token,
                expiresIn: '1小时'
            }));
        } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: '密码错误，请重试'
            }));
        }
    } catch (error) {
        logger.error('登录处理错误', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            message: error.message || '服务器错误'
        }));
    }
    return true;
}

// 定时清理过期token
setInterval(cleanupExpiredTokens, 5 * 60 * 1000); // 每5分钟清理一次

// 配置multer中间件
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            // multer在destination回调时req.body还未解析，先使用默认路径
            // 实际的provider会在文件上传完成后从req.body中获取
            const uploadPath = path.join(process.cwd(), 'configs', 'temp');
            await fs.mkdir(uploadPath, { recursive: true });
            cb(null, uploadPath);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${timestamp}_${sanitizedName}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['.json', '.txt', '.key', '.pem', '.p12', '.pfx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('不支持的文件类型'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB限制
    }
});

/**
 * Serve static files for the UI
 * @param {string} path - The request path
 * @param {http.ServerResponse} res - The HTTP response object
 */

/**
 * Handle UI management API requests
 * @param {string} method - The HTTP method
 * @param {string} path - The request path
 * @param {http.IncomingMessage} req - The HTTP request object
 * @param {http.ServerResponse} res - The HTTP response object
 * @param {Object} currentConfig - The current configuration object
 * @param {Object} providerPoolManager - The provider pool manager instance
 * @returns {Promise<boolean>} - True if the request was handled by UI API
 */
/**
 * 重载配置文件
 * 动态导入config-manager并重新初始化配置
 * @returns {Promise<Object>} 返回重载后的配置对象
 */
export async function reloadConfig() {
    try {
        // Import config manager dynamically
        const { initializeConfig } = await import('./config/manager.js');

        // Reload main config
        const newConfig = await initializeConfig(process.argv.slice(2), './configs/config.json');

        // Update global CONFIG
        Object.assign(CONFIG, newConfig);
        logger.info('[UI API] Configuration reloaded:');

        // Update initApiService - 清空并重新初始化服务实例
        Object.keys(serviceInstances).forEach(key => delete serviceInstances[key]);
        initApiService(CONFIG);

        logger.info('[UI API] Configuration reloaded successfully');

        return newConfig;
    } catch (error) {
        logger.error('[UI API] Failed to reload configuration', error);
        throw error;
    }
}

export async function handleUIApiRequests(method, pathParam, req, res, currentConfig, providerPoolManager) {
    // ========== 文件上传特殊处理（需要在路由器之前） ==========
    if (method === 'POST' && pathParam === '/api/upload-oauth-credentials') {
        // 使用 multer 中间件处理文件上传
        const uploadMiddleware = upload.single('file');

        uploadMiddleware(req, res, async (err) => {
            if (err) {
                logger.error('文件上传错误', err);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: err.message || '文件上传失败'
                    }
                }));
                return;
            }

            try {
                if (!req.file) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: {
                            message: '没有文件被上传'
                        }
                    }));
                    return;
                }

                // 调用handler处理上传后的逻辑
                const { uploadCredentials } = await import('./ui/router/handlers/upload.handlers.js');
                await uploadCredentials({ req, res, currentConfig });
            } catch (error) {
                logger.error('[Router] Upload handler error', error);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: { message: '文件上传处理失败: ' + error.message }
                    }));
                }
            }
        });
        return true;
    }

    // ========== 路由器处理逻辑 ==========
    // 创建路由器实例
    if (!global.uiRouter || process.env.NODE_ENV !== 'production') {
        global.uiRouter = createRouter();
        if (ROUTER_CONFIG.ENABLE_ROUTER_LOGGING) {
            logger.verbose(`Router initialized with ${global.uiRouter.getRoutes().length} routes`);
        }
    }

    // 匹配路由
    const matched = global.uiRouter.match(method, pathParam);

    if (matched) {
        const { route, match } = matched;

        if (ROUTER_CONFIG.ENABLE_ROUTER_LOGGING) {
            logger.verbose(`Router matched: ${method} ${pathParam} -> ${route.description || '(no description)'}`);
        }

        // 认证检查
        if (route.auth) {
            const isAuth = await routerCheckAuth(req, res);
            if (!isAuth) {
                // routerCheckAuth 已经发送了 401 响应
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

            logger.verbose(`Router handler completed: ${method} ${pathParam}`);

            return true;
        } catch (error) {
            logger.error(`Router error handling ${method} ${pathParam}`, error);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Internal Server Error' } }));
            }
            return true;
        }
    }

    // 未匹配到路由，返回 false 继续处理
    logger.debug(`Router no match found for: ${method} ${pathParam}`);
    return false;
}

// 重新导出从 UI 模块导入的函数
export { serveStaticFiles, initializeUIManagement, broadcastEvent };
