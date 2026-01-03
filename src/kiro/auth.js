import { promises as fs } from 'fs';
import * as path from 'path';

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
    CONTENT_TYPE_JSON: 'application/json',
    ACCEPT_JSON: 'application/json',
    AUTH_METHOD_SOCIAL: 'social',
    AUTH_METHOD_IDC: 'IdC',
    ORIGIN_AI_EDITOR: 'AI_EDITOR',
    EXPIRE_WINDOW_MS: 5 * 60 * 1000,
    REFRESH_DEBOUNCE_MS: 30 * 1000,
    DEVICE_GRANT_TYPE: 'urn:ietf:params:oauth:grant-type:device_code'
};

const KIRO_AUTH_TOKEN_FILE = 'kiro-auth-token.json';
const refreshTokenDebounceMap = new Map();

export function getRefreshTokenDebounceMap() {
    return refreshTokenDebounceMap;
}

export async function loadCredentialsFromFile(filePath) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        return JSON.parse(fileContent);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.debug(`[Kiro Auth] Credential file not found: ${filePath}`);
        } else if (error instanceof SyntaxError) {
            console.warn(`[Kiro Auth] Failed to parse JSON from ${filePath}: ${error.message}`);
        } else {
            console.warn(`[Kiro Auth] Failed to read credential file ${filePath}: ${error.message}`);
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
                console.debug(`[Kiro Auth] Token file not found, creating new one: ${filePath}`);
            } else {
                console.warn(`[Kiro Auth] Could not read existing token file ${filePath}: ${readError.message}`);
            }
        }
        const mergedData = { ...existingData, ...newData };
        await fs.writeFile(filePath, JSON.stringify(mergedData, null, 2), 'utf8');
        console.info(`[Kiro Auth] Updated token file: ${filePath}`);
    } catch (error) {
        console.error(`[Kiro Auth] Failed to write token to file ${filePath}: ${error.message}`);
    }
}

export async function initializeAuth(service, forceRefresh = false) {
    if (service.accessToken && !forceRefresh) {
        console.debug('[Kiro Auth] Access token already available and not forced refresh.');
        return;
    }

    try {
        let mergedCredentials = {};

        if (service.base64Creds) {
            Object.assign(mergedCredentials, service.base64Creds);
            console.info('[Kiro Auth] Successfully loaded credentials from Base64 (constructor).');
            service.base64Creds = null;
        }

        const targetFilePath = service.credsFilePath || path.join(service.credPath, KIRO_AUTH_TOKEN_FILE);
        console.debug(`[Kiro Auth] Attempting to load credentials from directory: ${path.dirname(targetFilePath)}`);

        const targetCredentials = await loadCredentialsFromFile(targetFilePath);
        if (targetCredentials) {
            Object.assign(mergedCredentials, targetCredentials);
            console.info(`[Kiro Auth] Successfully loaded OAuth credentials from ${targetFilePath}`);
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
            console.warn('[Kiro Auth] Region not found in credentials. Using default region us-east-1 for URLs.');
            service.region = 'us-east-1';
        }

        service.refreshUrl = KIRO_CONSTANTS.REFRESH_URL.replace('{{region}}', service.region);
        service.refreshIDCUrl = KIRO_CONSTANTS.REFRESH_IDC_URL.replace('{{region}}', service.region);
        service.baseUrl = KIRO_CONSTANTS.BASE_URL.replace('{{region}}', service.region);
        service.amazonQUrl = KIRO_CONSTANTS.AMAZON_Q_URL.replace('{{region}}', service.region);
    } catch (error) {
        console.warn(`[Kiro Auth] Error during credential loading: ${error.message}`);
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
        console.log('[Kiro Auth] Token refresh already in progress for this account, waiting...');
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
        console.log(`[Kiro Auth] Refresh attempted ${Math.floor(timeSinceLastRefresh / 1000)}s ago for this account, skipping (debounce)`);
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

        console.log('[Kiro Auth] Refreshing access token...');
        console.log('[Kiro Auth] Refresh URL:', refreshUrl);
        console.log('[Kiro Auth] Auth method:', service.authMethod);
        console.log('[Kiro Auth] Request body keys:', Object.keys(requestBody));

        const response = await service.axiosInstance.post(refreshUrl, requestBody);
        console.log('[Kiro Auth] Token refresh response status:', response.status);
        console.log('[Kiro Auth] Token refresh response data keys:', Object.keys(response.data || {}));
        console.log('[Kiro Auth] Token refresh response data:', JSON.stringify(response.data, null, 2));

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
                console.warn('[Kiro Auth] No expiresIn or expiresAt in response, using default 1 hour');
                expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
            }
            service.expiresAt = expiresAt;
            console.info('[Kiro Auth] Access token refreshed successfully');
            console.info('[Kiro Auth] New expiresAt:', expiresAt);

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
        console.error('[Kiro Auth] Token refresh failed:', error.message);
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

    console.log('[Kiro Device Auth] Starting device authorization...');
    console.log('[Kiro Device Auth] Device auth URL:', deviceAuthUrl);
    console.log('[Kiro Device Auth] Start URL:', startUrl);

    try {
        const response = await service.axiosInstance.post(deviceAuthUrl, requestBody);
        console.log('[Kiro Device Auth] Device authorization started successfully');
        console.log('[Kiro Device Auth] Response:', JSON.stringify(response.data, null, 2));

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
        console.error('[Kiro Device Auth] Failed to start device authorization:', error.message);
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

    console.log(`[Kiro Device Auth] Starting token polling, interval ${interval}s, max attempts ${maxAttempts}`);

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
                console.log('[Kiro Device Auth] Successfully obtained token');

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
                console.info('[Kiro Device Auth] Token saved to file');

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
                    console.log(`[Kiro Device Auth] Waiting for user authorization... (attempt ${attempts}/${maxAttempts})`);
                    await new Promise(resolve => setTimeout(resolve, interval * 1000));
                    return poll();
                } else if (errorType === 'slow_down') {
                    console.log('[Kiro Device Auth] Slowing down polling frequency');
                    await new Promise(resolve => setTimeout(resolve, (interval + 5) * 1000));
                    return poll();
                } else if (errorType === 'expired_token') {
                    throw new Error('Device code expired. Please restart the authorization flow.');
                } else if (errorType === 'access_denied') {
                    throw new Error('User denied the authorization request.');
                }
            }

            console.warn(`[Kiro Device Auth] Polling error (attempt ${attempts}/${maxAttempts}):`, error.message);
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
            console.error('[Kiro Device Auth] Background polling failed:', error.message);
        });

    return deviceAuthInfo;
}

export { KIRO_AUTH_TOKEN_FILE };
