/**
 * OAuth 状态存储
 *
 * 管理 OAuth state 的生成、校验、持久化与过期清理，
 * 并记录已完成回调的幂等信息。
 *
 * @module domain/oauth/state-store
 */
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('OAuthStateStore');

const DEFAULT_STATE_FILE = path.join('configs', 'kiro-oauth-states.json');
const DEFAULT_STATE_TTL_MS = 30 * 60 * 1000; // 30 分钟
const DEFAULT_COMPLETED_TTL_MS = 30 * 60 * 1000; // 30 分钟（与 state TTL 对齐）

// state -> { code_verifier, machineid, timestamp, accountNumber, redirectUri, provider, ... }
export const kiroOAuthStates = new Map();
// state -> { accountNumber, relativePath, provider, completedAt, resultOk, errorMessage? }
export const kiroOAuthCompletedStates = new Map();

/**
 * 获取当前毫秒时间戳
 *
 * @returns {number} 当前时间戳（毫秒）
 */
function nowMs() {
    return Date.now();
}

/**
 * 生成 state 标识
 *
 * @returns {string} 随机 state
 */
function generateStateId() {
    return crypto.randomBytes(24).toString('hex');
}

/**
 * 判断时间戳是否过期
 *
 * @param {number} timestamp - 记录时间戳
 * @param {number} ttlMs - 过期阈值（毫秒）
 * @returns {boolean} 是否过期
 */
function isExpired(timestamp, ttlMs) {
    if (!timestamp || typeof timestamp !== 'number') return true;
    return (nowMs() - timestamp) > ttlMs;
}

/**
 * OAuth 状态存储器
 *
 * 负责 state 的创建、校验、落盘与过期清理。
 */
export class OAuthStateStore {
    /**
     * 创建 OAuthStateStore
     *
     * @param {Object} [options={}] - 配置项
     * @param {string} [options.stateFilePath] - 状态文件路径
     * @param {number} [options.stateTtlMs] - state TTL
     * @param {number} [options.completedTtlMs] - 完成记录 TTL
     * @param {number} [options.saveDebounceMs] - 保存防抖时间
     */
    constructor(options = {}) {
        this.stateFilePath = options.stateFilePath || DEFAULT_STATE_FILE;
        this.stateTtlMs = options.stateTtlMs ?? DEFAULT_STATE_TTL_MS;
        this.completedTtlMs = options.completedTtlMs ?? DEFAULT_COMPLETED_TTL_MS;

        this._loaded = false;
        this._saveTimer = null;
        this._saveDebounceMs = options.saveDebounceMs ?? 250;
    }

    /**
     * 确保状态已加载并清理过期项
     *
     * @returns {Promise<void>}
     */
    async _ensureLoaded() {
        if (this._loaded) return;
        this._loaded = true;
        await this._loadFromDisk();
        await this.cleanExpiredStates();
    }

    /**
     * 从磁盘加载状态
     *
     * @returns {Promise<void>}
     */
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

            logger.info(`Loaded ${kiroOAuthStates.size} valid state(s) from ${this.stateFilePath}`);
        } catch (error) {
            logger.warn('Failed to load state file', error);
        }
    }

    /**
     * 防抖触发保存
     *
     * @returns {void}
     */
    _scheduleSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._saveToDisk(), this._saveDebounceMs);
    }

    /**
     * 保存状态到磁盘
     *
     * @returns {Promise<void>}
     */
    async _saveToDisk() {
        try {
            const dir = path.dirname(this.stateFilePath);
            if (dir && dir !== '.' && !existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }
            const statesObject = Object.fromEntries(kiroOAuthStates.entries());
            await fs.writeFile(this.stateFilePath, JSON.stringify(statesObject, null, 2), 'utf8');
        } catch (error) {
            logger.warn('Failed to save state file', error);
        }
    }

    /**
     * 创建 state 记录
     *
     * @param {Object} [stateData={}] - state 数据
     * @returns {Promise<Object>} 包含 state 的记录
     */
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

    /**
     * 获取 state 记录
     *
     * @param {string} state - state 标识
     * @returns {Promise<Object|null>} state 数据或 null
     */
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

    /**
     * 校验 state 并可选消费/标记完成
     *
     * @param {string} state - state 标识
     * @param {Object} [options={}] - 校验选项
     * @returns {Promise<Object|null>} state 数据或 null
     */
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

    /**
     * 获取已完成回调的幂等信息
     *
     * @param {string} state - state 标识
     * @returns {Object|null} 完成信息或 null
     */
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

    /**
     * 清理过期 state 与完成记录
     *
     * @returns {Promise<{pending: number, completed: number}>} 清理后统计
     */
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

/**
 * 默认 OAuthStateStore 实例
 *
 * @type {OAuthStateStore}
 */
export const oauthStateStore = new OAuthStateStore();
