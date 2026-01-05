# /v1/messages 路由代理机制分析

## 项目概述

这是一个 **Claude API 兼容的代理服务**，将 AWS CodeWhisperer/Kiro 的接口封装成 Claude Messages API 格式。

### 核心功能

1. **对外提供 Claude 兼容接口**：`POST /v1/messages`
2. **对内代理到 AWS Kiro/CodeWhisperer**
3. **支持多账号管理**（Provider Pool）
4. **自动 Token 刷新**（OAuth）
5. **支持流式和非流式响应**
6. **工具调用（Tools）支持**
7. **Thinking 模式支持**

---

## 请求流程架构

```
客户端 Claude 请求
    ↓
src/request-handler.js (鉴权、CORS、provider 选择)
    ↓
src/api-manager.js (路由匹配 /v1/messages)
    ↓
src/common.js (解析请求体、重试逻辑、流式/非流式分发)
    ↓
src/core/claude-kiro.js (格式转换、Token 刷新、发起请求)
    ↓
AWS CodeWhisperer API
    ↓
解析响应并转换为 Claude 格式
    ↓
返回给客户端
```

---

## 被代理端请求详情

### 1. 请求 URL

**代码位置**：`src/core/claude-kiro.js:19-26`, `3746-3748`

```javascript
// 基础 URL（根据 region 动态生成）
baseUrl = `https://codewhisperer.${region}.amazonaws.com/generateAssistantResponse`
amazonQUrl = `https://codewhisperer.${region}.amazonaws.com/SendMessageStreaming`

// 根据模型选择 URL
requestUrl = model.startsWith('amazonq') ? amazonQUrl : baseUrl
```

**Region 配置**：
- 默认值：`us-east-1`
- 来源：凭据文件中的 `region` 字段
- 代码位置：`src/core/claude-kiro.js:1004-1008`

### 2. 请求头（Headers）

#### 固定请求头
**代码位置**：`src/core/claude-kiro.js:870-881`

```javascript
{
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'amz-sdk-request': 'attempt=1; max=2-4',  // 随机 2-4
  'x-amzn-kiro-agent-mode': 'vibe',
  'x-amz-user-agent': 'aws-sdk-js/3.x.x KiroIDE-x.x.x-{macSha256}',
  'user-agent': 'aws-sdk-js/3.x.x ua/2.1 os/{osType}#{winVersion} lang/js md/nodejs#{nodeVersion} api/codewhispererstreaming#3.x.x m/N,E KiroIDE-x.x.x-{macSha256}'
}
```

**特点**：
- User-Agent 伪装成 KiroIDE 客户端
- 包含随机化的版本号和 MAC 地址哈希
- 重试次数随机化（2-4次）

#### 动态请求头
**代码位置**：`src/core/claude-kiro.js:3740-3744`

```javascript
{
  'Authorization': `Bearer ${accessToken}`,
  'amz-sdk-invocation-id': `${uuid}`  // 每次请求生成新的 UUID
}
```

### 3. 请求体结构

**代码位置**：`src/core/claude-kiro.js:3700`（调用 `buildCodewhispererRequest()`）

```javascript
{
  conversationState: {
    chatTriggerType: "MANUAL",
    conversationId: "uuid",           // 会话 ID
    history: [...],                   // 历史消息（可选）
    agentContinuationId: "...",       // 可选
    agentTaskType: "...",             // 可选
    currentMessage: {
      userInputMessage: {
        content: "用户消息内容",
        modelId: "映射后的AWS模型ID",
        origin: "AI_EDITOR",
        images: [...],                // 图片（可选）
        userInputMessageContext: {
          toolResults: [...],         // 工具调用结果（可选）
          tools: [...],               // 工具定义（可选）
          supplementalContexts: [...]  // 系统提示（可选）
        }
      }
    }
  },
  profileArn: "..."                   // 可选（social auth）
}
```

---

## 关键代码位置索引

### 路由与入口
- **路由匹配**：`src/api-manager.js:20-24`
- **统一入口**：`src/request-handler.js:103-165`
- **鉴权逻辑**：`src/common.js:125-131`

### 请求处理
- **非流式请求**：`src/common.js:252-277`
- **流式请求**：`src/common.js:141-212`
- **重试逻辑**：`src/common.js:354-413`

### AWS 请求发送
- **URL 构建**：`src/core/claude-kiro.js:19-26`, `1004-1013`
- **Headers 配置**：`src/core/claude-kiro.js:870-881`, `3740-3744`
- **非流式 API 调用**：`src/core/claude-kiro.js:3687-3769`
- **流式 API 调用**：`src/core/claude-kiro.js:4348+`
- **请求体构建**：`src/core/claude-kiro.js:3262-3336`

### Token 管理
- **Token 刷新**：`src/core/claude-kiro.js:1010-1013`（刷新 URL）
- **Token 检查**：调用 `refreshAccessTokenIfNeeded()`

---

## 特殊功能

### 1. Provider Pool 管理
- 支持配置多个凭据/账号
- 失败自动切换到下一个 provider
- 健康检查机制

### 2. Thinking 模式
- 支持 Claude 的 thinking 功能
- 可通过请求体或配置启用
- 代码位置：`src/core/claude-kiro.js:3693-3696`

### 3. 流式响应
- 支持 Server-Sent Events (SSE)
- 解析 AWS event stream 二进制协议
- 转换为 Claude stream chunk 格式

### 4. 工具调用（Tools）
- 支持 Claude 的 function calling
- 转换为 AWS CodeWhisperer 的工具格式
- 支持工具调用结果回传

---

## 安全与鉴权

### 对外鉴权
- 支持 `Authorization: Bearer {API_KEY}` 头
- 支持 `x-api-key: {API_KEY}` 头
- API Key 配置在 `REQUIRED_API_KEY` 环境变量

### 对内鉴权
- 使用 OAuth 2.0 Bearer Token
- 自动刷新 access token
- 支持两种认证方式：
  - Kiro OAuth (`prod.{region}.auth.desktop.kiro.dev`)
  - AWS OIDC (`oidc.{region}.amazonaws.com`)

---

## 性能优化

1. **连接池管理**：使用 HTTP/HTTPS Agent 复用连接
2. **请求重试**：支持配置重试次数和延迟
3. **Socket 错误处理**：自动重置连接池
4. **性能诊断**：记录请求构建和响应时间

---

## 风险与注意事项

1. **上游接口强耦合**：URL/headers/事件流解析都在模拟 Kiro 官方行为
2. **鉴权语义分离**：对外 API Key 与上游 OAuth token 是两套体系
3. **流式重试限制**：流式响应一旦开始，后续失败无法重试
4. **User-Agent 伪装**：伪装成 KiroIDE 客户端可能违反服务条款
