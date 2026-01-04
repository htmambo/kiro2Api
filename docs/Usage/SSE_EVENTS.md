# SSE 事件系统使用指南

## 快速开始

### 在新页面中添加事件监听

如果你正在创建一个新的 Dashboard 页面，需要实时接收服务器事件，请按照以下步骤操作：

#### 1. 导入必要的依赖

```typescript
import { useEffect, useRef } from 'react';
```

#### 2. 创建 EventSource 引用

```typescript
const eventSourceRef = useRef<EventSource | null>(null);
```

#### 3. 在 useEffect 中建立 SSE 连接

```typescript
useEffect(() => {
    // 建立持久的 SSE 连接
    const eventSource = new EventSource('/api/events');
    eventSourceRef.current = eventSource;

    // 监听你需要的事件
    eventSource.addEventListener('account_update', (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Account update received:', data);
            // 处理事件，例如刷新数据
            loadData();
        } catch (e) {
            console.error('Failed to parse account_update event:', e);
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

## 可用事件列表

| 事件名称 | 用途 | 何时触发 |
|---------|------|---------|
| `log` | 系统日志 | 系统操作、错误发生 |
| `config_update` | 配置更新 | 配置文件修改、重载 |
| `account_update` | 账号变更 | 账号增删改、状态变更 |
| `provider_update` | 提供商更新 | 提供商配置变更 |
| `oauth_success` | OAuth 成功 | OAuth 授权完成 |
| `oauth_error` | OAuth 失败 | OAuth 授权失败 |

详细的事件数据结构请参考 [事件架构文档](../Architecture/EVENTS.md)。

## 常见使用场景

### 场景 1: 自动刷新列表数据

当后端数据变更时，自动刷新前端列表：

```typescript
eventSource.addEventListener('account_update', (event) => {
    try {
        const data = JSON.parse(event.data);
        // 自动刷新账号列表
        loadAccounts();
    } catch (e) {
        console.error('Failed to parse event:', e);
    }
});
```

### 场景 2: 显示实时通知

当特定事件发生时，显示 Toast 通知：

```typescript
eventSource.addEventListener('oauth_success', (event) => {
    try {
        const data = JSON.parse(event.data);
        toast.success('授权成功！', `账号已添加`);
        loadAccounts();
    } catch (e) {
        console.error('Failed to parse event:', e);
    }
});

eventSource.addEventListener('oauth_error', (event) => {
    try {
        const data = JSON.parse(event.data);
        toast.error('授权失败', data.error || '未知错误');
    } catch (e) {
        console.error('Failed to parse event:', e);
    }
});
```

### 场景 3: 条件性处理事件

根据事件数据的不同字段，执行不同的操作：

```typescript
eventSource.addEventListener('config_update', (event) => {
    try {
        const data = JSON.parse(event.data);

        // 只处理特定类型的配置更新
        if (data.type === 'main_config' || data.type === 'system_prompt') {
            loadConfig();
        }
    } catch (e) {
        console.error('Failed to parse event:', e);
    }
});
```

## 最佳实践

### ✅ DO - 推荐做法

1. **使用持久连接**
   ```typescript
   useEffect(() => {
       const eventSource = new EventSource('/api/events');
       // ...
       return () => eventSource.close();
   }, []); // 空依赖数组
   ```

2. **始终添加错误处理**
   ```typescript
   try {
       const data = JSON.parse(event.data);
       // 处理数据
   } catch (e) {
       console.error('Failed to parse event:', e);
   }
   ```

3. **正确清理连接**
   ```typescript
   return () => {
       eventSource.close();
   };
   ```

4. **使用 useRef 保存连接引用**
   ```typescript
   const eventSourceRef = useRef<EventSource | null>(null);
   eventSourceRef.current = eventSource;
   ```

### ❌ DON'T - 避免的做法

1. **不要使用条件连接**
   ```typescript
   // ❌ 错误
   useEffect(() => {
       if (!showModal) return;
       const eventSource = new EventSource('/api/events');
       // ...
   }, [showModal]);
   ```

2. **不要忘记清理连接**
   ```typescript
   // ❌ 错误
   useEffect(() => {
       const eventSource = new EventSource('/api/events');
       // 缺少 return () => eventSource.close();
   }, []);
   ```

3. **不要在事件处理中执行耗时操作**
   ```typescript
   // ❌ 错误
   eventSource.addEventListener('account_update', async (event) => {
       // 避免在这里执行大量同步计算
       for (let i = 0; i < 1000000; i++) { /* ... */ }
   });
   ```

4. **不要忽略错误处理**
   ```typescript
   // ❌ 错误
   eventSource.addEventListener('account_update', (event) => {
       const data = JSON.parse(event.data); // 可能抛出异常
       // ...
   });
   ```

## 调试指南

### 1. 检查 SSE 连接状态

打开浏览器开发者工具：
1. 切换到 **Network** 标签
2. 筛选类型为 **EventStream**
3. 查找 `/api/events` 连接
4. 查看连接状态和接收到的事件

### 2. 添加调试日志

```typescript
eventSource.addEventListener('account_update', (event) => {
    console.log('Event received:', {
        type: event.type,
        data: event.data,
        timestamp: new Date().toISOString()
    });

    try {
        const data = JSON.parse(event.data);
        console.log('Parsed data:', data);
        // 处理数据...
    } catch (e) {
        console.error('Parse error:', e);
    }
});
```

### 3. 监控连接状态

```typescript
eventSource.onopen = () => {
    console.log('SSE connection opened');
};

eventSource.onerror = (err) => {
    console.error('SSE connection error:', err);
    console.log('ReadyState:', eventSource.readyState);
};
```

## 完整示例

以下是一个完整的页面组件示例：

```typescript
'use client';

import { useEffect, useState, useRef } from 'react';
import { useToast } from '@/components/ui/toast';
import { fetchWithAuth } from '@/lib/apiClient';

export default function MyPage() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const eventSourceRef = useRef<EventSource | null>(null);
    const toast = useToast();

    // 加载数据
    const loadData = async () => {
        try {
            const response = await fetchWithAuth('/api/my-data');
            if (!response.ok) throw new Error('Failed to load data');
            const result = await response.json();
            setData(result);
        } catch (error) {
            console.error('Load data failed:', error);
            toast.error('加载失败', error.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // 初始加载
        loadData();

        // 建立 SSE 连接
        const eventSource = new EventSource('/api/events');
        eventSourceRef.current = eventSource;

        // 监听数据更新事件
        eventSource.addEventListener('account_update', (event) => {
            try {
                const eventData = JSON.parse(event.data);
                console.log('Account update received:', eventData);

                // 自动刷新数据
                loadData();

                // 显示通知
                toast.success('数据已更新', `操作: ${eventData.action}`);
            } catch (e) {
                console.error('Failed to parse account_update event:', e);
            }
        });

        // 错误处理
        eventSource.onerror = (err) => {
            console.error('SSE connection error:', err);
        };

        // 清理
        return () => {
            eventSource.close();
        };
    }, []);

    if (loading) {
        return <div>Loading...</div>;
    }

    return (
        <div>
            <h1>My Page</h1>
            {/* 渲染数据 */}
        </div>
    );
}
```

## 故障排查

### 问题: 前端没有收到事件

**可能原因**:
1. SSE 连接未建立成功
2. 事件名称不匹配
3. 后端未正确广播事件

**解决方法**:
1. 检查 Network 标签中的 `/api/events` 连接状态
2. 确认事件名称大小写正确
3. 检查后端日志，确认事件已广播

### 问题: 连接频繁断开重连

**可能原因**:
1. 网络不稳定
2. 服务器重启
3. 代理/负载均衡器超时

**解决方法**:
1. 实现自定义重连逻辑
2. 增加服务器超时时间
3. 配置代理保持连接

### 问题: 内存泄漏

**可能原因**:
1. 未正确清理 EventSource 连接
2. useEffect 依赖数组配置错误

**解决方法**:
1. 确保 return 语句中调用 `eventSource.close()`
2. 使用空依赖数组 `[]`

## 参考资料

- [事件架构文档](../Architecture/EVENTS.md) - 详细的事件类型和数据结构
- [MDN - Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [EventSource API](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)

---

**文档版本**: 1.0
**最后更新**: 2026-01-04
**维护者**: Claude Code
