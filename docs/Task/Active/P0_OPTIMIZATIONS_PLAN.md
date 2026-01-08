# P0 优化任务

**状态**: 🔄 进行中 (开始时间: 2026-01-08)

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

### ⏳ 子任务 2: 修复 mutex.js Promise rejection 风险
- 保存 setTimeout 返回的 timer ID
- 在 Promise.race 完成后清理 timer
- 添加测试用例验证修复

### ⏳ 子任务 3: 提交 streaming.js 内存泄漏修复
- 从 stash 中提取 streaming.js 的改动
- 添加 MAX_BUFFER_SIZE 限制
- 独立提交

### ⏳ 子任务 4: 提交 domain/oauth/index.js 事务一致性修复
- 从 stash 中提取 domain/oauth/index.js 的改动
- 添加入池失败回滚机制
- 独立提交

### ⏳ 子任务 5: 提交 oauth.handlers.js 优化
- 从 stash 中提取 oauth.handlers.js 的改动
- 添加 mutex 锁、accountNumber 验证
- 依赖修复后的 mutex.js
- 独立提交

### ⏳ 子任务 6: 提交 account.handlers.js 重构
- 从 stash 中提取 account.handlers.js 的改动
- 迁移到 AwsSsoDeviceFlow
- 独立提交

### ⏳ 子任务 7: 删除废弃代码
- 删除 services/oauth-handlers.js
- 独立提交

### ⏳ 子任务 8: 其他小改动
- 日志优化（移除 `[Kiro]` 前缀）
- 独立提交

### ⏳ 子任务 9: 验证和测试
- 运行所有测试
- 手动测试关键流程
- 确认无回归

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

- [ ] mutex.js 无 unhandled Promise rejection
- [ ] streaming.js 有 buffer 大小限制
- [ ] OAuth 导入有并发控制和重复检测
- [ ] 入池失败能正确回滚
- [ ] account.handlers.js 使用 domain 层组件
- [ ] services/oauth-handlers.js 已删除
- [ ] 所有测试通过
- [ ] 无回归问题

## 备注

- 本次任务从 stash 中恢复改动，需要仔细拆分
- Codex 已 review 并指出关键风险点
- 优先修复 mutex.js，因为其他任务依赖它
