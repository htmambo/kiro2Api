# Logger.info 级别分析报告

**生成时间**: 2026-01-18  
**分析范围**: 全项目 logger.info 调用（共 236 处，31 个文件）

---

## 分类标准

### 应保持 INFO 级别
- ✅ 系统启动/关闭信息
- ✅ 用户操作结果（登录、上传、配置变更）
- ✅ 重要状态变更（账号切换、配置重载）
- ✅ 关键性能指标（TTFT、请求完成时间）
- ✅ 安全相关（认证、授权）
- ✅ 错误恢复（token 刷新成功）

### 应降级为 DEBUG 级别
- 🔽 详细的内部处理流程
- 🔽 工具调用细节
- 🔽 消息处理细节
- 🔽 中间状态信息
- 🔽 频繁触发的日志
- 🔽 调试用的详细信息

---

## 文件级别分析

### 1. src/api/server.js (17 处)
**建议**: 保持 INFO

**原因**: 服务器启动配置、端点信息，用户需要看到

```javascript
✅ logger.info(`--- Unified API Server Configuration ---`);
✅ logger.info(`Unified API Server running on http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}`);
✅ logger.info(`Login page available at: ...`);
```

---

### 2. src/master.js (27 处)
**建议**: 大部分保持 INFO，少数降级

**保持 INFO**:
```javascript
✅ logger.info(`Worker process started, PID: ${workerProcess.pid}`);
✅ logger.info('Restart requested via API');
✅ logger.info('Received SIGTERM, shutting down...');
```

**降级为 DEBUG**:
```javascript
🔽 logger.info('Received message from worker', { message });
🔽 logger.info('Worker status', { status: message.data });
```

---

### 3. src/kiro/adapter.js (26 处)
**建议**: 大部分降级为 DEBUG

**保持 INFO**:
```javascript
✅ logger.info('Initializing Kiro API Service...');
✅ logger.info('Resetting connection pool...');
✅ logger.info('Connection pool reset completed');
```

**降级为 DEBUG**:
```javascript
🔽 logger.info(`System proxy ${this.useSystemProxy ? 'enabled' : 'disabled'}`);
🔽 logger.info(`Verbose logging ${this.verboseLogging ? 'enabled' : 'disabled'}`);
🔽 logger.info(`Merged adjacent ${currentMsg.role} messages`);
🔽 logger.info(`Removing unsupported tool: ${name}`);
🔽 logger.info(`Filtering out builtin tool: ${tool.name}`);
🔽 logger.info(`Processed ${filteredTools.length} tools`);
🔽 logger.info(`Tool trimming info: kept ${keptToolNames.size} tools`);
🔽 logger.info(`Filtering out tool_result for trimmed tool: ${toolName}`);
🔽 logger.info(`Filtering out tool_use for trimmed tool: ${part.name}`);
🔽 logger.info('Last message is assistant, moving it to history');
🔽 logger.info(`⚠️ currentContent too long, truncating...`);
🔽 logger.info(`currentContent truncated to ${currentContent.length} chars`);
🔽 logger.info('Using continuationId for multi-turn optimization:', continuationId);
🔽 logger.info('Using taskType:', taskType);
🔽 logger.info(`Request size: ${requestSizeKB} KB`);
🔽 logger.info(`- History: ${(historySize / 1024).toFixed(2)} KB`);
🔽 logger.info(`Perf: buildCodewhispererRequest total: ${buildDuration}ms`);
🔽 logger.info(`Expiry date: ${expirationTime.getTime()}, Current time: ...`);
```

---

### 4. src/kiro/api-client.js (18 处)
**建议**: 大部分降级为 DEBUG

**保持 INFO**:
```javascript
✅ logger.info(`📥 RESPONSE [${response.status}] [${requestDuration}s]`);
✅ logger.info(`Calling generateContent with model: ${finalModel}`);
✅ logger.info(`Calling generateContentStream with model: ${finalModel}`);
```

**降级为 DEBUG**:
```javascript
🔽 logger.info(`Token] generateContent estimateInputTokens: ${inputTokens} tokens`);
🔽 logger.info(`Token estimateInputTokens: ${inputTokens} tokens`);
🔽 logger.info("Raw response contains [Called marker.");
🔽 logger.info('Detected webSearch tool call, executing on server...');
🔽 logger.info(`Code references detected: ${references.length} sources`);
🔽 logger.info(`WebSearch Processing ${serverSideTools.length} server-side tool calls...`);
🔽 logger.info('Search results added to response');
🔽 logger.info('Usage limits fetched successfully');
🔽 logger.info('Received 403 on getUsageLimits. Attempting token refresh...');
🔽 logger.info('Usage limits fetched successfully after token refresh');
```

---

### 5. src/kiro/streaming.js (8 处)
**建议**: 保持 INFO（性能指标）

**保持 INFO**:
```javascript
✅ logger.info(`⚡ TTFT: ${(firstTokenTime / 1000).toFixed(2)}s`);
✅ logger.info(`📥 STREAM [Complete] [${requestDuration}s]`);
✅ logger.info(`Socket error detected: ${error.code || error.message}`);
```

---

### 6. src/kiro/auth.js (12 处)
**建议**: 保持 INFO（认证相关）

**保持 INFO**:
```javascript
✅ logger.info('Successfully loaded credentials from Base64');
✅ logger.info(`Successfully loaded OAuth credentials from ${targetFilePath}`);
✅ logger.info('Token refresh already in progress, waiting...');
✅ logger.info('Refreshing access token...');
✅ logger.info('Access token refreshed successfully');
✅ logger.info('Starting device authorization...');
✅ logger.info('Device authorization started successfully');
✅ logger.info('Successfully obtained token');
✅ logger.info('Token saved to file');
```

**降级为 DEBUG**:
```javascript
🔽 logger.info(`Updated token file: ${filePath}`);
🔽 logger.info(`Starting token polling, interval ${interval}s`);
🔽 logger.info('Slowing down polling frequency');
```

---

### 7. src/kiro/tools.js (5 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info(`Slow model detected (${model}), timeout: ${baseTimeout}ms -> ${adaptiveTimeout}ms`);
🔽 logger.info(`Split long document into ${chunks.length} chunks`);
🔽 logger.info(`Replacing tool call ${tcId} with better arguments`);
🔽 logger.info(`Skipping duplicate tool call: ${name}`);
🔽 logger.info(`Deduplicated tool calls: ${toolCalls.length} -> ${uniqueToolCalls.length}`);
```

---

### 8. src/kiro/message-sanitizer.js (3 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info(`Message sanitization: ${sanitizeActions.join(', ')}`);
🔽 logger.info(`Applied ${fixCount} fixes to message history`);
```

---

### 9. src/kiro/search.js (3 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info(`Executing search: "${query}"`);
🔽 logger.info(`DuckDuckGo found ${results.length} results`);
🔽 logger.info(`Bing found ${results.length} results`);
```

---

### 10. src/utils/common.js (7 处)
**建议**: 大部分降级为 DEBUG

**保持 INFO**:
```javascript
✅ logger.info('System prompt updated.');
✅ logger.info('System prompt cleared from file.');
```

**降级为 DEBUG**:
```javascript
🔽 logger.info(`[Pool] Increasing usage count for ${toProvider}`);
🔽 logger.info(`Re-selected service adapter based on model: ${model}`);
🔽 logger.info(`[Pool Retry] Request failed with ${pooluuid}`);
🔽 logger.info('[Pool Retry] Selecting next healthy account/provider...');
🔽 logger.info(`[Pool Retry] Switched to: ${pooluuid}`);
```

---

### 11. src/ui/router/handlers/oauth.handlers.js (23 处)
**建议**: 保持 INFO（OAuth 流程关键步骤）

**保持 INFO**:
```javascript
✅ logger.info(`OAuth Web Received callback: code=...`);
✅ logger.info('Manual Import RefreshToken validated and refreshed successfully');
✅ logger.info(`Manual Import Importing refreshToken for account ${accountNumber}`);
✅ logger.info(`Manual Import Token saved to: ${saveInfo.tokenFilePath}`);
✅ logger.info(`Manual Import Added to account pool: ${saveInfo.relativePath}`);
✅ logger.info(`[AWS SSO] Starting automatic client registration...`);
✅ logger.info(`[AWS SSO] Client registered successfully!`);
✅ logger.info(`[AWS SSO] Starting device authorization for account ${accountNumber}`);
✅ logger.info(`[AWS SSO] Device authorization started`);
✅ logger.info(`[AWS SSO] Token saved to: ${saveInfo.tokenFilePath}`);
✅ logger.info(`[AWS SSO] Token added to account pool: ${saveInfo.relativePath}`);
✅ logger.info(`[AWS SSO] Device authorization completed successfully`);
```

**降级为 DEBUG**:
```javascript
🔽 logger.info(`Manual Import ProfileArn: ${finalProfileArn}`);
🔽 logger.info(`Manual Import Duplicate account detected: ${userIdResult.userId}`);
🔽 logger.info(`Manual Import Path already exists in account pool`);
🔽 logger.info(`Manual Import Rolled back token file: ${saveInfo.tokenFilePath}`);
🔽 logger.info(`[AWS SSO] Region: ${region}, Start URL: ${finalStartUrl}`);
🔽 logger.info(`[AWS SSO] Client ID: ${clientId.substring(0, 10)}...`);
🔽 logger.info(`[AWS SSO] Client expires at: ${new Date(...).toISOString()}`);
🔽 logger.info(`[AWS SSO] Start URL: ${finalStartUrl}`);
🔽 logger.info(`[AWS SSO] User Code: ${deviceAuthInfo.userCode}`);
🔽 logger.info(`[AWS SSO] Verification URI: ${deviceAuthInfo.verificationUriComplete}`);
🔽 logger.info(`[AWS SSO] Rolled back token file for account ${accountNumber}`);
```

---

### 12. src/ui/router/handlers/system.handlers.js (3 处)
**建议**: 保持 INFO（用户操作）

```javascript
✅ logger.info('[Login] User logged in successfully');
✅ logger.info('[Login] Failed login attempt');
✅ logger.info('[System] Sending restart request to master...');
```

---

### 13. src/ui/router/handlers/upload.handlers.js (4 处)
**建议**: 保持 INFO（文件上传操作）

```javascript
✅ logger.info(`[UI API] Quick linked config: ${filePath}`);
✅ logger.info(`[Upload] OAuth凭据文件已上传: ${targetFilePath}`);
✅ logger.info(`[UI API] Bulk quick link started for ${uniquePaths.length} files`);
✅ logger.info(`[UI API] Bulk quick link completed: ${successCount} succeeded`);
```

---

### 14. src/config/manager.js (11 处)
**建议**: 保持 INFO（配置加载）

```javascript
✅ logger.info('Loaded configuration from config.json');
✅ logger.info('config.json not found, checking for config.json.example...');
✅ logger.info('Created config.json from config.json.example');
✅ logger.info('⚠️  Please edit config.json and set your REQUIRED_API_KEY');
✅ logger.info('Created default config.json');
✅ logger.info('Using default configuration.');
✅ logger.info('Created configs directory');
✅ logger.info('Created configs/kiro directory');
✅ logger.info(`Loaded system prompt from ${filePath}`);
```

---

### 15. src/lib/sqlite-db.js (6 处)
**建议**: 保持 INFO（数据库操作）

```javascript
✅ logger.info(`[SQLiteDB] Database initialized: ${dbPath}`);
✅ logger.info('[SQLiteDB] Database connection closed');
✅ logger.info(`[SQLiteDB] Backup created: ${backupPath}`);
✅ logger.info('[SQLiteDB] Migration to accounts schema completed');
✅ logger.info(`[SQLiteDB] Cleaned ${result.changes} expired usage cache entries`);
✅ logger.info(`[SQLiteDB] Cleaned ${result.changes} old health check history entries`);
```

---

### 16. src/ui-manager.js (4 处)
**建议**: 保持 INFO（配置重载）

```javascript
✅ logger.info('✓ UI 密码已配置且符合安全建议');
✅ logger.info(`Usage data cached to ${USAGE_CACHE_FILE}`);
✅ logger.info('[UI API] Configuration reloaded:');
✅ logger.info('[UI API] Configuration reloaded successfully');
```

---

### 17. src/api/request-handler.js (3 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info(`\n${new Date().toLocaleString()}`);
🔽 logger.info(`Received request: ${req.method} http://${host}${sanitizeUrlForLogs(req.url)}`);
🔽 logger.info(`Ignoring count_tokens request: ${path}`);
```

---

### 18. src/services/manager.js (2 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info(`Using pooled account configuration: ${serviceConfig.uuid}`);
🔽 logger.info(`getServiceAdapter, provider: ${config.MODEL_PROVIDER}, uuid: ${config.uuid}`);
```

---

### 19. src/converters/utils.js (2 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info("No budget_tokens provided, defaulting to reasoning_effort='high'");
🔽 logger.info(`🎯 Budget tokens ${budgetTokens} -> reasoning_effort '${effort}'`);
```

---

### 20. src/converters/strategies/OpenAIConverter.js (2 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info(`[OpenAI->Gemini] Adding responseModalities: ["TEXT"]`);
🔽 logger.info(`[OpenAI->Gemini] Skipping responseModalities for model ${model}`);
```

---

### 21. src/kiro/converters/tool-converter.js (3 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info('Converting Zod schema to JSON schema for tool:', { toolName: tool.name });
🔽 logger.info('Zod schema detected for tool:', { toolId: tool.id });
```

---

### 22. src/domain/oauth/flows/aws-sso-device.js (7 处)
**建议**: 保持 INFO（OAuth 流程）

```javascript
✅ logger.info('Starting automatic client registration...');
✅ logger.info(`Region: ${region}, Start URL: ${startUrl}`);
✅ logger.info('Client registered successfully!');
✅ logger.info('启动设备授权流程');
✅ logger.info('Device authorization started');
✅ logger.info(`Auto-added to account pool with UUID: ${addedAccount.uuid}`);
```

---

### 23. src/domain/oauth/token-store.js (2 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info(`[TokenStore] Saved token to ${absPath}`);
🔽 logger.info(`[TokenStore] Deleted token file ${filePath}`);
```

---

### 24. src/domain/oauth/state-store.js (1 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info(`Loaded ${kiroOAuthStates.size} valid state(s) from ${this.stateFilePath}`);
```

---

### 25. src/domain/oauth/index.js (2 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info(`[OAuth Callback] State ${state} already completed, returning cached result`);
🔽 logger.info('Token file rolled back successfully');
```

---

### 26. src/domain/account-pool/json-store.js (1 处)
**建议**: 降级为 DEBUG

```javascript
🔽 this.logger.info(`Loaded account pool from ${filePath}`);
```

---

### 27. src/api/manager.js (1 处)
**建议**: 保持 INFO

```javascript
✅ logger.info(`Server is running. Current time: ${new Date().toLocaleString()}`);
```

---

### 28. src/api/rate-limiter.js (1 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info(`Cleaned up ${cleanedCount} expired records. Current size: ${records.size}`);
```

---

### 29. src/ui/events.js (1 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info('UI log broadcasting initialized');
```

---

### 30. src/ui/router/handlers/usage.handlers.js (1 处)
**建议**: 降级为 DEBUG

```javascript
🔽 logger.info(`[Usage API] Auto-initializing service adapter for ${providerType}`);
```

---

### 31. src/kiro/strategy.js (1 处)
**建议**: 需要查看具体内容

---

## 统计汇总

| 分类 | 数量 | 百分比 |
|------|------|--------|
| **保持 INFO** | ~90 | ~38% |
| **降级为 DEBUG** | ~146 | ~62% |
| **总计** | 236 | 100% |

---

## 优先级建议

### 高优先级降级（频繁触发，影响日志可读性）

1. **src/kiro/adapter.js** - 工具处理、消息合并、内容截断（~15 处）
2. **src/kiro/api-client.js** - Token 估算、工具调用细节（~10 处）
3. **src/api/request-handler.js** - 每个请求都打印（3 处）
4. **src/utils/common.js** - 账号池使用计数（5 处）
5. **src/kiro/tools.js** - 工具去重、分块（5 处）

### 中优先级降级（调试信息）

1. **src/kiro/message-sanitizer.js** - 消息清理细节（3 处）
2. **src/kiro/search.js** - 搜索执行细节（3 处）
3. **src/converters/** - 模型转换细节（7 处）
4. **src/domain/oauth/** - OAuth 内部状态（5 处）

### 低优先级（可选降级）

1. **src/kiro/auth.js** - Token 文件更新、轮询频率（3 处）
2. **src/ui/router/handlers/oauth.handlers.js** - OAuth 详细步骤（11 处）

---

## 实施建议

### 阶段 1：高频日志降级（立即执行）
- src/api/request-handler.js - 请求接收日志
- src/kiro/adapter.js - 工具处理、消息合并
- src/utils/common.js - 账号池计数

### 阶段 2：调试信息降级（本周内）
- src/kiro/api-client.js - Token 估算、工具调用
- src/kiro/tools.js - 工具去重、分块
- src/kiro/message-sanitizer.js - 消息清理

### 阶段 3：细节信息降级（下周）
- src/converters/ - 模型转换细节
- src/domain/oauth/ - OAuth 内部状态
- src/kiro/search.js - 搜索细节

---

## 验证方法

1. **修改前**: 运行一次完整请求，记录日志行数
2. **修改后**: 运行相同请求，对比日志行数
3. **预期结果**: 日志行数减少 50-60%，但关键信息不丢失

---

## 注意事项

1. **不要降级的日志**:
   - 用户操作结果（登录、上传、配置）
   - 系统启动/关闭
   - 错误恢复（token 刷新成功）
   - 性能指标（TTFT、请求完成时间）

2. **可以降级的日志**:
   - 内部处理流程
   - 工具调用细节
   - 中间状态信息
   - 频繁触发的日志

3. **降级后如何调试**:
   - 设置环境变量 `LOG_LEVEL=debug`
   - 或在 config.json 中配置 `"LOG_LEVEL": "debug"`
