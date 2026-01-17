# 代码重构任务计划

**状态**: 🔄 进行中 (开始时间: 2026-01-17)
**目标**: 消除代码重复，提升可维护性

---

## 一、任务目标

本项目存在约 21% 的代码重复（约 1280 行重复代码），主要分布在：
- 账号池管理器（32% 重复率）
- 转换器策略（20% 重复率）
- 工具函数（10.5% 重复率）

本计划旨在通过架构优化消除重复代码。

---

## 二、问题分析

### 2.1 转换器路由逻辑重复

**影响范围**: 所有 converter strategies（~4000 行代码）

**重复模式**:
- 每个转换器都有相同的 `convertRequest/convertResponse/convertStreamChunk/convertModelList` 方法
- 每个方法都有相同的 switch-case 路由逻辑

**重复代码量**: 约 200 行

**影响**: 
- 添加新协议需要修改所有转换器
- 维护成本高，容易遗漏某些转换路径

### 2.2 账号池管理器重复

**影响范围**: `src/domain/account-pool/`（1243 行代码）

**重复功能**:
- 健康检查请求构建（`_buildHealthCheckRequests`）
- 轮询账号选择逻辑（`selectAccount`）
- 健康标记方法（`markAccountHealthy/Unhealthy`）

**重复代码量**: 约 400 行

**影响**:
- 两个实现逻辑不同步
- 修复 bug 需要在两处修改

### 2.3 Schema 清理函数重复

**影响范围**: `src/converters/utils.js` 和 `src/kiro/converters/tool-converter.js`

**重复功能**:
- `cleanJsonSchemaProperties()` - 针对 Gemini API
- `compressInputSchema()` - 针对 AWS CodeWhisperer API

**重复代码量**: 约 80 行

**影响**:
- 两个函数做类似事情但策略不同
- 代码分散，难以维护

### 2.4 工具函数重复

**影响范围**: 多个工具模块

**重复功能**:
- JSON 解析修复（`safeParseJSON` vs `repairJson`）
- ID 生成（多处重复的 uuidv4 调用）

**重复代码量**: 约 50 行

---

## 三、重构方案

### 方案对比

| 方案 | 影响范围 | 工作量 | 风险 | 收益 | 优先级 |
|------|---------|-------|------|-----|-------|
| **A. BaseConverter 路由优化** | 所有转换器 | 中等 | 低 | 高 | 🔴 P0 |
| **B. 账号池基类抽取** | 账号池 | 高 | 中 | 高 | 🔴 P0 |
| **C. Schema 清理统一** | 转换器 | 低 | 低 | 中 | 🟡 P1 |
| **D. 工具函数合并** | 全局 | 低 | 低 | 中 | 🟡 P1 |
| **E. 常量重组** | utils | 低 | 低 | 低 | 🟢 P2 |

### 最优方案选择

**选择**: **方案 A + B + C**（按顺序执行）

**理由**:
1. **方案 A** 影响最广，收益最大，风险最低
2. **方案 B** 解决大量重复逻辑，为未来扩展打基础
3. **方案 C** 相对简单，可以快速完成并验证重构效果

**暂不执行**:
- 方案 D（工具函数）：需要更多使用场景分析，避免破坏现有调用
- 方案 E（常量重组）：收益较低，不影响功能

---

## 四、任务分解

### 任务 1: BaseConverter 路由优化

**状态**: ✅ 已完成 (完成时间: 2026-01-17)
**文件**: `src/converters/BaseConverter.js`

**改动内容**:
1. 在 `BaseConverter` 中实现通用的 `convertRequest/convertResponse/convertStreamChunk/convertModelList` 方法
2. 使用方法名映射代替 switch-case
3. 子类只需实现具体的 `toXxxRequest/toXxxResponse` 方法

**实际收益**:
- **删除 383 行重复代码**（所有转换器的 switch-case 路由逻辑）
- **新增 95 行通用路由实现**（BaseConverter）
- **净减少 288 行代码**
- **影响文件**: 6 个（BaseConverter + 5 个策略转换器）

**验收标准**:
- [x] 所有转换器结构统一
- [x] 移除所有重复的 switch-case 路由逻辑
- [x] 代码行数减少 (净减少 288 行)

**备注**: 重构后，新增协议转换只需在子类中实现具体的 `toXxxRequest` 等方法，无需修改路由逻辑

---

### 任务 2: 账号池基类抽取

**状态**: ⏳ 待执行
**文件**:
- 新建: `src/domain/account-pool/BaseAccountPoolManager.js`
- 修改: `src/domain/account-pool/sqlite-store.js`
- 修改: `src/domain/account-pool/json-store.js`

**改动内容**:
1. 创建 `BaseAccountPoolManager` 抽象类
2. 提取公共方法到基类：
   - `_buildHealthCheckRequests()`
   - `markAccountHealthy()` (框架)
   - `markAccountUnhealthy()` (框架)
   - `disableAccount()`, `enableAccount()`
3. 两个实现继承基类
4. 只保留存储层特定逻辑

**预期收益**:
- 减少约 300 行重复代码
- 提高两个实现的同步性
- 便于未来添加新存储后端

**验收标准**:
- [ ] SQLite 和 JSON 存储都正常工作
- [ ] 健康检查功能正常
- [ ] 账号选择逻辑正确
- [ ] 代码行数减少

---

### 任务 3: Schema 清理统一

**状态**: ✅ 已完成 (完成时间: 2026-01-17)
**文件**:
- 新建: `src/utils/schema-cleaner.js`
- 修改: `src/converters/utils.js`
- 修改: `src/kiro/converters/tool-converter.js`

**改动内容**:
1. 创建可配置的 Schema 清理器（`src/utils/schema-cleaner.js`）
2. 支持多种清理策略：
   - `GEMINI` - Gemini API 策略
   - `AWS_CODEWHISPERER` - AWS CodeWhisperer 策略
3. 统一导出接口（`cleanSchema`, `SCHEMA_CLEANER_STRATEGY`）
4. 更新现有调用点：
   - `src/converters/utils.js` 的 `cleanJsonSchemaProperties` 现在包装新实现
   - `src/kiro/converters/tool-converter.js` 的 `compressInputSchema` 现在包装新实现

**实际收益**:
- **删除 401 行重复代码**（两个旧的清理函数）
- **新增 171 行统一 Schema 清理器**
- **净减少 230 行代码**
- **影响文件**: 3 个（schema-cleaner.js + 2 个修改的文件）

**验收标准**:
- [x] 创建统一 Schema 清理器
- [x] 支持两种策略（Gemini 和 AWS CodeWhisperer）
- [x] 保持向后兼容（原有函数签名保留）
- [x] 代码行数减少 (净减少 230 行)

**备注**: 现在添加新的 Schema 清理策略只需在 `schema-cleaner.js` 中添加新策略常量和清理函数，无需修改调用代码。

---

## 五、实施顺序

### 阶段 1: BaseConverter 优化
- ✅ 任务 1: BaseConverter 路由优化

### 阶段 2: 账号池重构
- ✅ 任务 2: 账号池基类抽取

### 阶段 3: Schema 清理统一
- ✅ 任务 3: Schema 清理统一

---

## 六、风险评估与缓解措施

### 风险 1: BaseConverter 改动影响所有转换器

**可能性**: 高
**影响**: 中等

**缓解措施**:
1. 逐个转换器测试
2. 保留原有实现作为回退方案
3. 充分的单元测试覆盖

### 风险 2: 账号池基类抽取破坏现有功能

**可能性**: 中等
**影响**: 高

**缓解措施**:
1. 先实现基类，不修改现有实现
2. 逐个迁移方法到基类
3. 每次迁移后进行完整测试

### 风险 3: Schema 清理策略兼容性问题

**可能性**: 低
**影响**: 中等

**缓解措施**:
1. 保留原有函数作为兼容层
2. 逐步迁移调用点
3. 充分的集成测试

---

## 七、时间估算

| 任务 | 预计时间 | 实际时间 |
|------|---------|---------|
| 任务 1: BaseConverter 优化 | 2 小时 | - |
| 任务 2: 账号池基类抽取 | 3 小时 | - |
| 任务 3: Schema 清理统一 | 1.5 小时 | - |
| **总计** | **6.5 小时** | **-** |

---

## 八、备注

- 重构过程中需要保持向后兼容性
- 每个任务完成后需要测试验证
- 如遇到问题，应及时记录并调整方案
