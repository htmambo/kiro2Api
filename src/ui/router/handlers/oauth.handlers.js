/**
 * OAuth Handler 实现
 * 处理 OAuth 相关的 API 请求
 */
import { startDeviceAuthorization, pollDeviceToken } from '../../../kiro/auth.js';
// OAuth 相关的全局状态和函数需要从 ui-manager.js 导入

/**
 * OAuth 网页回调 Handler
 * 返回 HTML 页面
 */
export async function webCallback({ req, res }) {
    try {
        // 从 ui-manager.js 导入必要的函数和状态
        const { kiroOAuthStates, generateOAuthResultPage, KIRO_OAUTH_CONFIG } = await import('../../../ui-manager.js');

        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const code = urlObj.searchParams.get('code');
        const state = urlObj.searchParams.get('state');

        console.log(`[Kiro OAuth Web] Received callback: code=${code?.substring(0, 10)}..., state=${state?.substring(0, 10)}...`);

        if (!code || !state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(generateOAuthResultPage(false, '缺少必要参数 (code 或 state)'));
            return;
        }

        // 查找对应的 state（需要从 ui-manager.js 导入）
        const stateData = kiroOAuthStates.get(state);
        if (!stateData) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(generateOAuthResultPage(false, 'State 无效或已过期，请重新生成授权链接'));
            return;
        }

        // 检查是否过期（30分钟）
        if (Date.now() - stateData.timestamp > 30 * 60 * 1000) {
            kiroOAuthStates.delete(state);
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(generateOAuthResultPage(false, '授权已过期（超过30分钟），请重新生成授权链接'));
            return;
        }

        const redirectUri = stateData.redirectUri;

        // 交换 code 获取 token
        console.log('[Kiro OAuth Web] Exchanging code for token...');
        const tokenResponse = await fetch(KIRO_OAUTH_CONFIG.TOKEN_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': `Kiro/${KIRO_OAUTH_CONFIG.IDE_VERSION}`,
                'x-machineid': stateData.machineid
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirectUri,
                code_verifier: stateData.code_verifier
            }).toString()
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('[Kiro OAuth Web] Token exchange failed:', errorText);
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(generateOAuthResultPage(false, `Token 交换失败: ${tokenResponse.status} - ${errorText}`));
            return;
        }

        const tokenData = await tokenResponse.json();
        console.log('[Kiro OAuth Web] Token exchange successful!');

        // 保存 token 到文件
        const accountNumber = stateData.accountNumber || 1;
        const tokenFileName = `kiro-auth-token-${accountNumber}.json`;
        const path = await import('path');
        const fs = await import('fs');
        const tokenFilePath = path.default.join(process.cwd(), 'configs', 'kiro', tokenFileName);

        const tokenDir = path.default.dirname(tokenFilePath);
        if (!fs.default.existsSync(tokenDir)) {
            fs.default.mkdirSync(tokenDir, { recursive: true });
        }

        const fullTokenData = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: Date.now() + (tokenData.expires_in * 1000),
            machineid: stateData.machineid,
            provider: stateData.provider,
            createdAt: new Date().toISOString(),
            createdBy: 'web-oauth'
        };

        fs.default.writeFileSync(tokenFilePath, JSON.stringify(fullTokenData, null, 2));
        console.log(`[Kiro OAuth Web] Token saved to: ${tokenFilePath}`);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(generateOAuthResultPage(true, `账号 #${accountNumber} 授权成功！`, {
            accountNumber,
            tokenFile: tokenFileName,
            provider: stateData.provider
        }));
    } catch (error) {
        console.error('[Kiro OAuth Web] Callback handling error:', error);
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body><h1>处理失败</h1></body></html>');
    }
}

/**
 * 检查 OAuth state 状态
 */
export async function checkState({ req, res }) {
    try {
        // 从 ui-manager.js 导入状态
        const { kiroOAuthStates, kiroOAuthCompletedStates } = await import('../../../ui-manager.js');

        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const state = urlObj.searchParams.get('state');

        if (!state) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing state parameter' }));
            return;
        }

        const stateData = kiroOAuthStates.get(state);

        if (stateData) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ completed: false }));
        } else {
            const completedInfo = kiroOAuthCompletedStates?.get(state) || {};
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                completed: true,
                accountNumber: completedInfo.accountNumber
            }));
        }
    } catch (error) {
        console.error('[Kiro OAuth] Check state error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
    }
}

/**
 * 手动导入 refreshToken
 */
export async function manualImport({ req, res, currentConfig, providerPoolManager }) {
    try {
        const { parseRequestBody } = await import('../../../ui-manager.js');
        const { generateUUID } = await import('../../../utils/account-utils.js');
        const { broadcastEvent } = await import('../../events.js');
        const { existsSync, readFileSync, writeFileSync } = await import('fs');
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

        console.log(`[Kiro Manual Import] Importing refreshToken for account ${accountNumber}`);

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

            console.log('[Kiro Manual Import] RefreshToken validated and refreshed successfully');
            console.log(`[Kiro Manual Import] ProfileArn: ${finalProfileArn}`);

            // Save token to configs/kiro directory
            const kiroConfigDir = path.join(process.cwd(), 'configs', 'kiro');
            await (await import('fs')).mkdir(kiroConfigDir, { recursive: true });

            const tokenFilePath = path.join(kiroConfigDir, `kiro-auth-token-${accountNumber}.json`);
            const credentialsData = {
                accessToken: newAccessToken,
                refreshToken: refreshToken,
                profileArn: finalProfileArn,
                expiresAt: expiresAt || new Date(Date.now() + 3600000).toISOString(),
                authMethod: 'manual-import',
                provider: 'Manual'
            };

            await (await import('fs')).writeFile(tokenFilePath, JSON.stringify(credentialsData, null, 2));
            console.log('[Kiro Manual Import] Token saved to:', tokenFilePath);

            // Check for duplicates and add to provider_pools.json
            const { PROVIDER_POOLS_FILE } = await import('../../../ui-manager.js');
            const { findDuplicateUserId } = await import('../../../utils/account-utils.js');

            let isDuplicate = false;
            let duplicateProvider = null;

            try {
                const poolsFilePath = currentConfig.PROVIDER_POOLS_FILE_PATH || PROVIDER_POOLS_FILE;
                let providerPools = {};

                if (existsSync(poolsFilePath)) {
                    const fileContent = readFileSync(poolsFilePath, 'utf8');
                    providerPools = JSON.parse(fileContent);
                }

                if (!providerPools['claude-kiro-oauth']) {
                    providerPools['claude-kiro-oauth'] = [];
                }

                // Check duplicate path
                const relativePath = path.relative(process.cwd(), tokenFilePath);
                const normalizedPath = relativePath.replace(/\\/g, '/');
                const pathExists = providerPools['claude-kiro-oauth'].some(p => {
                    const existingPath = (p.KIRO_OAUTH_CREDS_FILE_PATH || '').replace(/\\/g, '/');
                    return existingPath === normalizedPath || existingPath === './' + normalizedPath;
                });

                // Check duplicate userId
                const userIdResult = await findDuplicateUserId(newAccessToken, finalProfileArn, providerPools['claude-kiro-oauth'], currentConfig);
                if (userIdResult) {
                    isDuplicate = true;
                    duplicateProvider = userIdResult.existingProvider;
                    console.log(`[Kiro Manual Import] Duplicate account detected: ${userIdResult.userId}`);

                    // Delete the token file
                    await (await import('fs')).unlink(tokenFilePath);
                    console.log(`[Kiro Manual Import] Deleted duplicate token file: ${tokenFilePath}`);

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
                    const newProvider = {
                        uuid: generateUUID(),
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

                    providerPools['claude-kiro-oauth'].push(newProvider);
                    writeFileSync(poolsFilePath, JSON.stringify(providerPools, null, 2), 'utf8');
                    console.log(`[Kiro Manual Import] Added to provider pool with UUID: ${newProvider.uuid}`);

                    if (providerPoolManager) {
                        providerPoolManager.providerPools = providerPools;
                        providerPoolManager.initializeProviderStatus();
                    }

                    broadcastEvent('provider_update', {
                        action: 'add',
                        providerType: 'claude-kiro-oauth',
                        providerConfig: newProvider,
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (error) {
                console.error('[Kiro Manual Import] Failed to add to provider pool:', error.message);
            }

            broadcastEvent('oauth_success', {
                provider: 'claude-kiro-oauth-manual',
                credPath: path.relative(process.cwd(), tokenFilePath),
                timestamp: new Date().toISOString()
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'RefreshToken 导入成功',
                tokenFile: tokenFilePath,
                profileArn: finalProfileArn
            }));
        } catch (refreshError) {
            console.error('[Kiro Manual Import] RefreshToken validation failed:', refreshError.message);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: `RefreshToken 无效或已过期: ${refreshError.message}`
            }));
        }
    } catch (error) {
        console.error('[Kiro Manual Import] Error:', error);
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
export async function awsSsoStart({ req, res, currentConfig, providerPoolManager }) {
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

        console.log(`[AWS SSO] Starting automatic client registration...`);
        console.log(`[AWS SSO] Region: ${region}, Start URL: ${finalStartUrl}`);

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

        console.log(`[AWS SSO] Client registered successfully!`);
        console.log(`[AWS SSO] Client ID: ${clientId.substring(0, 10)}...`);
        console.log(`[AWS SSO] Client expires at: ${new Date(clientSecretExpiresAt * 1000).toISOString()}`);

        // 动态导入 KiroService
        const { KiroService } = await import('../../../kiro/adapter.js');

        // 创建临时实例用于设备授权
        const kiroService = new KiroService(currentConfig);
        kiroService.clientId = clientId;
        kiroService.clientSecret = clientSecret;
        kiroService.region = region;
        kiroService.authMethod = 'IdC';
        await kiroService.initialize(true); // skipAuthCheck=true

        console.log(`[AWS SSO] Starting device authorization for account ${accountNumber}`);
        console.log(`[AWS SSO] Start URL: ${finalStartUrl}`);

        // 启动设备授权
        const deviceAuthInfo = await startDeviceAuthorization(kiroService, finalStartUrl);

        console.log(`[AWS SSO] Device authorization started`);
        console.log(`[AWS SSO] User Code: ${deviceAuthInfo.userCode}`);
        console.log(`[AWS SSO] Verification URI: ${deviceAuthInfo.verificationUriComplete}`);

        // 启动后台轮询（不等待完成）
        const fs = await import('fs');

        pollDeviceToken(
            kiroService,
            deviceAuthInfo.deviceCode,
            deviceAuthInfo.interval,
            deviceAuthInfo.expiresIn
        ).then(async tokenResult => {
            // 轮询成功，保存token到configs/kiro目录
            const kiroConfigDir = path.join(process.cwd(), 'configs', 'kiro');

            // 确保目录存在
            await fs.promises.mkdir(kiroConfigDir, { recursive: true });

            const tokenFilePath = path.join(kiroConfigDir, `kiro-auth-token-${accountNumber}.json`);
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

            await fs.promises.writeFile(tokenFilePath, JSON.stringify(credentialsData, null, 2));
            console.log(`[AWS SSO] Token saved to: ${tokenFilePath}`);

            // 自动添加到 provider_pools.json
            try {
                const result = providerPoolManager.addTokenFile(tokenFilePath);
                console.log(`[AWS SSO] Token added to provider_pools.json: ${result}`);

                if(result === 1) {
                    // 广播提供商更新事件
                    broadcastEvent('provider_update', {
                        action: 'add',
                        providerType: 'claude-kiro-oauth',
                        providerConfig: providerPoolManager.providerPools['claude-kiro-oauth'].slice(-1)[0],
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (error) {
                console.error(`[AWS SSO] Failed to add token to provider_pools.json: ${error.message}`);
            }

            // 广播OAuth成功事件
            broadcastEvent('oauth_success', {
                provider: 'claude-kiro-oauth-builderid',
                credPath: path.relative(process.cwd(), tokenFilePath),
                timestamp: new Date().toISOString()
            });

            console.log(`[AWS SSO] Device authorization completed successfully for account ${accountNumber}`);
        }).catch(error => {
            console.error(`[AWS SSO] Device authorization polling failed: ${error.message}`);
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
        console.error('[AWS SSO] Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            message: error.message
        }));
    }
}
