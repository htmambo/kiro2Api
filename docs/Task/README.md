# 任务索引

本文档记录所有任务的状态和归档信息。

## 活跃任务 (Active)

- ⏳ [前端静态化迁移](Active/FRONTEND_STATIC_MIGRATION_PLAN.md) - 创建于 2026-01-04
  - 将 Next.js 前端完全重写为纯静态方案
  - 消除编译等待时间，实现修改即生效
  - 预计工作量: 2-4 周
  - 优先级: 高

## 已完成任务 (Archive)

### 2026-01

- ✅ [账号池操作集中化重构](Archive/2026-01/ACCOUNT_POOL_CENTRALIZATION.md) - 完成于 2026-01-04
  - 将所有账号池操作集中到 AccountPoolManager 类
  - 重构 oauth-handlers.js，移除直接文件操作
  - 清理 ui-manager.js 中的废弃函数
  - 实现单一数据源模式，提升代码可维护性

- ✅ [broadcastEvent 系统改进](Archive/2026-01/BROADCAST_EVENT_IMPROVEMENT_PLAN.md) - 完成于 2026-01-04
  - 统一前后端事件命名 (oauth_success/oauth_error)
  - 清理重复的事件广播
  - 创建完整的事件系统文档 (Architecture/EVENTS.md)
  - 提供 SSE 事件使用指南 (Usage/SSE_EVENTS.md)

---

**更新时间**: 2026-01-04
**维护说明**: 任务完成后自动归档到 Archive/YYYY-MM/ 目录
