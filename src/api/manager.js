/**
 * API 路由与运行时管理的聚合模块
 *
 * 将路由分发、心跳与令牌刷新、请求体读取等通用能力集中在此处，
 * 以保持请求处理逻辑的单一入口和可维护性。
 *
 * @module manager
 */

import {
    handleContentGenerationRequest,
    ENDPOINT_TYPE
} from '../utils/common.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('api:manager');

/**
 * 处理 API 路由分发
 *
 * 路径分发集中在这里是为了保持请求入口的单一职责：上层只关心"是否要交给 API"，
 * 具体分流规则在此处统一维护，避免多处判断导致路径规则分裂。
 *
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @param {http.ServerResponse} res - HTTP 响应对象
 * @param {Object} currentConfig - 当前配置
 * @param {KiroService} apiService - API 服务实例
 * @param {Object} poolManager - 账号池管理器
 * @param {string} promptLogFilename - 提示词日志文件名
 * @returns {Promise<boolean>} 是否已被 API 处理
 */
export async function handleAPIRequests(method, path, req, res, currentConfig, apiService, poolManager, promptLogFilename) {
    // 路由内容生成请求
    if (method === 'POST') {
        if (path === '/v1/messages' || path === '/v1/stream') {
            await handleContentGenerationRequest(req, res, apiService, ENDPOINT_TYPE.CLAUDE_MESSAGE, currentConfig, promptLogFilename, poolManager, currentConfig.uuid);
            return true;
        }
        if (path === '/v1/chat/completions') {
            await handleContentGenerationRequest(req, res, apiService, ENDPOINT_TYPE.OPENAI_CHAT, currentConfig, promptLogFilename, poolManager, currentConfig.uuid);
            return true;
        }
        if (path === '/v1/responses') {
            await handleContentGenerationRequest(req, res, apiService, ENDPOINT_TYPE.OPENAI_RESPONSES, currentConfig, promptLogFilename, poolManager, currentConfig.uuid);
            return true;
        }
    }

    return false;
}

/**
 * 初始化 API 管理能力
 *
 * 心跳与刷新令牌能持续暴露服务健康状况并提前续期，
 * 对运维监控与稳定性保障有直接价值。
 *
 * @param {Object} services - 已初始化的服务集合
 * @returns {Function} 心跳与令牌刷新函数
 */
export function initializeAPIManagement(services) {
    return async function heartbeatAndRefreshToken() {
        logger.info(`Server is running. Current time: ${new Date().toLocaleString()}`, { providers: Object.keys(services) });
        for (const providerKey in services) {
            const serviceAdapter = services[providerKey];
            try {
                await serviceAdapter.checkToken();
            } catch (error) {
                logger.error(`Failed to refresh token for ${providerKey}`, error);
            }
        }
    };
}

/**
 * 读取请求体的轻量工具
 *
 * 不使用更高层的 body parser 是为了降低依赖与开销，
 * 同时保持对原始流的控制，避免与不同运行环境的兼容性问题。
 *
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @returns {Promise<string>} 请求体字符串
 */
export function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            resolve(body);
        });
        req.on('error', err => {
            reject(err);
        });
    });
}
