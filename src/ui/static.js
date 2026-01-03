import { existsSync, readFileSync, statSync } from 'fs';
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
    // 处理不同类型的路径
    let relativePath;
    if (pathParam === '/' || pathParam === '/index.html') {
        relativePath = 'index.html';
    } else if (pathParam === '/favicon.ico') {
        relativePath = 'favicon.ico';
    } else if (pathParam.startsWith('/_next/') || pathParam.startsWith('/dashboard') || pathParam.startsWith('/login') || pathParam.startsWith('/app/')) {
        // Next.js 静态资源直接使用路径（去掉开头的 /）
        relativePath = pathParam.substring(1);
    } else if (pathParam.startsWith('/')) {
        // 其他以 / 开头的路径，去掉开头的 /
        relativePath = pathParam.substring(1);
    } else {
        // 其他路径移除 /static/ 前缀
        relativePath = pathParam.replace('/static/', '');
    }

    let filePath = path.join(process.cwd(), 'static', relativePath);

    // 首先尝试添加 .html 扩展名（优先于目录处理）
    const ext = path.extname(filePath);
    if (!ext && !filePath.endsWith('/')) {
        const htmlPath = filePath + '.html';
        if (existsSync(htmlPath)) {
            try {
                const stats = statSync(htmlPath);
                if (!stats.isDirectory()) {
                    filePath = htmlPath;
                }
            } catch (e) {
                // 忽略错误
            }
        }
    }

    // 如果文件不存在，检查是否是目录并尝试添加 index.html
    if (!existsSync(filePath) || (existsSync(filePath) && statSync(filePath).isDirectory())) {
        const currentPath = path.join(process.cwd(), 'static', relativePath);
        if (existsSync(currentPath)) {
            try {
                const stats = statSync(currentPath);
                if (stats.isDirectory()) {
                    const indexPath = path.join(currentPath, 'index.html');
                    if (existsSync(indexPath)) {
                        filePath = indexPath;
                    }
                }
            } catch (e) {
                // 忽略错误
            }
        }
    }

    if (existsSync(filePath)) {
        try {
            const stats = statSync(filePath);
            if (stats.isDirectory()) {
                return false; // 仍然是目录，返回 false
            }
        } catch (e) {
            return false;
        }

        const fileExt = path.extname(filePath);
        const contentType = getContentType(fileExt);

        // 为HTML文件添加允许Next.js运行的CSP头（完全禁用CSP限制）
        const headers = { 'Content-Type': contentType };
        if (fileExt === '.html') {
            // 使用最宽松的CSP策略
            headers['Content-Security-Policy'] = "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;";
        }

        res.writeHead(200, headers);
        res.end(readFileSync(filePath));
        return true;
    }
    return false;
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
