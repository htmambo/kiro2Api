/**
 * OAuth Token 文件存储
 *
 * 负责 token 的校验、落盘、读取与删除，并维护一致的文件命名规则。
 *
 * @module domain/oauth/token-store
 */
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'node:path';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('token-store');

/**
 * 统一路径分隔符为 /
 *
 * @param {string} p - 原始路径
 * @returns {string} 规范化路径
 */
function normalizePath(p) {
    return String(p).replace(/\\/g, '/');
}

/**
 * 将标识转换为安全的文件名片段
 *
 * @param {string|number} id - 原始标识
 * @returns {string} 安全标识
 */
function safeId(id) {
    return String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * 判断值是否可被视为日期
 *
 * @param {*} value - 待判断值
 * @returns {boolean} 是否可解析为日期
 */
function isDateLike(value) {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return !Number.isNaN(Date.parse(value));
    return false;
}

/**
 * Token 存储器
 *
 * 提供 token 的校验、保存、读取与删除能力。
 */
export class TokenStore {
    /**
     * 创建 TokenStore
     *
     * @param {Object} [options={}] - 配置项
     * @param {string} [options.baseDir] - 相对工作目录的保存路径
     * @param {string} [options.cwd] - 工作目录
     */
    constructor(options = {}) {
        this.baseDir = options.baseDir || path.join('configs', 'kiro');
        this.cwd = options.cwd || process.cwd();
    }

    /**
     * 校验 token 数据结构
     *
     * @param {Object} tokenData - token 数据
     * @returns {{ok: boolean, error: (string|null)}} 校验结果
     */
    validateToken(tokenData) {
        if (!tokenData || typeof tokenData !== 'object') {
            return { ok: false, error: 'tokenData must be an object' };
        }

        // 允许不同来源字段，但至少要有一个可用凭据字段
        const hasCred =
            typeof tokenData.accessToken === 'string' && tokenData.accessToken.length > 0 ||
            typeof tokenData.refreshToken === 'string' && tokenData.refreshToken.length > 0;

        if (!hasCred) {
            return { ok: false, error: 'tokenData must include accessToken or refreshToken' };
        }

        if ('expiresAt' in tokenData && tokenData.expiresAt !== null && tokenData.expiresAt !== undefined) {
            if (!isDateLike(tokenData.expiresAt)) {
                return { ok: false, error: 'expiresAt must be a number (ms) or parseable date string' };
            }
        }

        return { ok: true, error: null };
    }

    /**
     * 构建 token 文件名
     *
     * @param {string|number} accountId - 账号标识
     * @param {Object} [options={}] - 可选项
     * @returns {string} 文件名
     */
    _buildTokenFileName(accountId, options = {}) {
        if (options.fileName) return options.fileName;
        const safe = safeId(accountId);
        return `kiro-auth-token-${safe}.json`;
    }

    /**
     * 构建绝对路径
     *
     * @param {string} fileName - 文件名
     * @returns {string} 绝对路径
     */
    _buildAbsolutePath(fileName) {
        return path.join(this.cwd, this.baseDir, fileName);
    }

    /**
     * 构建相对路径（统一分隔符）
     *
     * @param {string} fileName - 文件名
     * @returns {string} 相对路径
     */
    _buildRelativePath(fileName) {
        return normalizePath(path.join(this.baseDir, fileName));
    }

    /**
     * 保存 token 到文件
     *
     * @param {string|number} accountId - 账号标识
     * @param {Object} tokenData - token 数据
     * @param {Object} [options={}] - 额外选项
     * @returns {Promise<{tokenFilePath: string, tokenFileName: string, relativePath: string}>} 保存信息
     */
    async saveToken(accountId, tokenData, options = {}) {
        const validation = this.validateToken(tokenData);
        if (!validation.ok) {
            throw new Error(validation.error);
        }

        const fileName = this._buildTokenFileName(accountId, options);
        const absPath = this._buildAbsolutePath(fileName);
        const dir = path.dirname(absPath);

        if (!existsSync(dir)) {
            await fs.mkdir(dir, { recursive: true });
        }

        // 保存时附加时间戳，便于后续审计
        const payload = {
            ...tokenData,
            savedAt: new Date().toISOString()
        };

        await fs.writeFile(absPath, JSON.stringify(payload, null, 2), 'utf8');
        logger.info(`[TokenStore] Saved token to ${absPath}`);

        return {
            tokenFilePath: absPath,
            tokenFileName: fileName,
            relativePath: this._buildRelativePath(fileName)
        };
    }

    /**
     * 读取 token 文件
     *
     * @param {Object|string|number} tokenRef - token 引用（路径/相对路径/账号 ID）
     * @returns {Promise<Object>} token 数据
     */
    async loadToken(tokenRef) {
        const filePath = await this._resolveTokenRefToPath(tokenRef);
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content);
    }

    /**
     * 删除 token 文件
     *
     * @param {Object|string|number} tokenRef - token 引用（路径/相对路径/账号 ID）
     * @returns {Promise<boolean>} 是否删除成功
     */
    async deleteToken(tokenRef) {
        const filePath = await this._resolveTokenRefToPath(tokenRef);
        try {
            await fs.unlink(filePath);
            logger.info(`[TokenStore] Deleted token file ${filePath}`);
            return true;
        } catch (e) {
            if (e && e.code === 'ENOENT') return false;
            throw e;
        }
    }

    /**
     * 将 token 引用解析为绝对路径
     *
     * @param {Object|string|number} tokenRef - token 引用
     * @returns {Promise<string>} 文件绝对路径
     */
    async _resolveTokenRefToPath(tokenRef) {
        if (!tokenRef) throw new Error('tokenRef is required');

        // 支持两类调用：
        // - deleteToken({ filePath })
        // - deleteToken(accountId)
        if (typeof tokenRef === 'object' && tokenRef !== null) {
            if (tokenRef.filePath) return tokenRef.filePath;
            if (tokenRef.relativePath) return path.join(this.cwd, tokenRef.relativePath);
            if (tokenRef.accountId) {
                const fileName = this._buildTokenFileName(tokenRef.accountId, tokenRef);
                return this._buildAbsolutePath(fileName);
            }
        }

        const fileName = this._buildTokenFileName(tokenRef);
        return this._buildAbsolutePath(fileName);
    }
}

/**
 * 默认 TokenStore 实例
 *
 * @type {TokenStore}
 */
export const tokenStore = new TokenStore();
