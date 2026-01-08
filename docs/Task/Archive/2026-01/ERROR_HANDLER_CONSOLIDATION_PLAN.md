# 错误处理模块整合任务计划

**状态**: ✅ 已完成 (完成时间: 2026-01-08)

## 任务目标

整合三个错误处理相关文件，消除重复代码，统一错误处理逻辑。

## 问题分析

### 当前状态

项目中存在三个错误处理相关文件：

1. **src/utils/error-logger.js** (62 行)
   - **职责**: 开发环境错误日志记录
   - **导出函数**: `logErrorInDev`, `logWarningInDev`
   - **使用情况**: 仅被 `src/ui/router/handlers/usage.handlers.js` 使用

2. **src/api/error-middleware.js** (304 行)
   - **职责**: 统一错误处理中间件（HTTP 请求）
   - **导出函数**: `errorMiddleware`, `createError`
   - **功能**:
     - 支持 JSON 和 SSE 两种响应格式
     - 生产环境敏感信息过滤
     - 结构化日志记录
     - 错误分类和建议
   - **使用情况**:
     - `src/api/request-handler.js` 导入使用
     - `src/utils/common.js` 动态导入使用

3. **src/services/error-handler.js** (264 行) ⚠️ **未被使用**
   - **职责**: 错误类型定义和错误处理逻辑
   - **导出函数**: `handleError`, `createErrorResponse`, `createStreamErrorResponse`, `getErrorType`, `getErrorConfig`
   - **问题**:
     - ❌ 没有任何文件导入此模块
     - ❌ 与 `src/utils/common.js` 中的函数重复（`createErrorResponse`, `handleError`）
     - ❌ 与 `src/api/error-middleware.js` 功能重复

### 重复代码分析

#### 1. `createErrorResponse` 函数重复
- **src/services/error-handler.js:187-214** (28 行)
- **src/utils/common.js:636-673** (38 行)
- **相似度**: 90%，逻辑几乎完全相同

#### 2. `handleError` 函数重复
- **src/services/error-handler.js:133-179** (47 行)
- **src/utils/common.js:517-534** (18 行)
- **相似度**: 70%，功能相似但实现不同

#### 3. 错误类型和配置重复
- **src/services/error-handler.js:13-96** - 完整的错误类型枚举和配置
- **src/api/error-middleware.js:22-87** - 部分错误建议配置
- **src/utils/common.js:642-656** - 内联的错误类型判断

#### 4. 日志记录重复
- **src/utils/error-logger.js:35-51** - 开发环境错误日志
- **src/api/error-middleware.js:165-190** - 结构化错误日志
- **功能重叠**: 都记录错误详情、堆栈、响应数据

## 整合方案

### 方案：保留 error-middleware.js，删除 error-handler.js，增强 error-logger.js

#### 理由
1. **error-middleware.js** 是当前实际使用的模块，功能最完整
2. **error-handler.js** 完全未被使用，可以安全删除
3. **error-logger.js** 功能简单但有实际用途，保留并增强

#### 具体步骤

### 任务 1: 删除未使用的 error-handler.js ✅
- ✅ 确认没有任何导入引用
- ✅ 删除 `src/services/error-handler.js` (264 行)
- ✅ 验证项目正常运行

### 任务 2: 增强 error-logger.js ✅
- ✅ 保留现有的 `logErrorInDev` 和 `logWarningInDev`
- ✅ 添加 `logError` 函数（从 error-middleware.js 提取）
- ✅ 添加 `sanitizeUrl` 函数（URL 敏感信息清理）
- ✅ 统一日志格式和结构
- **成果**: error-logger.js 从 62 行增加到 133 行

### 任务 3: 清理 utils/common.js 中的重复代码 ✅
- ✅ 保留 `createErrorResponse` 函数（被 error-middleware.js 使用）
- ✅ 标记 `handleError` 函数为 @deprecated
- ✅ 更新注释说明

### 任务 4: 更新 error-middleware.js ✅
- ✅ 导入 `logError` 从 error-logger.js
- ✅ 删除重复的 `sanitizeUrl` 和 `logError` 函数
- ✅ 减少代码重复
- **成果**: error-middleware.js 从 304 行减少到 243 行

## 预期成果

### 代码减少
- 删除 `src/services/error-handler.js` (264 行)
- 清理 `src/utils/common.js` 中的重复代码 (~50 行)
- **总计减少**: ~314 行代码

### 架构优化
- **error-middleware.js**: HTTP 错误处理中间件（主要）
- **error-logger.js**: 错误日志记录工具（辅助）
- **utils/common.js**: 错误响应格式化（工具函数）

### 职责清晰
- 错误处理逻辑集中在 error-middleware.js
- 日志记录逻辑集中在 error-logger.js
- 响应格式化保留在 common.js（向后兼容）

## 验收标准

- ✅ 删除未使用的 error-handler.js
- ✅ 所有错误处理功能正常
- ✅ 日志记录统一且完整
- ✅ 无语法错误
- ✅ 所有测试通过

## 实施总结

### 改动文件
1. **删除**: src/services/error-handler.js (264 行) - 完全未被使用
2. **增强**: src/utils/error-logger.js (62 → 133 行，+71 行)
   - 新增 `logError` 函数（结构化日志记录）
   - 新增 `sanitizeUrl` 函数（敏感信息清理）
3. **优化**: src/api/error-middleware.js (304 → 243 行，-61 行)
   - 导入 `logError` 从 error-logger.js
   - 删除重复的 `sanitizeUrl` 和 `logError` 函数
4. **标记废弃**: src/utils/common.js
   - `handleError` 函数标记为 @deprecated

### 代码减少统计
- 删除 error-handler.js: -264 行
- 优化 error-middleware.js: -61 行
- 增强 error-logger.js: +71 行
- **净减少**: 254 行代码

### 架构优化
- **error-middleware.js**: HTTP 错误处理中间件（主要）
- **error-logger.js**: 错误日志记录工具（辅助）
- **utils/common.js**: 错误响应格式化（工具函数，部分废弃）

### 职责清晰
- 错误处理逻辑集中在 error-middleware.js
- 日志记录逻辑集中在 error-logger.js
- 响应格式化保留在 common.js（向后兼容）

### 语法验证
```bash
✅ src/utils/error-logger.js - 通过
✅ src/api/error-middleware.js - 通过
✅ src/utils/common.js - 通过
```

## 风险评估

- **低风险**: error-handler.js 完全未被使用，删除无影响
- **中风险**: common.js 中的函数可能有隐藏引用
- **缓解措施**: 逐步删除，每步验证

## 实施顺序

按风险从低到高执行：任务 1 → 任务 2 → 任务 3 → 任务 4
