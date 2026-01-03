# Kiro2Api 项目技术分析文档

本目录包含对 Kiro2Api 项目的深度技术分析文档，涵盖架构、代理机制、数据流转、存储方案等核心技术细节。

---

## 📚 文档列表

### 1. [项目概览与代理机制](./v1-messages-proxy-analysis.md) (5.7KB)

**核心内容**：
- 项目整体功能：Claude API 兼容的代理服务
- `/v1/messages` 路由的完整请求流程
- 被代理端（AWS CodeWhisperer）请求详情
  - 请求 URL 构建规则
  - 请求头（Headers）配置
  - 请求体（Body）结构
- 关键代码位置索引
- 风险与注意事项

**适合阅读对象**：想要快速了解项目功能和架构的开发者

---

### 2. [字段映射与转换规则](./field-mapping-analysis.md) (16KB)

**核心内容**：
- Claude Messages API 到 AWS CodeWhisperer 的完整字段映射
- `buildCodewhispererRequest()` 函数详细分析
- 消息转换规则：
  - messages 数组的角色转换（user/assistant → history/currentMessage）
  - tools 定义的转换与过滤
  - system prompt 的注入策略
  - thinking 模式的启用机制
  - images 的处理流程
  - tool_use 和 tool_result 的转换逻辑
- 参数映射与反向映射（CC ↔ Kiro）

**适合阅读对象**：需要理解请求体转换细节、调试字段映射问题的开发者

---

### 3. [流式响应机制](./streaming-response-analysis.md) (14KB)

**核心内容**：
- AWS Event Stream 二进制协议解析
  - `parseAwsEventStreamMessage()` 实现细节
  - `parseAwsEventStreamBuffer()` 增量解析机制
- 流式响应的三段式转换链路：
  - 上游网络流 → AWS Event Stream 解析
  - 内部事件规范化 → Claude streaming chunks
  - SSE 包装输出
- 事件类型映射关系
- 流式错误处理与重试机制
- TTFT（首字时间）统计

**适合阅读对象**：需要理解流式响应实现、调试流式问题的开发者

---

### 4. [Token 刷新流程](./token-refresh-analysis.md) (10KB)

**核心内容**：
- Token 刷新的完整流程
- 两种认证方式对比：
  - Kiro OAuth (social)
  - AWS OIDC (IdC / Builder ID)
- 过期判断逻辑：
  - 5分钟窗口 + 30秒防抖
  - 定时心跳刷新（10分钟窗口）
- 并发控制与防抖机制
- 设备授权流程（IdC 模式）

**适合阅读对象**：需要理解认证机制、调试 Token 刷新问题的开发者

---

### 5. [JSON 文件存储问题分析](./json-storage-issues-analysis.md) (19KB)

**核心内容**：
- JSON 文件存储的位置和用途：
  - 配置文件（config.json）
  - Provider Pool（provider_pools.json）
  - OAuth 状态与 UI 会话
  - 凭据/Token 文件
- 文件读写操作的代码位置索引
- 潜在问题分析：
  - 并发读写冲突（lost update）
  - 文件损坏/不完整写入风险
  - 性能瓶颈（频繁读写、大文件）
  - 数据一致性问题
  - 多进程/多实例部署问题
- 改进建议（短期/中期/长期）

**适合阅读对象**：需要理解存储方案、评估生产部署风险的开发者和运维人员

---

### 6. [SQLite 实现分析](./sqlite-implementation-analysis.md) (15KB)

**核心内容**：
- SQLite 方案的架构设计与数据模型
  - 连接管理与 WAL 模式配置
  - 三张表设计（providers/usage_cache/health_check_history）
  - SQLiteProviderPoolManager 业务边界
- SQLite vs JSON 对比分析
- P0/P1/P2 级别问题清单：
  - P0：usage_cache 过期时间格式不一致、UI 更新同步缺失
  - P1：busy_timeout 缺失、error_count 非原子更新、维护任务未调度
  - P2：索引优化、单例路径固化
- 并发安全性分析（WAL 模式、多进程/多实例风险）
- 数据一致性分析（JSON ↔ SQLite 同步机制）
- 性能优化建议与改进路线图

**适合阅读对象**：需要理解 SQLite 实现细节、评估迁移方案、解决并发与一致性问题的开发者

---

## 🎯 快速导航

### 按使用场景

| 场景 | 推荐文档 |
|---|---|
| 了解项目整体架构 | [项目概览与代理机制](./v1-messages-proxy-analysis.md) |
| 调试请求体转换问题 | [字段映射与转换规则](./field-mapping-analysis.md) |
| 调试流式响应问题 | [流式响应机制](./streaming-response-analysis.md) |
| 调试认证/Token 问题 | [Token 刷新流程](./token-refresh-analysis.md) |
| 评估 JSON 存储风险 | [JSON 文件存储问题分析](./json-storage-issues-analysis.md) |
| 评估 SQLite 实现与迁移 | [SQLite 实现分析](./sqlite-implementation-analysis.md) |

### 按技术栈

| 技术点 | 相关文档 |
|---|---|
| HTTP 代理 | [项目概览](./v1-messages-proxy-analysis.md) |
| 数据转换 | [字段映射](./field-mapping-analysis.md) |
| 二进制协议 | [流式响应](./streaming-response-analysis.md) |
| OAuth 2.0 | [Token 刷新](./token-refresh-analysis.md) |
| JSON 文件存储 | [JSON 存储问题](./json-storage-issues-analysis.md) |
| SQLite 数据库 | [SQLite 实现分析](./sqlite-implementation-analysis.md) |

---

## ⚠️ 重要风险提示

### 1. 上游接口强耦合
- URL/headers/事件流解析都在模拟 Kiro 官方行为
- 上游变更会直接影响可用性
- 相关文档：[项目概览](./v1-messages-proxy-analysis.md)

### 2. 并发与数据一致性
- JSON 文件缺少文件锁和原子写
- SQLite 模式存在 P0 级别问题（缓存过期逻辑、UI 同步缺失）
- 多进程/多实例部署需要额外配置（busy_timeout、原子更新）
- **JSON 模式不建议在生产环境使用 PM2 cluster 模式**
- 相关文档：[JSON 存储问题](./json-storage-issues-analysis.md)、[SQLite 实现分析](./sqlite-implementation-analysis.md)

### 3. 鉴权语义分离
- 对外 API Key 与上游 OAuth token 是两套体系
- 误配置可能导致安全风险
- 相关文档：[项目概览](./v1-messages-proxy-analysis.md)

### 4. 流式重试限制
- 流式响应一旦开始，后续失败无法重试
- 只能返回流式错误
- 相关文档：[流式响应](./streaming-response-analysis.md)

---

## 📊 代码统计

| 指标 | 数值 |
|---|---|
| 核心代码文件 | `src/core/claude-kiro.js` (~5500 行) |
| 主要配置文件 | `configs/config.json`, `configs/provider_pools.json` |
| 存储方案 | 2 种（JSON 文件 / SQLite 数据库，可切换） |
| JSON 文件读写点 | 30+ 处 |
| SQLite 表数量 | 3 张（providers/usage_cache/health_check_history） |
| 流式事件类型 | 7 种（AWS） → 7 种（Claude） |
| 认证方式 | 2 种（Kiro OAuth / AWS OIDC） |

---

## 🔧 开发建议

### 调试技巧

1. **启用详细日志**：设置 `VERBOSE_LOGGING=true`
2. **查看请求体**：关注 `buildCodewhispererRequest` 的输出
3. **监控流式事件**：在 `streamApiReal` 中添加日志
4. **检查 Token 状态**：查看 `configs/kiro/kiro-auth-token.json`

### 代码导航

- **路由入口**：`src/api-manager.js:20`
- **请求转换**：`src/core/claude-kiro.js:2623`
- **流式解析**：`src/core/claude-kiro.js:4057`
- **Token 刷新**：`src/core/claude-kiro.js:1032`
- **配置加载**：`src/config-manager.js:55`

---

## 📝 文档维护

### 更新记录

- **2026-01-03**：初始版本，包含 6 个核心分析文档
  - 新增：SQLite 实现分析（架构、并发安全、一致性与性能）

### 贡献指南

如需更新文档：
1. 确保代码位置索引准确（使用行号）
2. 添加实际代码片段示例
3. 标注风险等级（高/中/低）
4. 更新本 README 的统计信息

---

## 🔗 相关资源

- **项目仓库**：当前目录的父级
- **配置目录**：`../configs/`
- **源代码目录**：`../src/`

---

**最后更新**：2026-01-03
**文档版本**：v1.0
**分析基于代码版本**：commit `40bb66d`
