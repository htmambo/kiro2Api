# 修复 usage.handlers.js 导入和变量错误

**状态**: ✅ 已完成 (完成时间: 2026-01-07)

## 问题背景

用户报告 `/api/usage` 端点无法正确获取用量信息。经 Codex 分析发现 `src/ui/router/handlers/usage.handlers.js` 文件存在多个导入缺失和变量名错误。

## 问题清单

### 1. ❌ `serviceInstances` 导入错误
- **位置**: src/ui/router/handlers/usage.handlers.js:231
- **问题**: 从 `../../../kiro/adapter.js` 导入，但该模块只导出 `MODEL_MAPPING` 和 `KiroService`
- **修复**: 从 `../../../services/manager.js` 导入

### 2. ❌ `getServiceAdapter` 未导入
- **位置**: src/ui/router/handlers/usage.handlers.js:261
- **问题**: 函数被调用但未导入，会抛出 ReferenceError
- **修复**: 从 `../../../services/manager.js` 导入

### 3. ❌ `CONFIG` 变量未定义
- **位置**: src/ui/router/handlers/usage.handlers.js:257
- **问题**: 使用了未定义的 `CONFIG` 变量
- **修复**: 改用函数参数 `currentConfig`

### 4. ❌ `findDuplicateUserId` 未导入
- **位置**: src/ui/router/handlers/usage.handlers.js:337
- **问题**: 函数被调用但未导入
- **修复**: 从 `../../../utils/account-utils.js` 动态导入

### 5. ❌ `PROVIDER_POOLS_FILE` 未导入
- **位置**: src/ui/router/handlers/usage.handlers.js:359
- **问题**: 常量被引用但未导入
- **修复**: 从 `../../../ui-manager.js` 导入

### 6. ❌ `writeFileSync` 未导入
- **位置**: src/ui/router/handlers/usage.handlers.js:362
- **问题**: Node.js fs 函数未导入
- **修复**: 从 `fs` 模块导入

### 7. ❌ `readUsageCache` 和 `writeUsageCache` 未导入
- **位置**: src/ui/router/handlers/usage.handlers.js:389-399 (updateProviderUsageCache 函数)
- **问题**: 函数被调用但未导入
- **修复**: 从 `../../../ui-manager.js` 导入

## 修复步骤

### Step 1: 修复顶部导入声明 ✅
- 添加 `serviceInstances` 和 `getServiceAdapter` 从 `services/manager.js` 导入
- 添加 `writeFileSync` 从 `fs` 导入
- ~~添加 `PROVIDER_POOLS_FILE` 从 `ui-manager.js` 导入~~ (改为动态导入)

### Step 2: 修复 CONFIG 变量引用 ✅
- 将 line 257 的 `CONFIG` 改为 `currentConfig`

### Step 3: 添加 findDuplicateUserId 动态导入 ✅
- 在使用前动态导入该函数

### Step 4: 修复 updateProviderUsageCache 函数 ✅
- 在函数内部添加 `readUsageCache` 和 `writeUsageCache` 的导入

### Step 5: 修复 hasUpdates 逻辑 ✅
- 添加 `instanceResult.usage = usage;` 保存完整的 usage 对象
- 确保 `hasUpdates` 检查能正常工作

### Step 6: 使用 Codex Review 验证修复 ✅
- 确保所有语法正确
- 确保所有导入路径正确
- 确保功能正常工作

## 验收标准

- ✅ 所有函数和变量都已正确导入
- ✅ 没有 ReferenceError 或 undefined 错误
- ✅ `/api/usage` 端点能正常返回用量信息
- ✅ Codex review 通过（无阻塞性问题）
- ✅ `hasUpdates` 逻辑能正常工作，provider pools 能正确持久化

## 修复总结

成功修复了 `src/ui/router/handlers/usage.handlers.js` 中的所有导入和变量错误：

1. **导入修复**：
   - 从 `services/manager.js` 导入 `serviceInstances` 和 `getServiceAdapter`
   - 从 `fs` 导入 `writeFileSync`
   - 动态导入 `findDuplicateUserId`、`PROVIDER_POOLS_FILE` 和缓存函数

2. **变量修复**：
   - 将 `CONFIG` 改为 `currentConfig`
   - 添加 `instanceResult.usage = usage` 保存完整对象

3. **逻辑修复**：
   - 修复了 `hasUpdates` 检查逻辑，确保 provider pools 能正确持久化

经 Codex 两轮 review 确认，所有问题已解决，代码可以正常运行。

## 关联文件

- src/ui/router/handlers/usage.handlers.js
- src/services/manager.js
- src/kiro/adapter.js
- src/ui-manager.js
- src/utils/account-utils.js
