/**
 * Kiro 策略模块
 *
 * 提供与 Kiro/Claude 请求与响应格式匹配的解析与系统提示处理逻辑。
 *
 * @module kiro/strategy
 */
import { extractSystemPromptFromRequestBody } from '../utils/prompt-utils.js';
import { createLogger } from '../lib/logger.js';
import { KIRO_MODELS } from '../kiro/constants.js';

const logger = createLogger('kiro:strategy');

/**
 * Kiro/Claude 策略实现
 *
 * 负责从响应中提取文本，并处理系统提示词的注入逻辑。
 */
class KiroStrategy {
    /**
     * 提取响应中的文本内容
     *
     * @param {Object} response - 响应数据
     * @returns {string} 提取到的文本
     */
    extractResponseText(response) {
        if (response.type === 'content_block_delta' && response.delta ) {
            if(response.delta.type === 'text_delta' ){
                return response.delta.text;
            }
            if(response.delta.type === 'input_json_delta' ){
                return response.delta.partial_json;
            }
        }
        if (response.content && Array.isArray(response.content)) {
            return response.content
                .filter(block => block.type === 'text' && block.text)
                .map(block => block.text)
                .join('');
        } else if (response.content && response.content.type === 'text') {
            return response.content.text;
        }
        return '';
    }

    /**
     * 提取请求中的用户提示文本
     *
     * @param {Object} requestBody - 请求体
     * @returns {string} 用户提示文本
     */
    extractPromptText(requestBody) {
        if (requestBody.messages && requestBody.messages.length > 0) {
            const lastMessage = requestBody.messages[requestBody.messages.length - 1];
            if (lastMessage.content && Array.isArray(lastMessage.content)) {
                return lastMessage.content.map(block => block.text).join('');
            }
            return lastMessage.content;
        }
        return '';
    }

    /**
     * 从文件内容注入系统提示词
     *
     * @param {Object} config - 配置对象
     * @param {Object} requestBody - 请求体
     * @returns {Promise<Object>} 更新后的请求体
     */
    async applySystemPromptFromFile(config, requestBody) {
        if (!config.SYSTEM_PROMPT_FILE_PATH) {
            return requestBody;
        }

        const filePromptContent = config.SYSTEM_PROMPT_CONTENT;
        if (filePromptContent === null) {
            return requestBody;
        }

        const existingSystemText = extractSystemPromptFromRequestBody(requestBody, 'claude');

        const newSystemText = config.SYSTEM_PROMPT_MODE === 'append' && existingSystemText
            ? `${existingSystemText}\n${filePromptContent}`
            : filePromptContent;

        requestBody.system = newSystemText;
        logger.info(
            `[System Prompt] Applied system prompt from ${config.SYSTEM_PROMPT_FILE_PATH} in '${config.SYSTEM_PROMPT_MODE}' mode for provider 'claude'.`
        );

        return requestBody;
    }
}

export { KiroStrategy };
