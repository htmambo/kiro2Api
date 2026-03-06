import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getEncryptionKey() {
    const envKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!envKey) {
        logger.error('TOKEN_ENCRYPTION_KEY not set');
        throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required');
    }
    return scryptSync(envKey, 'salt', KEY_LENGTH);
}

export function encryptToken(plaintext) {
    try {
        const key = getEncryptionKey();
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv(ALGORITHM, key, iv);
        
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    } catch (err) {
        logger.error('Token encryption failed', { message: err.message });
        throw new Error('Failed to encrypt token');
    }
}

export function decryptToken(encryptedData) {
    try {
        const key = getEncryptionKey();
        const parts = encryptedData.split(':');
        
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted data format');
        }
        
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (err) {
        logger.error('Token decryption failed', { message: err.message });
        throw new Error('Failed to decrypt token');
    }
}

export function secureErase(buffer) {
    if (Buffer.isBuffer(buffer)) {
        buffer.fill(0);
    }
}
