import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('ui:oauth-states');

// OAuth 状态存储
export const kiroOAuthStates = new Map(); // state -> {code_verifier, machineid, timestamp, accountNumber}
export const kiroOAuthCompletedStates = new Map(); // state -> {accountNumber, completedAt}

// 持久化文件路径
export const KIRO_OAUTH_STATE_FILE = path.join(process.cwd(), 'configs', 'kiro-oauth-states.json');

// Kiro OAuth 配置
export const KIRO_OAUTH_CONFIG = {
    REDIRECT_URI: 'kiro://kiro.kiroAgent/authenticate-success',
    REDIRECT_URI_WEB: null,
    IDE_VERSION: '0.7.45',
    TOKEN_ENDPOINT: 'https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token',
    LOGIN_ENDPOINT: 'https://prod.us-east-1.auth.desktop.kiro.dev/login'
};

/**
 * 从文件加载 OAuth 状态
 */
export async function loadOAuthStates() {
    try {
        if (existsSync(KIRO_OAUTH_STATE_FILE)) {
            const content = await fs.readFile(KIRO_OAUTH_STATE_FILE, 'utf8');
            const data = JSON.parse(content);
            const now = Date.now();

            // 只加载 30 分钟内的状态
            const validStates = Object.entries(data).filter(
                ([_, stateData]) => now - stateData.timestamp < 30 * 60 * 1000
            );

            for (const [state, payload] of validStates) {
                kiroOAuthStates.set(state, payload);
            }

            logger.info(`[Kiro OAuth] Loaded ${validStates.length} valid states from file`);
        }
    } catch (error) {
        logger.warn('[Kiro OAuth] Failed to load OAuth states', error);
    }
}

/**
 * 保存 OAuth 状态到文件
 */
export async function saveOAuthStates() {
    try {
        const statesObject = Object.fromEntries(kiroOAuthStates.entries());
        await fs.writeFile(KIRO_OAUTH_STATE_FILE, JSON.stringify(statesObject, null, 2));
        logger.debug('[Kiro OAuth] OAuth states saved to file');
    } catch (error) {
        logger.error('[Kiro OAuth] Failed to save OAuth states', error);
    }
}
