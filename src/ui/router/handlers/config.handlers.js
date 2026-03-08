/**
 * 配置 Handler 实现。
 * @module ui/router/handlers/config
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createLogger } from '../../../lib/logger.js';
import { getRequestBody } from '../../../utils/request-body.js';
import { broadcastEvent } from '../../events.js';

const logger = createLogger('ui:handlers:config');

/**
 * 获取配置。
 * @param {{ res: import('http').ServerResponse, currentConfig: object }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function getConfig({ res, currentConfig }) {
    let systemPrompt = '';

    if (currentConfig.SYSTEM_PROMPT_FILE_PATH && existsSync(currentConfig.SYSTEM_PROMPT_FILE_PATH)) {
        try {
            systemPrompt = readFileSync(currentConfig.SYSTEM_PROMPT_FILE_PATH, 'utf-8');
        } catch (e) {
            logger.warn(`[UI API] Failed to read system prompt file: ${e.message}`);
        }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        ...currentConfig,
        systemPrompt
    }));
}

/**
 * 更新配置。
 * @param {{ req: import('http').IncomingMessage, res: import('http').ServerResponse, currentConfig: object }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function updateConfig({ req, res, currentConfig }) {
    try {
        const body = await getRequestBody(req);
        const newConfig = body;

        // 更新内存配置
        if (newConfig.REQUIRED_API_KEY !== undefined) currentConfig.REQUIRED_API_KEY = newConfig.REQUIRED_API_KEY;
        if (newConfig.HOST !== undefined) currentConfig.HOST = newConfig.HOST;
        if (newConfig.SERVER_PORT !== undefined) currentConfig.SERVER_PORT = newConfig.SERVER_PORT;
        if (newConfig.MODEL_PROVIDER !== undefined) currentConfig.MODEL_PROVIDER = newConfig.MODEL_PROVIDER;
        // ... 其他配置项

        // 处理 system_prompt 更新
        if (newConfig.systemPrompt !== undefined) {
            const promptPath = currentConfig.SYSTEM_PROMPT_FILE_PATH || 'input_system_prompt.txt';
            try {
                writeFileSync(promptPath, newConfig.systemPrompt, 'utf8');

                broadcastEvent('config_update', {
                    action: 'update',
                    filePath: promptPath,
                    type: 'system_prompt',
                    timestamp: new Date().toISOString()
                });
            } catch (e) {
                logger.warn(`[UI API] Failed to write system prompt: ${e.message}`);
            }
        }

        // 保存到 config.json
        const configPath = 'configs/config.json';
        try {
            writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), 'utf8');
        } catch (error) {
            logger.error('[UI API] Failed to save configuration to file:', error);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'Configuration updated successfully'
        }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 重载配置。
 * @param {{ res: import('http').ServerResponse }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function reloadConfig({ res }) {
    try {
        const { reloadConfig: doReload } = await import('../../../ui-manager.js');
        const newConfig = await doReload();

        broadcastEvent('config_update', {
            action: 'reload',
            filePath: 'configs/config.json',
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: '配置文件重新加载成功'
        }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}
