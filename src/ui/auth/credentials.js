import crypto from 'crypto';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('ui:auth:credentials');
const DEFAULT_UI_PASSWORD = 'admin';
const MIN_UI_PASSWORD_LENGTH = 8;

let hasWarnedDefaultPassword = false;
let hasWarnedWeakPassword = false;

function getEnvUiPassword() {
    if (typeof process.env.UI_PASSWORD !== 'string') return '';
    return process.env.UI_PASSWORD.trim();
}

function warnDefaultPasswordOnce() {
    if (hasWarnedDefaultPassword) return;
    hasWarnedDefaultPassword = true;

    logger.warn('━'.repeat(70));
    logger.warn('⚠️  安全警告 ⚠️');
    logger.warn('');
    logger.warn('检测到 UI 使用默认密码 "admin"');
    logger.warn('默认密码存在严重安全风险，容易被未授权访问');
    logger.warn('');
    logger.warn('建议操作：');
    logger.warn('  1. 设置环境变量 UI_PASSWORD 为强密码（至少 8 位）');
    logger.warn('  2. 或使用 scrypt 哈希格式存储密码');
    logger.warn('');
    logger.warn('示例：export UI_PASSWORD="your-strong-password-here"');
    logger.warn('━'.repeat(70));
}

function warnWeakPasswordOnce(password) {
    if (hasWarnedWeakPassword) return;
    hasWarnedWeakPassword = true;

    logger.warn('━'.repeat(70));
    logger.warn('⚠️  密码强度不足 ⚠️');
    logger.warn('');
    logger.warn(`当前 UI 密码长度仅为 ${password.length} 位，低于建议的 ${MIN_UI_PASSWORD_LENGTH} 位`);
    logger.warn('弱密码容易被暴力破解，建议使用更强的密码');
    logger.warn('');
    logger.warn('建议：');
    logger.warn('  • 使用至少 8 位密码');
    logger.warn('  • 包含大小写字母、数字和特殊字符');
    logger.warn('  • 避免使用常见单词或模式');
    logger.warn('━'.repeat(70));
}

function getConfiguredPassword() {
    const envPassword = getEnvUiPassword();
    if (envPassword) {
        return {
            password: envPassword,
            source: 'env'
        };
    }

    return {
        password: DEFAULT_UI_PASSWORD,
        source: 'default'
    };
}

export function checkUiPasswordOnStartup() {
    const { password: configuredPassword, source } = getConfiguredPassword();
    const isProduction = process.env.NODE_ENV === 'production';

    if (source === 'default' || configuredPassword === DEFAULT_UI_PASSWORD) {
        warnDefaultPasswordOnce();

        if (isProduction && source === 'default') {
            logger.error('');
            logger.error('🚨 生产环境安全要求 🚨');
            logger.error('生产环境必须配置 UI_PASSWORD 环境变量');
            logger.error('当前配置将导致无法登录管理界面');
            logger.error('');
            logger.error('请立即设置：export UI_PASSWORD="your-strong-password"');
            logger.error('');
        }
    }

    if (configuredPassword && !configuredPassword.startsWith('scrypt$') && configuredPassword.length < MIN_UI_PASSWORD_LENGTH) {
        warnWeakPasswordOnce(configuredPassword);

        if (isProduction) {
            logger.error('生产环境建议使用至少 8 位强密码');
        }
    }

    if (configuredPassword && configuredPassword !== DEFAULT_UI_PASSWORD) {
        const fromText = source === 'env' ? '环境变量' : '默认值';
        logger.info(`✓ UI 密码已配置（来源：${fromText}）`);
    }
}

async function readPassword() {
    try {
        const { password: resolvedPassword, source } = getConfiguredPassword();
        const isProduction = process.env.NODE_ENV === 'production';

        if (isProduction && source === 'default') {
            logger.error('[UI] 生产环境未配置 UI_PASSWORD，拒绝使用默认密码');
            return null;
        }

        if (isProduction && resolvedPassword === DEFAULT_UI_PASSWORD) {
            logger.error('[UI] 生产环境禁止使用默认密码 "admin"，请设置强密码');
            return null;
        }

        if (isProduction && resolvedPassword && !resolvedPassword.startsWith('scrypt$') && resolvedPassword.length < MIN_UI_PASSWORD_LENGTH) {
            logger.error(`[UI] 生产环境要求密码至少 ${MIN_UI_PASSWORD_LENGTH} 位，当前密码长度不足`);
            return null;
        }

        return resolvedPassword;
    } catch (error) {
        logger.error('读取密码配置失败', error);
        return null;
    }
}

export async function validateCredentials(password) {
    const storedPassword = await readPassword();
    if (!storedPassword || typeof password !== 'string') {
        return false;
    }

    if (!storedPassword.startsWith('scrypt$') && storedPassword.length < MIN_UI_PASSWORD_LENGTH) {
        warnWeakPasswordOnce(storedPassword);
    }

    if (storedPassword.startsWith('scrypt$')) {
        const parts = storedPassword.split('$');
        if (parts.length !== 3) return false;
        try {
            const salt = Buffer.from(parts[1], 'base64');
            const expected = Buffer.from(parts[2], 'base64');
            const derived = await new Promise((resolve, reject) => {
                crypto.scrypt(password, salt, expected.length, { N: 16384, r: 8, p: 1 }, (error, buffer) => {
                    if (error) return reject(error);
                    resolve(buffer);
                });
            });
            return crypto.timingSafeEqual(Buffer.from(derived), expected);
        } catch {
            return false;
        }
    }

    try {
        const providedBuffer = Buffer.from(password);
        const storedBuffer = Buffer.from(storedPassword);
        if (providedBuffer.length !== storedBuffer.length) {
            return false;
        }
        return crypto.timingSafeEqual(providedBuffer, storedBuffer);
    } catch {
        return false;
    }
}
