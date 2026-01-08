import { createLogger } from '../../lib/logger.js';
import { oauthStateStore } from './state-store.js';
import { tokenStore } from './token-store.js';
import { withLock } from '../../utils/mutex.js';

const logger = createLogger('OAuthFacade');

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
        const lockKey = `oauth:callback:${state}`;
        return withLock(lockKey, async () => {
            // 幂等性：优先检查 completedInfo，避免重复写 token / 重复入池
            const completedInfo = this.stateStore.getCompletedInfo(state);
            if (completedInfo) {
                logger.info(`[OAuth Callback] State ${state} already completed, returning cached result`);

                // 失败幂等：返回相同的失败信息
                if (completedInfo.resultOk === false) {
                    return fail(new Error(completedInfo.errorMessage || 'OAuth callback previously failed'), []);
                }

                // 成功幂等：返回相同的成功结果
                const relativePath = completedInfo.relativePath || null;
                const tokenFileName = relativePath
                    ? String(relativePath).replace(/\\/g, '/').split('/').slice(-1)[0]
                    : (completedInfo.accountNumber ? `kiro-auth-token-${completedInfo.accountNumber}.json` : null);

                return ok({
                    accountNumber: completedInfo.accountNumber,
                    tokenFileName,
                    tokenFilePath: null, // 幂等返回时不提供完整路径
                    provider: completedInfo.provider,
                    relativePath
                }, []);
            }

            const events = [];
            let stateData = null;
            let accountNumber = null;
            let saveInfo = null;

            // 辅助函数：记录失败的 completedInfo（失败也幂等）
            const recordCompletedFailure = async (message) => {
                try {
                    await this.stateStore.validateState(state, {
                        consume: false, // 失败时不 consume state
                        markCompleted: true,
                        completedInfo: {
                            accountNumber: accountNumber ?? (stateData ? (stateData.accountNumber || 1) : undefined),
                            relativePath: saveInfo?.relativePath,
                            provider: stateData?.provider,
                            resultOk: false,
                            errorMessage: message
                        }
                    });
                } catch (e) {
                    logger.warn('Failed to record completedInfo for failed callback', e);
                }
            };

            try {
                events.push({ type: OAUTH_DOMAIN_EVENTS.OAUTH_STARTED, timestamp: new Date().toISOString(), payload: { state } });

                stateData = await this.stateStore.getState(state);
                if (!stateData) {
                    const err = new Error('State 无效或已过期');
                    await recordCompletedFailure(err.message);
                    return fail(err, events);
                }

                const redirectUri = stateData.redirectUri;
                if (!redirectUri) {
                    const err = new Error('State 缺少 redirectUri');
                    await recordCompletedFailure(err.message);
                    return fail(err, events);
                }

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
                    const err = new Error(`Token 交换失败: ${tokenResponse.status} - ${errorText}`);
                    await recordCompletedFailure(err.message);
                    return fail(err, events);
                }

                const tokenData = await tokenResponse.json();

                accountNumber = stateData.accountNumber || 1;
                const tokenPayload = {
                    accessToken: tokenData.access_token,
                    refreshToken: tokenData.refresh_token,
                    expiresAt: Date.now() + (tokenData.expires_in * 1000),
                    machineid: stateData.machineid,
                    provider: stateData.provider,
                    createdAt: new Date().toISOString(),
                    createdBy: 'web-oauth'
                };

                saveInfo = await this.tokenStore.saveToken(accountNumber, tokenPayload, {
                    fileName: `kiro-auth-token-${accountNumber}.json`
                });
                events.push({ type: OAUTH_DOMAIN_EVENTS.TOKEN_SAVED, timestamp: new Date().toISOString(), payload: saveInfo });

                // 添加事务一致性保证 - 如果入池失败，回滚 token 文件
                if (this.accountPool && typeof this.accountPool.addAccount === 'function') {
                    try {
                        await this.accountPool.addAccount({
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
                    } catch (addAccountError) {
                        // 入池失败，回滚已保存的 token 文件
                        logger.error('Failed to add account to pool, rolling back token file', addAccountError);
                        try {
                            await this.tokenStore.deleteToken({ filePath: saveInfo.tokenFilePath });
                            logger.info('Token file rolled back successfully');
                        } catch (deleteError) {
                            logger.error('Failed to rollback token file', deleteError);
                        }

                        const err = new Error(`入池失败: ${addAccountError.message}`);
                        await recordCompletedFailure(err.message);
                        return fail(err, events);
                    }
                }

                // 只在所有操作成功后才 consume state
                await this.stateStore.validateState(state, {
                    consume: true,
                    markCompleted: true,
                    completedInfo: {
                        accountNumber,
                        relativePath: saveInfo.relativePath,
                        provider: stateData.provider,
                        resultOk: true
                    }
                });

                events.push({ type: OAUTH_DOMAIN_EVENTS.OAUTH_COMPLETED, timestamp: new Date().toISOString(), payload: { state, accountNumber } });

                // 返回 provider 信息，避免 handler 需要再次读取已消费的 state
                return ok({
                    accountNumber,
                    tokenFileName: saveInfo.tokenFileName,
                    tokenFilePath: saveInfo.tokenFilePath,
                    provider: stateData.provider
                }, events);
            } catch (error) {
                logger.warn('handleWebCallback failed', error);
                events.push({ type: OAUTH_DOMAIN_EVENTS.OAUTH_FAILED, timestamp: new Date().toISOString(), payload: { state, message: error.message } });
                await recordCompletedFailure(error instanceof Error ? error.message : String(error));
                return fail(error, events);
            }
        });
    }
}

export default OAuthFacade;
