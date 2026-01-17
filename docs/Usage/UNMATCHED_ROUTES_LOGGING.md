# 未定义路由日志记录功能

## 功能概述

当请求访问未定义的路由时，系统可以将详细的请求信息记录到磁盘文件中，方便分析和调试。

## 配置方法

### 1. 通过环境变量配置（推荐）

在 `.env` 文件中添加或修改：

```bash
# 启用未定义路由日志记录
LOG_UNMATCHED_ROUTES=true

# 禁用未定义路由日志记录（默认）
LOG_UNMATCHED_ROUTES=false
```

### 2. 通过 config.json 配置

在 `configs/config.json` 中添加：

```json
{
  "LOG_UNMATCHED_ROUTES": true
}
```

**注意**：环境变量的优先级高于 config.json 配置。

## 日志文件位置

日志文件存储在：`logs/unmatched-routes/`

文件命名格式：`{timestamp}-{random}.txt`

例如：`1705478400000-123.txt`

## 日志内容

每个日志文件包含以下信息：

### 1. 请求信息
- **Time**: ISO 8601 格式的时间戳
- **Timestamp**: Unix 时间戳（毫秒）
- **Method**: HTTP 方法（GET/POST/PUT/DELETE 等）
- **URL**: 完整的请求 URL
- **Path**: 请求路径

### 2. 客户端信息
- **IP**: 客户端真实 IP 地址（支持代理）
- **User-Agent**: 浏览器/客户端标识
- **Referer**: 来源页面

### 3. 请求头
- 完整的 HTTP 请求头列表

### 4. 请求体
- **Content-Type**: 请求内容类型
- **Content-Length**: 请求体大小
- **Body**: 请求体内容

## 日志示例

```
=== Unmatched Route Request ===
Time: 2026-01-17T01:00:00.000Z
Timestamp: 1705478400000

--- Request Info ---
Method: POST
URL: /api/unknown-endpoint?key=value
Path: /api/unknown-endpoint

--- Client Info ---
IP: 192.168.1.100
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)
Referer: http://localhost:8045/dashboard

--- Headers ---
host: localhost:8045
content-type: application/json
content-length: 42
authorization: Bearer ***REDACTED***
user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)
accept: application/json

--- Request Body ---
Content-Type: application/json
Content-Length: 42
Body:
{"action":"test","data":"sample"}

=== End of Request ===
```

## 使用场景

### 1. 调试 API 路由问题
当客户端报告 404 错误时，可以通过日志查看实际请求的路径和参数。

### 2. 安全审计
记录所有未授权的访问尝试，发现潜在的安全威胁。

### 3. API 迁移
在 API 版本升级时，记录旧版本 API 的访问情况。

### 4. 监控爬虫行为
记录搜索引擎爬虫或恶意爬虫的访问路径。

## 测试功能

### 方法 1：使用 curl

```bash
# 启用日志记录
echo "LOG_UNMATCHED_ROUTES=true" >> .env

# 重启服务
npm run pm2:restart

# 发送测试请求
curl -X POST http://localhost:8045/test-unmatched-route \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'

# 查看日志文件
ls -lh logs/unmatched-routes/
cat logs/unmatched-routes/*.txt
```

### 方法 2：使用测试脚本

```bash
# 运行测试脚本
node test-unmatched-route.js

# 查看日志
cat logs/unmatched-routes/*.txt
```

## 性能影响

### 启用日志记录时
- **磁盘 I/O**: 每个未匹配请求会写入一个文件
- **内存占用**: 需要读取请求体（最大 10MB）
- **响应延迟**: 增加约 5-20ms（取决于磁盘性能）

### 建议
- **开发环境**: 可以启用，方便调试
- **生产环境**: 仅在需要时临时启用，避免磁盘空间耗尽
- **高流量环境**: 建议禁用或使用日志轮转

## 日志管理

### 清理旧日志

```bash
# 删除 7 天前的日志
find logs/unmatched-routes/ -name "*.txt" -mtime +7 -delete

# 删除所有日志
rm -rf logs/unmatched-routes/*.txt
```

### 日志轮转（可选）

可以使用 `logrotate` 或类似工具管理日志文件：

```bash
# /etc/logrotate.d/kiro2api-unmatched
/path/to/kiro2Api/logs/unmatched-routes/*.txt {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
}
```

## 安全注意事项

### 1. 敏感信息保护
- Authorization 头中的 token 会被自动脱敏
- 建议定期检查日志，确保没有泄露敏感信息

### 2. 磁盘空间监控
- 高流量环境下日志文件可能快速增长
- 建议设置磁盘空间告警

### 3. 访问权限
- 日志文件可能包含敏感信息
- 确保只有授权人员可以访问 `logs/unmatched-routes/` 目录

```bash
# 设置日志目录权限
chmod 700 logs/unmatched-routes/
```

## 故障排除

### 问题 1：日志文件未生成

**可能原因**：
- `LOG_UNMATCHED_ROUTES` 未设置为 `true`
- 日志目录权限不足
- 磁盘空间不足

**解决方法**：
```bash
# 检查配置
grep LOG_UNMATCHED_ROUTES .env

# 检查目录权限
ls -ld logs/unmatched-routes/

# 检查磁盘空间
df -h

# 手动创建目录
mkdir -p logs/unmatched-routes
chmod 755 logs/unmatched-routes
```

### 问题 2：日志内容不完整

**可能原因**：
- 请求体过大（超过 10MB）
- 请求体读取超时

**解决方法**：
- 检查 `REQUEST_MAX_BODY_BYTES` 配置
- 增加请求体读取超时时间

### 问题 3：日志文件过多

**解决方法**：
```bash
# 设置定时任务清理旧日志
crontab -e

# 添加以下行（每天凌晨 2 点清理 7 天前的日志）
0 2 * * * find /path/to/kiro2Api/logs/unmatched-routes/ -name "*.txt" -mtime +7 -delete
```

## 相关配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `LOG_UNMATCHED_ROUTES` | boolean | `false` | 是否启用未定义路由日志记录 |
| `REQUEST_MAX_BODY_BYTES` | number | `10485760` | 请求体最大大小（10MB） |

## 更新日志

- **2026-01-17**: 初始版本
  - 添加未定义路由日志记录功能
  - 支持环境变量配置
  - 记录客户端 IP、User-Agent 等详细信息
