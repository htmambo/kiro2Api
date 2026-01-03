# Provider 层彻底移除任务计划

**创建时间**：2026-01-03
**目标**：彻底移除 provider 抽象层，改为单一账号池（Account Pool）管理
**预计工作量**：2-3 天
**风险等级**：高（涉及核心请求链路、数据迁移、前后端改造）

---

## 📋 目录

1. [背景与目标](#背景与目标)
2. [影响范围分析](#影响范围分析)
3. [重构策略](#重构策略)
4. [数据迁移方案](#数据迁移方案)
5. [任务分解](#任务分解)
6. [实施顺序](#实施顺序)
7. [回滚方案](#回滚方案)
8. [验证清单](#验证清单)

---

## 🎯 背景与目标

### 当前状况

**Provider 的本质**：
```
Provider (claude-kiro-oauth) ← 只是一个分组标签
  ├── Account 1 (uuid-1, token-1.json)
  ├── Account 2 (uuid-2, token-2.json)
  └── Account 3 (uuid-3, token-3.json)
```

**问题**：
- `providerType` 已退化为常量（只有 `claude-kiro-oauth`）
- 真正的负载均衡单位是 `uuid`（账号）
- Provider 层增加了不必要的复杂度

### 重构目标

**最终形态**：
```
Account Pool
  ├── Account 1 (uuid-1, token-1.json)
  ├── Account 2 (uuid-2, token-2.json)
  └── Account 3 (uuid-3, token-3.json)
```

**核心改变**：
- ✅ 移除 `providerType` 概念
- ✅ 移除 `providerPools` 嵌套结构
- ✅ 重命名核心类：`ProviderPoolManager` → `AccountPoolManager`
- ✅ 简化配置文件：`provider_pools.json` → `account_pool.json`
- ✅ 简化 UI API：`/api/providers/:type/:uuid` → `/api/accounts/:uuid`
- ✅ 迁移 SQLite schema：删除 `provider_type` 列

---

## 🔍 影响范围分析

### 关键路径（高风险）

#### 1. 请求链路
**影响**：每次 API 调用的账号选择、重试、健康状态

| 文件 | 位置 | 改动内容 |
|------|------|---------|
| `src/service-manager.js` | 261 | `selectProvider(providerType, ...)` → `selectAccount(...)` |
| `src/common.js` | 300, 345, 384 | 重试逻辑移除 providerType |
| `src/request-handler.js` | 123, 129 | 失败标记移除 providerType |

#### 2. SQLite 数据层
**影响**：所有账号数据持久化、查询、缓存

| 表名 | 改动 |
|------|------|
| `providers` | 删除 `provider_type` 列，重命名为 `accounts` |
| `usage_cache` | 删除 `provider_type` 列，唯一键改为 `account_uuid` |
| `health_check_history` | 删除 `provider_type` 列 |

#### 3. UI API
**影响**：前端管理界面完全重构

| 旧路由 | 新路由 |
|--------|--------|
| `GET /api/providers` | `GET /api/accounts` |
| `POST /api/providers` | `POST /api/accounts` |
| `PUT /api/providers/:type/:uuid` | `PUT /api/accounts/:uuid` |
| `DELETE /api/providers/:type/:uuid` | `DELETE /api/accounts/:uuid` |
| `GET /api/usage/:type/:uuid` | `GET /api/usage/:uuid` |

### 次要路径（中风险）

#### 4. 配置加载
- `src/config-manager.js:267` - 加载 provider_pools
- `src/service-manager.js:28` - 自动扫描并写回
- `src/provider-pool-manager.js:578` - 防抖落盘

#### 5. OAuth 入池
- `src/oauth-handlers.js:187` - 写入 providerPools
- `src/oauth-handlers.js:195` - SQLite upsert

#### 6. 前端依赖
- `frontend/app/dashboard/providers/page.tsx` - Providers 页面
- `frontend/app/dashboard/usage/page.tsx` - Usage 页面

---

## 💡 重构策略

### 核心命名变更

| 旧名称 | 新名称 |
|--------|--------|
| `providerPools` | `accountPool` 或 `accounts` |
| `providerType` | **移除** |
| `ProviderPoolManager` | `AccountPoolManager` |
| `SQLiteProviderPoolManager` | `SQLiteAccountPoolManager` |
| `selectProvider(providerType, ...)` | `selectAccount(requestedModel, ...)` |
| `markProviderUnhealthy(type, {uuid}, err)` | `markAccountUnhealthy(uuid, err)` |
| `getProviderPools(type)` | `getAccounts()` |

### 配置文件结构

**旧格式**：
```json
{
  "claude-kiro-oauth": [
    {
      "uuid": "account-1",
      "KIRO_OAUTH_CREDS_FILE_PATH": "configs/kiro/token-1.json",
      "isHealthy": true,
      "errorCount": 0
    }
  ]
}
```

**新格式**：
```json
{
  "accounts": [
    {
      "uuid": "account-1",
      "KIRO_OAUTH_CREDS_FILE_PATH": "configs/kiro/token-1.json",
      "isHealthy": true,
      "errorCount": 0
    }
  ]
}
```

### SQLite Schema 变更

**迁移目标**：
- `providers` → `accounts`（删除 `provider_type` 列）
- `usage_cache` → 删除 `provider_type`，唯一键改为 `account_uuid`
- `health_check_history` → 删除 `provider_type`

**迁移方式**（SQLite 无法直接 drop column）：
1. 创建新表（无 provider_type）
2. 复制数据
3. 删除旧表
4. 重命名新表
5. 重建索引
6. 更新 `PRAGMA user_version`

---

## 🔄 数据迁移方案

### SQLite 数据库迁移

**前置校验**：
```sql
-- 检查是否只有一个 providerType
SELECT COUNT(DISTINCT provider_type) FROM providers;
-- 如果 > 1，中止迁移并报错
```

**迁移步骤**：
```sql
-- 1. 备份
-- 复制 data/provider_pool.db → data/provider_pool.db.bak-<timestamp>

 2. 创建新表
CREATE TABLE accounts_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    config TEXT NOT NULL,
    is_healthy INTEGER DEFAULT 1,
    is_disabled INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    usage_count INTEGER DEFAULT 0,
    last_used TEXT,
    last_error_time TEXT,
    last_error_message TEXT,
    last_health_check_time TEXT,
    last_health_check_model TEXT,
    cached_email TEXT,
    cached_user_id TEXT,
    not_supported_models TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 3. 复制数据
INSERT INTO accounts_new SELECT
    id, uuid, config, is_healthy, is_disabled, error_count, usage_count,
    last_used, last_error_time, last_error_message, last_health_check_time,
    last_health_check_model, cached_email, cached_user_id, not_supported_models,
    created_at, updated_at
FROM providers;

-- 4. 删除旧表
DROP TABLE providers;

-- 5. 重命名
ALTER TABLE accounts_new RENAME TO accounts;

-- 6. 重建索引
CREATE INDEX idx_accounts_uuid ON accounts(uuid);
CREATE INDEX idx_accounts_healthy ON accounts(is_healthy, is_disabled);

-- 7. 更新版本号
PRAGMA user_version = 2;
```

**验证**：
- 行数一致：`SELECT COUNT(*) FROM accounts` == 旧 providers 行数
- 抽样检查：随机 uuid 的字段值一致
- 功能测试：健康账号查询、用量缓存读写正常

### JSON 配置文件迁移

**迁移步骤**：
```javascript
// 1. 备份
fs.copyFileSync(
    'configs/provider_pools.json',
    `configs/provider_pools.json.bak-${Date.now()}`
);

// 2. 读取旧格式
const oldData = JSON.parse(fs.readFileSync('configs/provider_pools.json'));

// 3. 转换为新格式
const newData = {
    accounts: oldData['claude-kiro-oauth'] || []
};

// 4. 写入新文件
fs.writeFileSync(
    'configs/account_pool.json',
    JSON.stringify(newData, null, 2)
);
```

**验证**：
- 账号数量一致
- UUID 唯一性校验
- 必需字段完整

---

## 📝 任务分解

### T01: 依赖冻结与重构开关 ⭐

**目标**：引入新旧实现切换点，支持灰度与快速回滚

**涉及文件**：
- `src/config-manager.js` - 新增开关读取
- `src/service-manager.js` - 初始化时选择 manager
- `src/ui-manager.js` - API 选择实现

**具体改动**：
```javascript
// src/config-manager.js
export const ACCOUNT_POOL_MODE = process.env.ACCOUNT_POOL_MODE || 'legacy';
// 'legacy' = 使用旧 providerPools
// 'account' = 使用新 accounts

// src/service-manager.js
if (ACCOUNT_POOL_MODE === 'legacy') {
    providerPoolManager = new ProviderPoolManager(...);
} else {
    accountPoolManager = new AccountPoolManager(...);
}
```

**验证方法**：
- 启动后打印当前模式
- legacy 模式下所有功能正常

**风险等级**：低
**预计工作量**：0.5 天
**前置依赖**：无

---

### T02: 定义 Account 数据模型与核心接口

**目标**：定义账号池的最小能力集

**涉及文件**：
- 检查并修改`src/account-pool-manager.js`以支持原逻辑的迁移
- 新增 `src/sqlite-account-pool-manager.js`

**核心接口**：
```javascript
class AccountPoolManager {
    // 列出所有账号
    listAccounts(): Account[]

    // 选择一个健康账号
    selectAccount(requestedModel, options): AccountConfig | null

    // 标记账号不健康
    markAccountUnhealthy(uuid, error): void

    // 标记账号健康
    markAccountHealthy(uuid, options): void

    // 禁用/启用账号
    disableAccount(uuid): void
    enableAccount(uuid): void

    // 健康检查
    performHealthChecks(): Promise<void>
}
```

**验证方法**：
- 单元测试验证 select 与 mark 状态变化
- 不接入真实请求链路

**风险等级**：中
**预计工作量**：0.5-1 天
**前置依赖**：T01

---

### T03: 核心请求链路改造 ⚠️

**目标**：让选账号、失败重试、健康标记完全不依赖 providerType

**涉及文件**：
- `src/service-manager.js:261` - getApiService
- `src/common.js:300` - 重试与切换
- `src/request-handler.js:123` - 错误标记

**具体改动**：
```javascript
// 旧代码
const providerConfig = providerPoolManager.selectProvider(
    config.MODEL_PROVIDER,
    requestedModel
);

// 新代码
const accountConfig = accountPoolManager.selectAccount(
    requestedModel,
    { skipUsageCount: opkipUsageCount }
);
```

**验证方法**：
- 单请求成功（无重试）
- 制造失败后能切换到下一个账号
- 健康状态正确更新

**风险等级**：高（直接影响线上成功率）
**预计工作量**：0.5-1 天
**前置依赖**：T02

---

### T04: 配置加载迁移

**目标**：移除 providerPools 配置结构，改为 accounts

**涉及文件**：
- `src/config-manager.js:267`
- `configs/provider_pools.json`
- `configs/account_pool.json`（新增）

**具体改动**：
```javascript
// 支持自动迁移
function loadAccountPool(filePath) {
    // 尝试读取新格式
    if (fs.existsSync('configs/account_pool.json')) {
        return JSON.parse(fs.readFileSync('configs/account_pool.json'));
    }

    // 读取旧格式并转换
    if (fs.existsSync('configs/provider_pools.json')) {
        const oldData = JSON.parse(fs.readFileSync('configs/provider_pools.json'));
        const newData = {
            accounts: oldData['claude-kiro-oauth'] || []
        };

        // 备份旧文件
        fs.copyFileSync(
            'configs/provider_pools.json',
            `configs/provider_pools.json.bak-${Date.now()}`
        );

        // 写入新文件
        fs.writeFileSync(
            'configs/account_pool.json',
            JSON.stringify(newData, null, 2)
        );

        return newData;
    }

    // 默认空账号池
    return { accounts: [] };
}
```

**验证方法**：
- 旧文件存在时自动生成新文件并备份
- 新文件结构正确、账号数量一致
- UUID 唯一性校验通过

**风险等级**：中
**预计工作量**：0.5 天
**前置依赖**：T01

---

### T05: OAuth 入池链路改造

**目标**：授权完成后直接写 account pool

**涉及文件**：
- `src/oauth-handlers.js:147`
- `src/oauth-handlers.js:193`

**具体改动**：
```javascript
// 旧代码
providerPools['claude-kiro-oauth'].push(newProvider);

// 新代码
accountPool.accounts.push(newAccount);
```

**验证方法**：
- 走一遍 OAuth 流程
- 新增账号能出现在 `/api/accounts`
- 新账号可被选择使用

**风险等级**：中
**预计工作量**：0.5 天
**前置依赖**：T04

---

### T06: UI API 重构 ⚠️

**目标**：彻底移除 providerType 路径段与请求体字段

**涉及文件**：
- 后端：`src/ui-manager.js` (多处)
- 前端：`frontend/app/dashboard/providers/page.tsx`
- 前端：`frontend/app/dashboard/usage/page.tsx`

**API 变更**：

| 旧 API | 新 API |
|--------|--------|
| `GET /api/providers` | `GET /api/accounts` |
| `POST /api/providers` | `POST /api/accounts` |
| `PUT /api/providers/:type/:uuid` | `PUT /api/accounts/:uuid` |
| `DELETE /api/providers/:type/:uuid` | `DELETE /api/accounts/:uuid` |
| `POST /api/providers/:type/:uuid/toggle` | `POST /api/accounts/:uuid/toggle` |
| `POST /api/providers/batch-delete` | `POST /api/accounts/batch-delete` |
| `GET /api/usage/:type/:uuid` | `GET /api/usage/:uuid` |

**前端改动**：
```typescript
// 旧代码
const response = await fetch(`/api/providers/${providerType}/${uuid}`);

// 新代码
const response = await fetch(`/api/accounts/${uuid}`);
```

**验证方法**：
- 前端能正常加载账号列表
- 禁用/删除/健康检查功能正常
- 批量操作功能正常

**风险等级**：高（会直接 break 管理 UI）
**预计工作量**：0.5-1 天
**前置依赖**：T03 + T04

---

### T07: SQLite Schema 迁移 ⚠️

**目标**：数据库层面彻底去 provider 概念

**涉及文件**：
- `src/sqlite-db.js` (整个文件)
- `src/sqlite-account-pool-manager.js` (新文件)

**迁移脚本**：
```javascript
async function migrateDatabase(dbPath) {
    const db = new Database(dbPath);

    // 1. 检查当前版本
    const currentVersion = db.pragma('user_version', { simple: true });
    if (currentVersion >= 2) {
        console.log('[Migration] Already migrated');
        return;
    }

    // 2. 备份
    fs.copyFileSync(dbPath, `${dbPath}.bak-${Date.now()}`);

    // 3. 校验
    const distinctTypes = db.prepare(
        'SELECT COUNT(DISTINCT provider_type) as count FROM providers'
    ).get();

    if (distinctTypes.count > 1) {
        throw new Error('Multiple provider types found, cannot migrate');
    }

    // 4. 迁移
    db.transaction(() => {
        // 创建新表
        db.exec(`
            CREATE TABLE accounts_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT UNIQUE NOT NULL,
                config TEXT NOT NULL,
                is_healthy INTEGER DEFAULT 1,
                is_disabled INTEGER DEFAULT 0,
                error_count INTEGER DEFAULT 0,
                usage_count INTEGER DEFAULT 0,
                last_used TEXT,
                last_error_time TEXT,
                last_error_message TEXT,
                last_health_check_time TEXT,
                last_health_check_model TEXT,
                cached_email TEXT,
                cached_user_id TEXT,
                not_supported_models TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);

        // 复制数据
        db.exec(`
            INSERT INTO accounts_new SELECT
                id, uuid, config, is_healthy, is_disabled, error_count, usage_count,
                last_used, last_error_time, last_error_message, last_health_check_time,
                last_health_check_model, cached_email, cached_user_id, not_supported_models,
                created_at, updated_at
            FROM providers
        `);

        // 删除旧表
        db.exec('DROP TABLE providers');

        // 重命名
        db.exec('ALTER TABLE accounts_new RENAME TO accounts');

        // 重建索引
        db.exec(`
            CREATE INDEX idx_accounts_uuid ON accounts(uuid);
            CREATE INDEX idx_accounts_healthy ON accounts(is_healthy, is_disabled);
        `);

        // 更新版本
        db.pragma('user_version = 2');
    })();

    console.log('[Migration] Database migrated successfully');
}
```

**验证方法**：
- 启动时自动迁移
- 行数一致性检查
- CRUD/健康检查/用量缓存均正常

**风险等级**：高（数据迁移 + 影响启动）
**预计工作量**：1 天
**前置依赖**：T01 + T03

---

### T08: 清理与删除遗留代码

**目标**：删除 provider 相关概念与命名残留

**涉及文件**：
- `src/provider-pool-manager.js` - 删除
- `src/sqlite-provider-pool-manager.js` - 删除
- `src/provider-utils.js` - 清理
- `src/core/constants.js` - 删除 PROVIDER_MAPPINGS
- `configs/provider_pools.json.example` - 删除
- 前端类型定义 - 清理

**验证方法**：
```bash
# 检查残留
rg -n "\bproviderPools\b|\bproviderType\b|provider_type"
# 结果应为 0（或仅剩注释/文档）
```

**风险等级**：中
**预计工作量**：0.5 天
**前置依赖**：T06 + T07 完成并稳定

---

## 🔄 实施顺序

### 阶段 1：准备与隔离（第 1 天上午）

```
T01: 依赖冻结与重构开关 (0.5 天)
  ↓
验证：legacy 模式下所有功能正常
```

### 阶段 2：核心重构（第 1 天下午 - 第 2 天）

```
T02: 定义 Account 数据模型 (0.5-1 天)
  ↓
T03: 核心请求链路改造 (0.5-1 天)
  ↓
验证：account 模式下请求成功、重试正常
```

### 阶段 3：配置与数据（第 2 天）

```
T04: 配置加载迁移 (0.5 天)
  ↓
T05: OAuth 入池链路改造 (0.5 天)
  ↓
T07: SQLite Schema 迁移 (1 天)
  ↓
验证：数据迁移成功、持久化正常
```

### 阶段 4：UI 改造（第 3 天）

```
T06: UI API 重构 (0.5-1 天)
  ↓
验证：前端功能完整、API 正常
```

### 阶段 5：清理收尾（第 3 天下午）

```
T08: 清理与删除遗留代码 (0.5 天)
  ↓
全量测试与文档更新
```

---

## 🔙 回滚方案

### 配置文件回滚

**备份位置**：
- `configs/provider_pools.json.bak-<timestamp>`
- `configs/account_pool.json.bak-<timestamp>`

**回滚步骤**：
```bash
# 1. 停止服务
npm run pm2:stop

# 2. 恢复配置
cp configs/provider_pools.json.bak-<timestamp> configs/provider_pools.json
rm configs/account_pool.json

# 3. 切换模式
export ACCOUNT_POOL_MODE=legacy

# 4. 重启服务
npm run pm2:restart
```

### SQLite 数据库回滚

**备份位置**：
- `data/provider_pool.db.bak-<timestamp>`

**回滚步骤**：
```bash
# 1. 停止服务
npm run pm2:stop

# 2. 恢复数据库
cp data/provider_pool.db.bak-<timestamp> data/provider_pool.db

# 3. 切换模式
export ACCOUNT_POOL_MODE=legacy

# 4. 重启服务
npm run pm2:restart
```

### 代码回滚

**Git 策略**：
```bash
# 每个阶段完成后打 tag
git tag -a refactor-t01-complete -m "T01: 重构开关完成"
git tag -a refactor-t03-complete -m "T03: 核心链路完成"

# 回滚到指定阶段
git reset --hard refactor-t01-complete
```

---

## ✅ 验证清单

### 功能验证

#### 核心功能
- [ ] 单次请求成功（选择账号正常）
- [ ] 请求失败后能切换账号重试
- [ ] 健康状态正确更新（成功/失败）
- [ ] 账号禁用/启用功能正常
- [ ] 健康检查功能正常

#### 配置与数据
- [ ] 配置文件自动迁移成功
- [ ] SQLite 数据迁移成功
- [ ] 账号数量一致
- [ ] UUID 唯一性保持
- [ ] 运行时状态持久化正常

#### UI 功能
- [ ] 账号列表加载正常
- [ ] 新增账号功能正常
- [ ] 编辑账号功能正常
- [ ] 删除账号功能正常
- [ ] 批量操作功能正常
- [ ] 健康检查触发正常
- [ ] 用量查询显示正常

#### OAuth 功能
- [ ] OAuth 授权流程正常
- [ ] 新账号自动入池
- [ ] 新账号可被选择使用

### 性能验证
- [ ] 请求响应时间 < 100ms
- [ ] 账号选择性能无退化
- [ ] SQLite 查询性能正常
- [ ] 并发请求处理正常

### 数据一致性验证
- [ ] 配置文件与数据库一致
- [ ] 重启后数据完整
- [ ] 并发写入无丢失
- [ ] 健康状态同步正常

---

## 📊 风险评估

| 任务 | 风险等级 | 主要风险 | 缓解措施 |
|------|---------|---------|---------|
| T01 | 低 | 开关逻辑错误 | 充分测试两种模式 |
| T02 | 中 | 接口设计不完善 | 参考现有实现 |
| T03 | 高 | 请求失败率上升 | 灰度发布、快速回滚 |
| T04 | 中 | 配置迁移失败 | 自动备份、校验 |
| T05 | 中 | OAuth 流程中断 | 保留旧逻辑兼容 |
| T06 | 高 | UI 完全不可用 | 前后端同步发布 |
| T07 | 高 | 数据丢失/损坏 | 迁移前备份、校验 |
| T08 | 中 | 删除错误引用 | 代码审查、测试 |

---

## 📚 相关文档

- [Provider 简化方案](./PROVIDER_SIMPLIFICATION.md) - 渐进式简化方案（已废弃）
- [SQLite 实现分析](./sqlite-implementation-analysis.md) - SQLite 架构分析
- [执行报告](./EXECUTION_REPORT.md) - 最近的优化记录

---

## 🎯 下一步行动

### 立即执行

如果你确认要开始重构，可以发送：

```
请开始执行 Provider 层移除计划的第一阶段：

1. 执行 T01: 依赖冻结与重构开关
2. 添加 ACCOUNT_POOL_MODE 环境变量支持
3. 在 service-manager 中添加模式选择逻辑
4. 验证 legacy 模式下所有功能正常

你有完全的代码修改权限，直接执行。
```

### 分阶段执行

建议按照实施顺序逐个阶段执行，每个阶段完成后：
1. 运行完整测试
2. 打 git tag
3. 部署到测试环境验证
4. 确认无问题后继续下一阶段

---

**文档版本**：v1.0
**最后更新**：2026-01-03
**状态**：待执行
**预计完成时间**：2026-01-06
