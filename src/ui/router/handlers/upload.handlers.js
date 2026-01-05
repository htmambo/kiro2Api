/**
 * 上传 Handler 实现
 * 处理文件上传和配置文件管理
 */

/**
 * Helper function to attempt quick link for a single file
 * Extracted from ui-manager.js for reusability
 */
async function attemptQuickLinkFile(filePath, providerPoolManager) {
    if (!filePath) {
        return { success: false, message: 'filePath is required' };
    }

    try {
        // Import dependencies
        const { DEFAULT_PROVIDER_TYPE_FOR_ACCOUNTS } = await import('../../../ui-manager.js');
        const { KIRO_MODELS } = await import('../../../kiro/constants.js');
        const { createProviderConfig, formatSystemPath } = await import('../../../utils/account-utils.js');
        const { broadcastEvent } = await import('../../events.js');

        // Defaults for Kiro OAuth
        const providerType = DEFAULT_PROVIDER_TYPE_FOR_ACCOUNTS;
        const credPathKey = 'KIRO_OAUTH_CREDS_FILE_PATH';
        const defaultCheckModel = KIRO_MODELS[0];
        const displayName = 'Claude Kiro Account';
        const needsProjectId = false;

        // Check if already linked
        const path = await import('path');
        const targetAbsPath = path.resolve(process.cwd(), filePath);
        const accounts = providerPoolManager.listAccounts();
        const isAlreadyLinked = accounts.some(p => {
            const existingPath = p.path || p[credPathKey]; // Support both key formats
            if (!existingPath) return false;
            const existingAbsPath = path.resolve(process.cwd(), existingPath);
            return existingAbsPath.toLowerCase() === targetAbsPath.toLowerCase();
        });

        if (isAlreadyLinked) {
            return { success: false, message: '该配置文件已关联', alreadyLinked: true };
        }

        // Create new provider config based on provider type
        const newProviderConfig = createProviderConfig({
            credPathKey,
            credPath: formatSystemPath(filePath),
            defaultCheckModel,
            needsProjectId
        });

        // Add account through AccountPoolManager
        const newProvider = providerPoolManager.addAccount(newProviderConfig);
        console.log(`[UI API] Quick linked config: ${filePath}`);

        // Broadcast update event
        broadcastEvent('config_update', {
            action: 'quick_link',
            filePath: filePath,
            newProvider,
            timestamp: new Date().toISOString()
        });

        broadcastEvent('provider_update', {
            action: 'add',
            providerConfig: newProvider,
            timestamp: new Date().toISOString()
        });

        return {
            success: true,
            message: `配置已成功关联到 ${displayName}`,
            provider: newProvider,
            providerType: providerType
        };
    } catch (error) {
        console.error(`[UI API] Quick link for ${filePath} failed:`, error);
        return { success: false, message: '关联失败: ' + error.message };
    }
}


/**
 * 上传 OAuth 凭据文件
 */
export async function uploadCredentials({ req, res, currentConfig }) {
    try {
        const { broadcastEvent } = await import('../../events.js');
        const path = await import('path');
        const fs = await import('fs');

        // multer执行完成后，表单字段已解析到req.body中
        const provider = req.body.provider || 'common';
        const tempFilePath = req.file.path;

        // 根据实际的provider移动文件到正确的目录
        let targetDir = path.join(process.cwd(), 'configs', provider);

        // 如果是kiro类型的凭证，需要再包裹一层文件夹
        if (provider === 'kiro') {
            // 使用时间戳作为子文件夹名称，确保每个上传的文件都有独立的目录
            const timestamp = Date.now();
            const originalNameWithoutExt = path.parse(req.file.originalname).name;
            const subFolder = `${timestamp}_${originalNameWithoutExt}`;
            targetDir = path.join(targetDir, subFolder);
        }

        await fs.mkdir(targetDir, { recursive: true });

        const targetFilePath = path.join(targetDir, req.file.filename);
        await fs.rename(tempFilePath, targetFilePath);

        const relativePath = path.relative(process.cwd(), targetFilePath);

        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'add',
            filePath: relativePath,
            provider: provider,
            timestamp: new Date().toISOString()
        });

        console.log(`[Upload] OAuth凭据文件已上传: ${targetFilePath} (提供商: ${provider})`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: '文件上传成功',
            filePath: relativePath,
            originalName: req.file.originalname,
            provider: provider
        }));

    } catch (error) {
        console.error('[Upload] 文件上传处理错误:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: '文件上传处理失败: ' + error.message
            }
        }));
    }
}

/**
 * 获取上传配置文件列表
 */
export async function getUploadConfigs({ res, currentConfig, providerPoolManager }) {
    try {
        const { scanConfigFiles } = await import('../../../ui-manager.js');
        const configFiles = await scanConfigFiles(currentConfig, providerPoolManager);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(configFiles));
    } catch (error) {
        console.error('[UI API] Failed to scan config files:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: 'Failed to scan config files: ' + error.message }
        }));
    }
}

/**
 * 查看配置文件
 */
export async function viewConfig({ res, match }) {
    const fs = await import('fs');
    const path = await import('path');

    try {
        const filePath = decodeURIComponent(match[1]);
        const fullPath = path.join(process.cwd(), filePath);

        // 安全检查
        const allowedDirs = ['configs'];
        const relativePath = path.relative(process.cwd(), fullPath);
        const isAllowed = allowedDirs.some(dir => relativePath.startsWith(dir + path.sep) || relativePath === dir);

        if (!isAllowed) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: '访问被拒绝：只能查看configs目录下的文件' }
            }));
            return;
        }

        if (!fs.existsSync(fullPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: '文件不存在' } }));
            return;
        }

        const content = await fs.readFile(fullPath, 'utf8');
        const stats = await fs.stat(fullPath);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            path: relativePath,
            content: content,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            name: path.basename(fullPath)
        }));
    } catch (error) {
        console.error('[UI API] Failed to view config file:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: 'Failed to view config file: ' + error.message }
        }));
    }
}

/**
 * 删除配置文件
 */
export async function deleteConfig({ res, match }) {
    const fs = await import('fs');
    const path = await import('path');
    const { broadcastEvent } = await import('../../events.js');

    try {
        const filePath = decodeURIComponent(match[1]);
        const fullPath = path.join(process.cwd(), filePath);

        // 安全检查
        const allowedDirs = ['configs'];
        const relativePath = path.relative(process.cwd(), fullPath);
        const isAllowed = allowedDirs.some(dir => relativePath.startsWith(dir + path.sep) || relativePath === dir);

        if (!isAllowed) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: '访问被拒绝：只能删除configs目录下的文件' }
            }));
            return;
        }

        if (!fs.existsSync(fullPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: '文件不存在' } }));
            return;
        }

        await fs.unlink(fullPath);

        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'delete',
            filePath: relativePath,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: '文件删除成功',
            filePath: relativePath
        }));
    } catch (error) {
        console.error('[UI API] Failed to delete config file:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: 'Failed to delete config file: ' + error.message }
        }));
    }
}

/**
 * 快速关联配置文件
 */
export async function quickLink({ req, res, providerPoolManager }) {
    const { getRequestBody } = await import('../../../utils/common.js');

    try {
        const body = await getRequestBody(req);
        const { filePath } = body;

        const result = await attemptQuickLinkFile(filePath, providerPoolManager);

        if (!result.success) {
            res.writeHead(result.alreadyLinked ? 400 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: result.message } }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: result.message,
            provider: result.provider,
            providerType: result.providerType
        }));
    } catch (error) {
        console.error('[UI API] Quick link failed:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: '关联失败: ' + error.message }
        }));
    }
}

/**
 * 批量快速关联
 */
export async function bulkQuickLink({ req, res, providerPoolManager }) {
    const { getRequestBody } = await import('../../../utils/common.js');

    try {
        const body = await getRequestBody(req);
        const { filePaths } = body;

        if (!Array.isArray(filePaths) || filePaths.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: '需要提供至少一个文件路径' } }));
            return;
        }

        const uniquePaths = Array.from(new Set(filePaths.filter(Boolean)));

        console.log(`[UI API] Bulk quick link started for ${uniquePaths.length} files`);

        const results = await Promise.all(uniquePaths.map(async filePath => {
            const result = await attemptQuickLinkFile(filePath, providerPoolManager);
            return {
                filePath,
                success: result.success,
                message: result.message,
                alreadyLinked: result.alreadyLinked || false,
                provider: result.provider || null
            };
        }));

        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success && !r.alreadyLinked).length;
        const skippedCount = results.filter(r => r.alreadyLinked).length;

        console.log(`[UI API] Bulk quick link completed: ${successCount} succeeded, ${failureCount} failed, ${skippedCount} skipped`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: `批量关联完成：成功 ${successCount} 个，失败 ${failureCount} 个，已关联 ${skippedCount} 个`,
            summary: {
                attempted: uniquePaths.length,
                successCount,
                failureCount,
                skippedCount
            },
            results
        }));
    } catch (error) {
        console.error('[UI API] Bulk quick link failed:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: '批量关联失败: ' + error.message }
        }));
    }
}
