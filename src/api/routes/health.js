import { getRedisClient } from '../../lib/redis-client.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('health');

export function createHealthRoutes() {
    return {
        '/health': async (req, res) => {
            const redis = getRedisClient();
            const redisHealthy = redis.isHealthy();
            
            const health = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                services: {
                    redis: {
                        status: redisHealthy ? 'healthy' : (redis.isFallback() ? 'fallback' : 'unhealthy'),
                        connected: redis.isConnected,
                        fallback: redis.isFallback()
                    }
                }
            };
            
            const allHealthy = redisHealthy || redis.isFallback();
            const statusCode = allHealthy ? 200 : 503;
            
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(health));
        },
        
        '/health/redis': async (req, res) => {
            const redis = getRedisClient();
            const isConnected = await redis.ping();
            
            const health = {
                status: isConnected ? 'healthy' : 'unhealthy',
                timestamp: new Date().toISOString(),
                connected: isConnected,
                fallback: redis.isFallback()
            };
            
            const statusCode = isConnected ? 200 : 503;
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(health));
        }
    };
}
