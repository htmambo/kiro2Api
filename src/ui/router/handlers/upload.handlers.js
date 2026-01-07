/**
 * 上传 Handler 实现
 * 处理文件上传和配置文件管理
 */
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { createLogger } from '../../../lib/logger.js';

const logger = createLogger('ui:handlers:upload');

/**
 * Helper function to attempt quick link for a single file
 * Extracted from ui-manager.js for reusability
 */
async function attemptQuickLinkFile(filePath, accountPoolManager) {
    if (!filePath) {
        return { success: false, message: 'filePath is required' };
    }

    try {
        // Import dependencies
        const { DEFAULT_PROVIDER_TYPE_FOR_ACCOUNTS } = await import('../../../ui-manager.js');
        const { KIRO_MODELS } = await import('../../../kiro/constants.js');
        const { createProviderConfig, formatSystemPath } = await import('../../../utils/account-utils.js');
        const { broadcastEvent } = await import('../../events.js');

        // Defaults for Kiro OAuth
        const providerType = DEFAULT_PROVIDER_TYPE_FOR_ACCOUNTS;
        const credPathKey = 'KIRO_OAUTH_CREDS_FILE_PATH';
        const defaultCheckModel = KIRO_MODELS[0];
        const displayName = 'Claude Kiro Account';
        const needsProjectId = false;

        // Check if already linked
        const targetAbsPath = path.resolve(process.cwd(), filePath);
        const accounts = accountPoolManager.listAccounts();
        const isAlreadyLinked = accounts.some(p => {
            const existingPath = p.path || p[credPathKey]; // Support both key formats
            if (!existingPath) return false;
            const existingAbsPath = path.resolve(process.cwd(), existingPath);
            return existingAbsPath.toLowerCase() === targetAbsPath.toLowerCase();
        });

        if (isAlreadyLinked) {
            return { success: false, message: '该配置文件已关联', alreadyLinked: true };
        }

        // Create new provider config based on provider type
        const newProviderConfig = createProviderConfig({
            credPathKey,
            credPath: formatSystemPath(filePath),
            defaultCheckModel,
            needsProjectId
        });

        // Add account through AccountPoolManager
        const newProvider = accountPoolManager.addAccount(newProviderConfig);
        logger.info(`[UI API] Quick linked config: ${filePath}`);

        // Broadcast update event
        broadcastEvent('config_update', {
            action: 'quick_link',
            filePath: filePath,
            newProvider,
            timestamp: new Date().toISOString()
        });

        broadcastEvent('provider_update', {
            action: 'add',
            providerConfig: newProvider,
            timestamp: new Date().toISOString()
        });

        return {
            success: true,
            message: `配置已成功关联到 ${displayName}`,
            provider: newProvider,
            providerType: providerType
        };
    } catch (error) {
        logger.error(`[UI API] Quick link for ${filePath} failed:`, error);
        return { success: false, message: '关联失败: ' + error.message };
    }
}


/**
 * 上传 OAuth 凭据文件
 */
export async function uploadCredentials({ req, res, currentConfig }) {
    try {
        const { broadcastEvent } = await import('../../events.js');

        // multer执行完成后，表单字段已解析到req.body中
        const provider = req.body.provider || 'common';
        const tempFilePath = req.file.path;

        // 根据实际的provider移动文件到正确的目录
        let targetDir = path.join(process.cwd(), 'configs', provider);

        // 如果是kiro类型的凭证，需要再包裹一层文件夹
        if (provider === 'kiro') {
            // 使用时间戳作为子文件夹名称，确保每个上传的文件都有独立的目录
            const timestamp = Date.now();
            const originalNameWithoutExt = path.parse(req.file.originalname).name;
            const subFolder = `${timestamp}_${originalNameWithoutExt}`;
            targetDir = path.join(targetDir, subFolder);
        }

        await fs.mkdir(targetDir, { recursive: true });

        const targetFilePath = path.join(targetDir, req.file.filename);
        await fs.rename(tempFilePath, targetFilePath);

        const relativePath = path.relative(process.cwd(), targetFilePath);

        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'add',
            filePath: relativePath,
            provider: provider,
            timestamp: new Date().toISOString()
        });

        logger.info(`[Upload] OAuth凭据文件已上传: ${targetFilePath} (提供商: ${provider})`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: '文件上传成功',
            filePath: relativePath,
            originalName: req.file.originalname,
            provider: provider
        }));

    } catch (error) {
        logger.error('[Upload] 文件上传处理错误:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: '文件上传处理失败: ' + error.message
            }
        }));
    }
}

/**
 * 获取上传配置文件列表
 */
export async function getUploadConfigs({ res, currentConfig, accountPoolManager }) {
    try {
        const configFiles = await scanConfigFiles(currentConfig, accountPoolManager);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(configFiles));
    } catch (error) {
        logger.error('[UI API] Failed to scan config files:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: 'Failed to scan config files: ' + error.message }
        }));
    }
}

/**
 * 查看配置文件
 */
export async function viewConfig({ res, match }) {
    try {
        const filePath = decodeURIComponent(match[1]);
        const fullPath = path.join(process.cwd(), filePath);

        // 安全检查
        const allowedDirs = ['configs'];
        const relativePath = path.relative(process.cwd(), fullPath);
        const isAllowed = allowedDirs.some(dir => relativePath.startsWith(dir + path.sep) || relativePath === dir);

        if (!isAllowed) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: '访问被拒绝：只能查看configs目录下的文件' }
            }));
            return;
        }

        if (!existsSync(fullPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: '文件不存在' } }));
            return;
        }

        const content = await fs.readFile(fullPath, 'utf8');
        const stats = await fs.stat(fullPath);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            path: relativePath,
            content: content,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            name: path.basename(fullPath)
        }));
    } catch (error) {
        logger.error('[UI API] Failed to view config file:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: 'Failed to view config file: ' + error.message }
        }));
    }
}

/**
 * 删除配置文件
 */
export async function deleteConfig({ res, match }) {
    const { broadcastEvent } = await import('../../events.js');

    try {
        const filePath = decodeURIComponent(match[1]);
        const fullPath = path.join(process.cwd(), filePath);

        // 安全检查
        const allowedDirs = ['configs'];
        const relativePath = path.relative(process.cwd(), fullPath);
        const isAllowed = allowedDirs.some(dir => relativePath.startsWith(dir + path.sep) || relativePath === dir);

        if (!isAllowed) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: '访问被拒绝：只能删除configs目录下的文件' }
            }));
            return;
        }

        if (!existsSync(fullPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: '文件不存在' } }));
            return;
        }

        await fs.unlink(fullPath);

        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'delete',
            filePath: relativePath,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: '文件删除成功',
            filePath: relativePath
        }));
    } catch (error) {
        logger.error('[UI API] Failed to delete config file:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: 'Failed to delete config file: ' + error.message }
        }));
    }
}

/**
 * 快速关联配置文件
 */
export async function quickLink({ req, res, accountPoolManager }) {
    const { getRequestBody } = await import('../../../utils/common.js');

    try {
        const body = await getRequestBody(req);
        const { filePath } = body;

        const result = await attemptQuickLinkFile(filePath, accountPoolManager);

        if (!result.success) {
            res.writeHead(result.alreadyLinked ? 400 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: result.message } }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: result.message,
            provider: result.provider,
            providerType: result.providerType
        }));
    } catch (error) {
        logger.error('[UI API] Quick link failed:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: '关联失败: ' + error.message }
        }));
    }
}

/**
 * 批量快速关联
 */
export async function bulkQuickLink({ req, res, accountPoolManager }) {
    const { getRequestBody } = await import('../../../utils/common.js');

    try {
        const body = await getRequestBody(req);
        const { filePaths } = body;

        if (!Array.isArray(filePaths) || filePaths.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: '需要提供至少一个文件路径' } }));
            return;
        }

        const uniquePaths = Array.from(new Set(filePaths.filter(Boolean)));

        logger.info(`[UI API] Bulk quick link started for ${uniquePaths.length} files`);

        const results = await Promise.all(uniquePaths.map(async filePath => {
            const result = await attemptQuickLinkFile(filePath, accountPoolManager);
            return {
                filePath,
                success: result.success,
                message: result.message,
                alreadyLinked: result.alreadyLinked || false,
                provider: result.provider || null
            };
        }));

        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success && !r.alreadyLinked).length;
        const skippedCount = results.filter(r => r.alreadyLinked).length;

        logger.info(`[UI API] Bulk quick link completed: ${successCount} succeeded, ${failureCount} failed, ${skippedCount} skipped`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: `批量关联完成：成功 ${successCount} 个，失败 ${failureCount} 个，已关联 ${skippedCount} 个`,
            summary: {
                attempted: uniquePaths.length,
                successCount,
                failureCount,
                skippedCount
            },
            results
        }));
    } catch (error) {
        logger.error('[UI API] Bulk quick link failed:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: '批量关联失败: ' + error.message }
        }));
    }
}

/**
 * 标准化路径，用于跨平台兼容
 * @param {string} filePath - 文件路径
 * @returns {string} 使用正斜杠的标准化路径
 */
function normalizePath(filePath) {
    if (!filePath) return filePath;
    
    // 使用 path 模块标准化，然后转换为正斜杠
    const normalized = path.normalize(filePath);
    return normalized.replace(/\\/g, '/');
}

/**
 * 检查两个路径是否指向同一文件（跨平台兼容）
 * @param {string} path1 - 第一个路径
 * @param {string} path2 - 第二个路径
 * @returns {boolean} 如果路径指向同一文件则返回 true
 */
function pathsEqual(path1, path2) {
    if (!path1 || !path2) return false;
    
    try {
        // 标准化两个路径
        const normalized1 = normalizePath(path1);
        const normalized2 = normalizePath(path2);
        
        // 直接匹配
        if (normalized1 === normalized2) {
            return true;
        }
        
        // 移除开头的 './' 后比较
        const clean1 = normalized1.replace(/^\.\//, '');
        const clean2 = normalized2.replace(/^\.\//, '');
        
        if (clean1 === clean2) {
            return true;
        }
        
        // 检查一个是否是另一个的子集（用于相对路径与绝对路径比较）
        if (normalized1.endsWith('/' + clean2) || normalized2.endsWith('/' + clean1)) {
            return true;
        }
        
        return false;
    } catch (error) {
        logger.warn(`[Path Comparison] Error comparing paths: ${path1} vs ${path2} ${error.message}`);
        return false;
    }
}

/**
 * 从路径中提取文件名
 * @param {string} filePath - 文件路径
 * @returns {string} 文件名
 */
function getFileName(filePath) {
    return path.basename(filePath);
}

/**
 * 检查文件路径是否正在被使用（跨平台兼容）
 * @param {string} relativePath - 相对路径
 * @param {string} fileName - 文件名
 * @param {Set} usedPaths - 已使用路径的集合
 * @returns {boolean} 如果文件正在被使用则返回 true
 */
function isPathUsed(relativePath, fileName, usedPaths) {
    if (!relativePath) return false;

    // 标准化相对路径
    const normalizedRelativePath = normalizePath(relativePath);
    const cleanRelativePath = normalizedRelativePath.replace(/^\.\//, '');
    
    // 从相对路径获取文件名
    const relativeFileName = getFileName(normalizedRelativePath);
    
    // 遍历所有已使用路径进行匹配
    for (const usedPath of usedPaths) {
        if (!usedPath) continue;
        
        // 1. 直接路径匹配
        if (pathsEqual(relativePath, usedPath) || pathsEqual(relativePath, './' + usedPath)) {
            return true;
        }
        
        // 2. 标准化路径匹配
        if (pathsEqual(normalizedRelativePath, usedPath) ||
            pathsEqual(normalizedRelativePath, './' + usedPath)) {
            return true;
        }
        
        // 3. 清理后的路径匹配
        if (pathsEqual(cleanRelativePath, usedPath) ||
            pathsEqual(cleanRelativePath, './' + usedPath)) {
            return true;
        }
        
        // 4. 文件名匹配（确保不是误匹配）
        const usedFileName = getFileName(usedPath);
        if (usedFileName === fileName || usedFileName === relativeFileName) {
            // 确保是同一个目录下的文件
            const usedDir = path.dirname(usedPath);
            const relativeDir = path.dirname(normalizedRelativePath);
            
            if (pathsEqual(usedDir, relativeDir) ||
                pathsEqual(usedDir, cleanRelativePath.replace(/\/[^\/]+$/, '')) ||
                pathsEqual(relativeDir.replace(/^\.\//, ''), usedDir.replace(/^\.\//, ''))) {
                return true;
            }
        }
        
        // 5. 绝对路径匹配（Windows 和 Unix）
        try {
            const resolvedUsedPath = path.resolve(usedPath);
            const resolvedRelativePath = path.resolve(relativePath);
            
            if (resolvedUsedPath === resolvedRelativePath) {
                return true;
            }
        } catch (error) {
            // 忽略路径解析错误
        }
    }
    
    return false;
}

async function scanConfigFiles(currentConfig, accountPoolManager) {
    const configFiles = [];
    
    // 只扫描configs目录
    const configsPath = path.join(process.cwd(), 'configs');
    
    if (!existsSync(configsPath)) {
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
        const { addToUsedPaths } = await import('../../../utils/account-utils.js');
        for (const account of accounts) {
            addToUsedPaths(usedPaths, account.KIRO_OAUTH_CREDS_FILE_PATH);
        }
    }

    try {
        // 扫描configs目录下的所有子目录和文件
        const configsFiles = await scanOAuthDirectory(configsPath, usedPaths, currentConfig);
        configFiles.push(...configsFiles);
    } catch (error) {
        logger.warn(`[Config Scanner] Failed to scan configs directory: ${error.message}`);
    }

    return configFiles;
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
    // const path = await import('path');
    // const { promises: fs, existsSync } = await import('fs');
    
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
        logger.warn(`[OAuth Scanner] Failed to scan directory ${dirPath}: ${error.message}`);
    }
    
    return oauthFiles;
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
        logger.warn(`[OAuth Analyzer] Failed to analyze file ${filePath}: ${error.message}`);
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
        logger.warn(`[OAuth Analyzer] Checking provider pools for file ${relativePath}`);
        logger.warn(`[OAuth Analyzer] Provider pools: ${JSON.stringify(currentConfig.providerPools)}`);
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
                usageInfo.usageType = 'account_pool';
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
