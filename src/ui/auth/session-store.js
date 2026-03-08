import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('ui:auth:session');
const TOKEN_STORE_FILE = './configs/token-store.json';
const TOKEN_EXPIRY_MS = 60 * 60 * 1000;
let cleanupTimer = null;

export async function readTokenStore() {
    try {
        if (existsSync(TOKEN_STORE_FILE)) {
            const content = await fs.readFile(TOKEN_STORE_FILE, 'utf8');
            return JSON.parse(content);
        }

        await writeTokenStore({ tokens: {} });
        return { tokens: {} };
    } catch (error) {
        logger.error('读取 token 存储文件失败', error);
        return { tokens: {} };
    }
}

export async function writeTokenStore(tokenStore) {
    try {
        await fs.writeFile(TOKEN_STORE_FILE, JSON.stringify(tokenStore, null, 2), 'utf8');
    } catch (error) {
        logger.error('写入 token 存储文件失败', error);
    }
}

export function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

export function getExpiryTime() {
    return Date.now() + TOKEN_EXPIRY_MS;
}

export async function saveToken(token, tokenInfo) {
    const tokenStore = await readTokenStore();
    tokenStore.tokens[token] = tokenInfo;
    await writeTokenStore(tokenStore);
}

export async function deleteToken(token) {
    const tokenStore = await readTokenStore();
    if (tokenStore.tokens[token]) {
        delete tokenStore.tokens[token];
        await writeTokenStore(tokenStore);
    }
}

export async function cleanupExpiredTokens() {
    const tokenStore = await readTokenStore();
    const now = Date.now();
    let hasChanges = false;

    for (const token of Object.keys(tokenStore.tokens)) {
        if (now > tokenStore.tokens[token].expiryTime) {
            delete tokenStore.tokens[token];
            hasChanges = true;
        }
    }

    if (hasChanges) {
        await writeTokenStore(tokenStore);
    }
}

export function startTokenCleanupScheduler() {
    if (cleanupTimer) {
        return cleanupTimer;
    }

    cleanupTimer = setInterval(() => {
        cleanupExpiredTokens().catch((error) => {
            logger.error('清理过期 token 失败', error);
        });
    }, 5 * 60 * 1000);

    if (typeof cleanupTimer.unref === 'function') {
        cleanupTimer.unref();
    }

    return cleanupTimer;
}
