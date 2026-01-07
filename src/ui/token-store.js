import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('ui:token-store');
const TOKEN_STORE_FILE = './configs/token-store.json';

/**
 * 读取 token 存储文件
 * @returns {Promise<Object>} Token 存储对象
 */
export async function readTokenStore() {
    try {
        if (existsSync(TOKEN_STORE_FILE)) {
            const content = await fs.readFile(TOKEN_STORE_FILE, 'utf8');
            return JSON.parse(content);
        }
        await writeTokenStore({ tokens: {} });
        return { tokens: {} };
    } catch (error) {
        logger.error('读取token存储文件失败', error);
        return { tokens: {} };
    }
}

/**
 * 写入 token 存储文件
 * @param {Object} tokenStore - Token 存储对象
 */
export async function writeTokenStore(tokenStore) {
    try {
        await fs.writeFile(TOKEN_STORE_FILE, JSON.stringify(tokenStore, null, 2), 'utf8');
    } catch (error) {
        logger.error('写入token存储文件失败', error);
    }
}

/**
 * 生成随机 token
 * @returns {string} 64位十六进制字符串
 */
export function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * 获取 token 过期时间（1小时后）
 * @returns {number} 时间戳
 */
export function getExpiryTime() {
    return Date.now() + 60 * 60 * 1000;
}

/**
 * 验证 token 是否有效
 * @param {string} token - 要验证的 token
 * @returns {Promise<Object|null>} Token 信息或 null
 */
export async function verifyToken(token) {
    const tokenStore = await readTokenStore();
    const tokenInfo = tokenStore.tokens[token];

    if (!tokenInfo) {
        return null;
    }

    if (Date.now() > tokenInfo.expiryTime) {
        await deleteToken(token);
        return null;
    }

    return tokenInfo;
}

/**
 * 保存 token
 * @param {string} token - Token 字符串
 * @param {Object} tokenInfo - Token 信息
 */
export async function saveToken(token, tokenInfo) {
    const tokenStore = await readTokenStore();
    tokenStore.tokens[token] = tokenInfo;
    await writeTokenStore(tokenStore);
}

/**
 * 删除 token
 * @param {string} token - 要删除的 token
 */
export async function deleteToken(token) {
    const tokenStore = await readTokenStore();
    if (tokenStore.tokens[token]) {
        delete tokenStore.tokens[token];
        await writeTokenStore(tokenStore);
    }
}

/**
 * 清理过期的 tokens
 */
export async function cleanupExpiredTokens() {
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
        logger.info('已清理过期的 tokens');
    }
}
