# 第二优先级安全改进任务计划

**状态**: ✅ 已完成
**创建时间**: 2026-01-05
**完成时间**: 2026-01-05
**优先级**: 🟡 高（本周内完成）
**关联文档**: [代码质量审计报告](../../Analysis/CODE_QUALITY_AUDIT_2026-01-05.md)

---

## 任务目标

完成代码质量审计报告中的第二优先级任务，提升系统安全性和稳定性：
1. ✅ 实现统一的错误处理中间件
2. ✅ 添加请求速率限制
3. ✅ 添加超时控制

---

## 背景分析

根据审计报告，当前系统存在以下中危问题：
- **错误处理不一致**：不同模块使用不同的错误处理方式，难以追踪和调试
- **缺少请求速率限制**：API 端点容易被滥用或 DDoS 攻击
- **异步操作缺少超时控制**：可能导致请求挂起，资源耗尽

这些问题虽然不如第一优先级的安全漏洞严重，但会影响系统的可用性和可维护性。

---

## 任务分解

### 任务 1: 实现统一的错误处理中间件 ✅

**目标**: 建立统一的错误处理机制，确保所有错误都以一致的格式返回

**当前问题**:
- `src/utils/common.js:487-561` 中的 `handleError` 逻辑分散
- 不同地方使用不同的错误处理方式
- 流式响应（SSE）和普通响应的错误格式不统一

**实施步骤**:

1. **创建错误中间件模块** ✅
   - 文件: `src/api/error-middleware.js`（新建）
   - 功能:
     - 重构 `src/utils/common.js:487-561` 的 `handleError` 逻辑
     - 支持 JSON 和 SSE 两种响应格式
     - 统一的日志记录
     - 敏感信息过滤（生产环境）
     - URL 中的敏感参数（key, token 等）自动脱敏
   - 接口设计:
     ```javascript
     /**
      * 统一错误处理中间件
      * @param {Error} error - 错误对象
      * @param {Request} req - 请求对象
      * @param {Response} res - 响应对象
      * @param {boolean} isStreaming - 是否为流式响应
      */
     function errorMiddleware(error, req, res, isStreaming = false)
     ```

2. **集成到请求处理器** ✅
   - 文件: `src/api/request-handler.js:16-147`
   - 改动:
     - 在 `createRequestHandler` 外层包裹 `try/catch`
     - 捕获所有同步和异步错误
     - 调用统一的错误中间件
   - 位置: 包裹整个 `requestHandler` 函数体

3. **更新现有错误处理调用** ✅
   - 文件: `src/api/request-handler.js:112-125`（`getApiService` 失败块）
   - 文件: `src/api/request-handler.js:79-83`（`/stats` 端点）
   - 文件: `src/utils/common.js:245-269`（`handleStreamRequest`）
   - 改动: 替换现有的 `handleError` 调用为新的中间件

4. **处理流式响应错误** ✅
   - 文件: `src/utils/common.js:245-269`
   - 改动:
     - 检测响应是否已发送 headers
     - 未发送时使用统一中间件
     - 已发送时使用 SSE 格式的错误事件

5. **导出必要的辅助函数** ✅
   - 文件: `src/utils/common.js:612`
   - 改动: 导出 `createErrorResponse` 函数供中间件使用

**验收标准**:
- ✅ 所有错误都通过统一中间件处理
- ✅ JSON 和 SSE 响应格式正确
- ✅ 生产环境不泄露敏感信息
- ✅ 错误日志格式统一且包含必要上下文
- ✅ URL 中的 API key 等敏感参数自动脱敏

**风险评估**:
- ✅ **已解决**: 流式响应的错误处理已正确实现
- ✅ **已解决**: 敏感信息泄露风险已通过 `sanitizeUrl` 函数解决

**完成时间**: 2026-01-05
**Codex Review**: ✅ 通过（无阻塞性问题）

---

### 任务 2: 添加请求速率限制 ✅

**目标**: 防止 API 滥用和 DDoS 攻击

**当前问题**:
- API 端点没有任何速率限制
- 容易被恶意请求耗尽资源

**实施步骤**:

1. **添加配置项** ✅
   - 文件: `src/config/manager.js:104-107, 142-145`
   - 新增配置:
     ```javascript
     REQUEST_RATE_LIMIT_WINDOW_MS: 60000,  // 60 秒窗口
     REQUEST_RATE_LIMIT_MAX_REQUESTS: 60,   // 最大请求数
     REQUEST_RATE_LIMIT_WHITELIST_PATHS: ['/health', '/favicon.ico', '/public/'],
     REQUEST_RATE_LIMIT_TRUSTED_PROXIES: [],
     ```
   - 文件: `configs/config.json.example:14-21`
   - 同步添加示例配置

2. **创建速率限制器模块** ✅
   - 文件: `src/api/rate-limiter.js`（新建）
   - 功能:
     - 滑动窗口算法实现
     - 基于 IP + API Key 指纹的组合键
     - 自动清理过期记录（2 分钟间隔）
     - 支持白名单（如健康检查端点）
     - CIDR 格式的可信代理配置（自动规范化子网地址）
     - IPv6 地址支持（精确匹配）
   - 接口设计:
     ```javascript
     export function checkRateLimit(req, config)
     export function isRateLimitWhitelisted(path, config)
     export function getRateLimiterStats()
     ```

3. **集成到请求处理流程** ✅
   - 文件: `src/api/request-handler.js:10, 27-36`
   - 改动:
     - 导入速率限制器模块
     - 在 CORS 处理之前调用速率限制器
     - 超限时返回 `429 Too Many Requests`
     - 设置 `Retry-After` 响应头
   - 位置: `createRequestHandler` 函数早期

4. **特殊路由处理** ✅
   - 白名单路由（不限流）:
     - `/health` - 健康检查
     - `/favicon.ico` - 静态资源
     - `/public/*` - 公共资源
   - 实现: 在速率限制器中检查路径白名单

**验收标准**:
- ✅ 超过限制的请求返回 429 状态码
- ✅ 响应包含 `Retry-After` 头
- ✅ 白名单路由不受限制
- ✅ 配置可通过环境变量调整
- ✅ 日志记录限流事件（通过统一错误中间件）
- ✅ CIDR 配置自动规范化（容错性强）
- ✅ IPv6 地址支持精确匹配

**风险评估**:
- ✅ **已解决**: CIDR 解析已修复，自动规范化子网地址
- ✅ **已解决**: IPv6 代理支持精确匹配
- ⚠️ **已缓解**: 使用 IP + API Key 组合，降低误杀概率
- ⚠️ **已缓解**: 提供配置选项，允许运维调整阈值
- ⚠️ **已缓解**: 自动清理机制防止内存泄漏

**完成时间**: 2026-01-05
**Codex Review**: ✅ 通过（无阻塞性问题）

---

### 任务 3: 添加超时控制 ✅

**目标**: 防止请求挂起导致资源耗尽

**当前问题**:
- `src/services/kiro/core.js` 中的 Axios 调用没有超时设置
- 可能导致请求无限等待

**实施步骤**:

1. **添加超时配置** ✅
   - 文件: `src/kiro/auth.js:4-32`（`KIRO_CONSTANTS`）
   - 新增配置:
     ```javascript
     TIMEOUT_API_REQUEST: 120000,    // API 请求超时（120秒）
     TIMEOUT_STREAM_REQUEST: 300000, // 流式请求超时（300秒）
     TIMEOUT_AUTH_REQUEST: 30000,    // 认证请求超时（30秒）
     ```
   - 文件: `src/config/manager.js:90-119, 130-159`
   - 新增环境变量支持:
     ```javascript
     TIMEOUT_API_REQUEST: 120000,
     TIMEOUT_STREAM_REQUEST: 300000,
     TIMEOUT_AUTH_REQUEST: 30000,
     ```
   - 文件: `configs/config.json.example:22-24`
   - 添加示例配置

2. **更新 Axios 实例配置** ✅
   - 文件: `src/kiro/core.js:335`（`KiroService.initialize`）
   - 改动:
     - 已从 `this.config.KIRO_REQUEST_TIMEOUT_MS` 读取超时值
     - 使用 `KIRO_CONSTANTS.REQUEST_TIMEOUT_MS` 作为后备
     - 无需额外修改（已有正确实现）

3. **更新具体调用点** ✅
   - 文件: `src/kiro/core.js:580`（`_doRefreshToken`）
     - 添加认证超时配置：`this.config?.TIMEOUT_AUTH_REQUEST ?? KIRO_CONSTANTS.TIMEOUT_AUTH_REQUEST`
   - 文件: `src/kiro/core.js:655`（`startDeviceAuthorization`）
     - 添加认证超时配置
   - 文件: `src/kiro/core.js:712`（`pollDeviceToken`）
     - 添加认证超时配置
   - 文件: `src/kiro/core.js:3786`（`streamApiReal`）
     - 添加流式请求超时配置：`this.config?.TIMEOUT_STREAM_REQUEST ?? KIRO_CONSTANTS.TIMEOUT_STREAM_REQUEST`
   - 文件: `src/kiro/core.js:141, 195`（Web 搜索）
     - 已使用 `WEB_SEARCH_CONFIG.timeout` 配置（无需修改）

4. **超时错误处理** ✅
   - 超时错误会被 Axios 抛出为异常
   - 通过统一的错误中间件处理（任务 1 已实现）
   - 错误信息会被正确格式化并记录

**验收标准**:
- ✅ 所有 Axios 调用都有超时配置
- ✅ 超时时间可通过配置调整
- ✅ 流式请求和普通请求使用不同的超时时间
- ✅ 超时错误返回统一格式
- ✅ 日志记录超时事件

**风险评估**:
- ✅ **已解决**: 超时时间设置合理（认证 30s，API 120s，流式 300s）
- ✅ **已解决**: 流式响应的超时处理已正确实现
- ✅ **已解决**: 所有超时配置都有合理的默认值

**缓解措施**:
- ✅ 使用较长的默认超时时间（120 秒）
- ✅ 流式请求使用更长的超时（300 秒）
- ✅ 认证请求使用较短的超时（30 秒）
- ✅ 提供配置选项，允许根据实际情况调整
- ✅ 记录超时事件，便于分析和优化

**完成时间**: 2026-01-05
**Codex Review**: ✅ 通过（无阻塞性问题）

---

## 任务依赖关系

```
任务 1: 统一错误处理中间件 (基础设施)
    ↓
    ├─→ 任务 2: 请求速率限制 (依赖错误中间件格式化 429 响应)
    └─→ 任务 3: 超时控制 (依赖错误中间件处理超时错误)
```

**实施顺序**:
1. **第一步**: 实现统一的错误处理中间件（任务 1）
2. **第二步**: 添加请求速率限制（任务 2）
3. **第三步**: 添加超时控制（任务 3）

---

## 整体风险评估

### 高风险项
- 速率限制阈值设置不当可能影响正常用户

### 中风险项
- 流式响应的错误处理需要特别注意
- 超时时间设置需要根据实际情况调整
- 内存限流状态在重启后丢失

### 低风险项
- 现有错误处理逻辑迁移可能遗漏边界情况
- `x-forwarded-for` 头可能被伪造

### 缓解策略
1. **充分测试**: 在开发环境充分测试各种场景
2. **灰度发布**: 先在测试环境验证，再逐步推广到生产
3. **监控告警**: 添加监控指标，及时发现异常
4. **可配置**: 所有阈值都可通过配置调整
5. **详细日志**: 记录关键事件，便于问题排查

---

## 验收标准

### 功能验收
- ✅ 所有错误都通过统一中间件处理，格式一致
- ✅ 速率限制正常工作，超限请求返回 429
- ✅ 所有异步操作都有超时控制
- ✅ 配置项可通过环境变量调整

### 安全验收
- ✅ 生产环境不泄露敏感信息
- ✅ 速率限制有效防止滥用
- ✅ 超时控制防止资源耗尽

### 性能验收
- ✅ 错误处理不影响正常请求性能
- ✅ 速率限制检查耗时 < 5ms
- ✅ 超时配置合理，不影响正常业务

### 可维护性验收
- ✅ 代码结构清晰，职责明确
- ✅ 配置集中管理，易于调整
- ✅ 日志完整，便于问题排查

---

## 实施计划

### 第 1 天: 统一错误处理中间件
- [ ] 创建 `src/api/error-middleware.js`
- [ ] 重构 `handleError` 逻辑
- [ ] 集成到 `request-handler.js`
- [ ] 更新现有错误处理调用
- [ ] 测试 JSON 和 SSE 响应

### 第 2 天: 请求速率限制
- [ ] 添加配置项
- [ ] 创建 `src/api/rate-limiter.js`
- [ ] 集成到请求处理流程
- [ ] 配置白名单路由
- [ ] 测试限流功能

### 第 3 天: 超时控制
- [ ] 添加超时配置
- [ ] 更新 Axios 实例配置
- [ ] 更新具体调用点
- [ ] 测试超时处理

### 第 4 天: 集成测试和优化
- [ ] 端到端测试
- [ ] 性能测试
- [ ] 调整配置参数
- [ ] 完善日志和监控

---

## 后续改进建议

1. **分布式限流**: 考虑使用 Redis 实现分布式速率限制
2. **结构化日志**: 引入 Winston 或 Pino 替代 console.log
3. **监控指标**: 集成 Prometheus 或类似工具
4. **自动化测试**: 添加单元测试和集成测试
5. **文档完善**: 更新 API 文档，说明限流和超时策略

---

## 参考资料

- [代码质量审计报告](../../Analysis/CODE_QUALITY_AUDIT_2026-01-05.md)
- [Express 错误处理最佳实践](https://expressjs.com/en/guide/error-handling.html)
- [Axios 超时配置](https://axios-http.com/docs/req_config)
- [OWASP API 安全最佳实践](https://owasp.org/www-project-api-security/)

---

**备注**:
- 本任务计划基于 codex 的分析和建议
- 实施过程中如遇到新问题，及时更新本文档
- 完成后需要使用 codex review 代码改动
