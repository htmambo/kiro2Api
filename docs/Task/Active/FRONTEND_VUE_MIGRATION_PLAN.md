# 前端 Vue/Vite 迁移计划

**状态**: 🔄 进行中 (开始时间: 2026-01-15)

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

### 阶段 3: UI 组件库 ⏳
- [ ] 3.1 Badge 组件
- [ ] 3.2 Button 组件 (gradient-button, shiny-button)
- [ ] 3.3 Card 组件 (card-spotlight)
- [ ] 3.4 Toast 组件
- [ ] 3.5 Skeleton 组件
- [ ] 3.6 LoadingSpinner 组件
- [ ] 3.7 ColourfulText 组件

### 阶段 4: 布局组件 ✅
- [x] 4.1 根布局 (App.vue)
- [x] 4.2 Dashboard 布局 (侧边栏 + 顶栏)

### 阶段 5: 页面迁移 🔄
- [x] 5.1 登录页 (/login)
- [x] 5.2 Dashboard 首页 (/dashboard)
- [x] 5.3 配置管理页 (/dashboard/config)
- [ ] 5.4 号池管理页 (/dashboard/providers)
- [ ] 5.5 凭据文件页 (/dashboard/credentials)
- [ ] 5.6 用量统计页 (/dashboard/usage)
- [ ] 5.7 运行日志页 (/dashboard/logs)

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

1. 所有页面功能与原版一致
2. 认证流程正常工作
3. API 调用正常
4. 样式与原版保持一致
5. 3D 特效正常渲染
6. 虚拟滚动性能正常
7. 静态构建输出正常

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
