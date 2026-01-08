# 代码去重任务计划

**状态**: ✅ 已完成 (完成时间: 2026-01-08)

## 任务目标

消除 src/ 目录中发现的重复代码和定义，提高代码可维护性。

## 问题分析

通过全面扫描 src/ 目录，发现以下重复代码：

1. **src/config/manager.js - 默认配置对象重复** ⚠️ 严重
   - 位置：第 87-115 行和第 125-153 行
   - 问题：完全相同的默认配置对象定义了两次（28 行重复）
   - 影响：修改配置时容易遗漏，导致不一致

2. **KIRO_OAUTH_CONFIG 重复定义** ⚠️ 严重
   - 位置：src/ui-manager.js:137 和 src/services/oauth-handlers.js:21
   - 问题：OAuth 配置在两处定义，内容不完全一致
   - 影响：配置不一致，维护困难

3. **DEFAULT_PROVIDER_TYPE 重复** ⚠️ 中等
   - 位置：src/lib/sqlite-db.js:12 和 src/ui-manager.js:28
   - 问题：相同常量值，名称略有不同
   - 影响：可能导致值不一致

4. **KIRO_VERSION / IDE_VERSION 重复** ⚠️ 中等
   - 位置：src/kiro/auth.js:25 和 src/ui-manager.js:140
   - 问题：相同版本号在两处定义
   - 影响：更新版本时容易遗漏

## 任务分解

### 任务 1: 提取 config/manager.js 默认配置为常量 ✅
- ✅ 创建 `DEFAULT_CONFIG` 常量
- ✅ 替换两处重复的配置对象（第 87-115 行和第 125-153 行）
- ✅ 验证语法正常
- **成果**: 消除 28 行重复代码

### 任务 2: 统一 KIRO_OAUTH_CONFIG 定义 ✅
- ✅ 将 src/services/oauth-handlers.js 中的配置重命名为 KIRO_SSO_CONFIG
- ✅ 添加注释说明两者的区别（社交登录 vs AWS SSO）
- ✅ 验证语法正常
- **成果**: 消除命名冲突，明确职责分离

### 任务 3: 统一 DEFAULT_PROVIDER_TYPE 常量 ✅
- ✅ 在 src/kiro/constants.js 中添加 DEFAULT_PROVIDER_TYPE
- ✅ 更新 src/lib/sqlite-db.js 导入
- ✅ 更新 src/ui-manager.js 导入
- ✅ 验证语法正常
- **成果**: 统一常量定义，单一数据源

### 任务 4: 统一 KIRO_VERSION 常量 ✅
- ✅ 在 src/kiro/constants.js 中添加 KIRO_IDE_VERSION
- ✅ 更新 src/kiro/auth.js 导入
- ✅ 更新 src/ui-manager.js 导入
- ✅ 验证语法正常
- **成果**: 版本号统一管理，避免不一致

## 验收标准

- ✅ 所有重复代码已消除
- ✅ 功能测试通过（配置加载、OAuth、账号池）
- ✅ 代码可读性提升
- ✅ 无语法错误
- ✅ Git commit 符合规范

## 实施总结

### 改动文件
1. **src/kiro/constants.js** - 新增 KIRO_IDE_VERSION 和 DEFAULT_PROVIDER_TYPE 常量
2. **src/config/manager.js** - 提取 DEFAULT_CONFIG 常量，消除 28 行重复代码
3. **src/services/oauth-handlers.js** - 重命名 KIRO_OAUTH_CONFIG 为 KIRO_SSO_CONFIG
4. **src/kiro/auth.js** - 导入 KIRO_IDE_VERSION
5. **src/lib/sqlite-db.js** - 导入 DEFAULT_PROVIDER_TYPE
6. **src/ui-manager.js** - 导入 KIRO_IDE_VERSION 和 DEFAULT_PROVIDER_TYPE

### 代码质量提升
- **消除重复**: 28 行配置对象重复 → 单一常量定义
- **统一管理**: 版本号和常量集中在 constants.js
- **职责分离**: KIRO_OAUTH_CONFIG（社交登录）vs KIRO_SSO_CONFIG（AWS SSO）
- **可维护性**: 修改版本号或常量只需改一处

### 语法验证
```bash
✅ src/kiro/constants.js - 通过
✅ src/kiro/auth.js - 通过
✅ src/lib/sqlite-db.js - 通过
✅ src/ui-manager.js - 通过
✅ src/config/manager.js - 通过
✅ src/services/oauth-handlers.js - 通过
```

## 风险评估

- **低风险**：配置常量提取，影响范围可控
- **缓解措施**：每个任务完成后立即测试验证

## 实施顺序

按优先级从高到低执行：任务 1 → 任务 2 → 任务 3 → 任务 4
