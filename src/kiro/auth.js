import { promises as fs } from 'fs';
import * as path from 'path';
import { createLogger } from '../lib/logger.js';
import { KIRO_IDE_VERSION } from './constants.js';

const logger = createLogger('Kiro Auth');

export const KIRO_CONSTANTS = {
    REFRESH_URL: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken',
    REFRESH_IDC_URL: 'https://oidc.{{region}}.amazonaws.com/token',
    DEVICE_AUTH_URL: 'https://oidc.{{region}}.amazonaws.com/device_authorization',
    REGISTER_CLIENT_URL: 'https://oidc.{{region}}.amazonaws.com/client/register',
    BASE_URL: 'https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse',
    AMAZON_Q_URL: 'https://codewhisperer.{{region}}.amazonaws.com/SendMessageStreaming',
    USAGE_LIMITS_URL: 'https://q.{{region}}.amazonaws.com/getUsageLimits',
    DEFAULT_MODEL_NAME: 'claude-sonnet-4-20250514',
    AXIOS_TIMEOUT: 120000,
    REQUEST_TIMEOUT_MS: 120000,  // 普通请求超时（120秒）
    STREAM_TIMEOUT_MS: 180000,   // 流式请求超时（180秒）
    SEARCH_TIMEOUT_MS: 10000,    // 搜索请求超时（10秒）
    // 新增：可配置的超时常量（与 config.js 中的配置项对应）
    TIMEOUT_API_REQUEST: 120000,    // API 请求超时（120秒）
    TIMEOUT_STREAM_REQUEST: 300000, // 流式请求超时（300秒）
    TIMEOUT_AUTH_REQUEST: 30000,    // 认证请求超时（30秒）
    USER_AGENT: 'KiroIDE',
    KIRO_VERSION: KIRO_IDE_VERSION,  // 从 constants.js 导入
    CONTENT_TYPE_JSON: 'application/json',
    ACCEPT_JSON: 'application/json',
    AUTH_METHOD_SOCIAL: 'social',
    AUTH_METHOD_IDC: 'IdC',
    CHAT_TRIGGER_TYPE_MANUAL: 'MANUAL',
    ORIGIN_AI_EDITOR: 'AI_EDITOR',
    EXPIRE_WINDOW_MS: 5 * 60 * 1000,
    REFRESH_DEBOUNCE_MS: 30 * 1000,
    DEVICE_GRANT_TYPE: 'urn:ietf:params:oauth:grant-type:device_code'
};

const KIRO_AUTH_TOKEN_FILE = 'kiro-auth-token.json';
const refreshTokenDebounceMap = new Map();

export async function loadCredentialsFromFile(filePath) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        return JSON.parse(fileContent);
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.debug(`Credential file not found: ${filePath}`);
        } else if (error instanceof SyntaxError) {
            logger.warn(`Failed to parse JSON from ${filePath}: ${error.message}`);
        } else {
            logger.warn(`Failed to read credential file ${filePath}: ${error.message}`);
        }
        return null;
    }
}

export async function saveCredentialsToFile(filePath, newData) {
    try {
        let existingData = {};
        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            existingData = JSON.parse(fileContent);
        } catch (readError) {
            if (readError.code === 'ENOENT') {
                logger.debug(`Token file not found, creating new one: ${filePath}`);
            } else {
                logger.warn(`Could not read existing token file ${filePath}: ${readError.message}`);
            }
        }
        const mergedData = { ...existingData, ...newData };
        await fs.writeFile(filePath, JSON.stringify(mergedData, null, 2), 'utf8');
        logger.info(`Updated token file: ${filePath}`);
    } catch (error) {
        logger.error(`Failed to write token to file ${filePath}: ${error.message}`);
    }
}

export async function initializeAuth(service, forceRefresh = false) {
    if (service.accessToken && !forceRefresh) {
        logger.debug('Access token already available and not forced refresh.');
        return;
    }

    try {
        let mergedCredentials = {};

        if (service.base64Creds) {
            Object.assign(mergedCredentials, service.base64Creds);
            logger.info('Successfully loaded credentials from Base64 (constructor).');
            service.base64Creds = null;
        }

        const targetFilePath = service.credsFilePath || path.join(service.credPath, KIRO_AUTH_TOKEN_FILE);
        logger.debug(`Attempting to load credentials from directory: ${path.dirname(targetFilePath)}`);

        const targetCredentials = await loadCredentialsFromFile(targetFilePath);
        if (targetCredentials) {
            Object.assign(mergedCredentials, targetCredentials);
            logger.info(`Successfully loaded OAuth credentials from ${targetFilePath}`);
        }

        service.accessToken = service.accessToken || mergedCredentials.accessToken;
        service.refreshToken = service.refreshToken || mergedCredentials.refreshToken;
        service.clientId = service.clientId || mergedCredentials.clientId;
        service.clientSecret = service.clientSecret || mergedCredentials.clientSecret;
        service.authMethod = service.authMethod || mergedCredentials.authMethod;
        service.expiresAt = service.expiresAt || mergedCredentials.expiresAt;
        service.profileArn = service.profileArn || mergedCredentials.profileArn;
        service.region = service.region || mergedCredentials.region;

        if (!service.region) {
            logger.warn('Region not found in credentials. Using default region us-east-1 for URLs.');
            service.region = 'us-east-1';
        }

        service.refreshUrl = KIRO_CONSTANTS.REFRESH_URL.replace('{{region}}', service.region);
        service.refreshIDCUrl = KIRO_CONSTANTS.REFRESH_IDC_URL.replace('{{region}}', service.region);
        service.baseUrl = KIRO_CONSTANTS.BASE_URL.replace('{{region}}', service.region);
        service.amazonQUrl = KIRO_CONSTANTS.AMAZON_Q_URL.replace('{{region}}', service.region);
    } catch (error) {
        logger.warn(`Error during credential loading: ${error.message}`);
    }

    if (forceRefresh || (!service.accessToken && service.refreshToken)) {
        await refreshAccessTokenIfNeeded(service);
    }

    if (!service.accessToken) {
        throw new Error('No access token available after initialization and refresh attempts.');
    }
}

export async function refreshAccessTokenIfNeeded(service) {
    if (!service.refreshToken) {
        throw new Error('No refresh token available');
    }

    let debounceState = refreshTokenDebounceMap.get(service.refreshToken);
    if (!debounceState) {
        debounceState = { lastAttemptTime: new Date(0), promise: null };
        refreshTokenDebounceMap.set(service.refreshToken, debounceState);
    }

    if (debounceState.promise) {
        logger.info('Token refresh already in progress for this account, waiting...');
        return await debounceState.promise;
    }

    const expiresAt = new Date(service.expiresAt).getTime();
    const currentTime = Date.now();
    const timeUntilExpiry = expiresAt - currentTime;

    if (timeUntilExpiry > KIRO_CONSTANTS.EXPIRE_WINDOW_MS) {
        return;
    }

    const timeSinceLastRefresh = currentTime - debounceState.lastAttemptTime.getTime();
    if (timeSinceLastRefresh < KIRO_CONSTANTS.REFRESH_DEBOUNCE_MS) {
        logger.info(
            `Refresh attempted ${Math.floor(timeSinceLastRefresh / 1000)}s ago for this account, skipping (debounce)`
        );
        if (timeUntilExpiry <= 0) {
            throw new Error('Token is expired. Please refresh SSO session.');
        }
        return;
    }

    debounceState.lastAttemptTime = new Date();
    debounceState.promise = doRefreshToken(service);

    try {
        await debounceState.promise;
    } finally {
        debounceState.promise = null;
    }
}

export async function doRefreshToken(service) {
    if (!service.refreshToken) {
        throw new Error('No refresh token available to refresh access token.');
    }

    try {
        const requestBody = { refreshToken: service.refreshToken };
        let refreshUrl = service.refreshUrl;
        if (service.authMethod !== KIRO_CONSTANTS.AUTH_METHOD_SOCIAL) {
            refreshUrl = service.refreshIDCUrl;
            requestBody.clientId = service.clientId;
            requestBody.clientSecret = service.clientSecret;
            requestBody.grantType = 'refresh_token';
        }

        logger.info('Refreshing access token...');
        logger.debug('Refresh URL:', { refreshUrl });
        logger.debug('Auth method:', { authMethod: service.authMethod });
        logger.debug('Request body keys:', { keys: Object.keys(requestBody) });

        const response = await service.axiosInstance.post(refreshUrl, requestBody);
        logger.debug('Token refresh response status:', { status: response.status });
        logger.debug('Token refresh response data keys:', { keys: Object.keys(response.data || {}) });
        logger.debug('Token refresh response data:', { data: JSON.stringify(response.data, null, 2) });

        if (response.data && response.data.accessToken) {
            service.accessToken = response.data.accessToken;
            service.refreshToken = response.data.refreshToken || service.refreshToken;
            service.profileArn = response.data.profileArn || service.profileArn;

            const expiresIn = response.data.expiresIn;
            let expiresAt;
            if (expiresIn !== undefined && expiresIn !== null) {
                expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
            } else if (response.data.expiresAt) {
                expiresAt = response.data.expiresAt;
            } else {
                logger.warn('No expiresIn or expiresAt in response, using default 1 hour');
                expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
            }
            service.expiresAt = expiresAt;
            logger.info('Access token refreshed successfully');
            logger.info('New expiresAt:', { expiresAt });

            const tokenFilePath = service.credsFilePath || path.join(service.credPath, KIRO_AUTH_TOKEN_FILE);
            const updatedTokenData = {
                accessToken: service.accessToken,
                refreshToken: service.refreshToken,
                expiresAt
            };
            if (service.profileArn) {
                updatedTokenData.profileArn = service.profileArn;
            }
            await saveCredentialsToFile(tokenFilePath, updatedTokenData);
        } else {
            throw new Error('Invalid refresh response: Missing accessToken');
        }
    } catch (error) {
        logger.error('Token refresh failed:', { error: error.message });
        throw new Error(`Token refresh failed: ${error.message}`);
    }
}

export async function startDeviceAuthorization(service, startUrl) {
    if (!service.clientId || !service.clientSecret) {
        throw new Error('Missing clientId or clientSecret. Cannot start device authorization.');
    }

    const deviceAuthUrl = KIRO_CONSTANTS.DEVICE_AUTH_URL.replace('{{region}}', service.region);
    const requestBody = {
        clientId: service.clientId,
        clientSecret: service.clientSecret,
        startUrl
    };

    logger.info('Starting device authorization...');
    logger.debug('Device auth URL:', { deviceAuthUrl });
    logger.debug('Start URL:', { startUrl });

    try {
        const response = await service.axiosInstance.post(deviceAuthUrl, requestBody);
        logger.info('Device authorization started successfully');
        logger.debug('Response:', { data: JSON.stringify(response.data, null, 2) });

        const {
            deviceCode,
            userCode,
            verificationUri,
            verificationUriComplete,
            expiresIn,
            interval
        } = response.data;

        if (!deviceCode || !userCode || !verificationUri) {
            throw new Error('Invalid device authorization response: Missing required fields');
        }

        return {
            deviceCode,
            userCode,
            verificationUri,
            verificationUriComplete: verificationUriComplete || `${verificationUri}?user_code=${userCode}`,
            expiresIn: expiresIn || 300,
            interval: interval || 5
        };
    } catch (error) {
        logger.error('Failed to start device authorization:', { error: error.message });
        throw new Error(`Device authorization failed: ${error.message}`);
    }
}

export async function pollDeviceToken(service, deviceCode, interval = 5, expiresIn = 300) {
    if (!service.clientId || !service.clientSecret) {
        throw new Error('Missing clientId or clientSecret. Cannot poll for token.');
    }

    const tokenUrl = KIRO_CONSTANTS.REFRESH_IDC_URL.replace('{{region}}', service.region);
    const maxAttempts = Math.floor(expiresIn / interval);
    let attempts = 0;

    logger.info(`Starting token polling, interval ${interval}s, max attempts ${maxAttempts}`);

    const poll = async () => {
        if (attempts >= maxAttempts) {
            throw new Error('Device authorization timeout. Please restart the authorization flow.');
        }

        attempts += 1;

        const requestBody = {
            clientId: service.clientId,
            clientSecret: service.clientSecret,
            deviceCode,
            grantType: KIRO_CONSTANTS.DEVICE_GRANT_TYPE
        };

        try {
            const response = await service.axiosInstance.post(tokenUrl, requestBody);

            if (response.data && response.data.accessToken) {
                logger.info('Successfully obtained token');

                const {
                    accessToken,
                    refreshToken,
                    expiresIn: tokenExpiresIn,
                    tokenType
                } = response.data;

                service.accessToken = accessToken;
                service.refreshToken = refreshToken;
                const expiresAt = tokenExpiresIn
                    ? new Date(Date.now() + tokenExpiresIn * 1000).toISOString()
                    : new Date(Date.now() + 3600 * 1000).toISOString();
                service.expiresAt = expiresAt;

                const tokenFilePath = service.credsFilePath || path.join(service.credPath, KIRO_AUTH_TOKEN_FILE);
                const tokenData = {
                    accessToken,
                    refreshToken,
                    expiresAt,
                    clientId: service.clientId,
                    clientSecret: service.clientSecret,
                    authMethod: KIRO_CONSTANTS.AUTH_METHOD_IDC,
                    provider: 'BuilderId',
                    region: service.region
                };
                await saveCredentialsToFile(tokenFilePath, tokenData);
                logger.info('Token saved to file');

                return {
                    accessToken,
                    refreshToken,
                    expiresIn: tokenExpiresIn,
                    tokenType,
                    expiresAt
                };
            }
        } catch (error) {
            if (error.response?.data?.error) {
                const errorType = error.response.data.error;

                if (errorType === 'authorization_pending') {
                    logger.debug(
                        `Waiting for user authorization... (attempt ${attempts}/${maxAttempts})`
                    );
                    await new Promise(resolve => setTimeout(resolve, interval * 1000));
                    return poll();
                } else if (errorType === 'slow_down') {
                    logger.info('Slowing down polling frequency');
                    await new Promise(resolve => setTimeout(resolve, (interval + 5) * 1000));
                    return poll();
                } else if (errorType === 'expired_token') {
                    throw new Error('Device code expired. Please restart the authorization flow.');
                } else if (errorType === 'access_denied') {
                    throw new Error('User denied the authorization request.');
                }
            }

            logger.warn(
                `Polling error (attempt ${attempts}/${maxAttempts}):`,
                { error: error.message }
            );
            await new Promise(resolve => setTimeout(resolve, interval * 1000));
            return poll();
        }
    };

    return poll();
}

export async function initiateDeviceAuthorization(service, startUrl) {
    const deviceAuthInfo = await startDeviceAuthorization(service, startUrl);

    pollDeviceToken(service, deviceAuthInfo.deviceCode, deviceAuthInfo.interval, deviceAuthInfo.expiresIn)
        .catch(error => {
            logger.error('Background polling failed:', { error: error.message });
        });

    return deviceAuthInfo;
}
