/**
 * 简单的进程内互斥锁实现
 *
 * 用于防止并发操作导致的竞态条件。
 *
 * @module utils/mutex
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const locks = new Map();
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * 获取锁并执行函数
 *
 * @param {string} key - 锁的键（例如 accountNumber）
 * @param {Function} fn - 要执行的异步函数
 * @param {Object} options - 选项
 * @param {number} options.timeoutMs - 超时时间（毫秒），默认30秒
 * @returns {Promise<any>} 函数执行结果
 * @throws {Error} 超时或可重入死锁时抛出错误
 */
export async function withLock(key, fn, options = {}) {
    const { timeoutMs = 30000 } = options;

    // 检测可重入死锁
    const currentLocks = asyncLocalStorage.getStore() || new Set();
    if (currentLocks.has(key)) {
        throw new Error(`Reentrant lock detected for key: ${key}. This would cause a deadlock.`);
    }

    // 等待锁释放（带超时，使用 Promise.race 真正打断等待）
    const startTime = Date.now();
    while (locks.has(key)) {
        const remainingTime = timeoutMs - (Date.now() - startTime);
        if (remainingTime <= 0) {
            throw new Error(`Lock acquisition timeout for key: ${key} after ${timeoutMs}ms`);
        }

        // 使用 Promise.race 确保超时能真正打断等待
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`Lock acquisition timeout for key: ${key} after ${timeoutMs}ms`));
            }, remainingTime);
        });

        try {
            try {
                await Promise.race([locks.get(key), timeoutPromise]);
            } catch (error) {
                if (error?.message?.includes('timeout')) {
                    throw error;
                }
                // 锁正常释放，继续循环检查
            }
        } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
        }
    }

    // 创建新的锁
    let releaseLock;
    const lockPromise = new Promise(resolve => {
        releaseLock = resolve;
    });
    locks.set(key, lockPromise);

    // 记录当前持有的锁（用于可重入检测）
    const newLockSet = new Set(currentLocks);
    newLockSet.add(key);

    try {
        // 在新的 async context 中执行函数
        return await asyncLocalStorage.run(newLockSet, fn);
    } finally {
        // 释放锁
        locks.delete(key);
        releaseLock();
    }
}

/**
 * 检查某个键是否被锁定
 *
 * @param {string} key - 锁的键
 * @returns {boolean} 是否被锁定
 */
export function isLocked(key) {
    return locks.has(key);
}

/**
 * 获取当前锁的数量（用于调试）
 *
 * @returns {number} 锁数量
 */
export function getLockCount() {
    return locks.size;
}

/**
 * 获取当前持有的所有锁（用于调试）
 *
 * @returns {Set<string>} 返回副本，防止外部修改
 */
export function getCurrentLocks() {
    const store = asyncLocalStorage.getStore();
    return store ? new Set(store) : new Set();
}
