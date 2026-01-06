# 日志系统统一重构任务计划

**状态**: ✅ 已完成 (完成时间: 2026-01-06)
**创建时间**: 2026-01-06
**优先级**: P2 - 代码质量改进

## 任务目标

将系统中 `./src` 目录下所有的日志输出统一使用 `src/lib/logger.js` 处理，包括：
1. 标准 `console.*` 调用（487 处）
2. 自定义日志方法（`_log`, `logError`, `logConversation` 等）
3. 添加 `verbose` 级别支持
4. 为每个模块配置合适的 context

## 背景和问题

### 当前问题
1. **日志输出不统一**:
   - 487 处 `console.*` 调用分布在 30 个文件中
   - 多个自定义日志方法（`_log`, `logError`, `logConversation`）
   - 缺少统一的日志格式和上下文信息

2. **自定义日志方法**:
   - `src/api/error-middleware.js`: `logError(error, req, statusCode)` - 错误日志
   - `src/services/pools/sqlite.js` 和 `json.js`: `_log(level, message)` - 类内部日志
   - `src/utils/common.js`: `logConversation()` - 对话日志（含文件写入）、`_log()` - 内部日志

3. **日志级别不完整**: logger.js 缺少 `verbose` 级别

4. **难以过滤和管理**: 生产环境无法灵活控制日志输出级别

### 影响范围
- 所有 `src` 目录下的 .js 文件（32 个文件）
- 日志基础设施 `src/lib/logger.js`
- 可能影响调试和问题排查流程

## 任务分解

### 任务 1: 增强 logger.js，添加 verbose 级别 ✅

**改动内容**:
- 在 `LogLevel` 枚举中添加 `VERBOSE: 'verbose'`
- 在 `LOG_LEVEL_PRIORITY` 中添加 `verbose: -1`（最低优先级）
- 在 `LOG_LEVEL_COLORS` 中添加 verbose 的颜色（灰色 `\x1b[90m`）
- 在 `Logger` 类中添加 `verbose(message, meta)` 方法
- 在导出的 `logger` 对象中添加 `verbose` 便捷方法
- 在 `log()` 方法的 switch 中添加 VERBOSE case
- 更新 JSDoc 注释

**验收标准**:
- ✅ verbose 级别优先级为 -1（低于 debug）
- ✅ 可以通过 `logger.verbose()` 调用
- ✅ 默认情况下（level=INFO）不输出 verbose 日志
- ✅ 设置 level=VERBOSE 时可以看到所有日志
- ✅ Codex review 通过

---

### 任务 2: 重构 error-middleware.js 的 logError ✅

**文件**: `src/api/error-middleware.js`

**改动内容**:
- 在文件顶部导入: `import { createLogger } from '../lib/logger.js';`
- 创建模块级 logger: `const logger = createLogger('api:error-middleware');`
- 将 `logError` 函数中的 `console.error` 替换为 `logger.error`
- 将 `console.warn` 替换为 `logger.warn`
- 保持错误信息的结构化格式
- 替换其他 console 调用（共 6 处）

**验收标准**:
- ✅ logError 函数使用 logger.error 输出
- ✅ 错误信息包含完整的上下文（请求路径、状态码等）
- ✅ 所有 console 调用已替换
- ✅ Codex review 通过

---

### 任务 3: 重构 AccountPoolManager 类的 _log 方法 ✅

**文件**:
- `src/services/pools/json.js` (67 处 _log 调用)
- `src/services/pools/sqlite.js` (3 处 _log 调用)

**改动内容**:
- 在文件顶部导入: `import { createLogger } from '../../lib/logger.js';`
- 在构造函数中创建 logger 实例:
  ```javascript
  this.logger = createLogger('services:pools:json'); // 或 sqlite
  ```
- 将 `_log` 方法重构为直接调用 `this.logger[level](message)`:
  ```javascript
  _log(level, message) {
      const levels = { verbose: -1, debug: 0, info: 1, warn: 2, error: 3 };
      if (levels[level] >= levels[this.logLevel]) {
          this.logger[level](message);
      }
  }
  ```
- 添加 verbose 级别支持

**验收标准**:
- ✅ 构造函数中创建了 logger 实例
- ✅ 所有 _log 调用已替换或重构
- ✅ 日志级别映射正确（verbose/info/warn/error/debug）
- ✅ 保持原有的日志过滤逻辑
- ✅ 支持 verbose 级别
- ✅ Codex review 通过

---

### 任务 4: 重构 utils/common.js 的日志方法 ✅

**文件**: `src/utils/common.js`

**改动内容**:
1. **logConversation 函数**:
   - 在文件顶部导入: `import { createLogger } from '../lib/logger.js';`
   - 创建模块级 logger: `const logger = createLogger('utils:common');`
   - 保留文件写入功能（`logMode === 'file'`）
   - `logMode === 'console'` 时改用 `logger.verbose()`
   - 文件写入成功后也输出一条 `logger.verbose()` 日志
   - 替换函数内的 console 调用

2. **_log 函数**:
   - 删除 _log 函数（有 bug，使用了 undefined 的 this）

3. **其他 console 调用**:
   - 替换所有 console.log/warn/error（共 29 处）

**验收标准**:
- ✅ logConversation 保留文件写入功能
- ✅ logConversation 同时输出到 logger
- ✅ _log 函数已删除
- ✅ 所有 console 调用已替换
- ✅ Codex review 通过

---

### 任务 5: 批量替换标准 console 调用 ⏳

#### 批次 1: 核心基础设施（6 个文件）⏳
**文件列表**:
- `src/config/manager.js` (38 处) - context: `config:manager`
- `src/master.js` (43 处) - context: `master`
- `src/api/server.js` (22 处) - context: `api:server`
- `src/ui-manager.js` (22 处) - context: `ui:manager`
- `src/api/manager.js` (2 处) - context: `api:manager`
- `src/lib/error-handler.js` (1 处) - context: `lib:error-handler`

**改动内容**:
- 在文件顶部导入 logger: `import { createLogger } from './lib/logger.js'`（注意相对路径）
- 创建模块级 logger: `const logger = createLogger('context-name');`
- 替换所有 console 调用:
  - `console.log()` → `logger.info()` 或 `logger.verbose()`（根据重要性）
  - `console.debug()` → `logger.debug()`
  - `console.warn()` → `logger.warn()`
  - `console.error()` → `logger.error()`

#### 批次 2: API 层（4 个文件）⏳
**文件列表**:
- `src/api/request-handler.js` (3 处) - context: `api:request-handler`
- `src/api/rate-limiter.js` (1 处) - context: `api:rate-limiter`
- `src/services/manager.js` (3 处) - context: `services:manager`
- `src/services/oauth-handlers.js` (15 处) - context: `services:oauth`

#### 批次 3: UI 层（7 个文件）⏳
**文件列表**:
- `src/ui/events.js` (6 处) - context: `ui:events`
- `src/ui/router/handlers/upload.handlers.js` (15 处) - context: `ui:handlers:upload`
- `src/ui/router/handlers/usage.handlers.js` (6 处) - context: `ui:handlers:usage`
- `src/ui/router/handlers/config.handlers.js` (3 处) - context: `ui:handlers:config`
- `src/ui/router/handlers/system.handlers.js` (5 处) - context: `ui:handlers:system`
- `src/ui/router/handlers/oauth.handlers.js` (33 处) - context: `ui:handlers:oauth`
- `src/ui/router/middleware/auth.middleware.js` (2 处) - context: `ui:middleware:auth`

#### 批次 4: Kiro 核心模块（9 个文件）⏳
**文件列表**:
- `src/kiro/auth.js` (39 处) - context: `kiro:auth`
- `src/kiro/adapter.js` (53 处) - context: `kiro:adapter`
- `src/kiro/api-client.js` (67 处) - context: `kiro:api-client`
- `src/kiro/streaming.js` (31 处) - context: `kiro:streaming`
- `src/kiro/message-sanitizer.js` (12 处) - context: `kiro:message-sanitizer`
- `src/kiro/summarization.js` (7 处) - context: `kiro:summarization`
- `src/kiro/tools.js` (6 处) - context: `kiro:tools`
- `src/kiro/search.js` (4 处) - context: `kiro:search`
- `src/kiro/strategy.js` (1 处) - context: `kiro:strategy`

#### 批次 5: 存储层（1 个文件）⏳
**文件列表**:
- `src/services/storage/sqlite-db.js` (9 处) - context: `services:storage:sqlite-db`

**验收标准**（每批次）:
- ✅ 所有 console 调用已替换为 logger 调用
- ✅ 日志级别映射正确
- ✅ 元数据和错误对象正确传递
- ✅ 导入路径正确
- ✅ 代码语法检查通过
- ✅ Codex review 通过

---

### 任务 6: 添加环境变量支持 ✅

**改动内容**:
1. **更新 .env.example**:
   - 添加 LOG_LEVEL 环境变量配置
   - 说明各级别的用途（verbose/debug/info/warn/error）
   - 默认值为 'info'

2. **更新 src/master.js**:
   - 在应用启动时读取 LOG_LEVEL 环境变量
   - 调用 `initLogger({ level: logLevel })` 初始化全局 logger

3. **更新 src/api/server.js**:
   - 在 worker 进程启动时读取 LOG_LEVEL 环境变量
   - 调用 `initLogger({ level: logLevel })` 初始化全局 logger

**验收标准**:
- ✅ 可以通过环境变量控制日志级别
- ✅ 默认级别为 info
- ✅ Master 和 Worker 进程都支持 LOG_LEVEL
- ✅ 配置文档完善
- ✅ Codex review 通过

---

### 任务 7: 验证和清理 ✅

**改动内容**:
- 使用 `grep` 确认 `src` 目录下没有遗漏的 `console.*` 调用（logger.js 自身除外）
- 确认没有遗漏的自定义日志方法
- 运行语法检查
- 修复 Codex review 发现的问题：
  - Worker 进程也支持 LOG_LEVEL
  - Pool manager 的 _log 方法支持 verbose 级别
- 最终验证

**验收标准**:
- ✅ `src` 目录下没有遗漏的 console 调用（除 logger.js）
- ✅ 所有自定义日志方法已重构
- ✅ 所有语法检查通过
- ✅ 日志输出格式统一且包含正确的 context
- ✅ Master 和 Worker 进程都支持 LOG_LEVEL
- ✅ 所有日志级别都支持 verbose
- ✅ Codex review 通过

---

## Context 映射表

| 文件路径 | Console 调用数 | Context 名称 | 说明 |
|---------|--------------|-------------|------|
| `src/config/manager.js` | 38 | `config:manager` | 配置管理器 |
| `src/master.js` | 43 | `master` | Master 进程 |
| `src/api/server.js` | 22 | `api:server` | API 服务器 |
| `src/ui-manager.js` | 22 | `ui:manager` | UI 管理器 |
| `src/api/manager.js` | 2 | `api:manager` | API 管理器 |
| `src/lib/error-handler.js` | 1 | `lib:error-handler` | 错误处理器 |
| `src/api/request-handler.js` | 3 | `api:request-handler` | 请求处理器 |
| `src/api/error-middleware.js` | 6 | `api:error-middleware` | 错误中间件 |
| `src/api/rate-limiter.js` | 1 | `api:rate-limiter` | 速率限制器 |
| `src/utils/common.js` | 29 | `utils:common` | 通用工具 |
| `src/services/manager.js` | 3 | `services:manager` | 服务管理器 |
| `src/services/oauth-handlers.js` | 15 | `services:oauth` | OAuth 处理器 |
| `src/services/storage/sqlite-db.js` | 9 | `services:storage:sqlite-db` | SQLite 数据库 |
| `src/services/pools/json.js` | 67 | `services:pools:json` | JSON 账号池 |
| `src/services/pools/sqlite.js` | 3 | `services:pools:sqlite` | SQLite 账号池 |
| `src/ui/events.js` | 6 | `ui:events` | UI 事件 |
| `src/ui/router/handlers/upload.handlers.js` | 15 | `ui:handlers:upload` | 上传处理器 |
| `src/ui/router/handlers/usage.handlers.js` | 6 | `ui:handlers:usage` | 使用统计处理器 |
| `src/ui/router/handlers/config.handlers.js` | 3 | `ui:handlers:config` | 配置处理器 |
| `src/ui/router/handlers/system.handlers.js` | 5 | `ui:handlers:system` | 系统处理器 |
| `src/ui/router/handlers/oauth.handlers.js` | 33 | `ui:handlers:oauth` | OAuth 处理器 |
| `src/ui/router/middleware/auth.middleware.js` | 2 | `ui:middleware:auth` | 认证中间件 |
| `src/kiro/auth.js` | 39 | `kiro:auth` | Kiro 认证 |
| `src/kiro/adapter.js` | 53 | `kiro:adapter` | Kiro 适配器 |
| `src/kiro/api-client.js` | 67 | `kiro:api-client` | Kiro API 客户端 |
| `src/kiro/streaming.js` | 31 | `kiro:streaming` | Kiro 流式处理 |
| `src/kiro/message-sanitizer.js` | 12 | `kiro:message-sanitizer` | Kiro 消息清理 |
| `src/kiro/summarization.js` | 7 | `kiro:summarization` | Kiro 摘要 |
| `src/kiro/tools.js` | 6 | `kiro:tools` | Kiro 工具 |
| `src/kiro/search.js` | 4 | `kiro:search` | Kiro 搜索 |
| `src/kiro/strategy.js` | 1 | `kiro:strategy` | Kiro 策略 |
| `src/lib/logger.js` | 3 | N/A | Logger 自身（保持原样） |

**总计**: 32 个文件，约 550+ 处调用（含自定义方法）

---

## 风险评估

### 高风险
- **大规模替换**: 550+ 处调用，容易出现遗漏或错误
  - **缓解措施**: 分批执行，每批次完成后使用 codex review

- **自定义日志方法重构**: 可能影响现有逻辑
  - **缓解措施**: 仔细分析每个自定义方法的用途，保留必要功能（如文件写入）

### 中风险
- **导入路径错误**: 不同目录层级的文件需要不同的相对路径
  - **缓解措施**: 仔细检查每个文件的导入路径，使用语法检查工具

- **日志级别映射不当**: console.log 可能对应 info 或 verbose
  - **缓解措施**: 根据日志内容的重要性判断，重要信息用 info，详细调试用 verbose

- **类内部 logger 实例**: 需要在构造函数中正确初始化
  - **缓解措施**: 确保 logger 在使用前已创建，避免 undefined 错误

### 低风险
- **环境变量配置**: 需要更新配置以支持新的 verbose 级别
  - **缓解措施**: 提供清晰的文档和示例配置

---

## 实施顺序

1. ✅ 创建任务计划文档（本文档）
2. ✅ 任务 1: 增强 logger.js，添加 verbose 级别
3. ✅ 任务 2: 重构 error-middleware.js 的 logError
4. ✅ 任务 3: 重构 AccountPoolManager 类的 _log 方法
5. ✅ 任务 4: 重构 utils/common.js 的日志方法
6. ✅ 任务 5: 批量替换标准 console 调用
   - 批次 1: 核心基础设施 ✅
   - 批次 2: API 层 ✅
   - 批次 3: UI 层 ✅
   - 批次 4: Kiro 核心模块 ✅
   - 批次 5: 存储层 ✅
7. ✅ 任务 6: 添加环境变量支持
8. ✅ 任务 7: 验证和清理

---

## 预期效果

### 代码质量提升
- ✅ 统一的日志格式和输出方式
- ✅ 清晰的模块上下文标识
- ✅ 更细粒度的日志级别控制（新增 verbose）
- ✅ 消除自定义日志方法，降低维护成本

### 可维护性提升
- ✅ 便于问题排查和调试
- ✅ 生产环境可灵活控制日志输出
- ✅ 日志可以轻松集成到日志聚合系统
- ✅ 统一的 API 降低学习成本

### 开发体验提升
- ✅ 开发时可以使用 verbose 级别查看详细信息
- ✅ 生产环境可以关闭 verbose/debug 减少噪音
- ✅ 每个模块有清晰的日志上下文

---

## 备注

- 本次重构不改变日志内容，只改变输出方式
- logger.js 自身的 console 调用保持不变（避免循环依赖）
- logConversation 的文件写入功能保留，同时也输出到 logger
- 类内部的 _log 方法改为使用 this.logger，保持实例级别的日志控制
- 如果发现某些 console 调用是第三方库或特殊用途，可以保留并记录原因
