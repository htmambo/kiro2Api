/**
 * OAuth Handler 实现
 * 处理 OAuth 相关的 API 请求
 */
import { startDeviceAuthorization, pollDeviceToken } from '../../../kiro/auth.js';
import { createLogger } from '../../../lib/logger.js';
import { oauthStateStore } from '../../../domain/oauth/state-store.js';
import { tokenStore } from '../../../domain/oauth/token-store.js';
import { OAuthFacade } from '../../../domain/oauth/index.js';

const logger = createLogger('ui:handlers:oauth');

/**
 * OAuth 网页回调 Handler
 * 返回 HTML 页面
 */
export async function webCallback({ req, res, accountPoolManager }) {
    try {
        // 从 ui-manager.js 导入必要的函数
        const { generateOAuthResultPage, KIRO_OAUTH_CONFIG } = await import('../../../ui-manager.js');

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

        const { accountNumber, tokenFileName } = result.data;
        const stateData = await oauthStateStore.getState(state);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(generateOAuthResultPage(true, `账号 #${accountNumber} 授权成功！`, {
            accountNumber,
            tokenFile: tokenFileName,
            provider: stateData?.provider || 'Kiro'
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
        const path = await import('path');
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

            const credentialsData = {
                accessToken: newAccessToken,
                refreshToken: refreshToken,
                profileArn: finalProfileArn,
                expiresAt: expiresAt || new Date(Date.now() + 3600000).toISOString(),
                authMethod: 'manual-import',
                provider: 'Manual'
            };

            // 使用 TokenStore 统一写入 token 文件
            const saveInfo = await tokenStore.saveToken(accountNumber, credentialsData, {
                fileName: `kiro-auth-token-${accountNumber}.json`
            });
            logger.info(`[Kiro Manual Import] Token saved to: ${saveInfo.tokenFilePath}`);

            const { findDuplicateUserId } = await import('../../../utils/account-utils.js');

            let isDuplicate = false;
            let duplicateProvider = null;

            try {
                const accounts = accountPoolManager && typeof accountPoolManager.listAccounts === 'function'
                    ? accountPoolManager.listAccounts()
                    : [];

                // Check duplicate path
                const normalizedPath = saveInfo.relativePath;
                const pathExists = accounts.some(p => {
                    const existingPath = (p.KIRO_OAUTH_CREDS_FILE_PATH || '').replace(/\\/g, '/');
                    return existingPath === normalizedPath || existingPath === './' + normalizedPath;
                });

                // Check duplicate userId
                const userIdResult = await findDuplicateUserId(newAccessToken, finalProfileArn, accounts, currentConfig);
                if (userIdResult) {
                    isDuplicate = true;
                    duplicateProvider = userIdResult.existingProvider;
                    logger.info(`[Kiro Manual Import] Duplicate account detected: ${userIdResult.userId}`);

                    // Delete the token file
                    await tokenStore.deleteToken({ filePath: saveInfo.tokenFilePath });
                    logger.info(`[Kiro Manual Import] Deleted duplicate token file: ${saveInfo.tokenFilePath}`);

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

                if (!pathExists) {
                    const newAccount = {
                        KIRO_OAUTH_CREDS_FILE_PATH: normalizedPath,
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

                    // 使用 accountPoolManager 统一入池（消除 TODO）
                    accountPoolManager.addAccount(newAccount);
                    logger.info(`[Kiro Manual Import] Added to account pool: ${normalizedPath}`);

                    broadcastEvent('provider_update', {
                        action: 'add',
                        providerType: 'claude-kiro-oauth',
                        providerConfig: newAccount,
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (error) {
                logger.error(`[Kiro Manual Import] Failed to add to provider pool: ${error.message}`);
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
    try {
        const { parseRequestBody } = await import('../../../ui-manager.js');
        const { broadcastEvent } = await import('../../events.js');
        const path = await import('path');
        const axios = (await import('axios')).default;

        const body = await parseRequestBody(req);
        const { accountNumber = 1, startUrl } = body;

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
        const fs = await import('fs');

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

            try {
                const result = accountPoolManager.addTokenFile(saveInfo.tokenFilePath);
                logger.info(`[AWS SSO] Token added to acount_pool.json: ${result}`);

                if(result === 1) {
                    // 广播提供商更新事件
                    broadcastEvent('provider_update', {
                        action: 'add',
                        providerType: 'claude-kiro-oauth',
                        providerConfig: accountPoolManager.providerPools['claude-kiro-oauth'].slice(-1)[0],
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (error) {
                logger.error(`[AWS SSO] Failed to add token to account_pool.json: ${error.message}`);
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
        logger.error('[AWS SSO] Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            message: error.message
        }));
    }
}
