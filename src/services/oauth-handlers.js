import fs from 'fs';
import path from 'path';
import { startDeviceAuthorization, pollDeviceToken } from '../kiro/auth.js';
import { createLogger } from '../lib/logger.js';
import { KIRO_OAUTH_CONFIG } from '../ui/oauth-states.js';

const logger = createLogger('services:oauth');

// 延迟导入 broadcastEvent 避免循环依赖
let _broadcastEvent = null;
async function getBroadcastEvent() {
    if (!_broadcastEvent) {
        const uiManager = await import('../ui-manager.js');
        _broadcastEvent = uiManager.broadcastEvent;
    }
    return _broadcastEvent;
}

/**
 * 处理 Kiro OAuth 授权 (AWS SSO 设备授权流程)
 * 使用动态客户端注册来获取 clientId 和 clientSecret
 * @param {Object} currentConfig - 当前配置对象
 * @param {Object} poolManager - 池管理器实例（provider/account，可选）
 * @returns {Promise<Object>} 返回授权URL和相关信息
 */
export async function handleKiroOAuth(currentConfig, poolManager = null) {
    try {
        const region = currentConfig.KIRO_REGION || KIRO_OAUTH_CONFIG.region;
        const startUrl = currentConfig.KIRO_START_URL || KIRO_OAUTH_CONFIG.startUrl;

        // AWS SSO OIDC 的 scopes (从 Kiro 源码获取)
        const scopes = [
            'codewhisperer:completions',
            'codewhisperer:analysis',
            'codewhisperer:conversations',
            'codewhisperer:transformations',
            'codewhisperer:taskassist'
        ];

        logger.info(`Starting automatic client registration...`);
        logger.info(`Region: ${region}, Start URL: ${startUrl}`);

        // Step 1: 自动注册 Client (调用 AWS SSO OIDC RegisterClient API)
        const registerClientUrl = `https://oidc.${region}.amazonaws.com/client/register`;

        // 随机化 Client 配置，降低批量注册特征
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
            issuerUrl: startUrl
        };

        const axios = (await import('axios')).default;
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

        logger.info(`Client registered successfully!`);
        logger.info(`Client ID: ${clientId.substring(0, 10)}...`);
        logger.info(`Client expires at: ${new Date(clientSecretExpiresAt * 1000).toISOString()}`);

        // 动态导入 KiroService (避免循环依赖)
        const { KiroService } = await import('../kiro/adapter.js');

        // 创建临时实例用于设备授权
        const kiroService = new KiroService(currentConfig);

        // 设置必要的属性
        kiroService.clientId = clientId;
        kiroService.clientSecret = clientSecret;
        kiroService.region = region;
        kiroService.authMethod = 'IdC';

        // 初始化 axios 实例 (skipAuthCheck=true 因为设备授权前没有现有凭据)
        await kiroService.initialize(true);

        logger.info(`启动设备授权流程`);
        logger.info(`Start URL: ${startUrl}`);

        // 启动设备授权流程
        const deviceAuthInfo = await startDeviceAuthorization(kiroService, startUrl);

        logger.info(`Device authorization started`);
        logger.info(`User Code: ${deviceAuthInfo.userCode}`);
        logger.info(`Verification URI: ${deviceAuthInfo.verificationUriComplete}`);

        // 启动后台轮询（不等待完成）
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

            // 生成唯一的账户编号
            const accountNumber = Date.now();
            const tokenFilePath = path.join(kiroConfigDir, `kiro-auth-token-${accountNumber}.json`);
            const credentialsData = {
                accessToken: tokenResult.accessToken,
                refreshToken: tokenResult.refreshToken,
                expiresAt: tokenResult.expiresAt,
                clientId: clientId,
                clientSecret: clientSecret,
                authMethod: 'IdC',
                provider: 'BuilderId',
                region: region
            };

            await fs.promises.writeFile(tokenFilePath, JSON.stringify(credentialsData, null, 2));
            logger.info(`Token saved to: ${tokenFilePath}`);

            // 自动添加到 account_pool.json（provider 层已移除）
            try {
                const relativePath = path.relative(process.cwd(), tokenFilePath);
                const normalizedPath = relativePath.replace(/\\/g, '/');

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

                const addedAccount = poolManager.addAccount(newAccount);
                logger.info(`Auto-added to account pool with UUID: ${addedAccount.uuid}`);

                const broadcast = await getBroadcastEvent();
                if (broadcast) {
                    broadcast('account_update', {
                        action: 'add',
                        uuid: addedAccount.uuid,
                        accountConfig: addedAccount,
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (poolError) {
                logger.error(`Failed to add to account pool: ${poolError.message}`);
            }

            // 广播授权成功事件
            const broadcast = await getBroadcastEvent();
            if (broadcast) {
                broadcast('oauth_success', {
                    provider: 'claude-kiro-oauth',
                    timestamp: new Date().toISOString()
                });
            }
        }).catch(async error => {
            logger.error(`Background polling failed: ${error.message}`);
            const broadcast = await getBroadcastEvent();
            if (broadcast) {
                broadcast('oauth_error', {
                    provider: 'claude-kiro-oauth',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });

        return {
            authUrl: deviceAuthInfo.verificationUriComplete,
            authInfo: {
                provider: 'claude-kiro-oauth',
                authMethod: 'IdC',
                deviceCode: deviceAuthInfo.deviceCode,
                userCode: deviceAuthInfo.userCode,
                verificationUri: deviceAuthInfo.verificationUri,
                verificationUriComplete: deviceAuthInfo.verificationUriComplete,
                expiresIn: deviceAuthInfo.expiresIn,
                interval: deviceAuthInfo.interval,
                instructions: '请在浏览器中打开此链接进行AWS SSO授权。授权完成后,系统会自动获取访问令牌并添加到提供商池中。'
            }
        };
    } catch (error) {
        logger.error(`授权失败:`, error);
        throw new Error(`Kiro OAuth 授权失败: ${error.message}`);
    }
}
