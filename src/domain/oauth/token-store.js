import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'node:path';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('token-store');

function normalizePath(p) {
    return String(p).replace(/\\/g, '/');
}

function safeId(id) {
    return String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isDateLike(value) {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return !Number.isNaN(Date.parse(value));
    return false;
}

export class TokenStore {
    constructor(options = {}) {
        this.baseDir = options.baseDir || path.join('configs', 'kiro');
        this.cwd = options.cwd || process.cwd();
    }

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

    _buildTokenFileName(accountId, options = {}) {
        if (options.fileName) return options.fileName;
        const safe = safeId(accountId);
        return `kiro-auth-token-${safe}.json`;
    }

    _buildAbsolutePath(fileName) {
        return path.join(this.cwd, this.baseDir, fileName);
    }

    _buildRelativePath(fileName) {
        return normalizePath(path.join(this.baseDir, fileName));
    }

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

    async loadToken(tokenRef) {
        const filePath = await this._resolveTokenRefToPath(tokenRef);
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content);
    }

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

export const tokenStore = new TokenStore();
