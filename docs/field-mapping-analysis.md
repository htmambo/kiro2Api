# buildCodewhispererRequest() 字段映射与转换规则（Claude Messages API → AWS CodeWhisperer conversationState）

本文档仅基于代码静态分析，描述 `KiroService.buildCodewhispererRequest(messages, model, tools, inSystemPrompt, enableThinking)` 的**真实实现行为**与字段映射规则，不包含任何代码修改。

> 代码入口：`src/core/claude-kiro.js:2623`

---

## 0. 术语与目标结构

**输入（Claude Messages API 侧）**
- `messages[]`：Claude 消息数组（含 `role`、`content`，其中 `content` 可为字符串或 block 数组）
- `tools[]`：Claude tools 定义（支持多种格式）
- `system`：Claude system prompt（在本项目中以 `inSystemPrompt` 参数传入）
- `thinking`：是否启用"思考模式"（本函数接收的是布尔值 `enableThinking`，不是原始对象）

**输出（AWS CodeWhisperer 侧）**
- 统一构造成：
  - `request.conversationState.history[]`：历史消息（user/assistant 交替）
  - `request.conversationState.currentMessage.userInputMessage`：当前消息（**强制为 userInputMessage**）

构造 request 的关键片段：`src/core/claude-kiro.js:3262-3336`

---

## 1) 顶层字段映射表（Claude → CodeWhisperer）

| Claude 请求字段/概念 | buildCodewhispererRequest 入参 | CodeWhisperer 输出位置 | 规则摘要 |
|---|---|---|---|
| `messages` | `messages` | `conversationState.history` + `conversationState.currentMessage.userInputMessage` | 除最后一条外进入 history，最后一条进入 currentMessage；若最后一条为 assistant，会被先移入 history，再生成一个 user currentMessage（content=`Continue`） |
| `model` | `model` | `userInputMessage.modelId`（以及 history 的 userInputMessage.modelId） | 通过 `MODEL_MAPPING` 映射为 AWS 接受的模型 ID，写入每个 `userInputMessage.modelId`（`assistantResponseMessage` 不带 modelId） |
| `tools` | `tools` | `currentMessage.userInputMessage.userInputMessageContext.tools` | tools 只放到 **currentMessage** 的 context 中（history 不携带 tools 定义） |
| `system` | `inSystemPrompt` | 被"注入"为 history 的 userInputMessage.content | system prompt 不以独立字段存在，而是拼入第一条 user 或单独形成一条 userInputMessage |
| `thinking` | `enableThinking` | 通过"prompt injection"写入 system prompt 文本；另有 thinking block → `<thinking>...</thinking>` 文本化 | enableThinking=true 时把 `THINKING_PROMPT_TEMPLATE` 前置到 systemPrompt；assistant 的 `content[].type==="thinking"` 会被转成 `<thinking>` 标签写回文本 |
| `images`（Claude content blocks） | 从 `messages[*].content[]` 提取 | `userInputMessage.images[]` | 仅 userInputMessage 可带 images（history 的 userInputMessage、currentMessage 的 userInputMessage 都可带） |
| `tool_use`/`tool_result`（Claude content blocks） | 从 `messages[*].content[]` 提取 | `assistantResponseMessage.toolUses[]` / `userInputMessageContext.toolResults[]` | tool_use 进入 assistantResponseMessage.toolUses；tool_result 进入 userInputMessageContext.toolResults（并做截断、去重、过滤） |

参考：
- 模型映射与写入：`src/core/claude-kiro.js:2644-2646`, `src/core/claude-kiro.js:3290-3293`
- tools 写入 currentMessage：`src/core/claude-kiro.js:3314-3317`
- system prompt 注入：`src/core/claude-kiro.js:2942-2966`
- enableThinking 注入：`src/core/claude-kiro.js:2627-2634`

---

## 2) conversationState 字段生成规则

### 2.1 conversationState 固定字段

| CodeWhisperer 字段 | 来源 | 规则 |
|---|---|---|
| `conversationState.chatTriggerType` | 常量 | 固定为 `"MANUAL"`（`KIRO_CONSTANTS.CHAT_TRIGGER_TYPE_MANUAL`） |
| `conversationState.conversationId` | 从消息元数据提取或生成 | `extractMetadata(messages,"conversationId") || uuidv4()` |
| `conversationState.agentContinuationId` | 可选 | 从 `messages[*].additional_kwargs.continuationId` 提取，存在则写入 |
| `conversationState.agentTaskType` | 可选 | 从 `messages[*].additional_kwargs.taskType` 提取，存在则写入 |
| `conversationState.history` | 可选 | 仅当 history 非空时才加入（避免发送空数组） |

参考：
- 元数据提取与变量：`src/core/claude-kiro.js:2715-2719`, `src/core/claude-kiro.js:1736-1748`
- request/conversationState 结构：`src/core/claude-kiro.js:3262-3285`

### 2.2 currentMessage 固定要求

| CodeWhisperer 字段 | 规则 |
|---|---|
| `conversationState.currentMessage.userInputMessage` | **必须是 userInputMessage**。如果 Claude 的最后一条消息是 assistant，会先把该 assistant 迁入 history，再构造一个 user currentMessage（content=`Continue`）用于触发继续生成 |

参考：`src/core/claude-kiro.js:3113-3164`

---

## 3) messages[] 角色如何转换（history / currentMessage）

### 3.1 预处理（会影响转换输入）

1. `sanitizeMessages(messages)`：对 messages 做验证与自动修复（如确保交替等），然后继续后续流程。
   参考：`src/core/claude-kiro.js:2636-2639`
2. 若最后一条是 assistant 且内容为单个 `text:"{"`，会被移除（特殊修复逻辑）。
   参考：`src/core/claude-kiro.js:2726-2733`
3. 合并相邻相同 role 的消息：把相邻同 role 的 `content` 合并（数组拼接、字符串拼接或互转）。
   参考：`src/core/claude-kiro.js:2735-2772`
### 3.2 history 的构造（除最后一条外）

算法概览：
- `history = []`，先（可选）注入 system prompt（见第 6 节），得到 `startIndex`。
- 对 `processedMessages[startIndex ... length-2]` 逐条转换：
  - `role === "user"` → `history.push({ userInputMessage })`
  - `role === "assistant"` → `history.push({ assistantResponseMessage })`

参考：`src/core/claude-kiro.js:2939-3104`

### 3.3 currentMessage 的构造（最后一条）

设 `currentMessage = processedMessages[processedMessages.length - 1]`：
- 若 `currentMessage.role === "assistant"`：
  1) 先把该 assistant 按 assistant 规则转换并 push 进 history；
  2) 然后将 `currentContent` 设为 `"Continue"`，最终构造 user currentMessage。
  参考：`src/core/claude-kiro.js:3113-3164`
- 若 `currentMessage.role === "user"`：
  - 解析其 content blocks，得到 `currentContent` / `currentToolResults` / `currentImages`（以及一个未使用的 `currentToolUses`，见第 5 节）。
  参考：`src/core/claude-kiro.js:3165-3234`

最终 userInputMessage 写入 `conversationState.currentMessage.userInputMessage`：`src/core/claude-kiro.js:3287-3331`

---

## 4) tools 定义如何转换（Claude tools[] → CodeWhisperer toolSpecification）

### 4.1 tools 处理总流程

输入：Claude 的 `tools` 数组（多格式兼容）。输出：`toolsContext.tools`（数组），最终写入 currentMessage 的 `userInputMessageContext.tools`。

处理步骤（按代码执行顺序）：
1. 过滤 builtin tools（CodeWhisperer 不支持）：匹配形如 `{ type, name }` 且 `name` 在白名单 `['web_search','bash','code_execution','computer','str_replace_editor','str_replace_based_edit_tool']`。
   参考：`src/core/claude-kiro.js:2845-2887`
2. 过滤不支持的工具（CC_TO_KIRO_TOOL_MAPPING 标记 remove）：`shouldRemoveTool()`。
   参考：`src/core/claude-kiro.js:2865-2891`
3. 数量上限：最多保留 25 个工具（`MAX_TOOL_COUNT = 25`）。
   参考：`src/core/claude-kiro.js:2840-2842`, `src/core/claude-kiro.js:2892-2896`
4. 转换为 toolSpecification：对过滤后的 tools 执行 `convertToQToolWithMapping(tool, compressInputSchema, DESCRIPTION_MAX_LENGTH)`，并放入 `toolsContext.tools`。
   参考：`src/core/claude-kiro.js:2898-2905`
5. tools 仅写入 currentMessage：
   - `userInputMessageContext.tools = toolsContext.tools`
   参考：`src/core/claude-kiro.js:3314-3317`

### 4.2 convertToQToolWithMapping() 的关键规则（保持 CC schema，参数映射延后）

当工具名存在于 `CC_TO_KIRO_TOOL_MAPPING` 且有 `mapping.kiroTool` 时：
- 输出：
  - `toolSpecification.name`：**仍然使用原始工具名 toolName**（不是 kiroTool 名）
  - `toolSpecification.description`：优先使用 mapping.description，其次原 desc；并截断到 `DESCRIPTION_MAX_LENGTH`
  - `toolSpecification.inputSchema.json`：使用 **原始 CC schema**（仅做 compress），不替换成 Kiro schema
- 原因：代码明确注释"如果返回 Kiro schema，CC 会验证失败"；实际的参数名转换只在 tool_use 阶段的 `mapToolUseParams()` 做。

参考：
- `convertToQToolWithMapping`：`src/core/claude-kiro.js:1673-1729`
- "只在 mapToolUseParams 中做参数映射"的注释：`src/core/claude-kiro.js:1700-1705`

### 4.3 JSON Schema 压缩规则（compressInputSchema）

对 schema 做递归清理，移除 AWS CodeWhisperer 明确不支持的字段（如 `$schema/$id/definitions/examples`、以及 `allOf/anyOf/...` 等组合关键字），保留 validation 字段（min/max/pattern 等）。
参考：`src/core/claude-kiro.js:2774-2827`

---

## 5) tool_use 与 tool_result 的处理

### 5.1 tool_use（assistant → assistantResponseMessage.toolUses）

**触发条件**
- 当某条消息 `role === "assistant"` 且 `content[]` 内包含 `{ type:"tool_use" }` block。

**输出结构**
```json
assistantResponseMessage: {
  content: "..." ,
  toolUses: [
    { "toolUseId": "<part.id>", "name": "<part.name>", "input": { ...mapped... } }
  ]
}
```

**参数映射**
- `input` 会经过 `mapToolUseParams(part.name, part.input)`（CC → Kiro 参数名转换 + fixedParams 注入）。
参考：`src/core/claude-kiro.js:1407-1474`

**工具裁剪过滤**
- 若工具被裁剪（keptToolNames 不包含），会跳过该 tool_use。
参考：`src/core/claude-kiro.js:3065-3072`, `src/core/claude-kiro.js:3128-3134`

**空内容修复**
- 若 assistantResponseMessage.content 为空：
  - 有 toolUses → `'Calling tools...'`
  - 否则 → `'...'`
参考：`src/core/claude-kiro.js:3097-3100`

### 5.2 tool_result（user → userInputMessageContext.toolResults）

**触发条件**
- 当某条消息 `role === "user"` 且 `content[]` 内包含 `{ type:"tool_result" }` block。

**输出结构**
```json
userInputMessage: {
  content: "...(可能为空，后续会补默认)...",
  userInputMessageContext: {
    toolResults: [
      { "toolUseId": "<part.tool_use_id>", "status": "success", "content": [ { "text": "<tool output>" } ] }
    ]
  }
}
```

**内容抽取与截断**
- tool_result 的内容使用 `this.getContentText(part.content)` 抽取文本。
- 超长输出会截断到 `MAX_TOOL_OUTPUT_LENGTH`（64K chars），并追加截断提示。
参考：`src/core/claude-kiro.js:2996-3002`, `src/core/claude-kiro.js:3180-3186`

**去重**
- toolResults 按 `toolUseId` 去重，避免 API 拒绝重复 toolUseId。
参考：`src/core/claude-kiro.js:3035-3045`, `src/core/claude-kiro.js:3303-3313`

**工具裁剪过滤（tool_result 依赖 toolUseId→toolName）**
- 先从 assistant 消息中建立映射：`toolUseIdToName.set(tool_use.id, tool_use.name)`。
  参考：`src/core/claude-kiro.js:2922-2932`
- tool_result 在写入前，会通过 `toolUseIdToName.get(part.tool_use_id)` 找到工具名；若该工具名不在 keptToolNames，则跳过该 tool_result。
  参考：`src/core/claude-kiro.js:2987-2994`, `src/core/claude-kiro.js:3171-3178`

**空 content 修复**
- userInputMessage.content 为空时：
  - 有 toolResults → `'Tool results provided.'`
  - 否则 → `'Continue'`
参考：`src/core/claude-kiro.js:3048-3051`, `src/core/claude-kiro.js:3230-3233`

### 5.3 currentMessage 中的 tool_use（注意：收集但未写入 request）

在 current user message 的解析中，若遇到 `content[].type === "tool_use"`：
- 会 push 到 `currentToolUses`（包含 name/toolUseId/input），并同样执行 `mapToolUseParams()` 与裁剪过滤。
参考：`src/core/claude-kiro.js:3192-3207`

但在最终构造 `userInputMessageContext` 时，代码**并没有把 currentToolUses 写入 request**（只写入 toolResults/tools/supplementalContexts）。
可视为"保留但不生效"的实现细节：`src/core/claude-kiro.js:3300-3329`

---

## 6) system prompt 如何注入

### 6.1 systemPrompt 的来源与文本化

- `systemPrompt = this.getContentText(inSystemPrompt)`
参考：`src/core/claude-kiro.js:2625`

### 6.2 注入策略（转成 history 的 userInputMessage）

若 `systemPrompt` 非空：
1. 如果 `processedMessages[0].role === "user"`：
   - 创建一条 history userInputMessage，其 `content = systemPrompt + "\n\n" + firstUserContent`
   - `startIndex = 1`（跳过原第一条 user）
2. 否则：
   - 创建一条**独立的** history userInputMessage，其 `content = systemPrompt`
   - `startIndex` 保持为 0（不会跳过 messages[0]）

参考：`src/core/claude-kiro.js:2942-2966`

> 结论：system prompt 不会出现在 CodeWhisperer 的独立字段中，而是被"伪装成 user 消息"注入到 history。

---

## 7) images 如何处理（Claude image block → CodeWhisperer images）

### 7.1 输入形式（Claude）

当 message.content 为数组时，遇到：
- `part.type === "image"`
- 常见携带字段：`part.source.data`（以及可选的 `part.source.media_type`）

### 7.2 输出形式（CodeWhisperer）

构造成：
```json
images: [
  {
    "format": "<jpeg/png/...>",
    "source": { "bytes": "<part.source.data>" }
  }
]
```

### 7.3 format 决策规则

1. 若存在 `part.source.media_type`：取其 MIME 子类型（如 `"image/png"` → `"png"`）
2. 否则若存在 `part.source.data` 或 `part.image_url.url`：降级到 `detectImageFormat(...)`
3. 默认 `jpeg`

参考：
- history user 消息 images：`src/core/claude-kiro.js:3008-3025`
- current user 消息 images：`src/core/claude-kiro.js:3207-3224`

---

## 8) thinking 模式如何启用（enableThinking）

### 8.1 prompt injection：把 thinking 指令写入 systemPrompt

若 `enableThinking === true`：
- 有 systemPrompt：`systemPrompt = THINKING_PROMPT_TEMPLATE + "\n\n" + systemPrompt`
- 无 systemPrompt：`systemPrompt = THINKING_PROMPT_TEMPLATE`

参考：`src/core/claude-kiro.js:2627-2634`

> 注意：这意味着 thinking 的"启用"是通过修改 system prompt 文本实现的；最终仍旧通过第 6 节的逻辑注入到 history。

### 8.2 assistant thinking block 的处理（内容文本化）

当 assistant message.content[] 中出现 `part.type === "thinking"`：
- 会把 `part.thinking` 包装成：
  - `<thinking>\n${thinkingText}\n</thinking>\n`
- 拼接进 `assistantResponseMessage.content`

该逻辑出现在：
- history assistant：`src/core/claude-kiro.js:3080-3086`
- last assistant 被移入 history 的分支：`src/core/claude-kiro.js:3142-3148`

> 结论：thinking block 并不会以结构化字段发送给 CodeWhisperer，而是被降级为文本标签，确保上游接口可接受（代码注释提到避免 400）。

---

## 9) 附：userInputMessageContext 的最终组成（currentMessage）

currentMessage 的 `userInputMessageContext` 是"按需添加字段"的对象（避免空对象/空数组）：
- `toolResults`：来自 current user message 的 tool_result（去重后）
- `tools`：来自 toolsContext.tools（仅当存在）
- `supplementalContexts`：从 `extractSupplementalContext(currentMessage)` 提取（仅当存在）

参考：
- context 构建：`src/core/claude-kiro.js:3300-3329`
- supplementalContexts 提取入口：`src/core/claude-kiro.js:1758-1765`（实现细节在后续代码段）

此外，在返回 request 之前还会调用：
- `sanitizeMessageHistory(history, currentToolResults)`：确保 history 满足 Kiro API 规则（例如 toolUses 必须有匹配 toolResults，否则会移除 toolUses 等）。
参考：`src/core/claude-kiro.js:3337-3339`

---

## 10) 关键参考索引（便于复核）

- buildCodewhispererRequest 主体：`src/core/claude-kiro.js:2623`
- system prompt + thinking 注入：`src/core/claude-kiro.js:2627`, `src/core/claude-kiro.js:2942`
- 合并相邻同 role：`src/core/claude-kiro.js:2735`
- tools 过滤/上限/转换：`src/core/claude-kiro.js:2840`, `src/core/claude-kiro.js:2898`
- convertToQToolWithMapping：`src/core/claude-kiro.js:1673`
- mapToolUseParams：`src/core/claude-kiro.js:1407`
- history user/assistant 转换：`src/core/claude-kiro.js:2971`, `src/core/claude-kiro.js:3055`
- last assistant → history + Continue：`src/core/claude-kiro.js:3113`
- current user message 解析：`src/core/claude-kiro.js:3165`
- request.conversationState 组装：`src/core/claude-kiro.js:3262`
