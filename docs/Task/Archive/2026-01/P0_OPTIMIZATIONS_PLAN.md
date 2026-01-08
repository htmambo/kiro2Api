# P0 优化任务

**状态**: ✅ 已完成 (完成时间: 2026-01-08)

## 任务目标

处理 stash 中的 P0 优化任务，包括内存泄漏修复、事务一致性优化、并发控制等关键修复。

## 问题分析

### 当前状态
- Stash 中包含多个重要修复，但混在一起（10 个文件，224 insertions, 400 deletions）
- Codex review 指出 mutex.js 存在 unhandled Promise rejection 风险
- 需要拆分成多个独立的提交，便于 review 和回滚

### 关键问题

1. **mutex.js Promise rejection 风险**（第 38-49 行）
   - 问题：当 `locks.get(key)` 先 resolve 时，`timeoutPromise` 中的 `setTimeout` 仍会触发
   - 后果：导致 unhandled Promise rejection
   - 解决：清理 setTimeout timer

2. **streaming.js 内存泄漏**
   - 问题：无限制的 buffer 累积可能导致内存耗尽
   - 解决：添加 MAX_BUFFER_SIZE 限制（10MB）

3. **oauth.handlers.js 事务一致性**
   - 问题：并发导入、重复检测时机不当
   - 解决：添加 mutex 锁、accountNumber 验证、提前重复检测

4. **domain/oauth/index.js 事务一致性**
   - 问题：入池失败后 token 文件未回滚
   - 解决：添加回滚机制

5. **account.handlers.js 架构改进**
   - 问题：使用废弃的 services/oauth-handlers.js
   - 解决：迁移到 domain 层的 AwsSsoDeviceFlow

## 详细任务分解

### ✅ 子任务 1: 创建任务计划文档
- 创建 `docs/Task/Active/P0_OPTIMIZATIONS_PLAN.md`
- 分析所有待修复问题

### ✅ 子任务 2: 修复 mutex.js Promise rejection 风险
- 保存 setTimeout 返回的 timer ID
- 在 Promise.race 完成后清理 timer
- 提交: 3506aef

### ✅ 子任务 3: 提交 streaming.js 内存泄漏修复
- 从 stash 中提取 streaming.js 的改动
- 添加 MAX_BUFFER_SIZE 限制（10MB，可通过环境变量配置）
- 提交: 0872ef8

### ✅ 子任务 4: 提交 domain/oauth/index.js 事务一致性修复
- 从 stash 中提取 domain/oauth/index.js 的改动
- 添加入池失败回滚机制
- 返回 provider 信息避免读取已消费的 state
- 提交: 8d53caf

### ✅ 子任务 5: 提交 oauth.handlers.js 优化
- 从 stash 中提取 oauth.handlers.js 的改动
- 添加 mutex 锁防止并发导入
- 添加 accountNumber 类型和范围验证
- 移动重复检测到 token 保存之前
- 添加 AWS SSO 轮询失败的错误广播
- 提交: e347297

### ✅ 子任务 6: 提交 account.handlers.js 重构
- 从 stash 中提取 account.handlers.js 的改动
- 迁移到 AwsSsoDeviceFlow
- 使用 once 而非 on 避免内存泄漏
- 提交: deb4b90

### ✅ 子任务 7: 删除废弃代码
- 删除 services/oauth-handlers.js（218 行）
- 提交: b666c13

### ✅ 子任务 8: 其他小改动
- 日志优化（移除冗余的 `[Kiro]` 等前缀）
- 使用 accountPoolManager.listAccounts() 统一接口
- 提交: b5312db, beff7af

### ✅ 子任务 9: 验证和测试
- 模块加载测试通过
- Codex 代码审核完成

## 实施顺序

1. 创建任务计划文档 ✅
2. **先修复 mutex.js**（其他任务依赖它）
3. 提交 streaming.js 内存泄漏修复
4. 提交 domain/oauth/index.js 事务一致性修复
5. 提交 oauth.handlers.js 优化（依赖 mutex.js）
6. 提交 account.handlers.js 重构
7. 删除废弃代码
8. 其他小改动
9. 验证和测试

## 风险评估

### 高风险
1. **mutex.js 修复不当**
   - 风险：可能引入新的并发问题
   - 缓解：添加测试用例，仔细 review

2. **事务回滚不完整**
   - 风险：可能导致数据不一致
   - 缓解：确保所有失败路径都有回滚

### 中风险
1. **拆分提交时遗漏改动**
   - 风险：功能不完整
   - 缓解：仔细对比 stash 和提交内容

## 预期效果

- 修复 mutex.js 的 Promise rejection 风险
- 防止 streaming.js 内存泄漏
- 提高 OAuth 导入的事务一致性
- 改进架构，使用 domain 层组件
- 删除 218 行废弃代码
- 代码更安全、更可维护

## 验收标准

- [x] mutex.js 无 unhandled Promise rejection
- [x] streaming.js 有 buffer 大小限制
- [x] OAuth 导入有并发控制和重复检测
- [x] 入池失败能正确回滚
- [x] account.handlers.js 使用 domain 层组件
- [x] services/oauth-handlers.js 已删除
- [x] 模块加载测试通过
- [x] Codex 代码审核完成

## Codex 审核意见

### 已完成的改进
1. ✅ mutex.js Promise rejection 修复正确
2. ✅ streaming.js MAX_BUFFER_SIZE 实现合理
3. ✅ oauth.handlers.js 重复检测前置
4. ✅ account.handlers.js 使用 once 避免内存泄漏
5. ✅ 删除 218 行废弃代码

### 发现的待改进点（后续任务）

**⚠️ 注意：以下 6 个问题已在后续的 [Codex 审核改进任务](CODEX_REVIEW_IMPROVEMENTS_PLAN.md) 中全部解决。**

1. **awsSsoStart 路由仍用旧逻辑**（高风险）✅ 已修复 (commit: c692274)
   - 无锁、默认 accountNumber=1、可能互相踩踏
   - 建议：迁移到 domain layer 或禁用

2. **OAuth callback 缺少幂等性保护** ✅ 已修复 (commit: e9ec9d3)
   - 可能重复写 token/重复入池
   - 建议：添加 state 级别的锁

3. **manualImport 锁粒度不足** ✅ 已修复 (commit: 7e5f1d1)
   - 当前锁 accountNumber，应该锁 refreshToken
   - 建议：改为 `withLock('manualImport:' + hash(refreshToken))`

4. **入池失败处理不一致** ✅ 已修复
   - manualImport 入池失败不回滚 token 文件
   - 建议：统一回滚策略

5. **协议字段缺少健壮性校验** ✅ 已修复 (commit: 5eee89f)
   - parseAwsEventStreamMessage 未验证 totalLength/headersLength
   - 建议：添加边界检查

6. **accountNumber 类型校验过严** ✅ 已修复 (commit: 7e5f1d1)
   - 不接受 numeric string（如 "1"）
   - 建议：接受并转换

## 实际完成情况

### 提交记录
1. `3506aef` - fix(utils): prevent unhandled Promise rejection in mutex timeout
2. `0872ef8` - fix(kiro): prevent memory exhaustion in streaming buffer
3. `8d53caf` - fix: 添加事务一致性保证 - 入池失败时回滚token文件并返回provider信息
4. `9a87e2b` - docs(task): add P0 optimizations task plan and domain layer OAuth flow
5. `e347297` - refactor(oauth): optimize transaction consistency and concurrency control
6. `b5312db` - refactor(ui): use accountPoolManager.listAccounts() and clean up log prefixes
7. `deb4b90` - refactor(account): migrate to domain layer OAuth flow
8. `b666c13` - refactor: delete deprecated oauth-handlers.js service layer
9. `beff7af` - refactor(logs): remove redundant log prefixes in kiro modules

### 代码统计
- 删除：218 行废弃代码（services/oauth-handlers.js）
- 修改：9 个文件
- 新增：MAX_BUFFER_SIZE 限制、mutex 锁、事务回滚机制
- 改进：日志系统、架构分层

## 经验教训

1. **应该每个子任务完成后就让 codex 审核**
   - 本次是完成所有任务后才审核
   - 导致发现问题时已经提交
   - 下次改进：每个子任务完成 → codex 审核 → 修复 → 提交

2. **锁粒度设计需要更仔细**
   - manualImport 锁 accountNumber 不够
   - 应该锁业务唯一标识（refreshToken）

3. **幂等性保护容易遗漏**
   - OAuth callback 缺少幂等性
   - 需要在设计阶段就考虑

4. **旧代码迁移要彻底**
   - awsSsoStart 仍用旧逻辑
   - 应该一次性迁移完成

## 备注

- 本次任务从 stash 中恢复改动，需要仔细拆分
- Codex 已 review 并指出关键风险点
- 优先修复 mutex.js，因为其他任务依赖它
