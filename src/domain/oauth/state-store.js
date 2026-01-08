import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('domain:oauth:state-store');

const DEFAULT_STATE_FILE = path.join('configs', 'kiro-oauth-states.json');
const DEFAULT_STATE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_COMPLETED_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const kiroOAuthStates = new Map(); // state -> { code_verifier, machineid, timestamp, accountNumber, redirectUri, provider, ... }
export const kiroOAuthCompletedStates = new Map(); // state -> { accountNumber, completedAt }

function nowMs() {
    return Date.now();
}

function generateStateId() {
    return crypto.randomBytes(24).toString('hex');
}

function isExpired(timestamp, ttlMs) {
    if (!timestamp || typeof timestamp !== 'number') return true;
    return (nowMs() - timestamp) > ttlMs;
}

export class OAuthStateStore {
    constructor(options = {}) {
        this.stateFilePath = options.stateFilePath || DEFAULT_STATE_FILE;
        this.stateTtlMs = options.stateTtlMs ?? DEFAULT_STATE_TTL_MS;
        this.completedTtlMs = options.completedTtlMs ?? DEFAULT_COMPLETED_TTL_MS;

        this._loaded = false;
        this._saveTimer = null;
        this._saveDebounceMs = options.saveDebounceMs ?? 250;
    }

    async _ensureLoaded() {
        if (this._loaded) return;
        this._loaded = true;
        await this._loadFromDisk();
        await this.cleanExpiredStates();
    }

    async _loadFromDisk() {
        try {
            if (!existsSync(this.stateFilePath)) return;
            const content = await fs.readFile(this.stateFilePath, 'utf8');
            const data = JSON.parse(content);

            if (!data || typeof data !== 'object') return;

            for (const [state, stateData] of Object.entries(data)) {
                if (!stateData || typeof stateData !== 'object') continue;
                if (isExpired(stateData.timestamp, this.stateTtlMs)) continue;
                kiroOAuthStates.set(state, stateData);
            }

            logger.info(`[OAuthStateStore] Loaded ${kiroOAuthStates.size} valid state(s) from ${this.stateFilePath}`);
        } catch (error) {
            logger.warn('[OAuthStateStore] Failed to load state file', error);
        }
    }

    _scheduleSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._saveToDisk(), this._saveDebounceMs);
    }

    async _saveToDisk() {
        try {
            const dir = path.dirname(this.stateFilePath);
            if (dir && dir !== '.' && !existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }
            const statesObject = Object.fromEntries(kiroOAuthStates.entries());
            await fs.writeFile(this.stateFilePath, JSON.stringify(statesObject, null, 2), 'utf8');
        } catch (error) {
            logger.warn('[OAuthStateStore] Failed to save state file', error);
        }
    }

    async createState(stateData = {}) {
        await this._ensureLoaded();

        const state = stateData.state || generateStateId();
        const record = {
            ...stateData,
            timestamp: typeof stateData.timestamp === 'number' ? stateData.timestamp : nowMs()
        };

        kiroOAuthStates.set(state, record);
        this._scheduleSave();
        return { state, ...record };
    }

    async getState(state) {
        await this._ensureLoaded();
        if (!state) return null;
        const data = kiroOAuthStates.get(state) || null;
        if (!data) return null;
        if (isExpired(data.timestamp, this.stateTtlMs)) {
            kiroOAuthStates.delete(state);
            this._scheduleSave();
            return null;
        }
        return data;
    }

    async validateState(state, options = {}) {
        await this._ensureLoaded();
        const { consume = false, markCompleted = false, completedInfo = null } = options;

        const data = await this.getState(state);
        if (!data) return null;

        if (consume) {
            kiroOAuthStates.delete(state);
            this._scheduleSave();
        }

        if (markCompleted) {
            kiroOAuthCompletedStates.set(state, {
                ...(completedInfo && typeof completedInfo === 'object' ? completedInfo : {}),
                completedAt: nowMs()
            });
        }

        return data;
    }

    getCompletedInfo(state) {
        if (!state) return null;
        const info = kiroOAuthCompletedStates.get(state) || null;
        if (!info) return null;
        if (isExpired(info.completedAt, this.completedTtlMs)) {
            kiroOAuthCompletedStates.delete(state);
            return null;
        }
        return info;
    }

    async cleanExpiredStates() {
        await this._ensureLoaded();

        let changed = false;
        for (const [state, data] of kiroOAuthStates.entries()) {
            if (isExpired(data?.timestamp, this.stateTtlMs)) {
                kiroOAuthStates.delete(state);
                changed = true;
            }
        }

        for (const [state, info] of kiroOAuthCompletedStates.entries()) {
            if (isExpired(info?.completedAt, this.completedTtlMs)) {
                kiroOAuthCompletedStates.delete(state);
            }
        }

        if (changed) this._scheduleSave();
        return { pending: kiroOAuthStates.size, completed: kiroOAuthCompletedStates.size };
    }
}

export const oauthStateStore = new OAuthStateStore();
