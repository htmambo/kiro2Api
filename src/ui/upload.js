import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('ui:upload');

/**
 * 配置 multer 存储
 */
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            // multer在destination回调时req.body还未解析，先使用默认路径
            // 实际的provider会在文件上传完成后从req.body中获取
            const uploadPath = path.join(process.cwd(), 'configs', 'temp');
            await fs.mkdir(uploadPath, { recursive: true });
            cb(null, uploadPath);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${timestamp}_${sanitizedName}`);
    }
});

/**
 * 文件类型过滤器
 */
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['.json', '.txt', '.key', '.pem', '.p12', '.pfx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('不支持的文件类型'), false);
    }
};

/**
 * Multer 上传中间件配置
 */
export const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB限制
    }
});

/**
 * 处理文件上传请求
 * @param {Object} req - HTTP 请求对象
 * @param {Object} res - HTTP 响应对象
 * @param {Object} currentConfig - 当前配置对象
 */
export async function handleUpload(req, res, currentConfig) {
    const uploadMiddleware = upload.single('file');

    return new Promise((resolve, reject) => {
        uploadMiddleware(req, res, async (err) => {
            if (err) {
                logger.error('文件上传错误', err);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: err.message || '文件上传失败'
                    }
                }));
                resolve(false);
                return;
            }

            try {
                if (!req.file) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: {
                            message: '没有文件被上传'
                        }
                    }));
                    resolve(false);
                    return;
                }

                // 调用 handler 处理上传后的逻辑
                const { uploadCredentials } = await import('./router/handlers/upload.handlers.js');
                await uploadCredentials({ req, res, currentConfig });
                resolve(true);
            } catch (error) {
                logger.error('[Router] Upload handler error', error);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: { message: '文件上传处理失败: ' + error.message }
                    }));
                }
                reject(error);
            }
        });
    });
}

/**
 * 检查请求是否为文件上传请求
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径
 * @returns {boolean}
 */
export function isUploadRequest(method, path) {
    return method === 'POST' && path === '/api/upload-oauth-credentials';
}
