import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * 静态文件服务模块
 * 处理静态资源的请求和响应
 */

/**
 * 提供静态文件服务
 * @param {string} pathParam - 请求路径
 * @param {http.ServerResponse} res - HTTP响应对象
 * @returns {Promise<boolean>} - 如果文件被成功提供则返回true
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
        pathParam.startsWith('/_next/') ||
        pathParam.startsWith('/assets/') ||
        pathParam.startsWith('/dashboard') ||
        pathParam.startsWith('/login') ||
        pathParam.startsWith('/app/')) {
        // Next.js 静态资源直接使用路径（去掉开头的 /）
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
            // ignore missing
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
            // ignore
        }
    });
    stream.pipe(res);
    return true;
}

/**
 * 根据文件扩展名获取Content-Type
 * @param {string} fileExt - 文件扩展名
 * @returns {string} - Content-Type字符串
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
