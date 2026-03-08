/**
 * 协议前缀/解析工具（用于协议转换）
 *
 * 注意：该文件必须保持“无业务依赖”，避免与 `src/utils/common.js` / `src/utils/convert.js`
 * 形成循环依赖，导致 ESM 初始化期崩溃。
 *
 * @module utils/protocol
 */

/**
 * 模型协议前缀常量
 *
 * @type {Object}
 */
export const MODEL_PROTOCOL_PREFIX = {
    CLAUDE: 'claude',
};

/**
 * 从 provider 字符串中提取协议前缀
 *
 * 例如：`claude-kiro-oauth` -> `claude`。
 *
 * @param {string} provider - provider 字符串
 * @returns {string} 协议前缀
 */
export function getProtocolPrefix(provider) {
    if (!provider || typeof provider !== 'string') return '';
    const hyphenIndex = provider.indexOf('-');
    if (hyphenIndex !== -1) {
        return provider.substring(0, hyphenIndex);
    }
    return provider;
}
