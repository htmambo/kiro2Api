# Stage 2.5: Split OAuth Page Generation

**状态**: ✅ 已完成 (完成时间: 2026-01-08)

## 任务目标

将 OAuth 结果页面生成功能从 `ui-manager.js` 中分离到独立的视图模块，减少 `ui-manager.js` 的职责，提高代码的可维护性。

## 问题分析

### 当前状态
- `ui-manager.js` 有 582 行，职责过多
- `generateOAuthResultPage` 函数（lines 104-192）负责生成 OAuth 授权成功/失败的 HTML 页面
- 该函数被 `oauth.handlers.js` 中的 `webCallback` 函数调用
- 存在重复实现：`src/domain/oauth/views/result-page.js`（未被引用，孤立文件）

### 架构问题
1. **职责混乱**：视图生成逻辑不应该在 `ui-manager.js` 中
2. **分层错误**：`src/domain/oauth/views/result-page.js` 违反了 DDD 分层原则（domain 层不应包含 HTML 视图）
3. **代码重复**：两个地方实现了相同的功能

### 与 Codex 的分歧
- **Codex 方案**：UI 层复用 domain 层的视图（`export { generateOAuthResultPage } from '../../domain/oauth/views/result-page.js'`）
- **我的方案**：删除 domain 层的视图文件，在 UI 层创建唯一的视图实现
- **理由**：domain 层应该只包含纯业务逻辑，HTML 视图生成是 UI 层的职责

## 详细任务分解

### ✅ 子任务 1: 创建任务计划文档
- 创建 `docs/Task/Active/STAGE_2_5_SPLIT_OAUTH_PAGE_GENERATION_PLAN.md`
- 记录任务目标、问题分析、实施计划

### ✅ 子任务 2: 创建 UI 视图目录结构
- 创建 `src/ui/views/` 目录
- 创建 `.gitkeep` 文件（如果需要）

### ✅ 子任务 3: 创建 OAuth 结果页面视图模块
- 创建 `src/ui/views/oauth-result.js`
- 将 `generateOAuthResultPage` 函数从 `ui-manager.js` 复制到新模块
- 添加适当的文档注释

### ✅ 子任务 4: 更新 ui-manager.js
- 删除 `generateOAuthResultPage` 函数实现（lines 104-192）
- 添加 re-export：`export { generateOAuthResultPage } from './ui/views/oauth-result.js';`
- 保持向后兼容性

### ✅ 子任务 5: 更新 oauth.handlers.js
- 在顶层添加静态导入：`import { generateOAuthResultPage } from '../../views/oauth-result.js';`
- 保持 `KIRO_OAUTH_CONFIG` 的动态导入（避免循环依赖）
- 删除 `webCallback` 函数中的动态导入 `generateOAuthResultPage`

### ✅ 子任务 6: 删除重复的 domain 层视图文件
- 删除 `src/domain/oauth/views/result-page.js`（未被引用，违反分层原则）
- 删除空目录 `src/domain/oauth/views/`（如果为空）

### ✅ 子任务 7: 验证和测试
- 静态检查：`grep -r "generateOAuthResultPage" src/` 确认引用正确
- 启动服务测试 OAuth 回调页面（成功和失败场景）
- 确认中文编码正确显示

## 风险评估

### 高风险
1. **循环依赖回归**
   - 风险：如果导入路径错误，可能重新引入循环依赖
   - 缓解：保持 `KIRO_OAUTH_CONFIG` 的动态导入，只静态导入 `generateOAuthResultPage`

2. **路径错误导致运行时错误**
   - 风险：相对路径计算错误导致模块找不到
   - 缓解：仔细检查相对路径，从 `src/ui/router/handlers/` 到 `src/ui/views/` 是 `../../views/`

### 中风险
1. **HTML 注入/XSS**
   - 风险：`message` 和 `details` 参数直接插入 HTML，未来可能有 XSS 风险
   - 缓解：本次重构不改变行为，但标记为后续改进点

### 低风险
1. **导出形态变化**
   - 风险：默认导出 vs 命名导出可能破坏调用方
   - 缓解：保持命名导出 `export function generateOAuthResultPage(...)`

## 实施顺序

1. 创建任务计划文档 ✅
2. 创建 `src/ui/views/` 目录
3. 创建 `src/ui/views/oauth-result.js` 并实现函数
4. 更新 `src/ui-manager.js` 为 re-export
5. 更新 `src/ui/router/handlers/oauth.handlers.js` 的导入
6. 删除 `src/domain/oauth/views/result-page.js`
7. 验证和测试

## 预期效果

- `ui-manager.js` 减少约 90 行代码（从 582 行减少到 492 行）
- 视图生成逻辑独立到 `src/ui/views/oauth-result.js`
- 消除重复代码（删除 domain 层的错误实现）
- 符合 DDD 分层原则（domain 层不包含视图）
- 保持向后兼容性（通过 re-export）

## 验收标准

- [x] `src/ui/views/oauth-result.js` 文件创建成功
- [x] `generateOAuthResultPage` 函数正确实现
- [x] `ui-manager.js` 正确 re-export 该函数
- [x] `oauth.handlers.js` 正确导入该函数
- [x] `src/domain/oauth/views/result-page.js` 已删除
- [x] OAuth 回调页面（成功/失败）显示正常
- [x] 中文编码正确
- [x] 无循环依赖错误
- [x] 所有测试通过

## 实际完成情况

### 代码改动
- ✅ 创建 `src/ui/views/oauth-result.js` (107 行)
- ✅ 更新 `src/ui-manager.js` (从 582 行减少到 498 行，减少 84 行)
- ✅ 更新 `src/ui/router/handlers/oauth.handlers.js` (添加静态导入，保持动态导入配置)
- ✅ 删除 `src/domain/oauth/views/result-page.js` (重复实现)
- ✅ 文件权限修复为 644

### Codex Review 结果
- ✅ 循环依赖风险：很低，处理得当
- ✅ 导入路径：全部正确
- ✅ DDD 分层原则：符合，视图在 UI 层
- ✅ 代码质量：良好，职责边界清晰

### Git 提交
- Commit: e06f2e9
- 提交信息：`refactor(ui): split OAuth result page generation to dedicated view module`
- 改动统计：4 files changed, 230 insertions(+), 90 deletions(-)

## 备注

- 本次重构遵循"先存档，后执行"原则
- 与 codex 的方案有分歧，我选择了更符合分层原则的方案（在 UI 层创建视图，而不是复用 domain 层的视图）
- 成功避免了循环依赖问题（通过保持 KIRO_OAUTH_CONFIG 的动态导入）
- 通过 re-export 保持了向后兼容性
- 后续可以考虑对 HTML 模板进行转义处理，防止 XSS（标记为后续改进点）
- 其他非 Stage 2.5 的改动已通过 `git stash` 保存，待后续单独处理
