import { serviceInstances } from '../kiro/adapter.js';
import { CONFIG } from '../config/manager.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('ui:config-reloader');

// 依赖注入：账号服务初始化器
let accountServiceInitializer = null;

/**
 * 注册账号服务初始化器（由 api/server 调用）
 * @param {Function} fn - 初始化函数
 */
export function registerAccountServiceInitializer(fn) {
    accountServiceInitializer = fn;
    logger.info('[Config Reloader] Account service initializer registered');
}

/**
 * 获取已注册的账号服务初始化器
 * @returns {Function|null}
 */
export function getAccountServiceInitializer() {
    return accountServiceInitializer;
}

/**
 * 重载配置文件
 * 动态导入 config-manager 并重新初始化配置
 * @returns {Promise<Object>} 返回重载后的配置对象
 */
export async function reloadConfig() {
    try {
        // Import config manager dynamically
        const { initializeConfig } = await import('../config/manager.js');

        // Reload main config
        const newConfig = await initializeConfig(process.argv.slice(2), './configs/config.json');

        // Update global CONFIG
        Object.assign(CONFIG, newConfig);
        logger.info('[Config Reloader] Configuration reloaded:');

        // 清理旧的服务实例
        Object.keys(serviceInstances).forEach(key => delete serviceInstances[key]);

        // 使用注册的初始化器重新初始化账号服务
        if (accountServiceInitializer) {
            await accountServiceInitializer(CONFIG);
            logger.info('[Config Reloader] Account service reinitialized via registered initializer');
        } else {
            logger.warn('[Config Reloader] No account service initializer registered, skipping account service reinitialization');
        }

        logger.info('[Config Reloader] Configuration reloaded successfully');

        return newConfig;
    } catch (error) {
        logger.error('[Config Reloader] Failed to reload configuration', error);
        throw error;
    }
}
