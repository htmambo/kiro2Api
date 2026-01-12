/**
 * 协议前缀/解析工具（用于协议转换）
 *
 * 注意：该文件必须保持“无业务依赖”，避免与 `src/utils/common.js` / `src/utils/convert.js`
 * 形成循环依赖，导致 ESM 初始化期崩溃。
 */

export const MODEL_PROTOCOL_PREFIX = {
    OPENAI: 'openai',
    OPENAI_RESPONSES: 'openaiResponses',
    CLAUDE: 'claude',
    GEMINI: 'gemini',
    OLLAMA: 'ollama',
};

/**
 * 从 provider 字符串中提取协议前缀。
 * 例如：`claude-kiro-oauth` -> `claude`
 * @param {string} provider
 * @returns {string}
 */
export function getProtocolPrefix(provider) {
    if (!provider || typeof provider !== 'string') return '';
    const hyphenIndex = provider.indexOf('-');
    if (hyphenIndex !== -1) {
        return provider.substring(0, hyphenIndex);
    }
    return provider;
}

