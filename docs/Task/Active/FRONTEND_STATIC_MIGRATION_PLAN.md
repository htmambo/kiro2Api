# 前端静态化迁移任务计划

**任务名称**: 前端从 Next.js 迁移到纯静态方案
**状态**: 🔄 进行中 (开始时间: 2026-01-04)
**创建时间**: 2026-01-04
**预计工作量**: 2-4 周
**优先级**: 高

---

## 📋 任务目标

将 `frontend/`（Next.js + React + TypeScript + Tailwind CSS）完全重写为类似 `static.orig/` 的纯静态方案，实现**修改即生效，无需编译**的开发体验。

### 核心目标
- ✅ 消除编译等待时间
- ✅ 保持所有现有功能
- ✅ 提升开发效率
- ✅ 降低部署复杂度

---

## 🔍 问题分析

### 当前痛点
1. **编译时间长**: 每次修改后需要等待 Next.js 编译
2. **开发体验差**: 无法实现即改即看
3. **依赖复杂**: 需要 Node.js 环境和大量依赖包
4. **部署繁琐**: 需要构建步骤

### 现状对比

| 维度 | frontend/ (当前) | static.orig/ (目标) |
|------|------------------|---------------------|
| **框架** | Next.js + React | 纯 HTML + ES6 模块 |
| **类型** | TypeScript | JavaScript |
| **样式** | Tailwind CSS | 原生 CSS + 变量 |
| **状态管理** | React hooks + Context | 模块级变量 + DOM |
| **路由** | Next.js 路由 | Hash 路由 / 多 HTML |
| **API** | fetchWithAuth (TS) | window.apiClient (JS) |
| **编译** | ✗ 需要 build | ✓ 无需编译 |
| **热重载** | ✓ 支持 | ✓ 原生支持 |

---

## 📊 任务分解

### 阶段 1: 基础架构搭建 ⏳

#### 1.1 创建静态页面骨架
- **输入**: `frontend/app/*.tsx` 页面结构
- **参考**: `static.orig/index.html`
- **输出**:
  - `frontend/static/index.html` - 首页/欢迎页
  - `frontend/static/login.html` - 登录页
  - `frontend/static/dashboard.html` - 控制台主页
- **具体改动**:
  - 将 React 组件的 JSX 结构转换为纯 HTML
  - 保留语义化标签和 class 结构
  - 移除所有 React 特定语法（如 `{}`、`className` 等）

#### 1.2 设置目录结构
- **目标结构**:
```
frontend/static/
├── index.html          # 首页
├── login.html          # 登录页
├── dashboard.html      # 控制台主页
├── app/
│   ├── auth.js         # 认证模块
│   ├── apiClient.js    # API 客户端
│   ├── app.js          # 主入口
│   ├── constants.js    # 常量配置
│   ├── utils.js        # 工具函数
│   ├── i18n.js         # 国际化
│   ├── styles.css      # 主样式
│   ├── mobile.css      # 响应式样式
│   ├── navigation.js   # 导航系统
│   ├── event-handlers.js  # 事件处理
│   ├── event-stream.js    # SSE 事件流
│   ├── modal.js           # 模态框
│   ├── config-manager.js  # 配置管理
│   ├── provider-manager.js # 号池管理
│   ├── upload-config-manager.js # 上传管理
│   └── usage-manager.js   # 用量管理
└── assets/
    └── logo.png
```

---

### 阶段 2: 认证系统迁移 ⏳

#### 2.1 登录页面
- **源文件**: `frontend/app/login/page.tsx`
- **参考**: `static.orig/login.html` + `static.orig/app/auth.js`
- **具体改动**:
  1. 创建 `frontend/static/login.html`
  2. 将 React 表单转为纯 HTML `<form>`
  3. 实现 `login()` 函数（用户名/密码验证）
  4. 实现 token 存储到 `localStorage`
  5. 实现"记住我"功能
  6. 实现错误提示（toast/inline）
  7. 添加表单验证逻辑

#### 2.2 认证客户端
- **源文件**: `frontend/lib/apiClient.ts`
- **参考**: `static.orig/app/auth.js` 的 `AuthManager` 和 `ApiClient`
- **输出**: `frontend/static/app/auth.js`
- **具体改动**:
  1. 创建 `AuthManager` 类
     - `login(username, password, remember)` - 登录
     - `logout()` - 登出
     - `getToken()` - 获取 token
     - `isAuthenticated()` - 检查登录状态
  2. 创建 `ApiClient` 类
     - 自动注入 token 到请求头
     - 401 拦截和重定向
     - 统一错误处理
  3. 暴露全局对象
     - `window.apiClient`
     - `window.initAuth()`
     - `window.login()`
     - `window.logout()`

---

### 阶段 3: API 客户端统一 ⏳

#### 3.1 重写 fetchWithAuth
- **源文件**: `frontend/lib/apiClient.ts` 的 `fetchWithAuth` 函数
- **输出**: `frontend/static/app/apiClient.js`
- **具体改动**:
  1. 封装 `fetch` 函数
  2. 自动添加 `Authorization` 头
  3. 处理 401/403 错误
  4. 统一错误处理和 toast 提示
  5. 支持 JSON/FormData/Blob 等多种请求类型
  6. 实现请求重试机制
  7. 实现请求超时处理

#### 3.2 SSE 事件流
- **参考**: `static.orig/app/event-stream.js`
- **输出**: `frontend/static/app/event-stream.js`
- **具体改动**:
  1. 实现 `/api/events` 的 `EventSource` 连接
  2. 实现事件分发机制（`CustomEvent`）
  3. 实现自动重连逻辑
  4. 实现连接状态管理
  5. 实现事件监听器注册/注销
  6. 防止内存泄漏

---

### 阶段 4: Dashboard 主页迁移 ⏳

#### 4.1 系统概览
- **源文件**: `frontend/app/dashboard/page.tsx`
- **输出**: `frontend/static/dashboard.html` + `frontend/static/app/dashboard.js`
- **具体改动**:
  1. 创建 Dashboard HTML 结构
  2. 迁移系统信息卡片
     - 运行时间
     - 版本号
     - Node.js 版本
     - 服务器时间
     - 平台信息
     - 内存使用
     - CPU 使用
  3. 实现数据自动刷新（`setInterval`）
  4. 迁移路由示例面板
  5. 实现更新检测功能

#### 4.2 导航系统
- **源文件**: `frontend/app/dashboard/layout.tsx`
- **参考**: `static.orig/app/navigation.js`
- **输出**: `frontend/static/app/navigation.js`
- **具体改动**:
  1. 实现侧边栏导航
  2. 实现 hash 路由（`#dashboard`, `#config` 等）
  3. 实现 section 切换动画
  4. 实现导航高亮状态
  5. 实现面包屑导航
  6. 实现移动端导航折叠

---

### 阶段 5: 子模块迁移 ⏳

#### 5.1 系统配置页
- **参考**: `static.orig/app/config-manager.js`
- **输出**: `frontend/static/app/config-manager.js`
- **具体改动**:
  1. 表单渲染和数据绑定
  2. 配置加载（`/api/config`）
  3. 配置保存（`/api/config`）
  4. 配置重置功能
  5. 密码显示/隐藏切换
  6. 表单验证
  7. OAuth 凭据类型切换（文件/Base64）
  8. 文件上传功能
  9. 高级配置折叠/展开

#### 5.2 号池管理页
- **参考**: `static.orig/app/provider-manager.js`
- **输出**: `frontend/static/app/provider-manager.js`
- **具体改动**:
  1. 提供商列表渲染
  2. 提供商统计信息
  3. 健康检测功能
  4. 添加提供商（模态框）
  5. 编辑提供商（模态框）
  6. 删除提供商（确认对话框）
  7. 重置健康状态
  8. 生成 OAuth 授权链接
  9. 实时状态更新（SSE）

#### 5.3 配置管理页
- **参考**: `static.orig/app/upload-config-manager.js`
- **输出**: `frontend/static/app/upload-config-manager.js`
- **具体改动**:
  1. 配置文件列表展示
  2. 文件上传功能
  3. 文件下载功能
  4. 文件删除功能
  5. 搜索和过滤
  6. 关联状态显示
  7. 批量关联 OAuth
  8. 打包下载所有配置

#### 5.4 用量查询页
- **参考**: `static.orig/app/usage-manager.js`
- **输出**: `frontend/static/app/usage-manager.js`
- **具体改动**:
  1. 用量数据展示
  2. 自动刷新功能
  3. 手动刷新按钮
  4. 最后更新时间显示
  5. 错误处理和提示
  6. 空状态提示

#### 5.5 实时日志页
- **参考**: `static.orig/app/event-handlers.js`
- **输出**: 集成到 `frontend/static/app/event-handlers.js`
- **具体改动**:
  1. SSE 日志流接收
  2. 日志实时显示
  3. 自动滚动控制
  4. 日志清空功能
  5. 日志级别过滤
  6. 日志搜索功能

---

### 阶段 6: 样式系统迁移 ⏳

#### 6.1 提取 CSS 变量
- **源文件**: `frontend/app/globals.css`
- **输出**: `frontend/static/app/styles.css`
- **具体改动**:
  1. 提取 `:root` 变量
     - 颜色变量（主色、辅助色、状态色）
     - 间距变量
     - 字体变量
     - 阴影变量
     - 圆角变量
  2. 定义 dark mode 变量
  3. 定义 light mode 变量（如需要）

#### 6.2 转换 Tailwind 类
- **方法**: 为每个组件创建对应的 CSS class
- **具体改动**:
  1. 布局类（grid, flex, container）
  2. 间距类（padding, margin）
  3. 文字类（font-size, font-weight, color）
  4. 背景类（background, gradient）
  5. 边框类（border, border-radius）
  6. 阴影类（box-shadow）
  7. 过渡类（transition）

**示例转换**:
```css
/* Tailwind: grid grid-cols-3 gap-8 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;
}

/* Tailwind: flex items-center justify-between */
.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
```

#### 6.3 响应式设计
- **参考**: `static.orig/app/mobile.css`
- **输出**: `frontend/static/app/mobile.css`
- **具体改动**:
  1. 添加 `@media` 查询
  2. 移动端布局调整
  3. 触摸交互优化
  4. 字体大小调整
  5. 导航栏适配
  6. 表格横向滚动

#### 6.4 动画效果
- **源文件**: `frontend/app/globals.css` 的动画定义
- **输出**: 集成到 `frontend/static/app/styles.css`
- **具体改动**:
  1. 转换为 `@keyframes`
  2. 实现渐变动画
  3. 实现脉冲动画
  4. 实现淡入淡出
  5. 实现滑动动画
  6. 实现旋转动画（loading）

---

### 阶段 7: 交互和事件管理 ⏳

#### 7.1 事件监听器
- **参考**: `static.orig/app/event-handlers.js`
- **输出**: `frontend/static/app/event-handlers.js`
- **具体改动**:
  1. 统一的 `initEventListeners()` 函数
  2. 按钮点击事件
  3. 表单提交事件
  4. 导航切换事件
  5. 模态框打开/关闭事件
  6. Toast 通知事件
  7. 文件上传事件
  8. 搜索和过滤事件

#### 7.2 模态框系统
- **参考**: `static.orig/app/modal.js`
- **输出**: `frontend/static/app/modal.js`
- **具体改动**:
  1. 模态框打开/关闭
  2. 模态框内容动态渲染
  3. 表单验证
  4. 确认对话框
  5. ESC 键关闭
  6. 背景点击关闭
  7. 防止背景滚动

#### 7.3 工具函数
- **参考**: `static.orig/app/utils.js`
- **输出**: `frontend/static/app/utils.js`
- **具体改动**:
  1. 时间格式化函数
  2. 数据验证函数
  3. DOM 操作辅助函数
  4. Toast 通知函数
  5. 防抖和节流函数
  6. 深拷贝函数
  7. URL 参数解析

---

### 阶段 8: 测试和验证 ⏳

#### 8.1 功能测试清单
- [ ] 登录/登出流程
- [ ] Token 过期处理
- [ ] 所有 API 调用正常
- [ ] SSE 事件接收正常
- [ ] 所有页面导航正常
- [ ] 表单提交和验证
- [ ] 文件上传功能
- [ ] 模态框交互
- [ ] 配置保存/加载
- [ ] 提供商管理（增删改查）
- [ ] 健康检测功能
- [ ] 用量查询功能
- [ ] 实时日志功能
- [ ] 搜索和过滤功能

#### 8.2 样式验证清单
- [ ] 所有页面视觉一致
- [ ] 响应式布局正常
- [ ] 动画效果流畅
- [ ] Dark mode 正常
- [ ] 移动端适配正常
- [ ] 字体和图标正常显示
- [ ] 颜色和间距符合设计

#### 8.3 浏览器兼容性测试
- [ ] Chrome/Edge (最新版)
- [ ] Firefox (最新版)
- [ ] Safari (最新版)
- [ ] 移动端 Chrome
- [ ] 移动端 Safari

#### 8.4 性能测试
- [ ] 页面加载速度
- [ ] API 响应时间
- [ ] SSE 连接稳定性
- [ ] 内存使用情况
- [ ] 无内存泄漏

---

### 阶段 9: 清理和优化 ⏳

#### 9.1 备份和重命名
- **具体改动**:
  1. 备份当前 `frontend/` 目录
     ```bash
     mv frontend frontend.backup
     ```
  2. 将新的静态版本移动到 `frontend/`
     ```bash
     mv frontend/static frontend
     ```

#### 9.2 更新配置文件
- **具体改动**:
  1. 更新 `package.json`
     ```json
     {
       "scripts": {
         "serve": "live-server frontend --port=8045",
         "watch": "chokidar \"frontend/**/*\" -c \"echo File changed\""
       },
       "devDependencies": {
         "chokidar-cli": "^3.0.0",
         "live-server": "^1.2.2"
       }
     }
     ```
  2. 移除 Next.js 相关依赖
  3. 更新 `.gitignore`

#### 9.3 更新部署脚本
- **源文件**: `frontend/deploy-frontend.sh`
- **具体改动**:
  1. 移除 `npm run build` 步骤
  2. 直接复制静态文件到部署目录
  3. 更新 nginx 配置（如需要）

#### 9.4 更新文档
- **具体改动**:
  1. 更新 README.md
  2. 添加开发指南
  3. 添加部署指南
  4. 更新 API 文档

---

## ⚠️ 风险评估和缓解措施

### 风险 1: 工作量大，时间长
- **影响**: 预计需要 2-4 周时间
- **缓解措施**:
  - 分阶段执行，每个阶段独立验证
  - 优先完成核心功能（认证、API、Dashboard）
  - 可以先使用 `static.orig` 作为临时方案

### 风险 2: 功能遗漏
- **影响**: 可能遗漏某些功能或交互细节
- **缓解措施**:
  - 详细对比两套代码
  - 建立功能清单和测试清单
  - 逐页验证功能完整性

### 风险 3: 认证逻辑错误
- **影响**: 401 处理不当可能导致无限重定向
- **缓解措施**:
  - 参考 `static.orig/app/auth.js` 的成熟实现
  - 充分测试 token 过期场景
  - 添加调试日志

### 风险 4: SSE 连接问题
- **影响**: 内存泄漏或连接不稳定
- **缓解措施**:
  - 正确管理 `EventSource` 生命周期
  - 实现自动重连机制
  - 添加连接状态监控

### 风险 5: 样式不一致
- **影响**: Tailwind 转 CSS 可能出现视觉差异
- **缓解措施**:
  - 逐页对比样式
  - 使用 CSS 变量保持一致性
  - 建立样式规范文档

### 风险 6: 状态同步问题
- **影响**: 没有 React 状态管理，手动维护 DOM 容易出错
- **缓解措施**:
  - 建立清晰的数据流
  - 使用模块级变量管理状态
  - 添加状态变更日志

---

## 📝 验收标准

### 功能验收
- ✅ 所有现有功能正常工作
- ✅ 无功能缺失或降级
- ✅ 用户体验与原版一致或更好

### 性能验收
- ✅ 页面加载时间 < 2 秒
- ✅ API 响应时间正常
- ✅ 无内存泄漏
- ✅ 无明显性能问题

### 代码质量验收
- ✅ 代码结构清晰，模块化良好
- ✅ 注释完整，易于维护
- ✅ 无明显的代码异味
- ✅ 遵循最佳实践

### 文档验收
- ✅ README 更新完整
- ✅ 开发指南清晰
- ✅ 部署指南准确
- ✅ API 文档完整

---

## 🎯 实施建议

### 建议 1: 渐进式迁移
不要一次性重写所有代码，而是：
1. 先完成认证系统和 API 客户端
2. 验证核心功能正常后再继续
3. 逐个模块迁移和验证

### 建议 2: 复用 static.orig
`static.orig` 已经是一个成熟的静态方案，可以：
1. 直接复制 `static.orig` 作为起点
2. 根据 `frontend` 的新功能进行增强
3. 保持两套代码的功能同步

### 建议 3: 建立 PoC
在全面迁移前，先做一个小范围的概念验证：
1. 只迁移登录页 + 认证系统
2. 验证技术可行性
3. 评估实际工作量
4. 调整实施计划

### 建议 4: 保留备份
在迁移过程中：
1. 保留 `frontend.backup` 作为备份
2. 使用 Git 分支管理
3. 关键节点打 tag
4. 随时可以回滚

---

## 📅 实施时间表（参考）

| 阶段 | 预计时间 | 关键里程碑 |
|------|----------|-----------|
| 阶段 1-2 | 3-5 天 | 完成认证系统 |
| 阶段 3-4 | 3-5 天 | 完成 Dashboard 主页 |
| 阶段 5 | 5-7 天 | 完成所有子模块 |
| 阶段 6 | 2-3 天 | 完成样式迁移 |
| 阶段 7 | 2-3 天 | 完成交互和事件 |
| 阶段 8 | 2-3 天 | 完成测试验证 |
| 阶段 9 | 1-2 天 | 完成清理和优化 |
| **总计** | **18-28 天** | **完整迁移** |

---

## 📌 备注

1. **优先级调整**: 如果时间紧张，可以先使用 `static.orig` 作为主前端，后续再逐步增强
2. **技术债务**: 迁移完成后，需要定期维护和优化代码
3. **文档更新**: 每完成一个阶段，及时更新文档
4. **团队协作**: 如有多人参与，需要明确分工和接口规范

---

## ✅ 任务完成标志

- [ ] 所有阶段完成
- [ ] 所有测试通过
- [ ] 文档更新完整
- [ ] 代码 review 通过
- [ ] 部署到生产环境
- [ ] 用户验收通过

---

**最后更新**: 2026-01-04
**文档版本**: v1.0
