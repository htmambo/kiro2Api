/**
 * Vite 开发服务器代理（仅开发环境使用）。
 * 目标：通过 8088 访问前端，隐藏 5173 端口。
 * @module ui/vite-dev-proxy
 */

import { createLogger } from '../lib/logger.js';

const logger = createLogger('ui:vite-dev-proxy');

let proxyInstance = null;
let proxyTarget = null;
let proxyInitPromise = null;

/**
 * 获取 Vite 开发服务器地址。
 * @returns {string | undefined}
 */
function getViteDevServerUrl() {
    return process.env.VITE_DEV_SERVER_URL;
}

/**
 * 判断是否启用 Vite 开发代理。
 * @returns {boolean}
 */
export function isViteProxyEnabled() {
    return Boolean(getViteDevServerUrl());
}

/**
 * 判断请求路径是否需要代理到 Vite。
 * @param {string} pathname - 请求路径。
 * @returns {boolean}
 */
export function shouldProxyToVitePath(pathname) {
    if (!isViteProxyEnabled()) return false;
    if (!pathname) return false;
    if (pathname === '/health' || pathname === '/stats') return false;
    if (pathname === '/v1' || pathname.startsWith('/v1/')) return false;
    if (pathname === '/api' || pathname.startsWith('/api/')) return false;
    if (pathname.startsWith('/kiro/')) return false;
    return true;
}

/**
 * 从 URL 中提取标准路径，避免查询参数影响。
 * @param {string} rawUrl - 原始 URL 字符串。
 * @returns {string}
 */
function normalizePath(rawUrl) {
    if (!rawUrl) return '';
    try {
        return new URL(rawUrl, 'http://localhost').pathname;
    } catch {
        return String(rawUrl).split('?')[0];
    }
}

/**
 * 确保代理实例已初始化，并复用同一目标的实例。
 * @returns {Promise<import('http-proxy') | null>}
 */
async function ensureProxy() {
    const target = getViteDevServerUrl();
    if (!target) return null;

    if (proxyInstance && proxyTarget === target) {
        return proxyInstance;
    }

    if (proxyInitPromise) {
        return proxyInitPromise;
    }

    proxyInitPromise = (async () => {
        const { default: httpProxy } = await import('http-proxy');
        const instance = httpProxy.createProxyServer({
            target,
            changeOrigin: true,
            ws: true,
            secure: false
        });

        instance.on('error', (err, _req, resOrSocket) => {
            logger.warn(`Vite dev proxy error: ${err.message}`);
            if (resOrSocket && typeof resOrSocket.writeHead === 'function') {
                if (!resOrSocket.headersSent) {
                    resOrSocket.writeHead(502, { 'Content-Type': 'text/plain' });
                }
                resOrSocket.end('Vite dev server proxy error');
            } else if (resOrSocket && typeof resOrSocket.end === 'function') {
                try {
                    resOrSocket.end();
                } catch {
                    // 忽略无法关闭的连接
                }
            }
        });

        // 缓存实例以避免重复创建
        proxyInstance = instance;
        proxyTarget = target;
        return instance;
    })();

    const created = await proxyInitPromise;
    proxyInitPromise = null;
    return created;
}

/**
 * 代理普通 HTTP 请求到 Vite 开发服务器。
 * @param {import('http').IncomingMessage} req - HTTP 请求对象。
 * @param {import('http').ServerResponse} res - HTTP 响应对象。
 * @returns {Promise<boolean>} 是否成功代理。
 */
export async function proxyViteRequest(req, res) {
    const target = getViteDevServerUrl();
    if (!target) return false;

    const proxy = await ensureProxy();
    if (!proxy) return false;

    proxy.web(req, res, { target });
    return true;
}

/**
 * 代理 WebSocket 升级请求到 Vite 开发服务器。
 * @param {import('http').IncomingMessage} req - HTTP 请求对象。
 * @param {import('net').Socket} socket - 升级 Socket。
 * @param {Buffer} head - 升级头部数据。
 * @returns {Promise<boolean>} 是否成功代理。
 */
export async function proxyViteUpgrade(req, socket, head) {
    const target = getViteDevServerUrl();
    if (!target) return false;

    const proxy = await ensureProxy();
    if (!proxy) return false;

    proxy.ws(req, socket, head, { target });
    return true;
}

/**
 * 为服务器附加 Vite 代理的 upgrade 事件处理。
 * @param {import('http').Server} server - HTTP 服务器实例。
 * @returns {void}
 */
export function attachViteDevProxy(server) {
    if (!isViteProxyEnabled()) return;

    server.on('upgrade', async (req, socket, head) => {
        const pathname = normalizePath(req.url);
        if (!shouldProxyToVitePath(pathname)) {
            return;
        }

        try {
            const proxied = await proxyViteUpgrade(req, socket, head);
            if (!proxied) {
                socket.destroy();
            }
        } catch (error) {
            logger.warn(`Vite dev proxy upgrade failed: ${error.message}`);
            socket.destroy();
        }
    });
}
