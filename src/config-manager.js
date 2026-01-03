import * as fs from 'fs';
import { promises as pfs } from 'fs';
import { INPUT_SYSTEM_PROMPT_FILE, MODEL_PROVIDER } from './common.js';

export let CONFIG = {}; // Make CONFIG exportable
export let PROMPT_LOG_FILENAME = ''; // Make PROMPT_LOG_FILENAME exportable

// 账号池重构开关：
// - legacy: 兼容旧值（实际等同 account）
// - account: 使用 accounts/account_pool.json 逻辑
export const ACCOUNT_POOL_MODE = process.env.ACCOUNT_POOL_MODE || 'legacy';

const ALL_MODEL_PROVIDERS = Object.values(MODEL_PROVIDER);

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
            console.warn(`[Config Warning] Unknown model provider '${trimmed}'. This entry will be ignored.`);
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
 * Initializes the server configuration from config.json and command-line arguments.
 * @param {string[]} args - Command-line arguments.
 * @param {string} [configFilePath='configs/config.json'] - Path to the configuration file.
 * @returns {Object} The initialized configuration object.
 */
export async function initializeConfig(args = process.argv.slice(2), configFilePath = 'configs/config.json') {
    let currentConfig = {};
    let configFileExists = false;

    try {
        const configData = fs.readFileSync(configFilePath, 'utf8');
        currentConfig = JSON.parse(configData);
        configFileExists = true;
        console.log('[Config] Loaded configuration from config.json');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[Config] config.json not found, checking for config.json.example...');

            // 尝试从 config.json.example 复制
            try {
                if (fs.existsSync('configs/config.json.example')) {
                    const exampleData = fs.readFileSync('configs/config.json.example', 'utf8');
                    currentConfig = JSON.parse(exampleData);

                    // 创建 config.json
                    fs.writeFileSync(configFilePath, exampleData, 'utf8');
                    console.log('[Config] Created config.json from config.json.example');
                    console.log('[Config] ⚠️  Please edit config.json and set your REQUIRED_API_KEY');
                } else {
                    throw new Error('config.json.example not found');
                }
            } catch (exampleError) {
                console.log('[Config] config.json.example not found, creating default config.json...');

                // 使用默认配置
                currentConfig = {
                    REQUIRED_API_KEY: "123456",
                    SERVER_PORT: 8045,
                    HOST: '0.0.0.0',
                    MODEL_PROVIDER: MODEL_PROVIDER.KIRO_API,
                    ACCOUNT_POOL_MODE: 'legacy',
                    ACCOUNT_POOL_FILE_PATH: "./configs/account_pool.json",
                    KIRO_OAUTH_CREDS_BASE64: null,
                    SYSTEM_PROMPT_FILE_PATH: INPUT_SYSTEM_PROMPT_FILE,
                    SYSTEM_PROMPT_MODE: 'overwrite',
                    PROMPT_LOG_BASE_NAME: "prompt_log",
                    PROMPT_LOG_MODE: "none",
                    REQUEST_MAX_RETRIES: 8,
                    REQUEST_BASE_DELAY: 3000,
                    CRON_NEAR_MINUTES: 15,
                    CRON_REFRESH_TOKEN: true,
                    PROVIDER_POOLS_FILE_PATH: "./configs/provider_pools.json",
                    MAX_ERROR_COUNT: 5,
                    ENABLE_THINKING_BY_DEFAULT: true,
                    // SQLite 模式配置
                    USE_SQLITE_POOL: false,
                    SQLITE_DB_PATH: "data/provider_pool.db",
                    HEALTH_CHECK_CONCURRENCY: 5,
                    USAGE_QUERY_CONCURRENCY: 10
                };

                // 创建 config.json
                fs.writeFileSync(configFilePath, JSON.stringify(currentConfig, null, 2), 'utf8');
                console.log('[Config] Created default config.json');
                console.log('[Config] ⚠️  Please edit config.json and set your REQUIRED_API_KEY');
            }
        } else {
            console.error('[Config Error] Failed to load config.json:', error.message);
            // Fallback to default values if config.json is invalid
            currentConfig = {
                REQUIRED_API_KEY: "123456",
                SERVER_PORT: 8045,
                HOST: '0.0.0.0',
                MODEL_PROVIDER: MODEL_PROVIDER.KIRO_API,
                ACCOUNT_POOL_MODE: 'legacy',
                ACCOUNT_POOL_FILE_PATH: "./configs/account_pool.json",
                KIRO_OAUTH_CREDS_BASE64: null,
                SYSTEM_PROMPT_FILE_PATH: INPUT_SYSTEM_PROMPT_FILE,
                SYSTEM_PROMPT_MODE: 'overwrite',
                PROMPT_LOG_BASE_NAME: "prompt_log",
                PROMPT_LOG_MODE: "none",
                REQUEST_MAX_RETRIES: 8,
                REQUEST_BASE_DELAY: 3000,
                CRON_NEAR_MINUTES: 15,
                CRON_REFRESH_TOKEN: true,
                PROVIDER_POOLS_FILE_PATH: "./configs/provider_pools.json",
                MAX_ERROR_COUNT: 5,
                ENABLE_THINKING_BY_DEFAULT: true,
                // SQLite 模式配置
                USE_SQLITE_POOL: false,
                SQLITE_DB_PATH: "data/provider_pool.db",
                HEALTH_CHECK_CONCURRENCY: 5,
                USAGE_QUERY_CONCURRENCY: 10
            };
            console.log('[Config] Using default configuration.');
        }
    }

    // 确保 configs/kiro 目录存在
    if (!fs.existsSync('configs')) {
        fs.mkdirSync('configs', { recursive: true });
        console.log('[Config] Created configs directory');
    }
    if (!fs.existsSync('configs/kiro')) {
        fs.mkdirSync('configs/kiro', { recursive: true });
        console.log('[Config] Created configs/kiro directory');
    }

    // Parse command-line arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--api-key') {
            if (i + 1 < args.length) {
                currentConfig.REQUIRED_API_KEY = args[i + 1];
                i++;
            } else {
                console.warn(`[Config Warning] --api-key flag requires a value.`);
            }
        } else if (args[i] === '--log-prompts') {
            if (i + 1 < args.length) {
                const mode = args[i + 1];
                if (mode === 'console' || mode === 'file') {
                    currentConfig.PROMPT_LOG_MODE = mode;
                } else {
                    console.warn(`[Config Warning] Invalid mode for --log-prompts. Expected 'console' or 'file'. Prompt logging is disabled.`);
                }
                i++;
            } else {
                console.warn(`[Config Warning] --log-prompts flag requires a value.`);
            }
        } else if (args[i] === '--port') {
            if (i + 1 < args.length) {
                currentConfig.SERVER_PORT = parseInt(args[i + 1], 10);
                i++;
            } else {
                console.warn(`[Config Warning] --port flag requires a value.`);
            }
        } else if (args[i] === '--model-provider') {
            if (i + 1 < args.length) {
                currentConfig.MODEL_PROVIDER = args[i + 1];
                i++;
            } else {
                console.warn(`[Config Warning] --model-provider flag requires a value.`);
            }
        } else if (args[i] === '--system-prompt-file') {
            if (i + 1 < args.length) {
                currentConfig.SYSTEM_PROMPT_FILE_PATH = args[i + 1];
                i++;
            } else {
                console.warn(`[Config Warning] --system-prompt-file flag requires a value.`);
            }
        } else if (args[i] === '--system-prompt-mode') {
            if (i + 1 < args.length) {
                const mode = args[i + 1];
                if (mode === 'overwrite' || mode === 'append') {
                    currentConfig.SYSTEM_PROMPT_MODE = mode;
                } else {
                    console.warn(`[Config Warning] Invalid mode for --system-prompt-mode. Expected 'overwrite' or 'append'. Using default 'overwrite'.`);
                }
                i++;
            } else {
                console.warn(`[Config Warning] --system-prompt-mode flag requires a value.`);
            }
        } else if (args[i] === '--host') {
            if (i + 1 < args.length) {
                currentConfig.HOST = args[i + 1];
                i++;
            } else {
                console.warn(`[Config Warning] --host flag requires a value.`);
            }
        } else if (args[i] === '--prompt-log-base-name') {
            if (i + 1 < args.length) {
                currentConfig.PROMPT_LOG_BASE_NAME = args[i + 1];
                i++;
            } else {
                console.warn(`[Config Warning] --prompt-log-base-name flag requires a value.`);
            }
        } else if (args[i] === '--kiro-oauth-creds-base64') {
            if (i + 1 < args.length) {
                currentConfig.KIRO_OAUTH_CREDS_BASE64 = args[i + 1];
                i++;
            } else {
                console.warn(`[Config Warning] --kiro-oauth-creds-base64 flag requires a value.`);
            }
       } else if (args[i] === '--cron-near-minutes') {
            if (i + 1 < args.length) {
                currentConfig.CRON_NEAR_MINUTES = parseInt(args[i + 1], 10);
                i++;
            } else {
                console.warn(`[Config Warning] --cron-near-minutes flag requires a value.`);
            }
        } else if (args[i] === '--cron-refresh-token') {
            if (i + 1 < args.length) {
                currentConfig.CRON_REFRESH_TOKEN = args[i + 1].toLowerCase() === 'true';
                i++;
            } else {
                console.warn(`[Config Warning] --cron-refresh-token flag requires a value.`);
            }
        } else if (args[i] === '--provider-pools-file') {
            if (i + 1 < args.length) {
                currentConfig.PROVIDER_POOLS_FILE_PATH = args[i + 1];
                i++;
            } else {
                console.warn(`[Config Warning] --provider-pools-file flag requires a value.`);
            }
        } else if (args[i] === '--max-error-count') {
            if (i + 1 < args.length) {
                currentConfig.MAX_ERROR_COUNT = parseInt(args[i + 1], 10);
                i++;
            } else {
                console.warn(`[Config Warning] --max-error-count flag requires a value.`);
            }
        }
    }

    normalizeConfiguredProviders(currentConfig);

    // ACCOUNT_POOL_MODE 支持 env 覆盖，默认 legacy
    currentConfig.ACCOUNT_POOL_MODE = process.env.ACCOUNT_POOL_MODE || currentConfig.ACCOUNT_POOL_MODE || 'legacy';
    console.log(`[Config] ACCOUNT_POOL_MODE = ${currentConfig.ACCOUNT_POOL_MODE}`);

    if (!currentConfig.SYSTEM_PROMPT_FILE_PATH) {
        currentConfig.SYSTEM_PROMPT_FILE_PATH = INPUT_SYSTEM_PROMPT_FILE;
    }
    currentConfig.SYSTEM_PROMPT_CONTENT = await getSystemPromptFileContent(currentConfig.SYSTEM_PROMPT_FILE_PATH);

    // --- 账号池/号池配置加载（支持自动迁移） ---
    if (!currentConfig.PROVIDER_POOLS_FILE_PATH) {
        currentConfig.PROVIDER_POOLS_FILE_PATH = 'configs/provider_pools.json';
    }
    if (!currentConfig.ACCOUNT_POOL_FILE_PATH) {
        currentConfig.ACCOUNT_POOL_FILE_PATH = 'configs/account_pool.json';
    }

    const loadOrMigrateAccountPool = async () => {
        try {
            const accountData = await pfs.readFile(currentConfig.ACCOUNT_POOL_FILE_PATH, 'utf8');
            const parsed = JSON.parse(accountData);
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.accounts)) {
                throw new Error('Invalid account_pool.json format (expected { accounts: [] })');
            }
            return parsed;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(`[Config Error] Failed to load account pool from ${currentConfig.ACCOUNT_POOL_FILE_PATH}: ${error.message}`);
                return { accounts: [] };
            }
        }

        // account_pool.json 不存在：尝试从 provider_pools.json 迁移
        if (fs.existsSync(currentConfig.PROVIDER_POOLS_FILE_PATH)) {
            try {
                const legacyData = JSON.parse(fs.readFileSync(currentConfig.PROVIDER_POOLS_FILE_PATH, 'utf8'));
                const legacyAccounts = Array.isArray(legacyData?.['claude-kiro-oauth'])
                    ? legacyData['claude-kiro-oauth']
                    : [];

                // 基础校验：uuid 唯一 & 必填
                const seen = new Set();
                const accounts = [];
                for (const acc of legacyAccounts) {
                    if (!acc || typeof acc !== 'object') continue;
                    if (!acc.uuid || typeof acc.uuid !== 'string') {
                        console.warn('[Config] Skipping legacy account without uuid');
                        continue;
                    }
                    if (seen.has(acc.uuid)) {
                        console.warn(`[Config] Duplicate uuid in legacy pools, skipping: ${acc.uuid}`);
                        continue;
                    }
                    seen.add(acc.uuid);
                    accounts.push(acc);
                }

                const migrated = { accounts };
                const backupPath = `${currentConfig.PROVIDER_POOLS_FILE_PATH}.bak-${Date.now()}`;
                fs.copyFileSync(currentConfig.PROVIDER_POOLS_FILE_PATH, backupPath);
                fs.writeFileSync(currentConfig.ACCOUNT_POOL_FILE_PATH, JSON.stringify(migrated, null, 2), 'utf8');
                console.log(`[Config] Migrated provider_pools.json -> account_pool.json (backup: ${backupPath})`);
                return migrated;
            } catch (migrateError) {
                console.error(`[Config Error] Failed to migrate provider pools to account pool: ${migrateError.message}`);
                return { accounts: [] };
            }
        }

        // 无任何文件：创建空账号池文件（provider 层已移除，账号池为唯一入口）
        const emptyPool = { accounts: [] };
        fs.writeFileSync(currentConfig.ACCOUNT_POOL_FILE_PATH, JSON.stringify(emptyPool, null, 2), 'utf8');
        console.log(`[Config] Created empty ${currentConfig.ACCOUNT_POOL_FILE_PATH}`);
        return emptyPool;
    };

    currentConfig.accountPool = await loadOrMigrateAccountPool();
    console.log(`[Config] Loaded account pool (${currentConfig.accountPool.accounts.length} account(s)) from ${currentConfig.ACCOUNT_POOL_FILE_PATH}`);

    // Set PROMPT_LOG_FILENAME based on the determined config
    if (currentConfig.PROMPT_LOG_MODE === 'file') {
        const now = new Date();
        const pad = (num) => String(num).padStart(2, '0');
        const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        PROMPT_LOG_FILENAME = `${currentConfig.PROMPT_LOG_BASE_NAME}-${timestamp}.log`;
    } else {
        PROMPT_LOG_FILENAME = ''; // Clear if not logging to file
    }

    // Assign to the exported CONFIG
    Object.assign(CONFIG, currentConfig);
    return CONFIG;
}

/**
 * Gets system prompt content from the specified file path.
 * @param {string} filePath - Path to the system prompt file.
 * @returns {Promise<string|null>} File content, or null if the file does not exist, is empty, or an error occurs.
 */
export async function getSystemPromptFileContent(filePath) {
    try {
        await pfs.access(filePath, pfs.constants.F_OK);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`[System Prompt] Specified system prompt file not found: ${filePath}`);
        } else {
            console.error(`[System Prompt] Error accessing system prompt file ${filePath}: ${error.message}`);
        }
        return null;
    }

    try {
        const content = await pfs.readFile(filePath, 'utf8');
        if (!content.trim()) {
            return null;
        }
        console.log(`[System Prompt] Loaded system prompt from ${filePath}`);
        return content;
    } catch (error) {
        console.error(`[System Prompt] Error reading system prompt file ${filePath}: ${error.message}`);
        return null;
    }
}

export { ALL_MODEL_PROVIDERS };
