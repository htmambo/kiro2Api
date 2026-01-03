/**
 * Kiro API 常量定义模块
 * 包含所有 Kiro API 相关的常量配置
 */

export const KIRO_MODELS = [
    'claude-opus-4-5',
    'claude-opus-4-5-20251101',
    'claude-haiku-4-5',
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-20250514',
    'claude-3-7-sonnet-20250219'
];


/**
 * 提供商目录映射配置
 * 定义目录名称到提供商类型的映射关系 - 只支持 Kiro OAuth
 */
export const PROVIDER_MAPPINGS = [
    {
        // Kiro OAuth 配置
        dirName: 'kiro',
        patterns: ['configs/kiro/', '/kiro/'],
        providerType: 'claude-kiro-oauth',
        credPathKey: 'KIRO_OAUTH_CREDS_FILE_PATH',
        defaultCheckModel: 'claude-haiku-4-5',
        displayName: 'Claude Kiro OAuth',
        needsProjectId: false
    }
];
