import { EventEmitter } from 'node:events';
import { createLogger } from '../../../lib/logger.js';
import { startDeviceAuthorization, pollDeviceToken } from '../../../kiro/auth.js';
import { KiroService } from '../../../kiro/adapter.js';
import { tokenStore as defaultTokenStore } from '../token-store.js';
import { OAUTH_DOMAIN_EVENTS } from '../index.js';

const logger = createLogger('aws-sso-device');

/**
 * Kiro SSO 配置 (AWS SSO BuilderId)
 * 注意：这与 ui-manager.js 中的 KIRO_OAUTH_CONFIG 不同
 * 这里用于 AWS SSO 设备授权流程，ui-manager.js 中的用于社交登录
 */
const KIRO_SSO_CONFIG = {
    startUrl: 'https://view.awsapps.com/start/',
    region: 'us-east-1'
};

export class AwsSsoDeviceFlow extends EventEmitter {
    constructor(options = {}) {
        super();
        this.tokenStore = options.tokenStore || defaultTokenStore;
        this.accountPool = options.accountPool || null; // 期望注入 AccountPoolFacade
    }

    _emitDomainEvent(type, payload) {
        try {
            this.emit(type, {
                ...payload,
                timestamp: new Date().toISOString()
            });
        } catch (e) {
            logger.warn(`Domain event handler threw: ${e.message}`);
        }
    }

    /**
     * 启动 AWS SSO Device Flow（立即返回授权 URL；后台轮询 token）
     * - 不依赖 ui-manager.js，不直接广播 UI 事件
     * - token 落盘通过 TokenStore
     * - 入池通过 AccountPoolFacade（若注入）
     */
    async start(currentConfig) {
        try {
            const region = currentConfig.KIRO_REGION || KIRO_SSO_CONFIG.region;
            const startUrl = currentConfig.KIRO_START_URL || KIRO_SSO_CONFIG.startUrl;

            // AWS SSO OIDC 的 scopes (从 Kiro 源码获取)
            const scopes = [
                'codewhisperer:completions',
                'codewhisperer:analysis',
                'codewhisperer:conversations',
                'codewhisperer:transformations',
                'codewhisperer:taskassist'
            ];

            this._emitDomainEvent(OAUTH_DOMAIN_EVENTS.OAUTH_STARTED, {
                provider: 'claude-kiro-oauth',
                authMethod: 'IdC',
                region,
                startUrl
            });

            logger.info('Starting automatic client registration...');
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
                scopes,
                grantTypes: ['authorization_code', 'refresh_token'],
                redirectUris: [`http://127.0.0.1:${randomPort}/oauth/callback`],
                issuerUrl: startUrl
            };

            const axios = (await import('axios')).default;
            const registerResponse = await axios.post(registerClientUrl, registerClientBody, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });

            const { clientId, clientSecret, clientSecretExpiresAt } = registerResponse.data || {};
            if (!clientId || !clientSecret) {
                throw new Error('Failed to register client: missing clientId or clientSecret in response');
            }

            logger.info('Client registered successfully!');
            logger.info(`Client ID: ${clientId.substring(0, 10)}...`);
            if (clientSecretExpiresAt) {
                logger.info(`Client expires at: ${new Date(clientSecretExpiresAt * 1000).toISOString()}`);
            }

            // 创建临时实例用于设备授权
            const kiroService = new KiroService(currentConfig);
            kiroService.clientId = clientId;
            kiroService.clientSecret = clientSecret;
            kiroService.region = region;
            kiroService.authMethod = 'IdC';

            // 初始化 axios 实例 (skipAuthCheck=true 因为设备授权前没有现有凭据)
            await kiroService.initialize(true);

            logger.info('启动设备授权流程');
            logger.info(`Start URL: ${startUrl}`);

            // 启动设备授权流程
            const deviceAuthInfo = await startDeviceAuthorization(kiroService, startUrl);

            logger.info('Device authorization started');
            logger.info(`User Code: ${deviceAuthInfo.userCode}`);
            logger.info(`Verification URI: ${deviceAuthInfo.verificationUriComplete}`);

            // 启动后台轮询（不等待完成）
            pollDeviceToken(
                kiroService,
                deviceAuthInfo.deviceCode,
                deviceAuthInfo.interval,
                deviceAuthInfo.expiresIn
            ).then(async (tokenResult) => {
                // 生成唯一的账户编号（与旧实现保持一致）
                const accountNumber = Date.now();

                // ⚠️ TokenStore 会附加 savedAt 字段；其他字段保持一致
                const credentialsData = {
                    accessToken: tokenResult.accessToken,
                    refreshToken: tokenResult.refreshToken,
                    expiresAt: tokenResult.expiresAt,
                    clientId,
                    clientSecret,
                    authMethod: 'IdC',
                    provider: 'BuilderId',
                    region
                };

                const saveInfo = await this.tokenStore.saveToken(accountNumber, credentialsData, {
                    fileName: `kiro-auth-token-${accountNumber}.json`
                });

                this._emitDomainEvent(OAUTH_DOMAIN_EVENTS.TOKEN_SAVED, {
                    provider: 'claude-kiro-oauth',
                    accountNumber,
                    saveInfo
                });

                // 自动添加到账号池（通过 AccountPoolFacade；若未注入则跳过）
                let addedAccount = null;
                try {
                    if (this.accountPool && typeof this.accountPool.addAccount === 'function') {
                        addedAccount = await Promise.resolve(this.accountPool.addAccount({
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
                        }));
                        logger.info(`Auto-added to account pool with UUID: ${addedAccount.uuid}`);
                    }
                } catch (poolError) {
                    logger.error(`Failed to add to account pool: ${poolError.message}`);
                }

                // 与旧实现保持一致：token 落盘成功即视为授权成功（即使入池失败也成功）
                this._emitDomainEvent(OAUTH_DOMAIN_EVENTS.OAUTH_COMPLETED, {
                    provider: 'claude-kiro-oauth',
                    accountNumber,
                    uuid: addedAccount?.uuid || null
                });
            }).catch(async (error) => {
                logger.error(`Background polling failed: ${error.message}`);
                this._emitDomainEvent(OAUTH_DOMAIN_EVENTS.OAUTH_FAILED, {
                    provider: 'claude-kiro-oauth',
                    message: error.message
                });
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
                    instructions: '请在浏览器中打开此链接进行AWS SSO授权。授权完成后,系统会自动获取访问令牌并添加到提号池中。'
                }
            };
        } catch (error) {
            logger.error('授权失败:', error);
            this._emitDomainEvent(OAUTH_DOMAIN_EVENTS.OAUTH_FAILED, {
                provider: 'claude-kiro-oauth',
                message: error.message
            });
            throw new Error(`Kiro OAuth 授权失败: ${error.message}`);
        }
    }
}
