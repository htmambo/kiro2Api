/**
 * OAuth Handler 实现
 * 处理 OAuth 相关的 API 请求
 */
import { startDeviceAuthorization, pollDeviceToken } from '../../../kiro/auth.js';
import { createLogger } from '../../../lib/logger.js';
import { oauthStateStore } from '../../../domain/oauth/state-store.js';
import { tokenStore } from '../../../domain/oauth/token-store.js';
import { generateOAuthResultPage } from '../../views/oauth-result.js';
import { OAuthFacade } from '../../../domain/oauth/index.js';
import { withLock } from '../../../utils/mutex.js';

const logger = createLogger('ui:handlers:oauth');

// AWS SSO in-flight 标记（跨请求生命周期的并发控制）
const awsSsoInflight = new Map();

/**
 * OAuth 网页回调 Handler
 * 返回 HTML 页面
 */
export async function webCallback({ req, res, accountPoolManager }) {
    try {
        // 保持动态 import KIRO_OAUTH_CONFIG，避免与 ui-manager/router 的循环依赖
        const { KIRO_OAUTH_CONFIG } = await import('../../../ui-manager.js');

        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const code = urlObj.searchParams.get('code');
        const state = urlObj.searchParams.get('state');

        logger.info(`[Kiro OAuth Web] Received callback: code=${code?.substring(0, 10)}..., state=${state?.substring(0, 10)}...`);

        if (!code || !state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(generateOAuthResultPage(false, '缺少必要参数 (code 或 state)'));
            return;
        }

        // 使用 OAuthFacade 处理 callback（domain 层负责 token 写入和入池）
        const oauthFacade = new OAuthFacade({ accountPool: accountPoolManager });
        const result = await oauthFacade.handleWebCallback({
            code,
            state,
            oauthConfig: KIRO_OAUTH_CONFIG
        });

        if (!result.ok) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(generateOAuthResultPage(false, result.error.message));
            return;
        }

        // ⚠️ 修复：使用返回的 provider 信息，避免读取已消费的 state
        const { accountNumber, tokenFileName, provider } = result.data;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(generateOAuthResultPage(true, `账号 #${accountNumber} 授权成功！`, {
            accountNumber,
            tokenFile: tokenFileName,
            provider: provider || 'Kiro'
        }));
    } catch (error) {
        logger.error('[Kiro OAuth Web] Callback handling error:', error);
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body><h1>处理失败</h1></body></html>');
    }
}

/**
 * 检查 OAuth state 状态
 */
export async function checkState({ req, res }) {
    try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const state = urlObj.searchParams.get('state');

        if (!state) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing state parameter' }));
            return;
        }

        const stateData = await oauthStateStore.getState(state);

        if (stateData) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ completed: false }));
        } else {
            const completedInfo = oauthStateStore.getCompletedInfo(state) || {};
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                completed: true,
                accountNumber: completedInfo.accountNumber
            }));
        }
    } catch (error) {
        logger.error('[Kiro OAuth] Check state error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
    }
}

/**
 * 手动导入 refreshToken
 */
export async function manualImport({ req, res, currentConfig, accountPoolManager }) {
    try {
        const { parseRequestBody } = await import('../../../ui-manager.js');
        const { broadcastEvent } = await import('../../events.js');
        const axios = (await import('axios')).default;

        const body = await parseRequestBody(req);
        const { refreshToken, profileArn, accountNumber = 1 } = body;

        if (!refreshToken) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: '请提供 refreshToken'
            }));
            return;
        }

        if (!refreshToken.startsWith('aorAAAAAG')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: 'RefreshToken 格式不正确，应该以 aorAAAAAG 开头'
            }));
            return;
        }

        // 验证 accountNumber 的类型和范围
        if (typeof accountNumber !== 'number' || !Number.isFinite(accountNumber) || accountNumber < 1 || accountNumber > 999999) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: 'accountNumber 必须是 number 类型，且范围为 1-999999'
            }));
            return;
        }

        // 使用互斥锁防止并发导入同一账号
        const lockKey = `manualImport:${accountNumber}`;
        await withLock(lockKey, async () => {
            logger.info(`[Kiro Manual Import] Importing refreshToken for account ${accountNumber}`);

        // Test refresh by calling Kiro token refresh API
        const REFRESH_URL = 'https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token';

        try {
            const refreshResponse = await axios.post(REFRESH_URL, {
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            });

            const { accessToken: newAccessToken, expiresAt, profileArn: fetchedProfileArn } = refreshResponse.data;
            const finalProfileArn = profileArn || fetchedProfileArn;

            logger.info('[Kiro Manual Import] RefreshToken validated and refreshed successfully');
            logger.info(`[Kiro Manual Import] ProfileArn: ${finalProfileArn}`);

            // ⚠️ 事务一致性优化：在保存 token 之前先进行完整的重复检测
            const { findDuplicateUserId } = await import('../../../utils/account-utils.js');

            let accounts = [];
            try {
                accounts = accountPoolManager && typeof accountPoolManager.listAccounts === 'function'
                    ? accountPoolManager.listAccounts()
                    : [];
            } catch (error) {
                logger.error(`[Kiro Manual Import] Failed to list accounts: ${error.message}`);
                // 获取账号列表失败不应阻止导入流程，继续执行（但重复检测会被跳过）
            }

            // 1. 检测重复的 userId
            if (accounts.length > 0) {
                try {
                    const userIdResult = await findDuplicateUserId(newAccessToken, finalProfileArn, accounts, currentConfig);
                    if (userIdResult) {
                        const duplicateProvider = userIdResult.existingProvider;
                        logger.info(`[Kiro Manual Import] Duplicate account detected: ${userIdResult.userId}`);

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: false,
                            message: `检测到重复账号 (${userIdResult.email || userIdResult.userId})，已存在 token: ${duplicateProvider.KIRO_OAUTH_CREDS_FILE_PATH}`,
                            duplicate: true,
                            userId: userIdResult.userId,
                            email: userIdResult.email,
                            existingToken: duplicateProvider.KIRO_OAUTH_CREDS_FILE_PATH
                        }));
                        return;
                    }
                } catch (error) {
                    logger.error(`[Kiro Manual Import] Duplicate userId check failed: ${error.message}`);
                    // 重复检测失败不应阻止导入流程，继续执行
                }
            }

            // 2. 检测重复的路径（预计算将要保存的路径）
            const normalizedBaseDir = String(tokenStore.baseDir || 'configs/kiro').replace(/\\/g, '/');
            const expectedRelativePath = `${normalizedBaseDir}/kiro-auth-token-${accountNumber}.json`;
            const pathExists = accounts.some(p => {
                const existingPath = (p.KIRO_OAUTH_CREDS_FILE_PATH || '').replace(/\\/g, '/');
                return existingPath === expectedRelativePath || existingPath === './' + expectedRelativePath;
            });

            if (pathExists) {
                logger.info(`[Kiro Manual Import] Path already exists in account pool: ${expectedRelativePath}`);
                // 路径已存在，但不是错误，只是跳过添加到池中
            }

            // 重复检测通过后，保存 token 文件
            const credentialsData = {
                accessToken: newAccessToken,
                refreshToken: refreshToken,
                profileArn: finalProfileArn,
                expiresAt: expiresAt || new Date(Date.now() + 3600000).toISOString(),
                authMethod: 'manual-import',
                provider: 'Manual'
            };

            const saveInfo = await tokenStore.saveToken(accountNumber, credentialsData, {
                fileName: `kiro-auth-token-${accountNumber}.json`
            });
            logger.info(`[Kiro Manual Import] Token saved to: ${saveInfo.tokenFilePath}`);

            // 如果路径不存在于账号池，则添加
            if (!pathExists) {
                try {
                    const newAccount = {
                        KIRO_OAUTH_CREDS_FILE_PATH: saveInfo.relativePath,
                        isHealthy: true,
                        usageCount: 0,
                        errorCount: 0,
                        lastUsed: null,
                        lastErrorTime: null,
                        isDisabled: false,
                        lastHealthCheckTime: new Date().toISOString(),
                        lastHealthCheckModel: 'claude-haiku-4-5',
                        lastErrorMessage: null,
                        checkModelName: '',
                        checkHealth: true,
                        notSupportedModels: []
                    };

                    // 使用 accountPoolManager 统一入池
                    accountPoolManager.addAccount(newAccount);
                    logger.info(`[Kiro Manual Import] Added to account pool: ${saveInfo.relativePath}`);

                    broadcastEvent('provider_update', {
                        action: 'add',
                        providerType: 'claude-kiro-oauth',
                        providerConfig: newAccount,
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    logger.error(`[Kiro Manual Import] Failed to add to provider pool: ${error.message}`);
                }
            }

            broadcastEvent('oauth_success', {
                provider: 'claude-kiro-oauth-manual',
                credPath: saveInfo.relativePath,
                timestamp: new Date().toISOString()
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'RefreshToken 导入成功',
                tokenFile: saveInfo.tokenFilePath,
                profileArn: finalProfileArn
            }));
        } catch (refreshError) {
            logger.error(`[Kiro Manual Import] RefreshToken validation failed: ${refreshError.message}`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: `RefreshToken 无效或已过期: ${refreshError.message}`
            }));
        }
        }); // 结束 withLock
    } catch (error) {
        logger.error('[Kiro Manual Import] Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            message: error.message
        }));
    }
}

/**
 * AWS SSO 设备授权启动
 */
export async function awsSsoStart({ req, res, currentConfig, accountPoolManager }) {
    let accountNumber; // 提升作用域，用于 catch 块清理 in-flight
    try {
        const { parseRequestBody } = await import('../../../ui-manager.js');
        const { broadcastEvent } = await import('../../events.js');
        const axios = (await import('axios')).default;

        const body = await parseRequestBody(req);
        const { accountNumber: rawAccountNumber, startUrl } = body;

        // accountNumber 必填（无默认值）
        if (rawAccountNumber === undefined || rawAccountNumber === null || rawAccountNumber === '') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: '请提供 accountNumber'
            }));
            return;
        }

        // 支持 numeric string（与 manualImport 对齐）
        accountNumber = rawAccountNumber;
        if (typeof accountNumber === 'string') {
            const trimmed = accountNumber.trim();
            if (/^\d+$/.test(trimmed)) {
                accountNumber = Number(trimmed);
            }
        }

        // 验证 accountNumber 的类型和范围
        if (typeof accountNumber !== 'number' || !Number.isFinite(accountNumber) || accountNumber < 1 || accountNumber > 999999) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: 'accountNumber 必须是 number 类型（或 numeric string），且范围为 1-999999'
            }));
            return;
        }

        // 进程内 in-flight 并发控制：同一 accountNumber 拒绝第二个请求
        if (awsSsoInflight.has(accountNumber)) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: `账号 #${accountNumber} 正在进行 AWS SSO 授权，请稍后重试`,
                accountNumber
            }));
            return;
        }
        awsSsoInflight.set(accountNumber, { startedAt: Date.now() });

        const region = 'us-east-1';
        const finalStartUrl = startUrl || 'https://view.awsapps.com/start';

        // AWS SSO OIDC 的 scopes
        const scopes = [
            'codewhisperer:completions',
            'codewhisperer:analysis',
            'codewhisperer:conversations',
            'codewhisperer:transformations',
            'codewhisperer:taskassist'
        ];

        logger.info(`[AWS SSO] Starting automatic client registration...`);
        logger.info(`[AWS SSO] Region: ${region}, Start URL: ${finalStartUrl}`);

        // Step 1: 自动注册 Client
        const registerClientUrl = `https://oidc.${region}.amazonaws.com/client/register`;

        // 随机化 Client 配置
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const randomPort = 10000 + Math.floor(Math.random() * 50000);
        const clientNames = ['Kiro IDE', 'Kiro', 'Kiro Editor', 'Kiro Dev', 'AWS Kiro'];
        const randomClientName = clientNames[Math.floor(Math.random() * clientNames.length)];

        const registerClientBody = {
            clientName: `${randomClientName}-${randomSuffix}`,
            clientType: 'public',
            scopes: scopes,
            grantTypes: ['authorization_code', 'refresh_token'],
            redirectUris: [`http://127.0.0.1:${randomPort}/oauth/callback`],
            issuerUrl: finalStartUrl
        };

        const registerResponse = await axios.post(registerClientUrl, registerClientBody, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const { clientId, clientSecret, clientSecretExpiresAt } = registerResponse.data;

        if (!clientId || !clientSecret) {
            throw new Error('Failed to register client: missing clientId or clientSecret in response');
        }

        logger.info(`[AWS SSO] Client registered successfully!`);
        logger.info(`[AWS SSO] Client ID: ${clientId.substring(0, 10)}...`);
        logger.info(`[AWS SSO] Client expires at: ${new Date(clientSecretExpiresAt * 1000).toISOString()}`);

        // 动态导入 KiroService
        const { KiroService } = await import('../../../kiro/adapter.js');

        // 创建临时实例用于设备授权
        const kiroService = new KiroService(currentConfig);
        kiroService.clientId = clientId;
        kiroService.clientSecret = clientSecret;
        kiroService.region = region;
        kiroService.authMethod = 'IdC';
        await kiroService.initialize(true); // skipAuthCheck=true

        logger.info(`[AWS SSO] Starting device authorization for account ${accountNumber}`);
        logger.info(`[AWS SSO] Start URL: ${finalStartUrl}`);

        // 启动设备授权
        const deviceAuthInfo = await startDeviceAuthorization(kiroService, finalStartUrl);

        logger.info(`[AWS SSO] Device authorization started`);
        logger.info(`[AWS SSO] User Code: ${deviceAuthInfo.userCode}`);
        logger.info(`[AWS SSO] Verification URI: ${deviceAuthInfo.verificationUriComplete}`);

        // 启动后台轮询（不等待完成）
        pollDeviceToken(
            kiroService,
            deviceAuthInfo.deviceCode,
            deviceAuthInfo.interval,
            deviceAuthInfo.expiresIn
        ).then(async tokenResult => {
            // 轮询成功，使用 TokenStore 统一保存 token
            const credentialsData = {
                accessToken: tokenResult.accessToken,
                refreshToken: tokenResult.refreshToken,
                expiresAt: tokenResult.expiresAt,
                clientId: clientId,
                clientSecret: clientSecret,
                authMethod: 'IdC',
                provider: 'BuilderId',
                region: 'us-east-1'
            };

            const saveInfo = await tokenStore.saveToken(accountNumber, credentialsData, {
                fileName: `kiro-auth-token-${accountNumber}.json`
            });
            logger.info(`[AWS SSO] Token saved to: ${saveInfo.tokenFilePath}`);

            // 统一入池逻辑：使用 accountPoolManager.addAccount()
            try {
                const newAccount = {
                    KIRO_OAUTH_CREDS_FILE_PATH: saveInfo.relativePath,
                    isHealthy: true,
                    usageCount: 0,
                    errorCount: 0,
                    lastUsed: null,
                    lastErrorTime: null,
                    isDisabled: false,
                    lastHealthCheckTime: new Date().toISOString(),
                    lastHealthCheckModel: 'claude-haiku-4-5',
                    lastErrorMessage: null,
                    checkModelName: '',
                    checkHealth: true,
                    notSupportedModels: []
                };

                accountPoolManager.addAccount(newAccount);
                logger.info(`[AWS SSO] Token added to account pool: ${saveInfo.relativePath}`);

                // 广播提供商更新事件
                broadcastEvent('provider_update', {
                    action: 'add',
                    providerType: 'claude-kiro-oauth',
                    providerConfig: newAccount,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                logger.error(`[AWS SSO] Failed to add token to account pool: ${error.message}`);

                // 统一入池失败语义：失败回滚 token 文件
                try {
                    await tokenStore.deleteToken(accountNumber);
                    logger.info(`[AWS SSO] Rolled back token file for account ${accountNumber}`);
                } catch (rollbackError) {
                    logger.error(`[AWS SSO] Failed to rollback token file: ${rollbackError.message}`);
                }

                // 广播错误事件，让前端能够感知入池失败
                try {
                    broadcastEvent('oauth_error', {
                        provider: 'claude-kiro-oauth-builderid',
                        error: error.message,
                        errorName: error.name || 'Error',
                        errorCode: error.code || null,
                        timestamp: new Date().toISOString(),
                        accountNumber,
                        stage: 'addAccount'
                    });
                } catch (broadcastError) {
                    logger.error(`[AWS SSO] Failed to broadcast oauth_error: ${broadcastError.message}`);
                }

                return; // 入池失败，不继续执行
            }

            // 广播OAuth成功事件
            broadcastEvent('oauth_success', {
                provider: 'claude-kiro-oauth-builderid',
                credPath: saveInfo.relativePath,
                timestamp: new Date().toISOString()
            });

            logger.info(`[AWS SSO] Device authorization completed successfully for account ${accountNumber}`);
        }).catch(error => {
            logger.error(`[AWS SSO] Device authorization polling failed: ${error.message}`);

            // 广播错误事件，让前端能够感知后台轮询失败
            try {
                broadcastEvent('oauth_error', {
                    provider: 'claude-kiro-oauth-builderid',
                    error: error && error.message ? error.message : String(error),
                    errorName: error && error.name ? error.name : 'Error',
                    errorCode: error && error.code ? error.code : null,
                    timestamp: new Date().toISOString(),
                    accountNumber,
                    stage: 'pollDeviceToken'
                });
            } catch (broadcastError) {
                logger.error(`[AWS SSO] Failed to broadcast oauth_error: ${broadcastError.message}`);
            }
        }).finally(() => {
            // 清理 in-flight 标记（无论成功或失败）
            awsSsoInflight.delete(accountNumber);
            logger.debug(`[AWS SSO] Cleared in-flight flag for account ${accountNumber}`);
        });

        // 立即返回设备授权信息给前端
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'AWS SSO 设备授权已启动',
            accountNumber,
            userCode: deviceAuthInfo.userCode,
            verificationUri: deviceAuthInfo.verificationUri,
            verificationUriComplete: deviceAuthInfo.verificationUriComplete,
            expiresIn: deviceAuthInfo.expiresIn,
            interval: deviceAuthInfo.interval,
            deviceCode: deviceAuthInfo.deviceCode
        }));
    } catch (error) {
        // 避免 start 阶段抛错导致 in-flight 泄漏
        if (typeof accountNumber === 'number') {
            awsSsoInflight.delete(accountNumber);
            logger.debug(`[AWS SSO] Cleared in-flight flag for account ${accountNumber} due to error`);
        }

        logger.error('[AWS SSO] Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            message: error.message
        }));
    }
}
