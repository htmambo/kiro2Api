/**
 * 静态文件服务模块。
 * 负责解析路径、定位静态资源并返回响应。
 * @module ui/static
 */

import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * 提供静态文件服务。
 * @param {string} pathParam - 请求路径。
 * @param {import('http').ServerResponse} res - HTTP 响应对象。
 * @returns {Promise<boolean>} 如果文件被成功提供则返回 true。
 */
export async function serveStaticFiles(pathParam, res) {
    const staticRoot = path.resolve(process.cwd(), 'static');
    // 处理不同类型的路径
    let relativePath;
    if (pathParam === '/' || pathParam === '/index.html') {
        relativePath = 'index.html';
    } else if (pathParam === '/favicon.ico') {
        relativePath = 'favicon.ico';
    } else if (
        pathParam.startsWith('/assets/') ||
        pathParam.startsWith('/dashboard') ||
        pathParam.startsWith('/login') ||
        pathParam.startsWith('/app/')) {
        relativePath = pathParam.substring(1);
    } else if (pathParam.startsWith('/')) {
        // 其他以 / 开头的路径，去掉开头的 /
        relativePath = pathParam.substring(1);
    } else {
        // 其他路径移除 /static/ 前缀
        relativePath = pathParam.replace('/static/', '');
    }
    const safeRelativePath = String(relativePath || '').replace(/^([/\\\\])+/, '');
    const candidateBase = path.resolve(staticRoot, safeRelativePath);

    // 防止路径穿越：必须落在 staticRoot 下
    if (!(candidateBase === staticRoot || candidateBase.startsWith(staticRoot + path.sep))) {
        return false;
    }

    // 生成候选路径（带扩展名、原路径、目录 index）
    const candidates = [];
    const ext = path.extname(candidateBase);
    if (!ext && !candidateBase.endsWith(path.sep)) {
        candidates.push(candidateBase + '.html');
    }
    candidates.push(candidateBase);
    candidates.push(path.join(candidateBase, 'index.html'));

    let filePath = null;
    for (const candidate of candidates) {
        try {
            const stat = await fs.stat(candidate);
            if (stat.isFile()) {
                filePath = candidate;
                break;
            }
        } catch {
            // 忽略不存在的候选路径
        }
    }

    if (!filePath && !ext) {
        const fallbackIndex = path.join(staticRoot, 'index.html');
        try {
            const stat = await fs.stat(fallbackIndex);
            if (stat.isFile()) {
                filePath = fallbackIndex;
            }
        } catch {
            // 忽略不存在的回退文件
        }
    }

    if (!filePath) return false;

    const fileExt = path.extname(filePath);
    const contentType = getContentType(fileExt);

    const headers = { 'Content-Type': contentType };
    if (fileExt === '.html' && process.env.NODE_ENV === 'production') {
        headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self';";
    }

    res.writeHead(200, headers);
    const stream = createReadStream(filePath);
    stream.on('error', () => {
        try {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
            }
            res.end('Internal Server Error');
        } catch {
            // 忽略无法写入的响应
        }
    });
    stream.pipe(res);
    return true;
}

/**
 * 根据文件扩展名获取 Content-Type。
 * @param {string} fileExt - 文件扩展名。
 * @returns {string} Content-Type 字符串。
 */
function getContentType(fileExt) {
    const contentTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.json': 'application/json',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf'
    };
    return contentTypes[fileExt] || 'text/plain';
}
