import { createLogger } from '../../lib/logger.js';
import { oauthStateStore } from './state-store.js';
import { tokenStore } from './token-store.js';

const logger = createLogger('domain:oauth:facade');

export const OAUTH_DOMAIN_EVENTS = Object.freeze({
    OAUTH_STARTED: 'oauth_started',
    OAUTH_COMPLETED: 'oauth_completed',
    OAUTH_FAILED: 'oauth_failed',
    TOKEN_SAVED: 'token_saved'
});

function ok(data, events = []) {
    return { ok: true, data, error: null, events };
}

function fail(error, events = []) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, data: null, error: { message }, events };
}

export class OAuthFacade {
    constructor(options = {}) {
        this.stateStore = options.stateStore || oauthStateStore;
        this.tokenStore = options.tokenStore || tokenStore;
        this.accountPool = options.accountPool || null; // 只要求有 addAccount/listAccounts 等方法（可注入 AccountPoolFacade 或旧 manager）
    }

    async createState(stateData) {
        const created = await this.stateStore.createState(stateData);
        return ok(created);
    }

    async getState(state) {
        const data = await this.stateStore.getState(state);
        return ok(data);
    }

    async validateState(state, options) {
        const data = await this.stateStore.validateState(state, options);
        return ok(data);
    }

    async cleanExpiredStates() {
        const stats = await this.stateStore.cleanExpiredStates();
        return ok(stats);
    }

    /**
     * 处理 Web OAuth callback：交换 code -> token，落盘 token 文件，并（可选）入池
     * 注意：不生成 HTML，不依赖 ui-manager.js；UI 层只负责把结果渲染为页面/JSON
     */
    async handleWebCallback({ code, state, oauthConfig }) {
        const events = [];
        try {
            events.push({ type: OAUTH_DOMAIN_EVENTS.OAUTH_STARTED, timestamp: new Date().toISOString(), payload: { state } });

            const stateData = await this.stateStore.getState(state);
            if (!stateData) return fail(new Error('State 无效或已过期'), events);

            const redirectUri = stateData.redirectUri;
            if (!redirectUri) return fail(new Error('State 缺少 redirectUri'), events);

            const tokenResponse = await fetch(oauthConfig.TOKEN_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': `Kiro/${oauthConfig.IDE_VERSION}`,
                    'x-machineid': stateData.machineid
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: redirectUri,
                    code_verifier: stateData.code_verifier
                }).toString()
            });

            if (!tokenResponse.ok) {
                const errorText = await tokenResponse.text();
                return fail(new Error(`Token 交换失败: ${tokenResponse.status} - ${errorText}`), events);
            }

            const tokenData = await tokenResponse.json();

            const accountNumber = stateData.accountNumber || 1;
            const tokenPayload = {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: Date.now() + (tokenData.expires_in * 1000),
                machineid: stateData.machineid,
                provider: stateData.provider,
                createdAt: new Date().toISOString(),
                createdBy: 'web-oauth'
            };

            const saveInfo = await this.tokenStore.saveToken(accountNumber, tokenPayload, {
                fileName: `kiro-auth-token-${accountNumber}.json`
            });
            events.push({ type: OAUTH_DOMAIN_EVENTS.TOKEN_SAVED, timestamp: new Date().toISOString(), payload: saveInfo });

            if (this.accountPool && typeof this.accountPool.addAccount === 'function') {
                this.accountPool.addAccount({
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
                });
            }

            await this.stateStore.validateState(state, {
                consume: true,
                markCompleted: true,
                completedInfo: { accountNumber }
            });

            events.push({ type: OAUTH_DOMAIN_EVENTS.OAUTH_COMPLETED, timestamp: new Date().toISOString(), payload: { state, accountNumber } });
            return ok({ accountNumber, tokenFileName: saveInfo.tokenFileName, tokenFilePath: saveInfo.tokenFilePath }, events);
        } catch (error) {
            logger.warn('[OAuthFacade] handleWebCallback failed', error);
            events.push({ type: OAUTH_DOMAIN_EVENTS.OAUTH_FAILED, timestamp: new Date().toISOString(), payload: { state, message: error.message } });
            return fail(error, events);
        }
    }
}

export default OAuthFacade;
