import { createClient } from 'redis';
import { createLogger } from '../lib/logger.js';
import { CONFIG } from '../config/manager.js';

const logger = createLogger('redis');

class RedisClientWrapper {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.fallbackMode = false;
        this.connectionAttempts = 0;
        this.maxRetries = 3;
    }

    async connect() {
        if (!CONFIG.REDIS_ENABLED) {
            logger.info('Redis disabled, using fallback mode');
            this.fallbackMode = true;
            return false;
        }

        const redisUrl = CONFIG.REDIS_URL || this.buildRedisUrl();
        
        try {
            this.client = createClient({
                url: redisUrl,
                socket: {
                    connectTimeout: 2000,
                    reconnectStrategy: (retries) => {
                        if (retries > this.maxRetries) {
                            logger.warn('Redis max retries exceeded, switching to fallback');
                            this.fallbackMode = true;
                            return false;
                        }
                        return Math.min(retries * 100, 1000);
                    }
                }
            });

            this.client.on('error', (err) => {
                logger.error('Redis client error', { message: err.message });
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                logger.info('Redis connected');
                this.isConnected = true;
                this.fallbackMode = false;
            });

            this.client.on('disconnect', () => {
                logger.warn('Redis disconnected');
                this.isConnected = false;
            });

            await this.client.connect();
            return true;
        } catch (err) {
            logger.error('Redis connection failed, using fallback', { message: err.message });
            this.fallbackMode = true;
            return false;
        }
    }

    buildRedisUrl() {
        const host = CONFIG.REDIS_HOST || 'localhost';
        const port = CONFIG.REDIS_PORT || 6379;
        const password = CONFIG.REDIS_PASSWORD;
        const db = CONFIG.REDIS_DB || 0;
        
        if (password) {
            return `redis://:${password}@${host}:${port}/${db}`;
        }
        return `redis://${host}:${port}/${db}`;
    }

    async get(key) {
        if (this.fallbackMode || !this.isConnected) {
            return null;
        }
        try {
            return await this.client.get(key);
        } catch (err) {
            logger.error('Redis get error', { key, message: err.message });
            return null;
        }
    }

    async set(key, value, ttlSeconds = 300) {
        if (this.fallbackMode || !this.isConnected) {
            return false;
        }
        try {
            await this.client.setEx(key, ttlSeconds, value);
            return true;
        } catch (err) {
            logger.error('Redis set error', { key, message: err.message });
            return false;
        }
    }

    async del(key) {
        if (this.fallbackMode || !this.isConnected) {
            return false;
        }
        try {
            await this.client.del(key);
            return true;
        } catch (err) {
            logger.error('Redis del error', { key, message: err.message });
            return false;
        }
    }

    async ping() {
        if (this.fallbackMode || !this.isConnected) {
            return false;
        }
        try {
            await this.client.ping();
            return true;
        } catch {
            return false;
        }
    }

    isHealthy() {
        return this.isConnected && !this.fallbackMode;
    }

    isFallback() {
        return this.fallbackMode;
    }
}

const redisWrapper = new RedisClientWrapper();

export async function initializeRedis() {
    return await redisWrapper.connect();
}

export function getRedisClient() {
    return redisWrapper;
}

export default redisWrapper;
