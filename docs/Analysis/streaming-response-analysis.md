# 流式响应机制分析（AWS Event Stream → Claude SSE）

本文档基于代码静态分析，聚焦流式响应机制：`streamApiReal()` 如何解析 AWS Event Stream（二进制协议）并转成 Claude/Anthropic SSE 事件序列。

> 重要说明：这里的"Claude SSE 格式"指本项目对外暴露 `/v1/messages` 流式输出时，采用 `text/event-stream`，并使用 `event: <chunk.type>` + `data: <json>` 的封装方式（见 `src/common.js:141-210`）。

---

## 1. 流式响应端到端链路

流式链路是三段式转换：

### 1.1 上游网络流（AWS CodeWhisperer/Kiro）

- `axios.post(..., responseType: 'stream')` 得到 Node Readable stream
- 代码位置：`src/core/claude-kiro.js:4414-4419`

### 1.2 AWS Event Stream（二进制协议）解析 → 统一"内部事件"

- `parseAwsEventStreamMessage()`：从二进制 buffer 中解出单个 event-stream message（含 `:event-type` 与 JSON payload）
  - 代码位置：`src/core/claude-kiro.js:3994`
- `parseAwsEventStreamBuffer()`：循环解析 buffer，返回 `{events, remaining}`，剩余不完整包留到下一次拼接
  - 代码位置：`src/core/claude-kiro.js:4057-4171`
- `streamApiReal()` 把 `parseAwsEventStreamBuffer` 解析出的事件进一步规范化后 `yield`
  - 代码位置：`src/core/claude-kiro.js:4348-4607`

### 1.3 内部事件 → Claude/Anthropic streaming chunks → SSE 包装输出

- `generateContentStream()` 把 `streamApiReal()` 的事件流转换为 Claude/Anthropic 风格 chunk 序列并 `yield`
  - 代码位置：`src/core/claude-kiro.js:4620-5197`
- `handleStreamRequest()` 把每个 chunk 写成 SSE：`event: ${chunk.type}` + `data: ${JSON.stringify(chunk)}`
  - 代码位置：`src/common.js:141-210`

---

## 2. AWS Event Stream 二进制协议解析

### 2.1 parseAwsEventStreamMessage(buffer, offset)

解析 AWS Event Stream message 的二进制格式：

**Prelude（12 bytes）**
- `totalLength`：4 bytes（UInt32BE）
- `headersLength`：4 bytes（UInt32BE）
- `preludeCrc`：4 bytes（UInt32BE，代码读了但不校验）

**Headers（headersLength bytes）**
每个 header：
- 1 byte：headerNameLength
- N bytes：headerName
- 1 byte：headerValueType（代码只处理 type=7 string）
- 2 bytes：headerValueLength（UInt16BE）
- M bytes：headerValue

**Payload**
- 从 `(offset + 12 + headersLength)` 到 `(offset + totalLength - 4)`
- 末尾 4 bytes 是 message CRC（不校验）

**返回结构**
```javascript
{
  eventType: headers[':event-type'] || 'unknown',
  contentType: headers[':content-type'] || 'application/json',
  messageType: headers[':message-type'] || 'event',
  payload: '<utf8 json string>',
  nextOffset: offset + totalLength
}
```

代码位置：
- 入口与结构说明：`src/core/claude-kiro.js:3986-3993`
- 实现起点：`src/core/claude-kiro.js:3994`

> 注：CRC 未做校验；解析依赖长度字段保证边界。

### 2.2 parseAwsEventStreamBuffer(buffer)

负责"增量解析"：
- 用 `offset` 逐条调用 `parseAwsEventStreamMessage(buffer, offset)`
- 如果某次返回 null（缓冲区不足一个完整 message）：
  - 立即返回 `{ events, remaining: buffer.slice(offset) }`（保留尾部未完成片段）
- 对每条 message：`JSON.parse(message.payload)`，再按 `message.eventType` 转成内部事件

代码位置：`src/core/claude-kiro.js:4057-4171`

---

## 3. AWS :event-type → 内部事件映射

在 `parseAwsEventStreamBuffer` 中，`message.eventType` 的映射关系：

| AWS `:event-type` | 解析条件 | 内部事件 `type` | 内部事件 `data` 结构 | 代码位置 |
|---|---|---|---|---|
| `assistantResponseEvent` | `parsed.content !== undefined` | `content` | `{ data: parsed.content }` | `src/core/claude-kiro.js:4081-4088` |
| `toolUseEvent` | 始终处理 | `toolUse` | `{ name, toolUseId, input: parsed.input\|\|'', stop: parsed.stop\|\|false }` | `src/core/claude-kiro.js:4089-4106` |
| `meteringEvent` | `parsed.usage !== undefined` | `metering` | `{ usage, unit }` | `src/core/claude-kiro.js:4107-4117` |
| `reasoningContentEvent` | `parsed.text \|\| parsed.reasoningText` | `thinking` | `{ thinking: <text> }` | `src/core/claude-kiro.js:4118-4127` |
| `followupPromptEvent` | `parsed.followupPrompt !== undefined` | `followup` | `parsed.followupPrompt`（直接作为 data） | `src/core/claude-kiro.js:4128-4135` |
| `codeReferenceEvent` | `parsed.references[]` 且过滤后非空 | `codeReference` | `{ references: validReferences }` | `src/core/claude-kiro.js:4136-4152` |
| `messageMetadataEvent` | `parsed.conversationId` | `metadata` | `{ conversationId }` | `src/core/claude-kiro.js:4153-4161` |

**异常处理**
- JSON parse 失败会 `console.warn` 并跳过该 message（不会中断解析循环）
- `src/core/claude-kiro.js:4162-4164`

---

## 4. streamApiReal()：网络流 → 内部事件流

### 4.1 网络请求与 buffer 拼接

`streamApiReal(method, model, body, isRetry=false, retryCount=0)` 关键行为：

1. 生成 requestData：`buildCodewhispererRequest(body.messages, model, body.tools, body.system, enableThinking)`
   - `src/core/claude-kiro.js:4361-4364`

2. 发起上游请求：
   ```javascript
   axiosInstance.post(requestUrl, requestData, {
     headers,
     responseType:'stream',
     maxContentLength:Infinity,
     maxBodyLength:Infinity
   })
   ```
   - `src/core/claude-kiro.js:4414-4419`

3. 对于每个网络 chunk：
   ```javascript
   pendingBuffer = Buffer.concat([pendingBuffer, chunk])
   const { events, remaining } = this.parseAwsEventStreamBuffer(pendingBuffer)
   pendingBuffer = remaining
   ```
   - `src/core/claude-kiro.js:4425-4437`

### 4.2 内部事件 → streamApiReal yield 事件

| parseAwsEventStreamBuffer 事件 | streamApiReal 输出 | 代码位置 |
|---|---|---|
| `{type:'content', data:<string>}` | `yield { type:'content', content: event.data }`（并过滤连续重复 content） | `src/core/claude-kiro.js:4449-4456` |
| `{type:'thinking', data:{thinking:<string>}}` | `yield { type:'thinking', data: event.data }` | `src/core/claude-kiro.js:4457-4460` |
| `{type:'toolUse', data:{...}}` | `yield { type:'toolUse', toolUse: event.data }` | `src/core/claude-kiro.js:4460-4463` |
| `{type:'toolUseInput', data:{input:<string>}}` | `yield { type:'toolUseInput', input: ..., toolUseId: ... }` | `src/core/claude-kiro.js:4464-4467` |
| `{type:'toolUseStop', data:{stop:<bool>}}` | `yield { type:'toolUseStop', stop: ..., toolUseId: ... }` | `src/core/claude-kiro.js:4468-4471` |

**额外机制**
- **TTFT（首字时间）**：当第一次看到 `event.type === 'content' || 'thinking'` 时记录并打印
  - `src/core/claude-kiro.js:4443-4447`
- **重复 content 过滤**：如果本次 content 与上一次完全相同则跳过
  - `src/core/claude-kiro.js:4449-4455`

---

## 5. generateContentStream()：内部事件 → Claude streaming chunks

### 5.1 chunk 输出总顺序（宏观）

1. `message_start`：启动事件（包含 message id、usage input_tokens 等）
   - `src/core/claude-kiro.js:4646-4657`

2. 若有 thinking（原生 thinking 事件或 `<thinking>` 标签注入解析）：
   - `content_block_start`（type=thinking）
   - 多次 `content_block_delta`（type=thinking_delta）
   - `content_block_stop`
   - 原生 thinking 路径：`src/core/claude-kiro.js:4680-4700`
   - prompt injection 解析路径：`src/core/claude-kiro.js:4699-4855`

3. text 内容：
   - `content_block_start`（type=text）
   - 多次 `content_block_delta`（type=text_delta）
   - `content_block_stop`
   - `src/core/claude-kiro.js:4865-4883`

4. tool_use（如果模型触发工具）：
   - 对每个工具调用输出 3 个事件：
     - `content_block_start`（content_block.type="tool_use"）
     - `content_block_delta`（delta.type="input_json_delta"）
     - `content_block_stop`
   - `src/core/claude-kiro.js:5078-5142`

5. `code_references`（可选）
   - `src/core/claude-kiro.js:5145-5157`

6. `message_delta`：包含 stop_reason 与 usage.output_tokens
   - `src/core/claude-kiro.js:5159-5173`

7. `message_stop`：结束事件
   - `src/core/claude-kiro.js:5175-5176`

### 5.2 内部事件到 chunk 的细粒度映射

#### A) thinking（原生事件路径）

当 `streamApiReal` yield `event.type === 'thinking'`：
- 第一次出现时：发 `content_block_start`（index=0，type=thinking）
- 每次：发 `content_block_delta`（type=thinking_delta）
- 代码：`src/core/claude-kiro.js:4680-4700`

#### B) thinking（prompt injection 解析路径）

当 `enableThinking` 为真时，`content` 文本中可能出现 `<thinking>...</thinking>`：
- 代码会维护 `contentBuffer` 并分片解析标签边界
- `<thinking>` 之前的文本仍走 text_delta
- `<thinking>` 内的文本走 thinking_delta，并在看到 `</thinking>` 时发送 `content_block_stop`
- 关键状态变量：`insideThinkingTag / thinkingTagClosed / thinkingBlockClosed`
  - `src/core/claude-kiro.js:4669-4673`
  - 解析逻辑片段：`src/core/claude-kiro.js:4799-4855`

#### C) content → text block

当 `event.type === 'content'` 且 `event.content` 存在：
- 未启用 thinking 或 thinking 解析结束后：确保发一次 `content_block_start`（type=text）
- 然后持续发 `content_block_delta`（type=text_delta）
- 代码（不启用 thinking 的直接路径）：`src/core/claude-kiro.js:4857-4883`

#### D) toolUse → toolCalls 累积 → tool_use blocks 输出

**累积阶段**：当 `event.type === 'toolUse'`：
- 按 `toolUseId` 去重（`seenToolUseIds`），第一次遇到会创建 `currentToolCall = {toolUseId,name,input:''}`
- **每次都追加 input**（event 中可能是分片 input）
- 若 `tc.stop` 为 true：尝试把累积 input `JSON.parse` 成对象，否则保留字符串；push 到 `toolCalls`
- 对 `webSearch` 特判：标记 `serverSideExecute=true`（后续会被服务端执行并把结果写入文本块）
- 代码：`src/core/claude-kiro.js:4884-4935`

**输出阶段**（仅客户端执行的工具）：在流结束后统一输出 tool_use blocks：
- 每个工具调用输出：
  - `content_block_start`：`content_block.type="tool_use"`，id=toolUseId，name=tc.name，input 初始为空对象
  - `content_block_delta`：`delta.type="input_json_delta"`，partial_json = JSON.stringify(reversedInput)
  - `content_block_stop`
- 同时执行 `reverseMapToolInput` 做 **Kiro → CC 参数名反向映射**（并过滤 CC 不认识的参数）
- 代码：`src/core/claude-kiro.js:5090-5142`

#### E) metering → outputTokens 的估算

- `event.type === 'metering'`：把 `usage` 近似换算为 token（`Math.ceil(usage * 1000)`），写入 `outputTokens`
  - `src/core/claude-kiro.js:4937-4944`
- 但最终仍会在流结束后重新用 tokenizer 计算 `totalContent + thinkingContent + tool input` 的 token 作为输出 token（覆盖式/最终值）
  - `src/core/claude-kiro.js:5159-5168`

### 5.3 stop_reason 与 message_delta / message_stop

- `message_delta.delta.stop_reason`：
  - 若存在任何客户端执行的 tool call：`"tool_use"`
  - 否则：`"end_turn"`
- 代码：`src/core/claude-kiro.js:5169-5173`
- 最终 always 发 `message_stop`：`src/core/claude-kiro.js:5175-5176`

---

## 6. SSE 输出格式（服务端对客户端的最终表现）

本项目对外 SSE 输出由 `handleStreamRequest()` 完成：

**设置响应头**
```javascript
{
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Transfer-Encoding': 'chunked'
}
```
- `src/common.js:141-146`

**对每个 chunk**
```javascript
event: ${chunk.type}\n
data: ${JSON.stringify(chunk)}\n\n
```
- `src/common.js:178-210`

> 因此：**SSE 的 event 名称与 chunk.type 完全一致**。例如 `message_start`、`content_block_delta`、`message_stop` 等就是对外的 SSE event。

---

## 7. 流式错误处理机制

### 7.1 streamApiReal 的错误处理与重试

#### Socket 类错误（无 `error.response`）

如 ECONNRESET/ETIMEDOUT/UND_ERR_SOCKET 等：
- 若 `retryCount < maxRetries`：
  - 调用 `resetConnectionPool()` 重置 http/https agent 连接池
  - sleep 1s
  - `yield* streamApiReal(..., retryCount+1)` 递归重试
- 超过最大重试：抛出 "Stream connection failed" 新错误
- 代码：`src/core/claude-kiro.js:4499-4525`

#### 403（权限/过期 token）

- 若不是 retry（`!isRetry`）：
  - `initializeAuth(true)` 强制刷新 token
  - `yield* streamApiReal(..., isRetry=true, retryCount)` 重试一次
- 代码：`src/core/claude-kiro.js:4527-4532`

#### 429（限流）

- 指数退避：`delay = baseDelay * 2^retryCount`，sleep 后递归重试
- 代码：`src/core/claude-kiro.js:4534-4540`

#### 400（Bad Request）

- 打印详细诊断：status/statusText、响应体片段、`x-amzn-errortype`
- 并打印 requestData.conversationState 的关键统计（content 长度、tools/toolResults 数量等）
- 代码：`src/core/claude-kiro.js:4542-4597`

最终：`throw error`，由上层 `generateContentStream` 捕获
- `src/core/claude-kiro.js:4599-4600`

### 7.2 generateContentStream 的错误处理（向客户端"可见"）

`generateContentStream` catch：
- **先 yield 一个 `{type:"error", error:{type,message}}` chunk**（让客户端在 SSE 流里看到错误，而不是静默断开）
- 然后再 throw 一个包装错误（让上层知道 stream 失败）

代码位置：`src/core/claude-kiro.js:5178-5196`

> 注意：这里 throw 之后，`handleStreamRequest` 的外层可能进入 provider retry（见 `src/common.js:354-409`），但如果已经开始向客户端写数据，则 `handleStreamRequest` 会走 "streamStarted=true 无法重试，只能返回流式错误" 的路径（`src/common.js:225-239`）。

---

## 参考索引（快速定位）

- SSE 输出封装：`src/common.js:141`, `src/common.js:155`, `src/common.js:199`
- Event Stream message 解析：`src/core/claude-kiro.js:3994`
- Event Stream buffer → 内部事件：`src/core/claude-kiro.js:4057`
- streamApiReal（网络流 + 重试）：`src/core/claude-kiro.js:4348`, `src/core/claude-kiro.js:4499`, `src/core/claude-kiro.js:4527`, `src/core/claude-kiro.js:4534`
- generateContentStream（chunk 序列）：`src/core/claude-kiro.js:4620`, `src/core/claude-kiro.js:4646`, `src/core/claude-kiro.js:5078`, `src/core/claude-kiro.js:5169`, `src/core/claude-kiro.js:5178`
