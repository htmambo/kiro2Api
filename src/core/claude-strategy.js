import { extractSystemPromptFromRequestBody } from '../utils/common.js';

/**
 * Claude provider strategy implementation.
 */
class ClaudeStrategy {
    extractModelAndStreamInfo(req, requestBody) {
        const model = requestBody.model;
        const isStream = requestBody.stream === true;
        return { model, isStream };
    }

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
        console.log(`[System Prompt] Applied system prompt from ${config.SYSTEM_PROMPT_FILE_PATH} in '${config.SYSTEM_PROMPT_MODE}' mode for provider 'claude'.`);

        return requestBody;
    }

    async manageSystemPrompt(requestBody) {
        const incomingSystemText = extractSystemPromptFromRequestBody(requestBody, 'claude');
        await this._updateSystemPromptFile(incomingSystemText, 'claude');
    }

    /**
     * Updates the system prompt file.
     * @param {string} incomingSystemText - Incoming system prompt text.
     * @param {string} providerName - Provider name (for logging).
     * @returns {Promise<void>}
     */
    async _updateSystemPromptFile(incomingSystemText, providerName) {
        let currentSystemText = '';
        try {
            currentSystemText = await fs.readFile(FETCH_SYSTEM_PROMPT_FILE, 'utf8');
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(`[System Prompt Manager] Error reading system prompt file: ${error.message}`);
            }
        }

        try {
            if (incomingSystemText && incomingSystemText !== currentSystemText) {
                await fs.writeFile(FETCH_SYSTEM_PROMPT_FILE, incomingSystemText);
                console.log(`[System Prompt Manager] System prompt updated in file for provider '${providerName}'.`);
            } else if (!incomingSystemText && currentSystemText) {
                await fs.writeFile(FETCH_SYSTEM_PROMPT_FILE, '');
                console.log('[System Prompt Manager] System prompt cleared from file.');
            }
        } catch (error) {
            console.error(`[System Prompt Manager] Failed to manage system prompt file: ${error.message}`);
        }
    }

}

export { ClaudeStrategy };
