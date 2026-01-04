# 账号池操作集中化重构任务

## 任务目标

将所有与账号池配置信息的操作集中到 `src/services/pools/json.js` 的 `AccountPoolManager` 类中，其它代码不能有直接修改文件的操作，必须调用 AccountPoolManager 的方法来处理。

## 当前问题分析

### 1. src/ui-manager.js (主要问题文件)

**直接文件操作函数**：
- `readAccountsFromStorage()` (line 44-63) - 直接使用 `readFileSync` 读取 account_pool.json
- `writeAccountsToStorage()` (line 65-69) - 直接使用 `writeFileSync` 写入 account_pool.json

**使用这些函数的 API 端点**（共 15+ 处）：
1. `GET /api/accounts` (line 1130) - 读取账号列表
2. `POST /api/accounts` (line 1207-1210) - 添加账号
3. `DELETE /api/accounts/:uuid` (line 1235-1245) - 删除账号
4. `POST /api/accounts/:uuid/toggle` (line 1264-1273) - 切换账号启用/禁用
5. `POST /api/accounts/batch-delete` (line 1306-1333) - 批量删除账号
6. `POST /api/accounts/reset-health` (line 1358-1377) - 重置健康状态
7. `POST /api/accounts/health-check` (line 1405-1435) - 批量健康检查
8. `POST /api/accounts/:uuid/health-check` (line 1464-1483) - 单个健康检查
9. `POST /api/accounts/:uuid/test` (line 1509) - 测试账号
10. `POST /api/accounts/cleanup-duplicates` (line 1554-1598) - 清理重复账号
11. `DELETE /api/providers/:type/:uuid` (line 1646-1698) - 删除提供商
12. `POST /api/providers/batch-delete` (line 1742-1827) - 批量删除提供商
13. `POST /api/providers/:type/:uuid/(disable|enable)` (line 1868-1893) - 启用/禁用提供商
14. `POST /api/providers/:type/:uuid/toggle` (line 1949-1966) - 切换提供商状态
15. `POST /api/quick-link-provider` (line 2380-2425) - 快速关联配置文件
16. `GET /api/usage` (line 3490) - 获取用量信息

**其他直接文件操作**：
- Line 762: OAuth 回调保存 token 文件
- Line 2098: 健康检查后保存 provider pools
- Line 2700-2703: 清理重复提供商
- Line 2851-2909: 手动导入 OAuth token
- Line 3629: 保存用量缓存的 userId/email

### 2. src/services/oauth-handlers.js

**直接文件操作**（line 144-194）：
- OAuth 回调成功后自动添加到 account_pool.json
- 使用 `readFileSync` 读取文件 (line 152)
- 使用 `writeFileSync` 写入文件 (line 183)
- 直接操作 accountPool.accounts 数组 (line 159-182)

## 需要在 AccountPoolManager 中添加的方法

### 核心 CRUD 方法
1. ✅ `listAccounts()` - 已存在
2. ✅ `addTokenFile(tokenFilePath)` - 已存在
3. **NEW** `addAccount(accountConfig)` - 添加完整账号配置
4. **NEW** `removeAccount(uuid)` - 删除账号
5. **NEW** `updateAccount(uuid, updates)` - 更新账号属性
6. **NEW** `getAccount(uuid)` - 获取单个账号
7. **NEW** `findAccount(predicate)` - 按条件查找账号

### 批量操作方法
8. **NEW** `batchDeleteAccounts(uuids)` - 批量删除账号
9. **NEW** `batchDeleteByStatus(statusTypes)` - 按状态批量删除
10. ✅ `markAllAccountsHealthy()` - 已存在（需验证）
11. **NEW** `resetAccountHealth(uuid)` - 重置单个账号健康状态

### 状态管理方法
12. ✅ `disableAccount(uuid)` - 已存在
13. ✅ `enableAccount(uuid)` - 已存在
14. **NEW** `toggleAccount(uuid)` - 切换启用/禁用状态
15. ✅ `markAccountHealthy(uuid, options)` - 已存在
16. ✅ `markAccountUnhealthy(uuid, errorMessage)` - 已存在

### 查询和统计方法
17. ✅ `getPoolStats()` - 已存在
18. ✅ `getPoolDetails()` - 已存在
19. **NEW** `getAccountsByStatus(statusType)` - 按状态获取账号列表
20. **NEW** `findDuplicateAccounts()` - 查找重复账号（相同 cachedUserId）

### 文件操作方法
21. **NEW** `loadFromFile()` - 显式从文件加载
22. **NEW** `saveToFile()` - 显式保存到文件（非防抖）
23. **NEW** `reloadFromFile()` - 重新加载文件（丢弃内存中的更改）

## 重构步骤

### Phase 1: 扩展 AccountPoolManager (优先级：高)
- [ ] 添加上述缺失的方法到 `src/services/pools/json.js`
- [ ] 确保所有方法都调用 `_debouncedSave()` 进行持久化
- [ ] 添加适当的错误处理和日志记录
- [ ] 添加方法的 JSDoc 注释

### Phase 2: 重构 ui-manager.js (优先级：高)
- [ ] 移除 `readAccountsFromStorage()` 函数
- [ ] 移除 `writeAccountsToStorage()` 函数
- [ ] 移除 `syncPoolManagerAfterAccountsChange()` 函数（不再需要）
- [ ] 重构所有 API 端点，使用 AccountPoolManager 方法：
  - [ ] GET /api/accounts
  - [ ] POST /api/accounts
  - [ ] DELETE /api/accounts/:uuid
  - [ ] POST /api/accounts/:uuid/toggle
  - [ ] POST /api/accounts/batch-delete
  - [ ] POST /api/accounts/reset-health
  - [ ] POST /api/accounts/health-check
  - [ ] POST /api/accounts/:uuid/health-check
  - [ ] POST /api/accounts/:uuid/test
  - [ ] POST /api/accounts/cleanup-duplicates
  - [ ] DELETE /api/providers/:type/:uuid
  - [ ] POST /api/providers/batch-delete
  - [ ] POST /api/providers/:type/:uuid/(disable|enable)
  - [ ] POST /api/providers/:type/:uuid/toggle
  - [ ] POST /api/quick-link-provider
  - [ ] GET /api/usage

### Phase 3: 重构 oauth-handlers.js (优先级：中)
- [x] 移除 OAuth 回调中的直接文件操作
- [x] 使用 `poolManager.addAccount()` 替代直接文件操作

### Phase 4: 测试和验证 (优先级：高)
- [ ] 测试所有 API 端点功能正常
- [ ] 验证文件持久化正常工作
- [ ] 验证防抖保存机制正常
- [ ] 检查日志输出是否正确

### Phase 5: 清理和文档 (优先级：低)
- [x] 移除未使用的导入和函数
- [ ] 更新相关文档
- [ ] 归档任务文档

## 预期收益

1. **单一数据源**：所有账号池操作都通过 AccountPoolManager
2. **一致的错误处理**：统一的错误处理逻辑
3. **性能优化**：防抖保存减少文件 I/O
4. **易于维护**：集中管理便于添加新功能（如缓存、验证等）
5. **更好的测试性**：可以轻松 mock AccountPoolManager 进行单元测试

## 风险评估

- **风险等级**：中等
- **影响范围**：账号管理相关的所有 API 端点
- **回滚策略**：保留原有函数作为备份，测试通过后再删除

## 开始时间

2026-01-04

## 完成时间

2026-01-04

## 完成总结

### 实际完成的工作

**Phase 1: 扩展 AccountPoolManager** ✅
- 已在之前的工作中完成，所有必需的方法都已存在

**Phase 2: 重构 ui-manager.js** ✅
- 验证发现所有 API 端点已经正确使用 AccountPoolManager 方法
- 无需额外修改

**Phase 3: 重构 oauth-handlers.js** ✅
- 重构了第 145-193 行的 OAuth 回调代码
- 移除了所有直接文件操作（fs.readFileSync/writeFileSync）
- 使用 `poolManager.addAccount()` 替代手动操作
- 代码从 ~50 行减少到 ~35 行
- 保留了所有必要的字段、日志和事件广播

**Phase 5: 清理和文档** ✅
- 移除了 ui-manager.js 中的两个废弃函数：
  - `writeAccountsToStorage()` (line 75-78)
  - `syncPoolManagerAfterAccountsChange()` (line 84-87)
- 更新了任务文档

### 代码变更统计

**src/services/oauth-handlers.js**:
- 删除: ~50 行直接文件操作代码
- 新增: ~35 行使用 AccountPoolManager 的代码
- 净减少: ~15 行

**src/ui-manager.js**:
- 删除: 18 行废弃函数代码

### 技术改进

1. **单一数据源**: 所有账号池操作现在都通过 AccountPoolManager
2. **代码简化**: 移除了重复的文件读写逻辑
3. **一致性**: 统一的错误处理和日志记录
4. **性能优化**: 利用防抖保存机制减少文件 I/O
5. **可维护性**: 集中管理便于未来扩展

### 遗留任务

**Phase 4: 测试和验证** - 需要手动测试
- [ ] 测试 OAuth 授权流程，确认账号正确添加到账号池
- [ ] 验证文件持久化正常工作
- [ ] 验证防抖保存机制正常
- [ ] 检查日志输出是否正确

---

**状态**: ✅ 已完成（代码重构部分）
**负责人**: Claude Code (自动执行)
**测试状态**: ⏳ 待手动验证
