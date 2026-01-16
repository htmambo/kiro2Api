/**
 * 账号工具模块
 *
 * 包含 ui-manager.js 等共用的工具函数。
 *
 * @module utils/account-utils
 */

import * as path from 'path';
import { promises as fs } from 'fs';

/**
 * 生成 UUID
 *
 * @returns {string} UUID 字符串
 */
export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 格式化相对路径为当前系统的路径格式
 *
 * @param {string} relativePath - 相对路径
 * @returns {string} 格式化后的路径（带有 ./ 或 .\ 前缀）
 */
export function formatSystemPath(relativePath) {
    if (!relativePath) return relativePath;
    
    // 根据操作系统判断使用对应的路径分隔符
    const isWindows = process.platform === 'win32';
    const separator = isWindows ? '\\' : '/';
    // 统一转换路径分隔符为当前系统的分隔符
    const systemPath = relativePath.replace(/[\/\\]/g, separator);
    return systemPath.startsWith('.' + separator) ? systemPath : '.' + separator + systemPath;
}

/**
 * 根据文件路径检测提供商类型
 *
 * @param {string} normalizedPath - 标准化的文件路径（小写，正斜杠）
 * @returns {Object|null} 提供商映射对象，如果未检测到则返回 null
 */
export function detectProviderFromPath(normalizedPath) {
    // 提供商层已移除：保留函数签名用于兼容旧代码路径（返回 null）
    return null;
}

/**
 * 根据目录名获取提供商映射
 *
 * @param {string} dirName - 目录名称
 * @returns {Object|null} 提供商映射对象，如果未找到则返回 null
 */
export function getProviderMappingByDirName(dirName) {
    // 提供商层已移除：保留函数签名用于兼容旧代码路径（返回 null）
    return null;
}

/**
 * 验证文件是否是有效的 OAuth 凭据文件
 *
 * @param {string} filePath - 文件路径
 * @returns {Promise<boolean>} 是否有效
 */
export async function isValidOAuthCredentials(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const jsonData = JSON.parse(content);
        
        // 检查是否包含 OAuth 相关字段
        // 凭据通常包含 access_token/accessToken, refresh_token/refreshToken, client_id 等字段
        // 支持下划线命名（access_token）和驼峰命名（accessToken）两种格式
        if (jsonData.access_token || jsonData.refresh_token ||
            jsonData.accessToken || jsonData.refreshToken ||
            jsonData.client_id || jsonData.client_secret ||
            jsonData.token || jsonData.credentials) {
            return true;
        }
        
        // 也可能是包含嵌套结构的凭据文件
        if (jsonData.installed || jsonData.web) {
            return true;
        }
        
        return false;
    } catch (error) {
        // 如果无法解析，认为不是有效的凭据文件
        return false;
    }
}

/**
 * 创建新的提供商配置对象
 *
 * @param {Object} options - 配置选项
 * @param {string} options.credPathKey - 凭据路径键名
 * @param {string} options.credPath - 凭据文件路径
 * @param {string} options.defaultCheckModel - 默认检测模型
 * @param {boolean} options.needsProjectId - 是否需要 PROJECT_ID
 * @returns {Object} 新的提供商配置对象
 */
export function createProviderConfig(options) {
    const { credPathKey, credPath, defaultCheckModel, needsProjectId } = options;
    
    const newProvider = {
        [credPathKey]: credPath,
        uuid: generateUUID(),
        checkModelName: defaultCheckModel,
        checkHealth: true,
        isHealthy: true,
        isDisabled: false,
        lastUsed: null,
        usageCount: 0,
        errorCount: 0,
        lastErrorTime: null,
        lastHealthCheckTime: null,
        lastHealthCheckModel: null,
        lastErrorMessage: null
    };
    
    // 如果需要 PROJECT_ID，添加空字符串占位
    if (needsProjectId) {
        newProvider.PROJECT_ID = '';
    }
    
    return newProvider;
}

/**
 * 将路径添加到已使用路径集合（标准化多种格式）
 *
 * @param {Set} usedPaths - 已使用路径的集合
 * @param {string} filePath - 要添加的文件路径
 */
export function addToUsedPaths(usedPaths, filePath) {
    if (!filePath) return;
    
    const normalizedPath = filePath.replace(/\\/g, '/');
    usedPaths.add(filePath);
    usedPaths.add(normalizedPath);
    if (normalizedPath.startsWith('./')) {
        usedPaths.add(normalizedPath.slice(2));
    } else {
        usedPaths.add('./' + normalizedPath);
    }
}

/**
 * 检查路径是否已关联（用于自动关联检测）
 *
 * @param {string} relativePath - 相对路径
 * @param {Set} linkedPaths - 已关联路径的集合
 * @returns {boolean} 是否已关联
 */
export function isPathLinked(relativePath, linkedPaths) {
    return linkedPaths.has(relativePath) ||
           linkedPaths.has('./' + relativePath) ||
           linkedPaths.has(relativePath.replace(/^\.\//, ''));
}

/**
 * 检查 provider pool 中是否存在相同 userId 的 token
 *
 * @param {Array} providerPool - provider pool 数组
 * @param {string} userId - 要检查的 userId
 * @param {string} excludeUuid - 排除的 uuid（用于更新场景）
 * @returns {Object|null} 如果存在重复，返回重复的 provider 信息；否则返回 null
 */
export function findDuplicateUserId(providerPool, userId, excludeUuid = null) {
    if (!providerPool || !Array.isArray(providerPool) || !userId) {
        return null;
    }

    for (const provider of providerPool) {
        // 跳过被排除的 uuid
        if (excludeUuid && provider.uuid === excludeUuid) {
            continue;
        }

        // 检查 cachedUserId 字段
        if (provider.cachedUserId === userId) {
            return {
                uuid: provider.uuid,
                path: provider.KIRO_OAUTH_CREDS_FILE_PATH,
                cachedEmail: provider.cachedEmail,
                cachedUserId: provider.cachedUserId
            };
        }
    }

    return null;
}
