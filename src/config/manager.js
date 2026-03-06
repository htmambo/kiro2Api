/**
 * 配置管理模块
 *
 * 负责读取配置文件、合并默认配置、处理命令行参数并导出运行时配置。
 *
 * @module config/manager
 */
import * as fs from 'fs';
import { promises as pfs } from 'fs';
import { INPUT_SYSTEM_PROMPT_FILE, MODEL_PROVIDER } from '../utils/constants.js';
import { createLogger } from '../lib/logger.js';

export let CONFIG = {}; // 导出全局 CONFIG 供其他模块使用
export let PROMPT_LOG_FILENAME = ''; // 导出提示词日志文件名

const ALL_MODEL_PROVIDERS = Object.values(MODEL_PROVIDER);
const logger = createLogger('config:manager');

// 默认配置常量
const DEFAULT_CONFIG = {
    REQUIRED_API_KEY: "123456",
    SERVER_PORT: 8088,
    HOST: '0.0.0.0',
    MODEL_PROVIDER: MODEL_PROVIDER.KIRO_API,
    ACCOUNT_POOL_FILE_PATH: "./configs/runtime/account_pool.json",
    KIRO_OAUTH_CREDS_BASE64: null,
    SYSTEM_PROMPT_FILE_PATH: INPUT_SYSTEM_PROMPT_FILE,
    SYSTEM_PROMPT_MODE: 'overwrite',
    PROMPT_LOG_BASE_NAME: "prompt_log",
    PROMPT_LOG_MODE: "none",
    REQUEST_MAX_RETRIES: 8,
    REQUEST_BASE_DELAY: 3000,
    REQUEST_RATE_LIMIT_WINDOW_MS: 60000,
    REQUEST_RATE_LIMIT_MAX_REQUESTS: 60,
    REQUEST_RATE_LIMIT_WHITELIST_PATHS: [
        '/health',
        '/api/health',
        '/favicon.ico',
        '/public/',
        '/static/',
        '/assets/',
        '/_next/',
        '/static-site/'
    ],
    REQUEST_RATE_LIMIT_TRUSTED_PROXIES: [],
    REQUEST_MAX_BODY_BYTES: 10 * 1024 * 1024,
    KIRO_REQUEST_TIMEOUT_MS: 120000,
    KIRO_STREAM_TIMEOUT_MS: 180000,
    CRON_NEAR_MINUTES: 15,
    CRON_REFRESH_TOKEN: true,
    MAX_ERROR_COUNT: 5,
    ENABLE_THINKING_BY_DEFAULT: true,
    // SQLite 模式配置
    USE_SQLITE_POOL: false,
    SQLITE_DB_PATH: "data/kiro2api.db",
    HEALTH_CHECK_CONCURRENCY: 5,
    USAGE_QUERY_CONCURRENCY: 10,
    LOG_UNMATCHED_ROUTES: false
};

/**
 * 规范化配置中的模型提供商列表
 *
 * @param {Object} config - 当前配置对象
 * @returns {void}
 */
function normalizeConfiguredProviders(config) {
    const fallbackProvider = MODEL_PROVIDER.KIRO_API;
    const dedupedProviders = [];

    const addProvider = (value) => {
        if (typeof value !== 'string') {
            return;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            return;
        }
        const matched = ALL_MODEL_PROVIDERS.find((provider) => provider.toLowerCase() === trimmed.toLowerCase());
        if (!matched) {
            logger.warn(`Unknown model provider '${trimmed}'. This entry will be ignored.`);
            return;
        }
        if (!dedupedProviders.includes(matched)) {
            dedupedProviders.push(matched);
        }
    };

    const rawValue = config.MODEL_PROVIDER;
    if (Array.isArray(rawValue)) {
        rawValue.forEach((entry) => addProvider(typeof entry === 'string' ? entry : String(entry)));
    } else if (typeof rawValue === 'string') {
        rawValue.split(',').forEach(addProvider);
    } else if (rawValue != null) {
        addProvider(String(rawValue));
    }

    if (dedupedProviders.length === 0) {
        dedupedProviders.push(fallbackProvider);
    }

    config.DEFAULT_MODEL_PROVIDERS = dedupedProviders;
    config.MODEL_PROVIDER = dedupedProviders[0];
}

/**
 * 从 config.json 与命令行参数初始化配置
 *
 * @param {string[]} args - 命令行参数
 * @param {string} [configFilePath='configs/runtime/config.json'] - 配置文件路径
 */
export async function initializeConfig(args = process.argv.slice(2), configFilePath = 'configs/runtime/config.json') {
    let currentConfig = {};

    try {
        const configData = fs.readFileSync(configFilePath, 'utf8');
        currentConfig = JSON.parse(configData);
        logger.info('Loaded configuration from config.json');
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.info('config.json not found, checking for config.json.example...');

            // 尝试从 config.json.example 复制
            try {
                if (fs.existsSync('configs/templates/config.json.example')) {
                    const exampleData = fs.readFileSync('configs/templates/config.json.example', 'utf8');
                    currentConfig = JSON.parse(exampleData);

                    // 创建 config.json
                    fs.writeFileSync(configFilePath, exampleData, 'utf8');
                    logger.info('Created config.json from config.json.example');
                    logger.info('⚠️  Please edit config.json and set your REQUIRED_API_KEY');
                } else {
                    throw new Error('config.json.example not found');
                }
            } catch (exampleError) {
                logger.info('config.json.example not found, creating default config.json...');

                // 使用默认配置
                currentConfig = { ...DEFAULT_CONFIG };

                // 创建 config.json
                fs.writeFileSync(configFilePath, JSON.stringify(currentConfig, null, 2), 'utf8');
                logger.info('Created default config.json');
                logger.info('⚠️  Please edit config.json and set your REQUIRED_API_KEY');
            }
        } else {
            logger.error('Failed to load config.json:', error.message);
            // 配置文件无效时回退到默认配置
            currentConfig = { ...DEFAULT_CONFIG };
            logger.info('Using default configuration.');
        }
    }

    // 确保 configs/kiro 目录存在
    if (!fs.existsSync('configs')) {
        fs.mkdirSync('configs', { recursive: true });
        logger.info('Created configs directory');
    }
    if (!fs.existsSync('configs/kiro')) {
        fs.mkdirSync('configs/kiro', { recursive: true });
        logger.info('Created configs/kiro directory');
    }

    currentConfig.OPEN_SERVER_URL  = true;
    // 解析命令行参数
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--api-key') {
            if (i + 1 < args.length) {
                currentConfig.REQUIRED_API_KEY = args[i + 1];
                i++;
            } else {
                logger.warn(`--api-key flag requires a value.`);
            }
        } else if (args[i] === '--log-prompts') {
            if (i + 1 < args.length) {
                const mode = args[i + 1];
                if (mode === 'console' || mode === 'file') {
                    currentConfig.PROMPT_LOG_MODE = mode;
                } else {
                    logger.warn(`Invalid mode for --log-prompts. Expected 'console' or 'file'. Prompt logging is disabled.`);
                }
                i++;
            } else {
                logger.warn(`--log-prompts flag requires a value.`);
            }
        } else if (args[i] === '--port') {
            if (i + 1 < args.length) {
                currentConfig.SERVER_PORT = parseInt(args[i + 1], 10);
                i++;
            } else {
                logger.warn(`--port flag requires a value.`);
            }
        } else if (args[i] === '--model-provider') {
            if (i + 1 < args.length) {
                currentConfig.MODEL_PROVIDER = args[i + 1];
                i++;
            } else {
                logger.warn(`--model-provider flag requires a value.`);
            }
        } else if (args[i] === '--system-prompt-file') {
            if (i + 1 < args.length) {
                currentConfig.SYSTEM_PROMPT_FILE_PATH = args[i + 1];
                i++;
            } else {
                logger.warn(`--system-prompt-file flag requires a value.`);
            }
        } else if (args[i] === '--system-prompt-mode') {
            if (i + 1 < args.length) {
                const mode = args[i + 1];
                if (mode === 'overwrite' || mode === 'append') {
                    currentConfig.SYSTEM_PROMPT_MODE = mode;
                } else {
                    logger.warn(`Invalid mode for --system-prompt-mode. Expected 'overwrite' or 'append'. Using default 'overwrite'.`);
                }
                i++;
            } else {
                logger.warn(`--system-prompt-mode flag requires a value.`);
            }
        } else if (args[i] === '--host') {
            if (i + 1 < args.length) {
                currentConfig.HOST = args[i + 1];
                i++;
            } else {
                logger.warn(`--host flag requires a value.`);
            }
        } else if (args[i] === '--prompt-log-base-name') {
            if (i + 1 < args.length) {
                currentConfig.PROMPT_LOG_BASE_NAME = args[i + 1];
                i++;
            } else {
                logger.warn(`--prompt-log-base-name flag requires a value.`);
            }
       } else if (args[i] === '--cron-near-minutes') {
            if (i + 1 < args.length) {
                currentConfig.CRON_NEAR_MINUTES = parseInt(args[i + 1], 10);
                i++;
            } else {
                logger.warn(`--cron-near-minutes flag requires a value.`);
            }
        } else if (args[i] === '--cron-refresh-token') {
            if (i + 1 < args.length) {
                currentConfig.CRON_REFRESH_TOKEN = args[i + 1].toLowerCase() === 'true';
                i++;
            } else {
                logger.warn(`--cron-refresh-token flag requires a value.`);
            }
        } else if (args[i] === '--max-error-count') {
            if (i + 1 < args.length) {
                currentConfig.MAX_ERROR_COUNT = parseInt(args[i + 1], 10);
                i++;
            } else {
                logger.warn(`--max-error-count flag requires a value.`);
            }
        } else if (args[i] === '--disableopenserverurl') {
            currentConfig.OPEN_SERVER_URL  = false;
        }
    }

    normalizeConfiguredProviders(currentConfig);
    
    if (!currentConfig.SYSTEM_PROMPT_FILE_PATH) {
        currentConfig.SYSTEM_PROMPT_FILE_PATH = INPUT_SYSTEM_PROMPT_FILE;
    }
    currentConfig.SYSTEM_PROMPT_CONTENT = await getSystemPromptFileContent(currentConfig.SYSTEM_PROMPT_FILE_PATH);

    if (!currentConfig.ACCOUNT_POOL_FILE_PATH) {
        currentConfig.ACCOUNT_POOL_FILE_PATH = 'configs/runtime/account_pool.json';
    }

    if (currentConfig.LOG_UNMATCHED_ROUTES === undefined) {
        const envValue = process.env.LOG_UNMATCHED_ROUTES;
        if (envValue !== undefined) {
            currentConfig.LOG_UNMATCHED_ROUTES = envValue.toLowerCase() === 'true';
        }
    }

    // 根据配置生成 PROMPT_LOG_FILENAME
    if (currentConfig.PROMPT_LOG_MODE === 'file') {
        const now = new Date();
        const pad = (num) => String(num).padStart(2, '0');
        const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        PROMPT_LOG_FILENAME = `${currentConfig.PROMPT_LOG_BASE_NAME}-${timestamp}.log`;
    } else {
        PROMPT_LOG_FILENAME = '';
    }

    // Load Redis configuration from environment variables
    currentConfig.REDIS_ENABLED = process.env.REDIS_ENABLED === 'true';
    currentConfig.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
    currentConfig.REDIS_PORT = parseInt(process.env.REDIS_PORT, 10) || 6379;
    currentConfig.REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';
    currentConfig.REDIS_DB = parseInt(process.env.REDIS_DB, 10) || 0;
    currentConfig.REDIS_URL = process.env.REDIS_URL || '';
    currentConfig.CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS || '';
    currentConfig.ALLOW_WEAK_API_KEY = process.env.ALLOW_WEAK_API_KEY;

    // Assign to the exported CONFIG
    Object.assign(CONFIG, currentConfig);
    return CONFIG;
}

/**
 * 从指定文件路径读取系统提示词内容。
 * @param {string} filePath - 系统提示词文件路径。
 * @returns {Promise<string|null>} 文件内容；不存在、为空或读取失败则返回 null。
 */
export async function getSystemPromptFileContent(filePath) {
    try {
        await pfs.access(filePath, pfs.constants.F_OK);
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.warn(`Specified system prompt file not found: ${filePath}`);
        } else {
            logger.error(`Error accessing system prompt file ${filePath}: ${error.message}`);
        }
        return null;
    }

    try {
        const content = await pfs.readFile(filePath, 'utf8');
        if (!content.trim()) {
            return null;
        }
        logger.info(`Loaded system prompt from ${filePath}`);
        return content;
    } catch (error) {
        logger.error(`Error reading system prompt file ${filePath}: ${error.message}`);
        return null;
    }
}

export { ALL_MODEL_PROVIDERS };
