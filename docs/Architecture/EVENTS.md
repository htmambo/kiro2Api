# SSE 事件系统架构文档

## 概述

本系统使用 Server-Sent Events (SSE) 实现服务器到客户端的实时通知。后端通过 `broadcastEvent()` 函数向所有连接的客户端广播事件，前端通过 `EventSource` API 监听这些事件。

## 事件类型

### 1. `log` - 日志事件
**用途**: 实时推送系统日志到前端日志页面

**触发时机**:
- 系统启动/关闭
- 重要操作执行
- 错误发生

**数据结构**:
```typescript
{
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  timestamp: string,  // ISO 8601 格式
  source?: string     // 日志来源
}
```

**前端监听**: `frontend/app/dashboard/logs/page.tsx`

---

### 2. `config_update` - 配置更新事件
**用途**: 通知前端配置文件已更新

**触发时机**:
- 主配置文件修改 (通过 `/api/config` POST)
- 系统提示词文件修改
- 配置重载 (通过 `/api/reload-config`)

**数据结构**:
```typescript
{
  type: 'main_config' | 'system_prompt' | 'account_pool',
  filePath?: string,
  timestamp: string
}
```

**前端监听**:
- `frontend/app/dashboard/config/page.tsx` - 监听 `main_config` 和 `system_prompt`
- `frontend/app/dashboard/providers/page.tsx` - 监听 `account_pool` 相关更新

---

### 3. `account_update` - 账号更新事件
**用途**: 通知前端账号池发生变化

**触发时机**:
- 添加新账号
- 删除账号
- 启用/禁用账号
- 批量删除账号
- 清理重复账号

**数据结构**:
```typescript
{
  action: 'add' | 'delete' | 'toggle' | 'batch_delete' | 'cleanup_duplicates',
  uuid?: string,              // 单个账号操作时的 UUID
  uuids?: string[],           // 批量操作时的 UUID 列表
  accountConfig?: object,     // 添加账号时的完整配置
  isDisabled?: boolean,       // toggle 操作时的新状态
  removedCount?: number,      // 批量删除/清理时的数量
  timestamp: string
}
```

**前端监听**: `frontend/app/dashboard/providers/page.tsx`

---

### 4. `provider_update` - 提供商更新事件
**用途**: 通知前端提供商配置发生变化

**触发时机**:
- 提供商配置文件修改
- 提供商池状态变化

**数据结构**:
```typescript
{
  provider?: string,
  timestamp: string
}
```

**前端监听**: `frontend/app/dashboard/providers/page.tsx`

---

### 5. `oauth_success` - OAuth 授权成功事件
**用途**: 通知前端 OAuth 授权流程成功完成

**触发时机**:
- Kiro OAuth 授权成功
- AWS Builder ID 授权成功
- 社交登录授权成功

**数据结构**:
```typescript
{
  provider: 'claude-kiro-oauth' | 'claude-kiro-oauth-builderid' | string,
  credPath?: string,          // Token 文件保存路径
  accountNumber?: number,     // 账号编号
  timestamp: string
}
```

**前端监听**: `frontend/app/dashboard/providers/page.tsx`

---

### 6. `oauth_error` - OAuth 授权失败事件
**用途**: 通知前端 OAuth 授权流程失败

**触发时机**:
- OAuth 授权超时
- OAuth 授权被拒绝
- OAuth 授权过程中发生错误

**数据结构**:
```typescript
{
  provider: string,
  error: string,              // 错误信息
  timestamp: string
}
```

**前端监听**: `frontend/app/dashboard/providers/page.tsx`

---

## 后端实现

### broadcastEvent 函数

**位置**: `src/server.js`

**签名**:
```javascript
function broadcastEvent(eventType, data)
```

**使用示例**:
```javascript
const broadcast = await getBroadcastEvent();
if (broadcast) {
    broadcast('account_update', {
        action: 'add',
        uuid: newAccount.uuid,
        timestamp: new Date().toISOString()
    });
}
```

### 主要广播位置

1. **src/ui-manager.js**
   - 账号管理相关事件 (`account_update`)
   - 配置更新事件 (`config_update`)

2. **src/services/oauth-handlers.js**
   - OAuth 授权事件 (`oauth_success`, `oauth_error`)

3. **src/server.js**
   - 日志事件 (`log`)
   - 系统级配置更新 (`config_update`)

---

## 前端实现

### EventSource 连接模式

**推荐模式**: 持久连接

```typescript
useEffect(() => {
    // 建立持久的 SSE 连接
    const eventSource = new EventSource('/api/events');

    // 监听特定事件
    eventSource.addEventListener('account_update', (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Account update:', data);
            // 处理事件...
        } catch (e) {
            console.error('Failed to parse event:', e);
        }
    });

    // 错误处理
    eventSource.onerror = (err) => {
        console.error('SSE connection error:', err);
    };

    // 清理连接
    return () => {
        eventSource.close();
    };
}, []); // 空依赖数组，确保只创建一次连接
```

### 已实现的监听页面

| 页面 | 监听事件 | 连接模式 |
|------|---------|---------|
| `logs/page.tsx` | `log` | 持久连接 ✅ |
| `config/page.tsx` | `config_update` | 持久连接 ✅ |
| `providers/page.tsx` | `account_update`, `provider_update`, `oauth_success`, `oauth_error` | 持久连接 ✅ |

---

## 最佳实践

### 1. 使用持久连接
❌ **错误示例** - 条件连接:
```typescript
useEffect(() => {
    if (!showModal) return; // 仅在特定条件下连接
    const eventSource = new EventSource('/api/events');
    // ...
}, [showModal]); // 依赖外部状态
```

✅ **正确示例** - 持久连接:
```typescript
useEffect(() => {
    const eventSource = new EventSource('/api/events');
    // ...
    return () => eventSource.close();
}, []); // 组件挂载时连接，卸载时断开
```

### 2. 正确的错误处理
```typescript
eventSource.addEventListener('event_name', (event) => {
    try {
        const data = JSON.parse(event.data);
        // 处理数据...
    } catch (e) {
        console.error('Failed to parse event:', e);
    }
});

eventSource.onerror = (err) => {
    console.error('SSE connection error:', err);
    // 可选：实现重连逻辑
};
```

### 3. 避免重复广播
后端应避免为同一操作广播多个事件。例如：

❌ **错误**:
```javascript
broadcastEvent('config_update', { ... });
broadcastEvent('account_update', { ... }); // 同一操作，重复广播
```

✅ **正确**:
```javascript
broadcastEvent('account_update', { ... }); // 只广播最具体的事件
```

### 4. 事件命名规范
- 使用小写字母和下划线: `account_update` ✅
- 避免驼峰命名: `accountUpdate` ❌
- 事件名应清晰表达含义
- 成功/失败使用不同事件: `oauth_success` / `oauth_error` ✅

### 5. 数据结构规范
- 始终包含 `timestamp` 字段
- 使用 ISO 8601 格式: `new Date().toISOString()`
- 包含足够的上下文信息 (如 `action`, `uuid` 等)
- 避免传递敏感信息 (如密码、完整 token)

---

## 调试技巧

### 1. 查看 SSE 连接状态
在浏览器开发者工具中:
- Network 标签 → 筛选 "EventStream"
- 查看 `/api/events` 连接状态
- 查看接收到的事件数据

### 2. 后端日志
```javascript
console.log(`Broadcasting ${eventType}:`, data);
```

### 3. 前端日志
```typescript
eventSource.addEventListener('event_name', (event) => {
    console.log('Event received:', event.type, event.data);
    // ...
});
```

---

## 常见问题

### Q: 为什么前端没有收到事件？
A: 检查以下几点:
1. SSE 连接是否建立成功 (Network 标签)
2. 事件名称是否匹配 (大小写敏感)
3. 后端是否正确广播事件
4. 前端是否正确监听事件

### Q: 如何添加新的事件类型？
A:
1. 在后端调用 `broadcastEvent('new_event', data)`
2. 在前端添加 `eventSource.addEventListener('new_event', handler)`
3. 更新本文档

### Q: SSE 连接断开后会自动重连吗？
A: 浏览器会自动尝试重连，但建议实现自定义重连逻辑以提供更好的用户体验。

---

**文档版本**: 1.0
**最后更新**: 2026-01-04
**维护者**: Claude Code
