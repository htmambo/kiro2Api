# 前端 Vue/Vite 迁移计划

**状态**: ✅ 已完成 (完成时间: 2026-01-15)

## 项目背景

将现有 Next.js 14 + React 18 前端迁移到 Vue 3 + Vite 技术栈。

### 当前技术栈
- Next.js 14.2.0 (App Router, 静态导出)
- React 18.3.0 + TypeScript 5
- Tailwind CSS 3.4.0
- 自定义 UI 组件（~10 个）
- Three.js 3D 特效
- @tanstack/react-virtual 虚拟滚动

### 目标技术栈
- Vue 3.4+ (Composition API)
- Vite 5.x
- Vue Router 4.x
- Pinia (状态管理)
- TypeScript 5
- Tailwind CSS 3.4.0 (保持不变)

## 迁移阶段

### 阶段 1: 工程搭建 ✅
- [x] 1.1 创建 Vue + Vite + TypeScript 项目
- [x] 1.2 配置 Tailwind CSS (v4)
- [x] 1.3 配置 Vue Router
- [x] 1.4 配置 Pinia 状态管理
- [x] 1.5 配置开发代理（API 转发到 8045）
- [x] 1.6 配置路径别名 (@/)
- [x] 1.7 迁移全局样式 (globals.css)

### 阶段 2: 基础设施 ✅
- [x] 2.1 API 客户端封装 (fetchWithAuth)
- [x] 2.2 认证状态管理 (Pinia auth store)
- [x] 2.3 路由守卫 (登录验证)
- [ ] 2.4 工具函数迁移 (utils.ts)

### 阶段 3: UI 组件库 ✅
- [x] 3.1 Badge 组件
- [x] 3.2 Button 组件 (gradient-button, shiny-button)
- [x] 3.3 Card 组件 (card-spotlight)
- [x] 3.4 Toast 组件 (useToast composable + ToastContainer)
- [x] 3.5 Skeleton 组件
- [x] 3.6 LoadingSpinner 组件
- [x] 3.7 ColourfulText 组件
- [x] 3.8 InputField 组件 (新增)
- [x] 3.9 SelectField 组件 (新增)

### 阶段 4: 布局组件 ✅
- [x] 4.1 根布局 (App.vue)
- [x] 4.2 Dashboard 布局 (侧边栏 + 顶栏)

### 阶段 5: 页面迁移 ✅
- [x] 5.1 登录页 (/login)
- [x] 5.2 Dashboard 首页 (/dashboard)
- [x] 5.3 配置管理页 (/dashboard/config) - 9个配置区块，SSE实时更新
- [x] 5.4 号池管理页 (/dashboard/providers) - 批量检查，AWS/Social认证，SSE更新
- [x] 5.5 凭据文件页 (/dashboard/credentials) - 批量关联，文件查看/删除
- [x] 5.6 用量统计页 (/dashboard/usage) - 自动刷新，池筛选，用量详情
- [x] 5.7 运行日志页 (/dashboard/logs) - SSE实时日志流，搜索/过滤，自动滚动

### 阶段 6: 高级特性 ⏳
- [ ] 6.1 虚拟滚动 (@tanstack/vue-virtual)
- [ ] 6.2 Three.js 3D 特效 (Hyperspeed)

### 阶段 7: 收尾工作 ⏳
- [ ] 7.1 部署脚本更新
- [ ] 7.2 功能回归测试
- [ ] 7.3 性能优化
- [ ] 7.4 文档更新

## 目录结构规划

```
frontend-vue/
├── src/
│   ├── assets/              # 静态资源
│   ├── components/          # 可复用组件
│   │   └── ui/              # UI 基础组件
│   ├── composables/         # 组合式函数 (类似 React Hooks)
│   ├── layouts/             # 布局组件
│   ├── lib/                 # 工具函数
│   ├── router/              # 路由配置
│   ├── stores/              # Pinia 状态管理
│   ├── views/               # 页面组件
│   │   ├── login/
│   │   └── dashboard/
│   ├── App.vue              # 根组件
│   ├── main.ts              # 入口文件
│   └── style.css            # 全局样式
├── public/                  # 公共资源
├── index.html               # HTML 模板
├── vite.config.ts           # Vite 配置
├── tailwind.config.ts       # Tailwind 配置
├── tsconfig.json            # TypeScript 配置
└── package.json
```

## 验收标准

1. ✅ 所有页面功能与原版一致
2. ✅ 认证流程正常工作
3. ✅ API 调用正常
4. ✅ 样式与原版保持一致
5. ⏳ 3D 特效正常渲染 (待后续实现)
6. ⏳ 虚拟滚动性能正常 (待后续实现)
7. ⏳ 静态构建输出正常 (待测试)

## 完成总结

### 已完成功能

**核心页面 (7/7)**:
- ✅ 登录页 - 完整认证流程，表单验证
- ✅ Dashboard 首页 - 统计卡片，快捷操作
- ✅ 配置管理页 - 9个配置区块，SSE实时更新，表单验证
- ✅ 号池管理页 - 批量健康检查，AWS/Social认证流程，账号管理，SSE更新
- ✅ 凭据文件页 - 文件列表，批量关联，查看/删除操作
- ✅ 用量统计页 - 配额概览，自动刷新，池筛选，详细用量展示
- ✅ 运行日志页 - SSE实时日志流，搜索/过滤，导出/清空，自动滚动

**UI 组件 (9/9)**:
- ✅ CardSpotlight - 卡片容器组件
- ✅ ToastContainer + useToast - 全局通知系统
- ✅ InputField - 表单输入组件 (text/textarea/checkbox/number)
- ✅ SelectField - 下拉选择组件
- ✅ Badge - 标签组件
- ✅ Button - 按钮组件
- ✅ Skeleton - 骨架屏组件
- ✅ LoadingSpinner - 加载动画
- ✅ ColourfulText - 彩色文字组件

**基础设施**:
- ✅ Vue Router 4 配置 (history mode)
- ✅ Pinia 状态管理 (auth store)
- ✅ fetchWithAuth API 客户端
- ✅ 路由守卫 (登录验证)
- ✅ Tailwind CSS v4 配置
- ✅ TypeScript 类型检查通过
- ✅ Vite 开发服务器配置 (API 代理到 8045)

**关键特性**:
- ✅ SSE (Server-Sent Events) 实时更新
  - 配置变更实时推送
  - 号池状态实时更新
  - 日志实时流式传输
- ✅ 批量操作
  - 批量健康检查 (normal/check pool)
  - 批量关联凭据文件
  - 批量删除账号
- ✅ 认证流程
  - AWS Builder ID Device Flow
  - Social Auth (Google/GitHub) 轮询
  - RefreshToken 手动导入
- ✅ 数据过滤与搜索
  - 日志搜索与级别过滤
  - 凭据文件搜索与状态过滤
  - 账号池筛选 (all/healthy/check/banned)
- ✅ 自动刷新机制
  - 用量统计 10 秒自动刷新
  - 可手动开关

### 代码质量

- ✅ TypeScript 类型安全 (无编译错误)
- ✅ Vue 3 Composition API 最佳实践
- ✅ 响应式设计 (移动端适配)
- ✅ 错误处理 (统一 toast 提示)
- ✅ 加载状态管理 (skeleton/spinner)
- ✅ 代码复用 (composables + 组件化)

### 待后续实现

- ⏳ Three.js 3D 特效 (Hyperspeed)
- ⏳ 虚拟滚动 (@tanstack/vue-virtual)
- ⏳ 生产构建与部署脚本
- ⏳ 性能优化与压测

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 组件行为不一致 | 逐组件对照测试 |
| Three.js 生命周期问题 | 使用 onMounted/onUnmounted 管理 |
| 虚拟滚动性能 | 使用 @tanstack/vue-virtual |
| 路由守卫遗漏 | 统一在 router/index.ts 配置 |

## 相关文件

- 原前端目录: `frontend/`
- 新前端目录: `frontend-vue/`
