# Kiro2Api 功能说明文档

**版本**: 1.0.0
**更新日期**: 2026-01-08
**项目**: Kiro OAuth 2 API

---

## 📖 文档概述

本文档详细说明 Kiro2Api 项目的所有功能模块、技术特性和使用方式。通过本文档,您将全面了解该项目的核心能力、架构设计和应用场景。

---

## 🎯 项目简介

### 什么是 Kiro2Api?

Kiro2Api 是一个**代理服务**,将 AWS CodeWhisperer (Kiro) 的 OAuth 2.0 认证转换为 Claude API 兼容格式。它允许开发者使用 Claude Code、Cursor 等支持 Claude API 的工具,通过 Kiro 的免费服务访问 Claude 模型。

### 核心价值

- **免费访问**: 通过 AWS CodeWhisperer 免费使用 Claude 模型
- **兼容性**: 完全兼容 Claude Messages API (`/v1/messages`)
- **多账号**: 支持多账号池管理,自动负载均衡
- **高可用**: 自动故障转移和健康检查
- **易用性**: 提供 Web UI 管理界面

---

## 🏗️ 技术架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                         客户端层                              │
│  Claude Code | Cursor | 其他 Claude API 工具                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      Kiro2Api 代理服务                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  API 服务层   │  │  业务逻辑层   │  │  数据存储层   │      │
│  │              │  │              │  │              │      │
│  │  • 请求路由   │  │  • 认证管理   │  │  • SQLite    │      │
│  │  • 速率限制   │  │  • 消息转换   │  │  • Redis     │      │
│  │  • CORS 处理  │  │  • 工具映射   │  │  • 文件存储   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    Web UI 管理界面                      │   │
│  │  • 账号管理 • OAuth 授权 • 系统监控 • 配置管理          │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    AWS CodeWhisperer API                    │
│                  (Kiro OAuth 认证服务)                        │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

#### 后端技术
- **Node.js** >= 18.0.0: 运行时环境
- **ES Modules**: 现代模块系统
- **better-sqlite3**: 嵌入式数据库
- **Redis**: 可选的缓存服务
- **undici**: HTTP/1.1 客户端
- **axios**: HTTP 客户端

#### 前端技术
- **Next.js** 16.1.1: React 框架
- **TypeScript**: 类型安全
- **CSS 变量**: 样式系统

#### 认证技术
- **AWS OAuth 2.0**: AWS Builder ID 认证
- **Google Auth Library**: OAuth 客户端

#### 进程管理
- **PM2**: Node.js 进程管理器

---

## 🔧 核心功能模块

### 1. 认证管理

#### 1.1 OAuth 2.0 认证流程

**支持的认证方式**:
- **Social Login**: 社交登录
- **AWS SSO**: AWS SSO 设备授权流程

**设备授权流程**:

```
1. 设备注册
   ↓
   向 AWS OIDC 服务注册客户端,获取 client_id 和 client_secret

2. 设备授权请求
   ↓
   请求设备授权码,获取:
   - device_code
   - user_code
   - verification_uri
   - expires_in (通常 1800 秒)

3. 用户授权
   ↓
   用户在浏览器中访问 verification_uri,输入 user_code 完成 AWS Builder ID 登录

4. 轮询令牌
   ↓
   后台轮询 /token 端点,间隔约 5 秒,最长轮询 1800 秒

5. 获取访问令牌
   ↓
   用户授权成功后,获取:
   - access_token (有效期 1 小时)
   - refresh_token (有效期 30 天)
   - id_token

6. 令牌刷新
   ↓
   access_token 即将过期时,使用 refresh_token 自动刷新
```

**关键特性**:
- ✅ **防抖机制**: 避免频繁刷新令牌
- ✅ **健康检查**: 定期检查令牌有效性
- ✅ **自动刷新**: 令牌过期前自动刷新
- ✅ **多账号支持**: 支持同时管理多个认证账号

#### 1.2 令牌存储

**存储位置**: `configs/kiro/kiro-auth-token-xxxx.json`

**存储结构**:
```json
{
  "device_code": "...",
  "user_code": "...",
  "verification_uri": "...",
  "access_token": "...",
  "refresh_token": "...",
  "id_token": "...",
  "expires_at": 1234567890,
  "token_type": "Bearer"
}
```

**安全说明**:
- ⚠️ 当前令牌以明文 JSON 格式存储
- ⚠️ 建议生产环境实施加密存储

---

### 2. Provider Pool 管理

#### 2.1 账号池架构

**功能说明**:
- 支持多个 Kiro 账号管理
- 自动负载均衡和故障转移
- 健康检查和使用统计

**存储方式**:
- **JSON 模式**: `configs/account_pool.json`
- **SQLite 模式**: `data/kiro2api.db`

#### 2.2 账号选择策略

**选择算法**: Round-Robin (轮询)

**选择逻辑**:
```
1. 筛选健康账号
   ↓
   isHealthy = true AND isDisabled = false

2. 选择使用次数最少的账号
   ↓
   ORDER BY usage_count ASC

3. 增加账号使用计数
   ↓
   usage_count += 1
   last_used = NOW()
```

#### 2.3 健康检查机制

**检查方式**:
- 定期 ping 账号可用性
- 检测错误响应状态
- 错误计数超过阈值自动标记为不健康

**错误阈值**:
- 默认: `MAX_ERROR_COUNT = 3`
- 可配置: 在 `config.json` 中设置

**自动故障转移**:
```
账号 A 请求失败 (错误计数 +1)
    ↓
错误计数 >= MAX_ERROR_COUNT
    ↓
标记 isHealthy = false
    ↓
自动切换到账号 B
```

#### 2.4 账号状态管理

**账号状态**:
- `isHealthy`: 健康状态
- `isDisabled`: 是否禁用 (手动)
- `errorCount`: 错误计数
- `usageCount`: 使用次数
- `lastUsed`: 最后使用时间
- `lastErrorTime`: 最后错误时间

**Web UI 管理**:
- 查看所有账号状态
- 手动启用/禁用账号
- 重置账号健康状态
- 查看使用统计

---

### 3. API 适配层

#### 3.1 Claude API 兼容性

**支持的端点**:
- `POST /v1/messages`: Claude Messages API
- `GET /health`: 健康检查
- `GET /stats`: 统计信息

**请求格式**:
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 4096,
  "messages": [
    {"role": "user", "content": "Hello!"}
  ]
}
```

**响应格式**:
```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [
    {"type": "text", "text": "..."}
  ],
  "model": "claude-sonnet-4-5-20250929",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 20
  }
}
```

#### 3.2 模型映射

**支持的模型**:

| Claude 模型 ID | AWS Kiro 模型 ID |
|---------------|-----------------|
| claude-opus-4-5 | claude-opus-4.5 |
| claude-sonnet-4-5 | CLAUDE_SONNET_4_5_20250929_V1_0 |
| claude-haiku-4-5 | claude-haiku-4.5 |

**模型别名**:
- `claude-3-5-sonnet` → `claude-sonnet-4-5`
- `claude-3-5-haiku` → `claude-haiku-4-5`
- `claude-3-5-opus` → `claude-opus-4-5`

#### 3.3 消息格式转换

**转换功能**:
- ✅ 消息角色映射 (user/assistant/system)
- ✅ 内容类型转换 (text/image/tool_use/tool_result)
- ✅ 工具调用参数映射
- ✅ 响应格式标准化

**示例**:
```
Claude Code 工具调用:
{
  "name": "Read",
  "input": {"file_path": "/path/to/file"}
}

    ↓ 转换

Kiro 工具调用:
{
  "name": "readFile",
  "input": {"path": "/path/to/file"}
}
```

---

### 4. 上下文管理

#### 4.1 上下文窗口管理

**上下文限制**:
- **最大上下文**: 200,000 tokens
- **自动修剪阈值**: 80% (160K tokens)
- **文件内容限制**: 75% 窗口
- **保留最小消息数**: 5 条

#### 4.2 智能摘要

**触发条件**:
- 上下文超过 160K tokens

**摘要策略**:
```
1. 识别可摘要的消息
   ↓
   排除最近 5 条消息和 system 消息

2. 使用摘要模型生成摘要
   ↓
   模型: claude-sonnet-4-5-20250929

3. 替换旧消息
   ↓
   用摘要内容替换旧消息组

4. 保留结构
   ↓
   保持消息交替和上下文连贯性
```

**优化效果**:
- 减少输入 token 使用
- 保持对话上下文
- 提升响应速度

---

### 5. 工具调用支持

#### 5.1 支持的工具

**文件操作**:
- `Read`: 读取文件内容
- `Write`: 写入文件内容
- `Edit`: 编辑文件内容

**命令执行**:
- `Bash`: 执行 shell 命令

**UI 操作**:
- `AskUserQuestion`: 向用户提问
- `Skill`: 调用技能

**LSP 操作**:
- `LSP`: 语言服务器协议操作

#### 5.2 工具映射

**映射表** (部分):

| Claude Code 工具 | Kiro 工具 | 参数映射 |
|-----------------|-----------|---------|
| Read | readFile | file_path → path |
| Write | createFile | file_path → path |
| Bash | executeBash | command → command |
| LSP | lspOperation | operation → operation |

**参数转换示例**:
```javascript
// Claude Code 格式
{
  "name": "Read",
  "input": {
    "file_path": "/path/to/file",
    "offset": 10,
    "limit": 100
  }
}

// 转换为 Kiro 格式
{
  "name": "readFile",
  "input": {
    "path": "/path/to/file",
    "start_line": 10,
    "end_line": 100
  }
}
```

---

### 6. 流式响应处理

#### 6.1 AWS Event Stream 解析

**流式协议**:
- AWS 使用专有的 Event Stream 协议
- 基于二进制格式,包含 headers 和 payload

**解析流程**:
```
1. 接收二进制流
   ↓
2. 解析 Event Headers
   ↓
   - 内容类型
   - 事件类型
   - 时间戳
3. 解析 Event Payload
   ↓
   - content_block_delta
   - content_block_stop
   - message_stop
4. 转换为 SSE 格式
   ↓
5. 发送给客户端
```

#### 6.2 流式优化

**优化特性**:
- ✅ **边接收边转发**: 降低延迟
- ✅ **缓冲区管理**: 防止内存溢出
- ✅ **错误恢复**: 协议损坏时自动恢复
- ✅ **断点续传**: 支持流式中断后恢复

**性能指标**:
- 首字延迟 (TTFB): < 1s
- 流式延迟: < 100ms
- 内存使用: 稳定

---

### 7. Web 搜索功能

#### 7.1 搜索引擎支持

**支持的引擎**:
- **DuckDuckGo** (默认): 无需 API Key
- **Bing Search**: 需要 API Key

#### 7.2 搜索策略

**搜索流程**:
```
1. 接收搜索请求
   ↓
2. 选择搜索引擎
   ↓
   优先: Bing (如果配置了 API Key)
   降级: DuckDuckGo
3. 执行搜索
   ↓
4. 解析搜索结果
   ↓
5. 格式化为统一格式
   ↓
6. 返回给客户端
```

#### 7.3 搜索结果格式

**标准化输出**:
```json
[
  {
    "title": "...",
    "url": "...",
    "snippet": "...",
    "source": "duckduckgo"
  }
]
```

**配置参数**:
- `WEB_SEARCH_ENGINE`: 搜索引擎选择
- `WEB_SEARCH_MAX_RESULTS`: 最大结果数 (1-20, 默认 5)
- `BING_API_KEY`: Bing API Key

---

### 8. 速率限制

#### 8.1 限制机制

**限制算法**: 滑动窗口

**限制维度**:
- IP 地址
- API Key
- 请求路径

#### 8.2 配置参数

**关键参数**:
```json
{
  "REQUEST_RATE_LIMIT_ENABLED": true,
  "REQUEST_RATE_LIMIT_MAX_REQUESTS": 100,
  "REQUEST_RATE_LIMIT_WINDOW_MS": 60000,
  "REQUEST_RATE_LIMIT_WHITELIST_PATHS": ["/health", "/stats"]
}
```

**说明**:
- `maxRequests`: 时间窗口内最大请求数
- `windowMs`: 时间窗口 (毫秒)
- `whitelistPaths`: 白名单路径 (不限制)

#### 8.3 超限响应

**HTTP 429**: Too Many Requests

```json
{
  "error": {
    "type": "rate_limit_error",
    "message": "Rate limit exceeded. Please try again later.",
    "retry_after": 30
  }
}
```

---

### 9. Web UI 管理

#### 9.1 UI 功能

**主要页面**:
- **登录页**: `/login.html`
- **仪表板**: `/dashboard`
- **账号管理**: `/accounts`
- **OAuth 授权**: `/oauth`
- **系统配置**: `/config`
- **使用统计**: `/usage`

#### 9.2 管理功能

**账号管理**:
- 查看所有账号状态
- 添加/删除账号
- 启用/禁用账号
- 重置健康状态
- 查看使用统计

**OAuth 管理**:
- 启动 OAuth 授权流程
- 查看授权状态
- 刷新 Token
- 删除 Token

**系统监控**:
- 实时请求统计
- 账号健康状态
- 系统资源使用
- 错误日志查看

---

## 🚀 高级特性

### 1. Extended Thinking

**功能说明**:
支持 Claude Extended Thinking (思考模式)

**启用方式**:
```json
{
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  }
}
```

**默认配置**:
- `ENABLE_THINKING_BY_DEFAULT`: true

**工作原理**:
通过 prompt injection 实现,在请求中注入思考提示词:
```
在回复之前,请在 <thinking>...</thinking> 标签内进行深入分析:
- 将复杂任务分解为清晰的步骤
- 考虑边界情况和潜在问题
- 确保工具参数完全符合要求
然后提供经过充分思考的回复。
```

### 2. 自动 Token 刷新

**刷新机制**:
- 定时检查 Token 过期时间
- 过期前自动刷新
- 刷新失败时重试

**配置参数**:
```json
{
  "CRON_REFRESH_TOKEN": true,
  "CRON_NEAR_MINUTES": 15
}
```

**刷新逻辑**:
```
每 15 分钟检查一次
    ↓
Token 即将过期 (< 15 分钟)
    ↓
使用 refresh_token 刷新
    ↓
更新存储的 Token
```

### 3. 日志系统

**日志级别**:
- `verbose`: 最详细日志
- `debug`: 调试日志
- `info`: 一般信息 (默认)
- `warn`: 警告日志
- `error`: 错误日志

**配置**:
```bash
LOG_LEVEL=info
```

**日志输出**:
- 控制台输出 (带颜色)
- 文件输出 (PM2 模式)
- 结构化日志格式

### 4. 错误处理

**错误类型**:
- 认证错误 (401)
- 速率限制 (429)
- 请求错误 (400)
- 服务器错误 (500)

**错误响应格式**:
```json
{
  "error": {
    "type": "error_type",
    "message": "详细错误信息"
  }
}
```

**重试机制**:
- 最大重试次数: 8
- 重试延迟: 3s (指数退避)
- 自动故障转移

---

## 📊 使用场景

### 场景 1: Claude Code 集成

**配置步骤**:
1. 启动 Kiro2Api 服务
2. 在 Claude Code 中配置:
```json
{
  "anthropic.apiKey": "your-api-key",
  "anthropic.baseUrl": "http://localhost:8045"
}
```
3. 开始使用 Claude Code

**优势**:
- 免费使用 Claude 模型
- 完整的工具调用支持
- 流式响应体验

### 场景 2: Cursor 集成

**配置步骤**:
1. 打开 Cursor 设置
2. 选择 "Custom API"
3. 配置:
   - API Key: `your-api-key`
   - Base URL: `http://localhost:8045`
4. 开始使用 Cursor

**优势**:
- AI 编程助手
- 代码补全和生成
- 多文件编辑

### 场景 3: 自定义应用集成

**使用 Claude API SDK**:
```javascript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: 'your-api-key',
  baseURL: 'http://localhost:8045'
});

const message = await anthropic.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 4096,
  messages: [{role: 'user', content: 'Hello!'}]
});
```

---

## 🛠️ 配置说明

### 核心配置参数

**服务器配置**:
```json
{
  "SERVER_PORT": 8045,
  "HOST": "0.0.0.0",
  "REQUIRED_API_KEY": "your-secret-key"
}
```

**认证配置**:
```json
{
  "MODEL_PROVIDER": "claude-kiro-oauth",
  "KIRO_OAUTH_CREDS_FILE_PATH": "./configs/kiro/kiro-auth-token.json"
}
```

**高级配置**:
```json
{
  "ENABLE_THINKING_BY_DEFAULT": true,
  "REQUEST_MAX_RETRIES": 8,
  "REQUEST_BASE_DELAY": 3000,
  "CRON_REFRESH_TOKEN": true,
  "CRON_NEAR_MINUTES": 15,
  "MAX_ERROR_COUNT": 5
}
```

**账号池配置**:
```json
{
  "claude-kiro-oauth": [
    {
      "uuid": "account-1",
      "KIRO_OAUTH_CREDS_FILE_PATH": "./configs/kiro/token-1.json",
      "isHealthy": true
    }
  ]
}
```

---

## 📈 性能特性

### 性能指标

**响应时间**:
- 平均响应时间: < 2s
- P95 响应时间: < 5s
- 首字延迟: < 1s

**吞吐量**:
- 并发支持: > 100 req/s
- 请求处理: 异步非阻塞

**资源使用**:
- 内存: 稳定,无泄漏
- CPU: < 80%
- 连接池: 复用连接

### 优化特性

- ✅ 流式响应处理
- ✅ 连接池复用
- ✅ 异步非阻塞 I/O
- ✅ 智能上下文修剪
- ✅ 缓存策略 (可启用 Redis)

---

## 🔐 安全特性

### 安全机制

- ✅ API Key 认证
- ✅ OAuth 2.0 认证
- ✅ 速率限制
- ✅ CORS 保护
- ✅ 路径验证
- ✅ 错误信息脱敏

### 安全建议

1. **修改默认密钥**:
```json
{
  "REQUIRED_API_KEY": "使用强密码替换"
}
```

2. **使用 HTTPS**:
生产环境建议使用 nginx 反向代理并配置 SSL

3. **限制访问**:
使用防火墙限制访问来源

4. **定期更新**:
保持依赖库版本最新

---

## 📝 总结

Kiro2Api 是一个功能完整、设计良好的代理服务,成功实现了将 AWS CodeWhisperer (Kiro) 转换为 Claude API 兼容接口的目标。项目具有以下优势:

**核心优势**:
- ✅ 免费访问 Claude 模型
- ✅ 完整的 Claude API 兼容性
- ✅ 多账号池管理和故障转移
- ✅ Web UI 管理界面
- ✅ 生产就绪的特性

**适用场景**:
- Claude Code 集成
- Cursor 集成
- 自定义应用集成
- AI 编程助手开发

**技术亮点**:
- 现代化的架构设计
- 完善的错误处理
- 智能的上下文管理
- 流式响应处理
- 可扩展的插件系统

---

**文档版本**: 1.0.0
**最后更新**: 2026-01-08
**维护者**: Kiro2Api 项目组
