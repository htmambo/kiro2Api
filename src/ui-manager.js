import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import multer from 'multer';
import crypto from 'crypto';
import { getRequestBody } from './utils/common.js';
import { CONFIG } from './config/manager.js';
import { serviceInstances, getServiceAdapter } from './kiro/core.js';
import { initApiService, getAccountPoolManager, isSQLiteMode } from './services/manager.js';
import { sqliteDB } from './services/storage/sqlite-db.js';
import { handleKiroOAuth } from './services/oauth-handlers.js';
import {
    generateUUID,
    normalizePath,
    getFileName,
    pathsEqual,
    isPathUsed,
    detectProviderFromPath,
    isValidOAuthCredentials,
    createProviderConfig,
    addToUsedPaths,
    formatSystemPath,
    findDuplicateUserId
} from './utils/account-utils.js';
import { formatKiroUsage } from './services/usage-service.js';
import { KIRO_MODELS } from './kiro/constants.js';
import { serveStaticFiles } from './ui/static.js';
import { initializeUIManagement, broadcastEvent } from './ui/events.js';

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
    console.warn('[UI API] No poolManager available, returning empty account pool');
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

            console.log(`[Kiro OAuth] Loaded ${validStates.length} valid states from file`);
        }
    } catch (error) {
        console.warn('[Kiro OAuth] Failed to load OAuth states from file:', error.message);
    }
}

// 保存OAuth状态到文件
async function saveOAuthStates() {
    try {
        const statesObject = Object.fromEntries(kiroOAuthStates.entries());
        await fs.writeFile(KIRO_OAUTH_STATE_FILE, JSON.stringify(statesObject, null, 2));
    } catch (error) {
        console.error('[Kiro OAuth] Failed to save OAuth states to file:', error.message);
    }
}

// 启动时加载OAuth状态
loadOAuthStates().catch(err => {
    console.warn('[Kiro OAuth] Error during initial state loading:', err.message);
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
        console.warn('[Usage Cache] Failed to read usage cache:', error.message);
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
        console.log('[Usage Cache] Usage data cached to', USAGE_CACHE_FILE);
    } catch (error) {
        console.error('[Usage Cache] Failed to write usage cache:', error.message);
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
 * 更新特定提供商类型的用量缓存
 * @param {string} providerType - 提供商类型
 * @param {Object} usageData - 用量数据
 */
export async function updateProviderUsageCache(providerType, usageData) {
    let cache = await readUsageCache();
    if (!cache) {
        cache = {
            timestamp: new Date().toISOString(),
            providers: {}
        };
    }
    cache.providers[providerType] = usageData;
    cache.timestamp = new Date().toISOString();
    await writeUsageCache(cache);
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
        console.error('读取token存储文件失败:', error);
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
        console.error('写入token存储文件失败:', error);
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
        console.error('读取密码文件失败:', error);
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
        console.error('登录处理错误:', error);
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
        console.log('[UI API] Configuration reloaded:');

        // Update initApiService - 清空并重新初始化服务实例
        Object.keys(serviceInstances).forEach(key => delete serviceInstances[key]);
        initApiService(CONFIG);

        console.log('[UI API] Configuration reloaded successfully');

        return newConfig;
    } catch (error) {
        console.error('[UI API] Failed to reload configuration:', error);
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
                console.error('文件上传错误:', err.message);
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
                console.error('[Router] Upload handler error:', error);
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
    // 创建路由器实例（开发模式下每次重新创建以获取最新路由）
    if (!global.uiRouter || process.env.NODE_ENV === 'development') {
        global.uiRouter = createRouter();
        if (ROUTER_CONFIG.ENABLE_ROUTER_LOGGING) {
            console.log('[Router] Router initialized with', global.uiRouter.getRoutes().length, 'routes');
        }
    }

    // 匹配路由
    const matched = global.uiRouter.match(method, pathParam);

    if (matched) {
        const { route, match } = matched;

        if (ROUTER_CONFIG.ENABLE_ROUTER_LOGGING) {
            console.log(`[Router] Matched: ${method} ${pathParam} -> ${route.description || '(no description)'}`);
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

            if (ROUTER_CONFIG.ENABLE_ROUTER_LOGGING) {
                console.log(`[Router] Handler completed: ${method} ${pathParam}`);
            }

            return true;
        } catch (error) {
            console.error(`[Router] Error handling ${method} ${pathParam}:`, error);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Internal Server Error' } }));
            }
            return true;
        }
    }

    // 未匹配到路由，返回 false 继续处理
    if (ROUTER_CONFIG.ENABLE_ROUTER_LOGGING) {
        console.log(`[Router] No match found for: ${method} ${pathParam}`);
    }
    return false;
}
export async function scanConfigFiles(currentConfig, accountPoolManager) {
    const configFiles = [];
    
    // 只扫描configs目录
    const configsPath = path.join(process.cwd(), 'configs');
    
    if (!existsSync(configsPath)) {
        // console.log('[Config Scanner] configs directory not found, creating empty result');
        return configFiles;
    }

    const usedPaths = new Set(); // 存储已使用的路径，用于判断关联状态
    // 使用最新的提供商池数据
    let accounts = currentConfig.accountPool.accounts;
    if (accountPoolManager && accountPoolManager.accountPools) {
        accounts = accountPoolManager.accountPools.accounts;
    }

    // 检查提供商池文件中的所有OAuth凭据路径 - 标准化路径格式
    if (accounts) {
        for (const account of accounts) {
            addToUsedPaths(usedPaths, account.KIRO_OAUTH_CREDS_FILE_PATH);
        }
    }

    try {
        // 扫描configs目录下的所有子目录和文件
        const configsFiles = await scanOAuthDirectory(configsPath, usedPaths, currentConfig);
        configFiles.push(...configsFiles);
    } catch (error) {
        console.warn(`[Config Scanner] Failed to scan configs directory:`, error.message);
    }

    return configFiles;
}

/**
 * Analyze OAuth configuration file and return metadata
 * @param {string} filePath - Full path to the file
 * @param {Set} usedPaths - Set of paths currently in use
 * @returns {Promise<Object|null>} OAuth file information object
 */
async function analyzeOAuthFile(filePath, usedPaths, currentConfig) {
    try {
        const stats = await fs.stat(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const filename = path.basename(filePath);
        const relativePath = path.relative(process.cwd(), filePath);
        
        // 读取文件内容进行分析
        let content = '';
        let type = 'oauth_credentials';
        let isValid = true;
        let errorMessage = '';
        let oauthProvider = 'unknown';
        let usageInfo = getFileUsageInfo(relativePath, filename, usedPaths, currentConfig);
        
        try {
            if (ext === '.json') {
                const rawContent = await fs.readFile(filePath, 'utf8');
                const jsonData = JSON.parse(rawContent);
                content = rawContent;
                
                // 识别OAuth提供商
                if (jsonData.apiKey || jsonData.api_key) {
                    type = 'api_key';
                } else if (jsonData.client_id || jsonData.client_secret) {
                    oauthProvider = 'oauth2';
                } else if (jsonData.access_token || jsonData.refresh_token) {
                    oauthProvider = 'token_based';
                } else if (jsonData.credentials) {
                    oauthProvider = 'service_account';
                }
                
                if (jsonData.base_url || jsonData.endpoint) {
                    if (jsonData.base_url.includes('anthropic.com')) {
                        oauthProvider = 'claude';
                    }
                }
            } else {
                content = await fs.readFile(filePath, 'utf8');
                
                if (ext === '.key' || ext === '.pem') {
                    if (content.includes('-----BEGIN') && content.includes('PRIVATE KEY-----')) {
                        oauthProvider = 'private_key';
                    }
                } else if (ext === '.txt') {
                    if (content.includes('api_key') || content.includes('apikey')) {
                        oauthProvider = 'api_key';
                    }
                } else if (ext === '.oauth' || ext === '.creds') {
                    oauthProvider = 'oauth_credentials';
                }
            }
        } catch (readError) {
            isValid = false;
            errorMessage = `无法读取文件: ${readError.message}`;
        }
        
        return {
            name: filename,
            path: relativePath,
            size: stats.size,
            type: type,
            provider: oauthProvider,
            extension: ext,
            modified: stats.mtime.toISOString(),
            isValid: isValid,
            errorMessage: errorMessage,
            isUsed: isPathUsed(relativePath, filename, usedPaths),
            usageInfo: usageInfo, // 新增详细关联信息
            preview: content.substring(0, 100) + (content.length > 100 ? '...' : '')
        };
    } catch (error) {
        console.warn(`[OAuth Analyzer] Failed to analyze file ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Get detailed usage information for a file
 * @param {string} relativePath - Relative file path
 * @param {string} fileName - File name
 * @param {Set} usedPaths - Set of used paths
 * @param {Object} currentConfig - Current configuration
 * @returns {Object} Usage information object
 */
function getFileUsageInfo(relativePath, fileName, usedPaths, currentConfig) {
    const usageInfo = {
        isUsed: false,
        usageType: null,
        usageDetails: []
    };

    // 检查是否被使用
    const isUsed = isPathUsed(relativePath, fileName, usedPaths);
    if (!isUsed) {
        return usageInfo;
    }

    usageInfo.isUsed = true;

    if (currentConfig.KIRO_OAUTH_CREDS_FILE_PATH &&
        (pathsEqual(relativePath, currentConfig.KIRO_OAUTH_CREDS_FILE_PATH) ||
         pathsEqual(relativePath, currentConfig.KIRO_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
        usageInfo.usageType = 'main_config';
        usageInfo.usageDetails.push({
            type: '主要配置',
            location: 'Kiro OAuth凭据文件路径',
            configKey: 'KIRO_OAUTH_CREDS_FILE_PATH'
        });
    }

    // 检查提供商池中的使用情况
    if (currentConfig.providerPools) {
        // 使用 flatMap 将双重循环优化为单层循环 O(n)
        const allProviders = Object.entries(currentConfig.providerPools).flatMap(
            ([providerType, providers]) =>
                providers.map((provider, index) => ({ provider, providerType, index }))
        );

        for (const { provider, providerType, index } of allProviders) {
            const providerUsages = [];

            if (provider.KIRO_OAUTH_CREDS_FILE_PATH &&
                (pathsEqual(relativePath, provider.KIRO_OAUTH_CREDS_FILE_PATH) ||
                 pathsEqual(relativePath, provider.KIRO_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: '提供商池',
                    location: `Kiro OAuth凭据 (节点${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    configKey: 'KIRO_OAUTH_CREDS_FILE_PATH'
                });
            }
            
            if (providerUsages.length > 0) {
                usageInfo.usageType = 'provider_pool';
                usageInfo.usageDetails.push(...providerUsages);
            }
        }
    }

    // 如果有多个使用位置，标记为多种用途
    if (usageInfo.usageDetails.length > 1) {
        usageInfo.usageType = 'multiple';
    }

    return usageInfo;
}

/**
 * Scan OAuth directory for credential files
 * @param {string} dirPath - Directory path to scan
 * @param {Set} usedPaths - Set of used paths
 * @param {Object} currentConfig - Current configuration
 * @returns {Promise<Array>} Array of OAuth configuration file objects
 */
async function scanOAuthDirectory(dirPath, usedPaths, currentConfig) {
    const oauthFiles = [];
    
    try {
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const file of files) {
            const fullPath = path.join(dirPath, file.name);
            
            if (file.isFile()) {
                const ext = path.extname(file.name).toLowerCase();
                // 只关注OAuth相关的文件类型
                if (['.json', '.oauth', '.creds', '.key', '.pem', '.txt'].includes(ext)) {
                    const fileInfo = await analyzeOAuthFile(fullPath, usedPaths, currentConfig);
                    if (fileInfo) {
                        oauthFiles.push(fileInfo);
                    }
                }
            } else if (file.isDirectory()) {
                // 递归扫描子目录（限制深度）
                const relativePath = path.relative(process.cwd(), fullPath);
                // 最大深度4层，以支持 configs/kiro/{subfolder}/file.json 这样的结构
                if (relativePath.split(path.sep).length < 4) {
                    const subFiles = await scanOAuthDirectory(fullPath, usedPaths, currentConfig);
                    oauthFiles.push(...subFiles);
                }
            }
        }
    } catch (error) {
        console.warn(`[OAuth Scanner] Failed to scan directory ${dirPath}:`, error.message);
    }
    
    return oauthFiles;
}


// 注意：normalizePath, getFileName, pathsEqual, isPathUsed, detectProviderFromPath
// 已移至 provider-utils.js 公共模块

/**
 * 获取所有支持用量查询的提供商的用量信息
 * @param {Object} currentConfig - 当前配置
 * @param {Object} providerPoolManager - 提供商池管理器
 * @returns {Promise<Object>} 所有提供商的用量信息
 */
export async function getAllProvidersUsage(currentConfig, providerPoolManager) {
    const results = {
        timestamp: new Date().toISOString(),
        providers: {}
    };

    // 支持用量查询的提供商列表 - 只支持 Kiro
    const supportedProviders = ['claude-kiro-oauth'];

    // 并发获取所有提供商的用量数据
    const usagePromises = supportedProviders.map(async (providerType) => {
        try {
            const providerUsage = await getProviderTypeUsage(providerType, currentConfig, providerPoolManager);
            return { providerType, data: providerUsage, success: true };
        } catch (error) {
            return {
                providerType,
                data: {
                    error: error.message,
                    instances: []
                },
                success: false
            };
        }
    });

    // 等待所有并发请求完成
    const usageResults = await Promise.all(usagePromises);

    // 将结果整合到 results.providers 中
    for (const result of usageResults) {
        results.providers[result.providerType] = result.data;
    }

    return results;
}

/**
 * 获取指定提供商类型的用量信息
 * @param {string} providerType - 提供商类型
 * @param {Object} currentConfig - 当前配置
 * @param {Object} providerPoolManager - 提供商池管理器
 * @returns {Promise<Object>} 提供商用量信息
 */
export async function getProviderTypeUsage(providerType, currentConfig, providerPoolManager) {
    const result = {
        providerType,
        instances: [],
        totalCount: 0,
        successCount: 0,
        errorCount: 0
    };

    // 获取账号列表（支持 SQLite 和 JSON 两种模式）
    let providers = [];

    if (isSQLiteMode() && providerPoolManager && typeof providerPoolManager.getProviderPools === 'function') {
        // SQLite 模式
        providers = providerPoolManager.getProviderPools(providerType);
    } else {
        // JSON 模式：从 account pool 获取
        const { accountPool } = readAccountsFromStorage(currentConfig, providerPoolManager);
        providers = accountPool.accounts || [];
    }

    result.totalCount = providers.length;

    // 遍历所有提供商实例获取用量
    for (const provider of providers) {
        const providerKey = providerType + (provider.uuid || '');
        let adapter = serviceInstances[providerKey];

        const instanceResult = {
            uuid: provider.uuid || 'unknown',
            email: provider.cachedEmail || getProviderDisplayName(provider, providerType),
            userId: provider.cachedUserId || null,
            isHealthy: provider.isHealthy !== false,
            isDisabled: provider.isDisabled === true,
            usageCount: provider.usageCount || 0,
            errorCount: provider.errorCount || 0,
            success: false,
            limits: null,
            error: null
        };

        // 首先检查是否已禁用，已禁用的提供商跳过初始化
        if (provider.isDisabled) {
            instanceResult.error = '提供商已禁用';
            result.errorCount++;
        } else if (!adapter) {
            // 服务实例未初始化，尝试自动初始化
            try {
                console.log(`[Usage API] Auto-initializing service adapter for ${providerType}: ${provider.uuid}`);
                // 构建配置对象
                const serviceConfig = {
                    ...CONFIG,
                    ...provider,
                    MODEL_PROVIDER: providerType
                };
                adapter = getServiceAdapter(serviceConfig);
            } catch (initError) {
                console.error(`[Usage API] Failed to initialize adapter for ${providerType}: ${provider.uuid}:`, initError.message);
                instanceResult.error = `服务实例初始化失败: ${initError.message}`;
                result.errorCount++;
            }
        }
        
        // 如果适配器存在（包括刚初始化的），且没有错误，尝试获取用量
        if (adapter && !instanceResult.error) {
            try {
                const usage = await getAdapterUsage(adapter, providerType);
                instanceResult.success = true;

                // 提取用量数据到扁平结构
                if (usage) {
                    // 更新 email 和 userId
                    if (usage.user) {
                        instanceResult.email = usage.user.email || instanceResult.email;
                        instanceResult.userId = usage.user.userId || instanceResult.userId;
                    }
                    // 提取 limits 数据
                    if (usage.limits) {
                        instanceResult.limits = {
                            used: usage.limits.used,
                            remaining: usage.limits.remaining,
                            total: usage.limits.total,
                            percentUsed: usage.limits.percentUsed,
                            unit: usage.limits.unit || 'tokens'
                        };
                    }
                    // 提取订阅信息
                    if (usage.subscription) {
                        instanceResult.subscription = {
                            title: usage.subscription.title,
                            type: usage.subscription.type
                        };
                    }
                    // 提取用量明细（Credit, Free Trial 等）
                    if (usage.usageBreakdown && Array.isArray(usage.usageBreakdown)) {
                        instanceResult.usageBreakdown = usage.usageBreakdown.map(item => ({
                            displayName: item.displayName,
                            currentUsage: item.currentUsage,
                            usageLimit: item.usageLimit,
                            unit: item.unit,
                            freeTrial: item.freeTrial ? {
                                currentUsage: item.freeTrial.currentUsage,
                                usageLimit: item.freeTrial.usageLimit,
                                expiresAt: item.freeTrial.expiresAt
                            } : null
                        }));
                    }
                    // 下次重置时间
                    if (usage.nextDateReset) {
                        instanceResult.nextDateReset = usage.nextDateReset;
                    }
                    if (usage.daysUntilReset !== undefined) {
                        instanceResult.daysUntilReset = usage.daysUntilReset;
                    }
                }
                // 添加凭据文件路径
                if (provider.KIRO_OAUTH_CREDS_FILE_PATH) {
                    instanceResult.credentialsPath = provider.KIRO_OAUTH_CREDS_FILE_PATH;
                }
                result.successCount++;

                // 缓存 userId 和 email 到 provider pool，用于去重检测
                if (usage && usage.user) {
                    const needsUpdate = provider.cachedUserId !== usage.user.userId ||
                                       provider.cachedEmail !== usage.user.email;
                    if (needsUpdate) {
                        provider.cachedUserId = usage.user.userId;
                        provider.cachedEmail = usage.user.email;
                        provider.cachedAt = new Date().toISOString();

                        // 检查是否有重复的 userId
                        const duplicate = findDuplicateUserId(providers, usage.user.userId, provider.uuid);
                        if (duplicate) {
                            console.warn(`[Usage API] 检测到重复账号: ${usage.user.email} (userId: ${usage.user.userId})`);
                            console.warn(`[Usage API] 重复的 token: ${provider.KIRO_OAUTH_CREDS_FILE_PATH} 与 ${duplicate.path}`);
                            instanceResult.isDuplicate = true;
                            instanceResult.duplicateOf = duplicate.path;
                        }
                    }
                }
            } catch (error) {
                instanceResult.error = error.message;
                result.errorCount++;
            }
        }

        result.instances.push(instanceResult);
    }

    // 如果有 userId 缓存更新，保存到 provider_pools.json
    const hasUpdates = result.instances.some(inst => inst.usage?.user?.userId);
    if (hasUpdates && providerPoolManager) {
        try {
            const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || PROVIDER_POOLS_FILE;
            const currentPools = providerPoolManager.providerPools || {};
            currentPools[providerType] = providers;
            writeFileSync(filePath, JSON.stringify(currentPools, null, 2), 'utf8');
            console.log('[Usage API] Provider pools updated with cached userId/email');
        } catch (saveError) {
            console.error('[Usage API] Failed to save provider pools:', saveError.message);
        }
    }

    return result;
}

/**
 * 从适配器获取用量信息
 * @param {Object} adapter - 服务适配器
 * @param {string} providerType - 提供商类型
 * @returns {Promise<Object>} 用量信息
 */
async function getAdapterUsage(adapter, providerType) {
    if (providerType === 'claude-kiro-oauth') {
        if (typeof adapter.getUsageLimits === 'function') {
            const rawUsage = await adapter.getUsageLimits();
            return formatKiroUsage(rawUsage);
        }
        throw new Error('该适配器不支持用量查询');
    }

    throw new Error(`不支持的提供商类型: ${providerType}`);
}

/**
 * 获取提供商显示名称
 * @param {Object} provider - 提供商配置
 * @param {string} providerType - 提供商类型
 * @returns {string} 显示名称
 */
function getProviderDisplayName(provider, providerType) {
    // 尝试从凭据文件路径提取名称
    const credPathKey = {
        'claude-kiro-oauth': 'KIRO_OAUTH_CREDS_FILE_PATH'
    }[providerType];

    if (credPathKey && provider[credPathKey]) {
        const filePath = provider[credPathKey];
        const fileName = path.basename(filePath);
        const dirName = path.basename(path.dirname(filePath));
        return `${dirName}/${fileName}`;
    }

    return provider.uuid || '未命名';
}

// 重新导出从 UI 模块导入的函数
export { serveStaticFiles, initializeUIManagement, broadcastEvent };
