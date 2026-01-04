# 前端静态化重写任务计划

**状态**: ⏳ 待执行
**创建时间**: 2026-01-05
**优先级**: 高

## 任务目标

将现有的 Next.js + React + TypeScript + Tailwind CSS 前端项目重写为纯静态方案，实现"修改即生效，无需编译"的开发体验，同时保留现有的 UI 样式和完整功能。

## 背景分析

### 当前技术栈
- **框架**: Next.js 14 + React 18
- **语言**: TypeScript
- **样式**: Tailwind CSS + 自定义 CSS 变量
- **构建**: 需要 `npm run build` 编译
- **开发体验**: 修改后需要等待热重载或重新编译

### 项目结构
```
frontend/
├── app/
│   ├── login/page.tsx           # 登录页面
│   ├── dashboard/
│   │   ├── layout.tsx           # 仪表板布局（导航、认证守卫）
│   │   ├── page.tsx             # 仪表板首页（统计概览）
│   │   ├── providers/page.tsx   # 账号池管理
│   │   ├── usage/page.tsx       # 用量统计
│   │   ├── credentials/page.tsx # 凭据文件管理
│   │   ├── config/page.tsx      # 配置管理
│   │   └── logs/page.tsx        # 日志查看
├── components/
│   ├── ui/                      # UI 组件（Toast、Card、Badge 等）
│   └── Hyperspeed.tsx           # 登录页 WebGL 背景
├── lib/
│   └── apiClient.ts             # API 客户端（fetchWithAuth）
└── globals.css                  # 全局样式和动画
```

### 核心功能清单

#### 1. 登录页面 (login)
- 动态粒子背景（Hyperspeed - Three.js）
- 光晕交互效果
- 密码显示/隐藏切换
- 表单验证和提交
- API: `POST /api/login`
- 成功后存储 token 到 localStorage 并跳转

#### 2. 仪表板布局 (dashboard/layout)
- 认证守卫（检查 token）
- 顶部导航栏（系统状态、重启按钮、登出）
- 侧边导航菜单（7个页面）
- 全局 Toast 通知系统
- 401 未授权处理

#### 3. 仪表板首页 (dashboard)
- 系统统计卡片（总账号数、健康账号、禁用账号、总用量）
- 配额使用进度条
- 账号池状态概览
- API: `/api/system`, `/api/accounts`, `/api/usage`

#### 4. 账号池管理 (providers)
- 账号列表展示（表格）
- 账号状态筛选（全部/健康/不健康/禁用）
- 批量操作（启用/禁用/删除/健康检查）
- 单个账号操作（查看详情、刷新用量、禁用/启用、删除）
- OAuth 授权流程（BuilderId、Manual Import）
- SSE 实时更新
- API: `/api/accounts`, `/api/accounts/:uuid`, `/api/kiro/oauth/*`

#### 5. 用量统计 (usage)
- 用量数据展示（卡片式）
- 自动刷新开关
- 健康/禁用账号筛选
- 单个账号刷新
- API: `/api/usage`, `/api/usage/:uuid`

#### 6. 凭据文件管理 (credentials)
- 文件列表展示
- 搜索和筛选（全部/已使用/未使用）
- 文件操作（查看、删除、关联）
- 批量关联未使用文件
- API: `/api/upload-configs`, `/api/quick-link-provider`, `/api/quick-link-provider/bulk`

#### 7. 配置管理 (config)
- 配置表单（多个配置项）
- 保存配置
- 重载配置
- SSE 实时更新
- API: `/api/config`, `/api/reload-config`

#### 8. 日志查看 (logs)
- 日志列表展示
- 搜索和筛选
- 清空日志
- 导出 JSON
- SSE 实时追加新日志
- API: `/api/logs`

### 技术依赖分析

#### 核心依赖
- **React**: 组件化、状态管理（useState、useEffect）
- **TypeScript**: 类型安全
- **Tailwind CSS**: 样式系统
- **Three.js + postprocessing**: 登录页背景动画
- **@tabler/icons-react**: 图标库
- **EventSource**: SSE 实时通信

#### API 交互模式
- 统一的 `fetchWithAuth` 封装
- 自动注入 Authorization header
- 401 自动重定向到登录页
- 错误处理和 Toast 提示

#### 状态管理模式
- 页面级 useState（loading, data, filters, modals）
- useEffect 处理数据加载和 SSE 订阅
- localStorage 存储 token

## 技术选型

### 方案对比

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **纯 HTML + Vanilla JS** | 零依赖、完全可控、最轻量 | 代码量大、状态管理复杂 | ⭐⭐⭐⭐ |
| **Alpine.js** | 轻量、类 Vue 语法、CDN 引入 | 需要学习新语法 | ⭐⭐⭐⭐⭐ |
| **Petite Vue** | Vue 3 子集、熟悉的 API | 功能有限 | ⭐⭐⭐ |
| **Preact + HTM** | 类 React 语法、无需编译 | 仍需一定学习成本 | ⭐⭐⭐ |

### 最终选型：Alpine.js + Tailwind CDN

**理由**：
1. **零编译**: 通过 CDN 引入，修改即生效
2. **轻量级**: ~15KB gzipped
3. **声明式**: `x-data`, `x-on`, `x-show` 等指令易于理解
4. **状态管理**: 内置响应式系统，适合中等复杂度的状态
5. **与 Tailwind 完美配合**: 都是声明式、utility-first
6. **学习曲线低**: 类似 Vue，但更简单

### 技术栈清单

#### 核心框架
- **Alpine.js 3.x** (CDN)
- **Tailwind CSS 3.x** (CDN)

#### 辅助库
- **Three.js** (CDN) - 登录页背景
- **Tabler Icons** (SVG 或 Web Font CDN)
- **Chart.js** (可选，用于数据可视化)

#### 开发工具
- **Live Server** 或 **http-server** - 本地开发服务器
- **Browser Sync** (可选) - 自动刷新

## 详细实施方案

### 阶段一：基础架构搭建 (2-3天)

#### 1.1 创建静态站点目录结构
```
static-site/
├── index.html                    # 重定向到 login.html
├── login.html                    # 登录页面
├── dashboard/
│   ├── index.html               # 仪表板首页
│   ├── providers.html           # 账号池管理
│   ├── usage.html               # 用量统计
│   ├── credentials.html         # 凭据管理
│   ├── config.html              # 配置管理
│   └── logs.html                # 日志查看
├── assets/
│   ├── css/
│   │   ├── globals.css          # 全局样式（从 frontend/app/globals.css 迁移）
│   │   └── animations.css       # 动画效果
│   ├── js/
│   │   ├── auth.js              # 认证相关（token、守卫）
│   │   ├── api.js               # API 客户端（fetchWithAuth）
│   │   ├── ui.js                # UI 组件（Toast、Modal）
│   │   ├── sse.js               # SSE 事件处理
│   │   └── utils.js             # 工具函数
│   └── icons/                   # SVG 图标
└── README.md                     # 开发说明
```

**任务清单**：
- [ ] 创建目录结构
- [ ] 设置 HTML 模板（包含 Alpine.js 和 Tailwind CDN）
- [ ] 迁移 globals.css 和动画
- [ ] 准备图标资源

#### 1.2 实现核心工具库

**auth.js - 认证模块**
```javascript
// 功能：
// - getToken() / setToken() / removeToken()
// - isAuthenticated()
// - authGuard() - 页面级守卫
// - logout() - 清除 token 并跳转
```

**api.js - API 客户端**
```javascript
// 功能：
// - fetchWithAuth(url, options) - 统一 API 调用
// - 自动注入 Authorization header
// - 401 处理（触发 toast + 重定向）
// - 错误处理和响应解析
```

**ui.js - UI 组件**
```javascript
// 功能：
// - Toast 系统（success, error, warning, info）
// - Modal 管理
// - Loading 状态
// - 确认对话框
```

**sse.js - SSE 事件处理**
```javascript
// 功能：
// - createEventSource(url, handlers)
// - 自动重连
// - 事件分发
// - 清理机制
```

**任务清单**：
- [ ] 实现 auth.js
- [ ] 实现 api.js（参考 frontend/lib/apiClient.ts）
- [ ] 实现 ui.js（参考 frontend/components/ui/toast.tsx）
- [ ] 实现 sse.js
- [ ] 实现 utils.js（日期格式化、文件大小格式化等）

#### 1.3 创建通用布局模板

**dashboard-layout.html - 仪表板布局片段**
```html
<!-- 包含：-->
<!-- - 顶部导航栏 -->
<!-- - 侧边菜单 -->
<!-- - 主内容区域 -->
<!-- - Toast 容器 -->
```

**任务清单**：
- [ ] 创建布局 HTML 结构
- [ ] 实现导航高亮逻辑
- [ ] 实现响应式侧边栏
- [ ] 集成 Toast 系统

### 阶段二：登录页面实现 (1-2天)

#### 2.1 基础结构和样式
- [ ] HTML 结构（表单、背景容器）
- [ ] Tailwind 样式应用
- [ ] 光晕交互效果
- [ ] 密码显示/隐藏切换

#### 2.2 Hyperspeed 背景
- [ ] 引入 Three.js CDN
- [ ] 迁移 Hyperspeed 逻辑（frontend/components/Hyperspeed.tsx）
- [ ] 性能优化（降低粒子数量）

#### 2.3 登录逻辑
- [ ] 表单验证
- [ ] API 调用（POST /api/login）
- [ ] Token 存储
- [ ] 跳转到仪表板
- [ ] 错误处理和提示

**参考文件**: `frontend/app/login/page.tsx`

### 阶段三：仪表板首页实现 (1-2天)

#### 3.1 布局集成
- [ ] 引入 dashboard-layout
- [ ] 认证守卫
- [ ] 页面初始化

#### 3.2 统计卡片
- [ ] 4个统计卡片（总账号、健康、禁用、总用量）
- [ ] 数据加载和展示
- [ ] 加载骨架屏
- [ ] 刷新功能

#### 3.3 配额和状态
- [ ] 配额进度条
- [ ] 账号池状态概览
- [ ] 实时更新

#### 3.4 API 集成
- [ ] GET /api/system
- [ ] GET /api/accounts
- [ ] GET /api/usage
- [ ] 错误处理

**参考文件**: `frontend/app/dashboard/page.tsx`

### 阶段四：账号池管理页面 (2-3天)

#### 4.1 账号列表
- [ ] 表格结构
- [ ] 数据加载和展示
- [ ] 状态筛选（全部/健康/不健康/禁用）
- [ ] 搜索功能
- [ ] 分页（如果需要）

#### 4.2 单个账号操作
- [ ] 查看详情 Modal
- [ ] 刷新用量
- [ ] 启用/禁用
- [ ] 删除（带确认）
- [ ] 健康检查

#### 4.3 批量操作
- [ ] 全选/取消全选
- [ ] 批量启用/禁用
- [ ] 批量删除
- [ ] 批量健康检查

#### 4.4 OAuth 授权
- [ ] BuilderId OAuth Modal
- [ ] Manual Import Modal
- [ ] 轮询授权状态
- [ ] 成功/失败处理

#### 4.5 SSE 实时更新
- [ ] 监听 /api/events
- [ ] 处理 provider_update 事件
- [ ] 自动刷新列表

**参考文件**: `frontend/app/dashboard/providers/page.tsx`

### 阶段五：用量统计页面 (1-2天)

#### 5.1 用量卡片
- [ ] 账号用量卡片列表
- [ ] 用量数据展示（进度条、百分比）
- [ ] 订阅信息
- [ ] 重置时间

#### 5.2 筛选和刷新
- [ ] 健康/禁用筛选
- [ ] 自动刷新开关
- [ ] 单个账号刷新
- [ ] 全局刷新

#### 5.3 API 集成
- [ ] GET /api/usage
- [ ] GET /api/usage/:uuid?refresh=true
- [ ] 错误处理

**参考文件**: `frontend/app/dashboard/usage/page.tsx`

### 阶段六：凭据文件管理页面 (1-2天)

#### 6.1 文件列表
- [ ] 文件卡片展示
- [ ] 搜索功能
- [ ] 状态筛选（全部/已使用/未使用）
- [ ] 统计信息

#### 6.2 文件操作
- [ ] 查看文件内容 Modal
- [ ] 删除文件（带确认）
- [ ] 单个文件关联
- [ ] 批量关联未使用文件

#### 6.3 批量关联结果
- [ ] 结果汇总展示
- [ ] 失败详情
- [ ] 手动清除

#### 6.4 API 集成
- [ ] GET /api/upload-configs
- [ ] POST /api/quick-link-provider
- [ ] POST /api/quick-link-provider/bulk
- [ ] DELETE /api/upload-configs/delete/:path

**参考文件**: `frontend/app/dashboard/credentials/page.tsx`

### 阶段七：配置管理页面 (1-2天)

#### 7.1 配置表单
- [ ] 表单结构（多个配置项）
- [ ] 数据加载和回填
- [ ] 输入验证
- [ ] Checkbox、Select 等组件

#### 7.2 保存和重载
- [ ] 保存配置（POST /api/config）
- [ ] 重载配置（POST /api/reload-config）
- [ ] 成功/失败提示

#### 7.3 SSE 实时更新
- [ ] 监听 config_update 事件
- [ ] 自动刷新配置

**参考文件**: `frontend/app/dashboard/config/page.tsx`

### 阶段八：日志查看页面 (1-2天)

#### 8.1 日志列表
- [ ] 日志条目展示
- [ ] 搜索功能
- [ ] 级别筛选
- [ ] 时间排序

#### 8.2 日志操作
- [ ] 清空日志（带确认）
- [ ] 导出 JSON
- [ ] 自动滚动到底部

#### 8.3 SSE 实时追加
- [ ] 监听 log_entry 事件
- [ ] 实时追加新日志
- [ ] 性能优化（限制显示数量）

#### 8.4 API 集成
- [ ] GET /api/logs
- [ ] DELETE /api/logs

**参考文件**: `frontend/app/dashboard/logs/page.tsx`

### 阶段九：优化和测试 (2-3天)

#### 9.1 性能优化
- [ ] 减少不必要的 API 调用
- [ ] 优化 SSE 连接管理
- [ ] 图片和资源优化
- [ ] 懒加载（如果需要）

#### 9.2 响应式适配
- [ ] 移动端适配
- [ ] 平板适配
- [ ] 侧边栏折叠

#### 9.3 浏览器兼容性
- [ ] Chrome/Edge 测试
- [ ] Firefox 测试
- [ ] Safari 测试

#### 9.4 功能测试
- [ ] 登录/登出流程
- [ ] 所有页面功能
- [ ] SSE 实时更新
- [ ] 错误处理
- [ ] 边界情况

#### 9.5 用户体验优化
- [ ] 加载状态优化
- [ ] 错误提示优化
- [ ] 动画和过渡
- [ ] 无障碍访问（ARIA）

### 阶段十：部署和文档 (1天)

#### 10.1 部署配置
- [ ] 配置静态文件服务
- [ ] 设置路由规则
- [ ] CORS 配置（如果需要）

#### 10.2 文档编写
- [ ] 开发指南
- [ ] 部署指南
- [ ] API 文档链接
- [ ] 常见问题

#### 10.3 迁移指南
- [ ] 从 Next.js 迁移的步骤
- [ ] 数据迁移（如果需要）
- [ ] 回滚方案

## 风险评估和缓解措施

### 风险1：Hyperspeed 背景性能问题
**影响**: 登录页面可能卡顿
**概率**: 中
**缓解措施**:
- 降低粒子数量
- 使用 requestAnimationFrame 优化
- 提供禁用动画选项
- 移动端使用静态背景

### 风险2：SSE 连接管理复杂
**影响**: 可能出现重复连接或连接泄漏
**概率**: 中
**缓解措施**:
- 封装统一的 SSE 管理器
- 页面卸载时自动关闭连接
- 实现重连机制
- 添加连接状态监控

### 风险3：状态管理复杂度
**影响**: 代码难以维护
**概率**: 低（使用 Alpine.js）
**缓解措施**:
- 使用 Alpine.js 的响应式系统
- 模块化状态管理
- 清晰的数据流
- 充分的代码注释

### 风险4：浏览器兼容性问题
**影响**: 部分浏览器功能异常
**概率**: 低
**缓解措施**:
- 使用现代浏览器特性检测
- 提供 polyfill（如果需要）
- 充分的跨浏览器测试
- 明确支持的浏览器版本

### 风险5：图标资源加载
**影响**: 图标显示异常或加载慢
**概率**: 低
**缓解措施**:
- 使用 SVG sprite
- 或使用 Web Font CDN
- 关键图标内联
- 提供 fallback

## 验收标准

### 功能完整性
- [ ] 所有页面功能正常工作
- [ ] API 调用正确
- [ ] SSE 实时更新正常
- [ ] 错误处理完善

### 用户体验
- [ ] 样式与原版一致（90%以上相似度）
- [ ] 交互流畅，无明显卡顿
- [ ] 加载状态清晰
- [ ] 错误提示友好

### 开发体验
- [ ] 修改 HTML/CSS/JS 后刷新即可看到效果
- [ ] 无需编译步骤
- [ ] 代码结构清晰
- [ ] 易于维护和扩展

### 性能指标
- [ ] 首屏加载时间 < 2s
- [ ] 页面切换流畅
- [ ] SSE 连接稳定
- [ ] 内存占用合理

### 兼容性
- [ ] Chrome 90+ ✓
- [ ] Firefox 88+ ✓
- [ ] Safari 14+ ✓
- [ ] Edge 90+ ✓

## 时间估算

| 阶段 | 预计时间 | 依赖 |
|------|---------|------|
| 阶段一：基础架构 | 2-3天 | - |
| 阶段二：登录页面 | 1-2天 | 阶段一 |
| 阶段三：仪表板首页 | 1-2天 | 阶段一 |
| 阶段四：账号池管理 | 2-3天 | 阶段一 |
| 阶段五：用量统计 | 1-2天 | 阶段一 |
| 阶段六：凭据管理 | 1-2天 | 阶段一 |
| 阶段七：配置管理 | 1-2天 | 阶段一 |
| 阶段八：日志查看 | 1-2天 | 阶段一 |
| 阶段九：优化测试 | 2-3天 | 阶段二~八 |
| 阶段十：部署文档 | 1天 | 阶段九 |

**总计**: 12-20 天（约 2-4 周）

## 参考资源

### 官方文档
- [Alpine.js 文档](https://alpinejs.dev/)
- [Tailwind CSS 文档](https://tailwindcss.com/)
- [Three.js 文档](https://threejs.org/)
- [MDN Web Docs](https://developer.mozilla.org/)

### 代码参考
- `frontend/app/login/page.tsx` - 登录页面
- `frontend/app/dashboard/layout.tsx` - 仪表板布局
- `frontend/app/dashboard/page.tsx` - 仪表板首页
- `frontend/app/dashboard/providers/page.tsx` - 账号池管理
- `frontend/app/dashboard/usage/page.tsx` - 用量统计
- `frontend/app/dashboard/credentials/page.tsx` - 凭据管理
- `frontend/app/dashboard/config/page.tsx` - 配置管理
- `frontend/app/dashboard/logs/page.tsx` - 日志查看
- `frontend/lib/apiClient.ts` - API 客户端
- `frontend/components/ui/toast.tsx` - Toast 组件
- `frontend/components/Hyperspeed.tsx` - 背景动画
- `frontend/app/globals.css` - 全局样式

## 下一步行动

1. **评审计划**: 与团队讨论技术选型和实施方案
2. **环境准备**: 安装必要的开发工具
3. **原型验证**: 创建一个简单的页面验证技术可行性
4. **开始实施**: 按照阶段一开始执行

## 备注

- 本计划基于当前项目的分析，实际实施中可能需要调整
- 建议采用增量迁移策略，先完成核心功能，再逐步完善
- 保留原 Next.js 版本作为参考和回滚方案
- 定期与 codex 协作 review 代码质量
