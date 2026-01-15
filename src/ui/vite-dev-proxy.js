/**
 * Vite 开发服务器代理（仅开发环境使用）
 *
 * 目标：通过 8088 访问前端，隐藏 5173 端口
 */

import { createLogger } from '../lib/logger.js';

const logger = createLogger('ui:vite-dev-proxy');

let proxyInstance = null;
let proxyTarget = null;
let proxyInitPromise = null;

function getViteDevServerUrl() {
    return process.env.VITE_DEV_SERVER_URL;
}

export function isViteProxyEnabled() {
    return Boolean(getViteDevServerUrl());
}

export function shouldProxyToVitePath(pathname) {
    if (!isViteProxyEnabled()) return false;
    if (!pathname) return false;
    if (pathname === '/health' || pathname === '/stats') return false;
    if (pathname === '/v1' || pathname.startsWith('/v1/')) return false;
    if (pathname === '/api' || pathname.startsWith('/api/')) return false;
    if (pathname.startsWith('/kiro/')) return false;
    return true;
}

function normalizePath(rawUrl) {
    if (!rawUrl) return '';
    try {
        return new URL(rawUrl, 'http://localhost').pathname;
    } catch {
        return String(rawUrl).split('?')[0];
    }
}

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
                    // ignore
                }
            }
        });

        proxyInstance = instance;
        proxyTarget = target;
        return instance;
    })();

    const created = await proxyInitPromise;
    proxyInitPromise = null;
    return created;
}

export async function proxyViteRequest(req, res) {
    const target = getViteDevServerUrl();
    if (!target) return false;

    const proxy = await ensureProxy();
    if (!proxy) return false;

    proxy.web(req, res, { target });
    return true;
}

export async function proxyViteUpgrade(req, socket, head) {
    const target = getViteDevServerUrl();
    if (!target) return false;

    const proxy = await ensureProxy();
    if (!proxy) return false;

    proxy.ws(req, socket, head, { target });
    return true;
}

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
