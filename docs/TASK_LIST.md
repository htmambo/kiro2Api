# SQLite 实现优化任务清单

基于 `docs/sqlite-implementation-analysis.md` 的分析结果，本文档列出所有需要完成的优化任务。

---

## 📋 任务优先级说明

- **P0（紧急）**：会导致功能错误或数据错误，必须立即修复
- **P1（高优先级）**：影响稳定性和数据一致性，应尽快安排
- **P2（中优先级）**：性能优化和代码质量改进，可按计划安排

---

## 🔴 P0 任务（必须立即修复）

### P0-1: 修复 usage_cache 过期时间格式不一致

**问题描述**：
- 写入时使用 `toISOString()`（格式：`2026-01-03T12:34:56.789Z`）
- 读取时使用 `datetime('now')`（格式：`2026-01-03 12:34:56`）
- TEXT 字典序比较失真，导致缓存几乎不过期

**影响范围**：
- 缓存命中异常
- 数据过期不生效
- 清理任务无法清理过期缓存

**涉及文件**：
- `src/sqlite-db.js:408` - 写入 expires_at
- `src/sqlite-db.js:426` - 读取比较
- `src/sqlite-db.js:455` - 批量读取比较
- `src/sqlite-db.js:481` - 清理过期缓存

**解决方案**（二选一）：
1. **方案 A（推荐）**：改为整数 epoch（毫秒）
   - 写入：`Date.now() + ttlSeconds * 1000`
   - 比较：`WHERE expires_at > ?` 传入 `Date.now()`

2. **方案 B**：统一使用 SQLite datetime 格式
   - 写入：使用 `datetime('now', '+' || ttlSeconds || ' seconds')`
   - 比较：保持 `datetime('now')`

**预计工作量**：1-2 小时

**验证方法**：
```javascript
// 测试用例
const uuid = 'test-uuid';
const providerType = 'claude-kiro-oauth';
const usageData = { test: 'data' };

// 设置 5 秒过期
sqliteDB.setUsageCache(uuid, providerType, usageData, 5);

// 立即读取应该成功
const cached1 = sqliteDB.getUsageCache(uuid, providerType);
console.assert(cached1 !== null, 'Cache should exist immediately');

// 6 秒后读取应该失败
setTimeout(() => {
    const cached2 = sqliteDB.getUsageCache(uuid, providerType);
    console.assert(cached2 === null, 'Cache should expire after 6 seconds');
}, 6000);
```

---

### P0-2: 修复 UI 更新 provider 在 SQLite 模式下的同步缺失

**问题描述**：
- UI PUT 更新 provider 只写 JSON
- 调用 `providerPoolManager.initializeProviderStatus()`（仅存在于 JSON 版）
- SQLite 模式下会抛异常或数据不同步

**影响范围**：
- UI 更新 provider 功能在 SQLite 模式下失效
- JSON 与 SQLite 数据分叉

**涉及文件**：
- `src/ui-manager.js:1501` - PUT 更新逻辑
- `src/ui-manager.js:1504` - 调用 initializeProviderStatus

**解决方案**：
```javascript
// src/ui-manager.js 第 1501 行附近
if (isSQLiteMode()) {
    // SQLite 模式：更新 SQLite
    const provider = {
        uuid: providerId,
        providerType: providerType,
        config: updatedProvider,
        notSupportedModels: updatedProvider.notSupportedModels
    };
    sqliteDB.upsertProvider(provider);

    // 同时更新 JSON 作为备份
    await fs.promises.writeFile(poolsFilePath, JSON.stringify(providerPools, null, 2));
} else {
    // JSON 模式：保持原有逻辑
    await fs.promises.writeFile(poolsFilePath, JSON.stringify(providerPools, null, 2));
    providerPoolManager.initializeProviderStatus(providerType, updatedProvider);
}
```

**预计工作量**：2-3 小时

**验证方法**：
1. 启用 SQLite 模式（`USE_SQLITE_POOL: true`）
2. 通过 UI 更新一个 provider 的配置
3. 检查 SQLite 数据库是否已更新
4. 重启服务，验证更新是否持久化

---

## 🟡 P1 任务（应尽快安排）

### P1-1: 增加 busy_timeout 配置

**问题描述**：
- 仅设置了 WAL 和 synchronous
- 多进程/多实例写入时易出现 SQLITE_BUSY

**影响范围**：
- 多实例部署时请求失败率上升
- 状态写入丢失

**涉及文件**：
- `src/sqlite-db.js:36-37` - pragma 配置

**解决方案**：
```javascript
// src/sqlite-db.js 第 37 行后添加
this.db.pragma('busy_timeout = 5000'); // 5 秒超时
```

**预计工作量**：30 分钟

**验证方法**：
- 启动多个实例（PM2 cluster 模式）
- 并发发送大量请求
- 监控错误日志中的 SQLITE_BUSY 错误

---

### P1-2: 将 error_count 更新改为原子 SQL

**问题描述**：
- 当前是"读取 → +1 → 写回"
- 多实例并发下会丢失更新

**影响范围**：
- 错误计数不准确
- 健康判定可能失效

**涉及文件**：
- `src/sqlite-provider-pool-manager.js:167` - 读取 provider
- `src/sqlite-provider-pool-manager.js:216` - 计算并写回

**解决方案**：
```javascript
// src/sqlite-provider-pool-manager.js 第 216 行附近
// 替换为原子更新
const newErrorCount = provider.errorCount + 1;
const isHealthy = !isFatalError && newErrorCount < this.maxErrorCount;

// 使用原子 SQL 更新
const stmt = sqliteDB.getDb().prepare(`
    UPDATE providers
    SET error_count = error_count + 1,
        is_healthy = ?,
        last_error_time = ?,
        last_error_message = ?,
        updated_at = datetime('now')
    WHERE uuid = ?
`);
stmt.run(isHealthy ? 1 : 0, new Date().toISOString(), errorMessage, providerConfig.uuid);
```

**预计工作量**：1-2 小时

**验证方法**：
- 多实例并发测试
- 故意触发错误
- 检查 error_count 是否准确累加

---

### P1-3: 合并健康更新与 usage 更新到同一事务

**问题描述**：
- 成功路径中两次独立的 SQL 更新
- 崩溃时可能只更新一半

**影响范围**：
- 数据一致性问题
- 健康状态与使用统计不匹配

**涉及文件**：
- `src/sqlite-provider-pool-manager.js:260` - updateProviderHealth
- `src/sqlite-provider-pool-manager.js:263` - incrementUsage

**解决方案**：
```javascript
// src/sqlite-provider-pool-manager.js 第 260 行附近
// 合并为单条 SQL
const stmt = sqliteDB.getDb().prepare(`
    UPDATE providers
    SET is_healthy = 1,
        error_count = 0,
        last_error_time = NULL,
        last_error_message = NULL,
        last_health_check_time = ?,
        last_health_check_model = ?,
        cached_email = ?,
        cached_user_id = ?,
        usage_count = usage_count + ?,
        last_used = datetime('now'),
        updated_at = datetime('now')
    WHERE uuid = ?
`);

stmt.run(
    extra.lastHealthCheckTime,
    extra.lastHealthCheckModel,
    extra.cachedEmail || null,
    extra.cachedUserId || null,
    resetUsageCount ? 0 : 1,
    providerConfig.uuid
);
```

**预计工作量**：1 小时

---

### P1-4: 增加 maintenance 定时调度

**问题描述**：
- maintenance 方法已定义但未调用
- 历史表无限增长
- 过期缓存不清理

**影响范围**：
- 数据库文件持续增大
- 查询性能下降

**涉及文件**：
- `src/sqlite-provider-pool-manager.js:460` - maintenance 定义
- `src/service-manager.js` - 需要添加调度

**解决方案**：
```javascript
// src/service-manager.js 启动后添加
if (CONFIG.USE_SQLITE_POOL) {
    // 每小时执行一次维护任务
    setInterval(() => {
        providerPoolManager.performMaintenance().catch(err => {
            console.error('[ServiceManager] Maintenance failed:', err);
        });
    }, 60 * 60 * 1000); // 1 小时

    // 启动时立即执行一次
    providerPoolManager.performMaintenance().catch(err => {
        console.error('[ServiceManager] Initial maintenance failed:', err);
    });
}
```

**预计工作量**：1 小时

**验证方法**：
- 启动服务
- 检查日志中的维护任务执行记录
- 查询历史表确认旧数据被清理

---

## 🟢 P2 任务（中长期优化）

### P2-1: 优化索引设计

**问题描述**：
- 查询条件与索引不匹配
- 可能导致全表扫描

**涉及文件**：
- `src/sqlite-db.js:101-107` - 索引定义

**解决方案**：
```javascript
// src/sqlite-db.js 第 107 行后添加
this.db.exec(`
    -- 健康 provider 查询优化
    CREATE INDEX IF NOT EXISTS idx_providers_type_health
    ON providers(provider_type, is_healthy, is_disabled);

    -- usage_cache 批量查询优化
    CREATE INDEX IF NOT EXISTS idx_usage_cache_type_expires
    ON usage_cache(provider_type, expires_at);

    -- health_check_history 清理优化
    CREATE INDEX IF NOT EXISTS idx_health_history_time
    ON health_check_history(check_time);
`);
```

**预计工作量**：1 小时

**验证方法**：
```sql
-- 使用 EXPLAIN QUERY PLAN 检查查询计划
EXPLAIN QUERY PLAN
SELECT * FROM providers
WHERE provider_type = 'claude-kiro-oauth'
AND is_healthy = 1
AND is_disabled = 0;
```

---

### P2-2: 修复单例 init 路径固化问题

**问题描述**：
- 二次调用 init 会忽略新的 dbPath
- 可能导致配置变更无效

**涉及文件**：
- `src/sqlite-db.js:21` - init 方法

**解决方案**：
```javascript
// src/sqlite-db.js 第 21 行
init(dbPath = 'data/provider_pool.db') {
    if (this.db) {
        // 检查路径是否一致
        if (this.dbPath !== dbPath) {
            console.warn(`[SQLiteDB] Database already initialized with path: ${this.dbPath}, ignoring new path: ${dbPath}`);
        }
        return this.db;
    }
    // ... 原有逻辑
}
```

**预计工作量**：30 分钟

---

### P2-3: 实现写入降频策略（可选）

**问题描述**：
- 每次成功请求都写 usage
- 高 QPS 下写入压力大

**解决方案**：
- 内存聚合 + 定期 flush
- 或使用 Redis 等外部缓存

**预计工作量**：4-8 小时（需要架构调整）

**注意**：此项为可选优化，仅在 QPS > 1000 时考虑

---

## 📊 任务统计

| 优先级 | 任务数量 | 预计总工作量 | 建议完成时间 |
|--------|---------|-------------|-------------|
| P0 | 2 | 3-5 小时 | 立即（1-2 天内） |
| P1 | 4 | 4-6 小时 | 本周内 |
| P2 | 3 | 2-3 小时（不含 P2-3） | 下个迭代 |
| **总计** | **9** | **9-14 小时** | **1-2 周** |

---

## 🔄 实施顺序建议

### 第一阶段（立即）
1. P0-1: 修复 usage_cache 过期时间格式
2. P0-2: 修复 UI 更新同步

### 第二阶段（本周）
3. P1-1: 增加 busy_timeout
4. P1-2: 原子更新 error_count
5. P1-4: 增加 maintenance 调度

### 第三阶段（下周）
6. P1-3: 合并事务
7. P2-1: 优化索引
8. P2-2: 修复单例路径

### 第四阶段（按需）
9. P2-3: 写入降频（仅在高负载时）

---

## ✅ 验证清单

完成所有任务后，执行以下验证：

### 功能验证
- [ ] 缓存过期逻辑正常工作
- [ ] UI 更新 provider 在 SQLite 模式下正常
- [ ] 多实例部署无 SQLITE_BUSY 错误
- [ ] 错误计数准确累加
- [ ] 维护任务定期执行

### 性能验证
- [ ] 查询响应时间 < 100ms
- [ ] 写入 TPS > 100
- [ ] 数据库文件大小稳定

### 数据一致性验证
- [ ] JSON 与 SQLite 数据一致
- [ ] 重启后数据完整
- [ ] 并发写入无丢失

---

## 📝 相关文档

- [SQLite 实现分析](./sqlite-implementation-analysis.md) - 详细问题分析
- [JSON 存储问题分析](./json-storage-issues-analysis.md) - JSON 模式对比

---

**创建时间**：2026-01-03
**基于分析**：commit `40bb66d`
**预计完成**：2026-01-17
