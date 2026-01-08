# Codex 审核改进任务

**状态**: 🔄 进行中 (开始时间: 2026-01-08)
**创建时间**: 2026-01-08
**优先级**: P1（中高优先级）

## 任务目标

处理 P0 优化任务完成后，Codex 审核发现的 6 个待改进点，提升代码的健壮性、一致性和安全性。

## 问题分析

### 来源
这些问题是在 P0 优化任务完成后，通过 Codex 代码审核发现的。虽然不是阻塞性问题，但会影响系统的稳定性和可维护性。

### 改进点列表（按风险重新评估）

1. **awsSsoStart 路由仍用旧逻辑**（高风险）
   - 位置：`src/ui/router/handlers/oauth.handlers.js:awsSsoStart`
   - 问题：无锁、默认 accountNumber=1、使用旧接口假设（`providerPools`、`addTokenFile` 返回值）
   - 影响：并发请求可能导致账号覆盖，接口不匹配可能导致功能异常
   - 建议：修复接口假设、添加 in-flight 标记、去除默认值

2. **OAuth callback 缺少幂等性保护**（高风险）
   - 位置：`src/ui/router/handlers/oauth.handlers.js:webCallback`、`src/domain/oauth/index.js`
   - 问题：可能重复写 token/重复入池
   - 影响：同一个 state 被多次回调时会重复处理
   - 建议：添加 state 级别的锁、扩充 completedInfo 支持幂等返回

3. **协议字段缺少健壮性校验**（中风险，提升自低风险）
   - 位置：`src/kiro/streaming.js:parseAwsEventStreamMessage`
   - 问题：未验证 totalLength/headersLength 的合法性，可能导致越界读取崩溃
   - 影响：恶意或损坏的数据可能导致进程崩溃（DoS）
   - 建议：添加边界检查、防止未捕获异常

4. **manualImport 锁粒度不足**（中风险）
   - 位置：`src/ui/router/handlers/oauth.handlers.js:manualImport`
   - 问题：当前锁 accountNumber，应该锁 refreshToken + accountNumber（双锁）
   - 影响：不同账号号码但相同 refreshToken 时无法防止重复；同账号并发覆盖
   - 建议：改为双锁策略（先 token 后 account）

5. **入池失败处理不一致**（中风险）
   - 位置：`src/ui/router/handlers/oauth.handlers.js:manualImport`
   - 问题：manualImport 入池失败不回滚 token 文件
   - 影响：可能导致 token 文件存在但未入池的不一致状态
   - 建议：统一回滚策略（参考 domain/oauth/index.js）

6. **accountNumber 类型校验过严**（低风险）
   - 位置：`src/ui/router/handlers/oauth.handlers.js:manualImport`
   - 问题：不接受 numeric string（如 "1"）
   - 影响：用户体验不佳，需要前端做类型转换
   - 建议：接受并转换 numeric string

### Codex 指出的关键遗漏点

1. **awsSsoStart 的 in-flight 标记**
   - 问题：`withLock` 作用域锁在请求返回时就释放，无法覆盖后台 poll 的生命周期
   - 解决：需要跨请求生命周期的 in-flight 标记（进程内 Map）

2. **OAuth callback 的 code 一次性问题**
   - 问题："不 consume state"不一定能保证重试成功（OAuth code 可能一次性）
   - 解决：在文档中明确说明，并建议对入池操作做有限次数内部重试

3. **completedInfo 的服务重启限制**
   - 问题：completedInfo 是内存缓存，服务重启后丢失
   - 解决：在文档中明确标注限制

## 统一语义 / 约定（必须遵守）

### 全局一致性原则
- 所有 OAuth/SSO/导入入口（`webCallback`、`manualImport`、`awsSsoStart`）遵循同一套一致性语义：**"入池成功"是成功的必要条件**。
- **不允许部分成功**：任何入口只要"token 已落盘但未入池"，都视为失败并执行回滚（删除已写入的 token 文件）。

### 入池失败处理（统一）
- 入池失败处理流程（所有入口一致）：
  1. 记录错误（含入口类型、accountNumber、stage）
  2. 回滚 token 文件（调用 `tokenStore.deleteToken(...)` 或等价逻辑）
  3. 返回失败响应（错误信息需可定位）
- OAuth callback 特殊约定：
  - **只有在"token 落盘 + 入池成功"后才 consume state**。
  - 入池失败时 **不 consume state**。
  - 说明：即使不 consume state，OAuth provider 的 `code` 可能一次性；若错误提示为 code 已使用/过期，则需要重新发起授权流程。

### awsSsoStart 行为定义（替换槽位）
- `accountNumber` 必填：后端不提供默认值；前端必须显式传入。
- 成功行为：允许覆盖指定 `accountNumber` 槽位（"替换槽位"预期）。
- 并发行为：同一 `accountNumber` 同时只允许一个 in-flight 授权流程：
  - 第二个请求直接拒绝（建议 `409` 或 `423`），错误信息为"该 accountNumber 正在进行授权"。
- 并发控制实现约定：
  - 必须使用**跨请求生命周期**的 in-flight 标记（例如进程内 Map），从流程启动到后台 poll 完成/失败清理为止。
  - 仅依赖作用域锁（如 `withLock`）不足以覆盖"立即返回 + 后台 poll"的生命周期。

### OAuth callback 幂等性（state 级）
- 重复回调（相同 `state`）必须返回**同样结果**：
  - 第一次成功 → 后续重复回调返回相同成功结果
  - 第一次失败 → 后续重复回调返回相同失败信息（失败也幂等）
- completedInfo 作为幂等结果缓存：
  - 字段（统一口径）：`accountNumber`、`relativePath`、`provider`、`completedAt`、`resultOk`、`errorMessage`（可选）
  - TTL：30 分钟（与 state TTL 对齐）
  - 限制：completedInfo 为内存缓存，服务重启后不保证保留（除非后续明确实现落盘）

### manualImport 并发锁策略（双锁）
- 目标：同时防止 "同 refreshToken 跨账号重复导入" 和 "同 accountNumber 并发覆盖写盘"。
- 固定锁顺序（全项目约定）：**先 token 锁，后 account 锁**。
- key 设计：
  - `manualImport:token:${sha256(refreshToken)}`
  - `manualImport:account:${accountNumber}`
- hash 算法：`sha256(refreshToken).digest('hex')`（禁止记录明文 refreshToken）。
- 适用前提：锁为**进程内互斥**，仅在单实例部署（例如 `pm2 instances=1`）下保证全局互斥；多实例需替换为分布式锁方案。

### 协议解析健壮性（防崩溃）
- `parseAwsEventStreamMessage` 必须做边界检查，保证异常/恶意数据不会触发越界读取导致进程崩溃：
  - `totalLength` 最小值检查
  - `headersLength` 与 `totalLength` 关系校验（headers 不得越界 payload/messageCrc）
  - 解析循环中每一步读取前都要验证剩余字节充足
  - 在无法解析时以可控方式返回（如 `null` 或结构化错误），不得抛出未捕获异常

## 详细任务分解

### ✅ 子任务 1: 创建任务计划并与 Codex 协作分析
- ✅ 创建本文档
- ✅ 与 Codex 协作完善需求分析和实施计划
- ✅ 确定实施顺序和风险评估
- ✅ 明确统一语义和约定

### ✅ 子任务 2: 协议解析健壮性（最简单、最独立）

**改动文件**：
- `src/kiro/streaming.js`

**具体改动点**：
- [x] 在 `parseAwsEventStreamMessage(buffer, offset)` 增加 `offset` 合法性校验
- [x] 增加 `totalLength` 下界校验（至少 16 字节）
- [x] 增加 `totalLength` 上界校验（复用 MAX_BUFFER_SIZE 或 10MB）
- [x] 增加 `headersLength` 边界校验：`12 + headersLength <= totalLength - 4`
- [x] 在 header 解析循环中，对每一次读取都做"剩余字节数"检查
- [x] 校验 `payloadStart/payloadEnd` 范围合法性
- [x] 在 `parseAwsEventStreamBuffer` 外层加 try/catch 捕获协议损坏错误
- [x] 明确"数据不完整 vs 数据损坏"的返回策略

**验收标准**：
- [x] 不完整数据：返回 `null`，等待更多数据
- [x] 损坏数据（totalLength < 16）：不崩溃，记录 warn
- [x] 损坏数据（headersLength 越界）：不崩溃，安全退出
- [x] 损坏数据（totalLength > MAX_BUFFER_SIZE）：不崩溃
- [x] header 截断：不崩溃
- [x] payload 越界：不崩溃
- [x] 回归：正常 Kiro streaming 响应仍能解析

**实施步骤**：
1. ✅ 让 Codex 提供代码原型（unified diff patch）
2. ✅ 重写代码（企业生产级）
3. ✅ 自审代码改动（Codex 调用失败）
4. ✅ 提交（commit: 5eee89f）

### ✅ 子任务 3: awsSsoStart 止血

**改动文件**：
- `src/ui/router/handlers/oauth.handlers.js`

**具体改动点**：
- [x] `accountNumber` 改为必填（移除默认值 1）
- [x] 对 `accountNumber` 做统一校验（与 manualImport 对齐，支持 numeric string）
- [x] 引入 in-flight 标记（进程内 Map：`awsSsoInflight`）
- [x] 并发拒绝规则：同一 accountNumber 拒绝第二个请求（409）
- [x] 统一入池失败语义：失败回滚 token 文件
- [x] 修复旧接口假设：使用 `addAccount()` 而非 `addTokenFile()`，不访问 `providerPools`
- [x] in-flight 清理：finally 块和 catch 块清理标记

**验收标准**：
- [x] 不传 accountNumber 返回 400
- [x] 同一 accountNumber 并发返回 409
- [x] 不同 accountNumber 可同时启动（Map key 隔离）
- [x] 入池失败回滚 token 文件（调用 tokenStore.deleteToken）
- [x] 成功路径：token 写入正确槽位、账号池包含、广播事件
- [x] 错误码一致性（400/409/500）

**实施步骤**：
1. ✅ 让 Codex 提供代码原型（unified diff patch）
2. ✅ 重写代码（企业生产级）
3. ✅ 模块加载测试通过
4. ✅ 提交（commit: c692274）

### ✅ 子任务 4: OAuth callback 幂等

**改动文件**：
- `src/domain/oauth/index.js`
- `src/domain/oauth/state-store.js`

**具体改动点**：
- [x] 在 `OAuthFacade.handleWebCallback` 内加 state 级锁（使用 withLock）
- [x] 优先检查 completedInfo：已存在则直接返回
- [x] 扩充 completedInfo 字段：accountNumber、relativePath、provider、completedAt、resultOk、errorMessage
- [x] 调整 completedInfo TTL 为 30 分钟（与 state TTL 对齐）
- [x] 严格保证"成功后才 consume state"（已实现，保持）
- [x] 失败也幂等：失败时记录 completedInfo（resultOk=false）

**验收标准**：
- [x] 同一 state 并发请求只发生一次处理（withLock 保证）
- [x] 重复回调返回同样成功结果（completedInfo 缓存）
- [x] 失败幂等：返回同样失败信息（resultOk=false）
- [x] 入池失败不 consume state（失败时 consume=false）
- [x] 服务重启后幂等退化（文档已标注：completedInfo 为内存缓存）

**实施步骤**：
1. ✅ 让 Codex 提供代码原型（unified diff patch）
2. ✅ 重写代码（企业生产级）
3. ✅ 模块加载测试通过
4. ✅ 提交（commit: e9ec9d3）

### ⏳ 子任务 5: manualImport 三件套（双锁 + 回滚 + accountNumber 类型）

**改动文件**：
- `src/ui/router/handlers/oauth.handlers.js`

**具体改动点**：
- [ ] accountNumber 兼容 numeric string（接受 `/^[0-9]+$/` 并转换）
- [ ] 引入 refreshToken hash（sha256）
- [ ] 双锁策略：先 token 锁，后 account 锁
- [ ] 锁作用范围：从校验通过到入池成功/回滚完成
- [ ] 统一入池失败回滚：删除 token 文件，返回失败
- [ ] 账号池一致性：导入结束后池必须包含对应 relativePath
- [ ] 成功/失败事件广播

**验收标准**：
- [ ] accountNumber="1" 导入成功
- [ ] 同 token 不同账号：串行化，防止重复
- [ ] 同账号不同 token：串行化，防止覆盖
- [ ] 回滚测试：入池失败删除 token 文件
- [ ] 重复检测回归：不新增重复账号

**实施步骤**：
1. 让 Codex 提供代码原型（unified diff patch）
2. 重写代码（企业生产级）
3. Codex review 代码改动
4. 提交

### ⏳ 子任务 6: 整体验证和测试
- [ ] 模块加载测试
- [ ] 功能测试
- [ ] 并发测试
- [ ] Codex 最终审核

### ⏳ 子任务 7: 归档任务文档
- [ ] 更新文档状态为"已完成"
- [ ] 移动到 Archive 目录
- [ ] 更新 README.md

## 实施顺序（已调整）

按"独立性 + 风险 + 修复确定性"排序：

1. ✅ 子任务 1: 创建计划并协作分析
2. ⏳ 子任务 2: 协议解析健壮性（最简单、最独立、防崩溃）
3. ⏳ 子任务 3: awsSsoStart 止血（高风险、接口不匹配）
4. ⏳ 子任务 4: OAuth callback 幂等（高风险、并发安全）
5. ⏳ 子任务 5: manualImport 三件套（中风险、合并实施）
6. ⏳ 子任务 6: 整体验证和测试
7. ⏳ 子任务 7: 归档

**说明**：
- 协议解析提前（独立、快速、防崩溃）
- manualImport 三件套合并（锁粒度 + 回滚 + accountNumber 类型）
- 每个子任务完成后立即 Codex review（吸取 P0 任务教训）

## 风险评估（重新评估）

### 高风险
1. **awsSsoStart 强制 accountNumber 必填可能破坏前端**
   - 缓解：前端同步改动，API 返回明确错误信息
   - 缓解：必要时短期保留兼容分支（但强烈不推荐默认 1）

2. **awsSsoStart in-flight 未清理导致账号永久锁死**
   - 缓解：确保所有路径 finally 清理
   - 缓解：可选加"超时自动清理"保护

3. **OAuth callback 幂等引入失败固定化**
   - 缓解：区分 retryable/terminal 或给失败更短 TTL
   - 缓解：输出清晰错误指引

### 中风险
1. **协议解析校验过严导致误判损坏**
   - 缓解：限定在明确的长度关系违例
   - 缓解：保留"不完整返回 null"路径

2. **manualImport 锁范围过大导致吞吐下降**
   - 缓解：token 锁覆盖全流程保证语义
   - 缓解：若性能成问题再优化，但不倒退一致性

3. **错误处理路径遗漏回滚**
   - 缓解：统一回滚分支结构
   - 缓解：用回滚测试覆盖

### 低风险
1. **类型转换引入新的验证问题**
   - 缓解：保持严格的范围检查
   - 缓解：只接受 `/^[0-9]+$/` 格式

## 预期效果

- ✅ 修复 awsSsoStart 的并发安全问题和接口不匹配
- ✅ 防止 OAuth callback 重复处理（幂等性）
- ✅ 提高 manualImport 的重复检测准确性（双锁）
- ✅ 统一入池失败的回滚策略（三个入口一致）
- ✅ 增强协议解析的健壮性（防崩溃）
- ✅ 改善用户体验（接受 numeric string）
- ✅ 代码更安全、更一致、更可维护

## 总体验收标准

### 功能验收
- [ ] awsSsoStart 有 in-flight 并发控制机制
- [ ] awsSsoStart accountNumber 必填，无默认值
- [ ] OAuth callback 有 state 级幂等性保护
- [ ] OAuth callback 重复请求返回相同结果
- [ ] manualImport 使用双锁（token + account）
- [ ] manualImport 入池失败能回滚 token 文件
- [ ] manualImport 接受 numeric string accountNumber
- [ ] parseAwsEventStreamMessage 有完整边界检查
- [ ] 三个入口入池失败语义一致

### 测试验收
- [ ] 模块加载测试通过
- [ ] 并发测试通过（同 accountNumber、同 token、同 state）
- [ ] 回滚测试通过（入池失败场景）
- [ ] 协议解析损坏数据测试通过（不崩溃）
- [ ] 回归测试通过（正常流程不受影响）

### 代码质量验收
- [ ] 每个子任务完成后 Codex review 通过
- [ ] 最终 Codex 审核通过
- [ ] 代码符合企业生产级标准
- [ ] 错误处理完整，日志清晰

## 经验教训（来自 P0 任务）

1. **每个子任务完成后立即 Codex review**
   - 不要等到所有任务完成才审核
   - 及时发现问题，节省 token

2. **先让 Codex 提供代码原型**
   - 要求 Codex 仅给出 unified diff patch
   - 严禁 Codex 对代码做真实修改
   - 以原型为参考，自己重写代码

3. **保持与 Codex 的争辩**
   - Codex 只是参考，不是真理
   - 必须有自己的思考和判断
   - 通过争辩找到最佳方案

## 备注

- 本次任务是 P0 优化任务的后续改进
- 所有问题均由 Codex 审核发现
- 优先处理高风险问题
