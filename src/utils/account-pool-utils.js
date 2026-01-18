export function canUsePool(config, poolManager) {
    return Boolean(poolManager);
}

export function markPoolHealthy(poolManager, uuid) {
    if (!poolManager || !uuid) return;
    if (typeof poolManager.markAccountHealthy === 'function') {
        poolManager.markAccountHealthy(uuid);
    }
}

export function markPoolUnhealthy(poolManager, uuid, error) {
    if (!poolManager || !uuid) return;
    if (typeof poolManager.markAccountUnhealthy === 'function') {
        poolManager.markAccountUnhealthy(uuid, error);
    }
}

export function countAvailablePoolItems(config, poolManager) {
    if (!canUsePool(config, poolManager)) return 1;

    if (typeof poolManager.listAccounts === 'function') {
        const available = poolManager.listAccounts().filter((a) => a && a.isHealthy && !a.isDisabled).length;
        return available > 0 ? available : 1;
    }

    return 1;
}
