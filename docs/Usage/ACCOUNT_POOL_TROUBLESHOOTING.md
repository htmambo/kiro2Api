# 账号池故障排查指南

## 概述

本指南提供账号池管理系统的常见问题诊断和解决方案。

---

## 诊断工具

### 1. 查看账号池状态

使用 `/stats` 端点获取实时状态:

```bash
curl http://localhost:8045/stats | jq '.'
```

返回信息包括:
- 总账号数、健康账号数、不健康账号数、禁用账号数
- 每个账号的��细状态
- 使用次数和错误次数

### 2. 查看启动日志

启动时会输出账号池配置信息:

```
========================================
[Account Pool] Account Pool Manager initialized
[Account Pool] Storage type: SQLite
[Account Pool] Storage path: data/provider_pool.db
[Account Pool] Total accounts: 10
========================================
```

### 3. 查看应用日志

根据日志级别查看相关日志:

```bash
# 查看所有日志
tail -f logs/app.log

# 过滤账号池相关日志
grep "Account Pool" logs/app.log

# 查看错误日志
grep "ERROR" logs/app.log
```

---

## 常见问题

### 问题 1: 启动时没有账号

**症状**:
```
[Account Pool] Total accounts: 0
```

**可能原因**:
1. JSON 文件或数据库不存在
2. JSON 文件格式错误
3. 配置文件路径错误

**诊断步骤**:

1. 检查配置文件路径:
```bash
# JSON 模式
ls -la configs/account_pool.json

# SQLite 模式
ls -la data/provider_pool.db
```

2. 验证 JSON 文件格式:
```bash
cat configs/account_pool.json | jq '.'
```

3. 检查配置文件中的路径设置:
```bash
grep "ACCOUNT_POOL_FILE_PATH\|SQLITE_DB_PATH" configs/config.json
```

**解决方案**:

- 确保 JSON 文件存在且格式正确
- 确保 SQLite 数据库文件存在
- 检查配置文件路径是否正确

---

### 问题 2: 所有账号都显示不健康

**症状**:
```json
{
  "stats": {
    "total": 10,
    "healthy": 0,
    "unhealthy": 10,
    "disabled": 0
  }
}
```

**可能原因**:
1. 网络连接问题
2. OAuth 凭证过期
3. `MAX_ERROR_COUNT` 设置过低
4. 健康检查失败

**诊断步骤**:

1. 查看账号详情:
```bash
curl http://localhost:8045/stats | jq '.accountPool.details.accounts[0]'
```

2. 查看错误消息:
```bash
curl http://localhost:8045/stats | jq '.accountPool.details.accounts[].lastErrorMessage'
```

3. 检查网络连接:
```bash
# 测试到 API 的连通性
curl -I https://api.anthropic.com
```

**解决方案**:

1. **重置账号健康状态**:
```bash
# 通过 UI 的重置按钮
# 或手动修改 JSON 文件,将所有账号的 isHealthy 改为 true
```

2. **增加错误容忍度**:
```json
{
  "MAX_ERROR_COUNT": 10
}
```

3. **刷新 OAuth 凭证**:
- 检查 `KIRO_OAUTH_CREDS_FILE_PATH` 指向的凭证文件
- 确保凭证没有过期

---

### 问题 3: 账号池不轮询/总是使用同一个账号

**症状**:
- 所有请求都使用同一个账号
- 某个账号的使用次数异常高

**可能原因**:
1. 其他账号都不健康
2. 其他账号都被禁用
3. 轮询索引没有更新

**诊断步骤**:

1. 检查账号健康状态:
```bash
curl http://localhost:8045/stats | jq '.accountPool.stats'
```

2. 检查禁用状态:
```bash
curl http://localhost:8045/stats | jq '.accountPool.details.accounts[] | select(.isDisabled == true)'
```

**解决方案**:

1. 启用更多账号:
```bash
# 通过 UI 启用账号
# 或修改 JSON 文件,将 isDisabled 改为 false
```

2. 重置不健康账号:
```bash
# 通过 UI 重置健康状态
```

3. 检查日志中的轮询逻辑:
```bash
grep "selectAccount" logs/app.log
```

---

### 问题 4: SQLite 模式下性能很差

**症状**:
- API 响应很慢
- 健康检查耗时很长

**可能原因**:
1. 并发设置过低
2. 数据库文件损坏
3. 磁盘 I/O 瓶颈

**诊断步骤**:

1. 检查并发配置:
```bash
grep "HEALTH_CHECK_CONCURRENCY\|USAGE_QUERY_CONCURRENCY" configs/config.json
```

2. 检查数据库文件大小:
```bash
ls -lh data/provider_pool.db
```

3. 检查磁盘 I/O:
```bash
iostat -x 1
```

**解决方案**:

1. **增加并发数**:
```json
{
  "HEALTH_CHECK_CONCURRENCY": 10,
  "USAGE_QUERY_CONCURRENCY": 20
}
```

2. **优化数据库**:
```bash
sqlite3 data/provider_pool.db "VACUUM;"
sqlite3 data/provider_pool.db "ANALYZE;"
```

3. **考虑使用内存数据库** (测试环境):
```json
{
  "SQLITE_DB_PATH": ":memory:"
}
```

---

### 问题 5: JSON 模式下数据丢失

**症状**:
- 重启后新增的账号消失
- 更改的状态没有保存

**可能原因**:
1. 文件写入权限问题
2. 防抖保存时间过长
3. 进程被强制杀死

**诊断步骤**:

1. 检查文件权限:
```bash
ls -la configs/account_pool.json
```

2. 检查保存配置:
```bash
grep "saveDebounceTime" configs/config.json
```

3. 查看保存日志:
```bash
grep "saveToFile\|Saving" logs/app.log
```

**解决方案**:

1. **修复文件权限**:
```bash
chmod 644 configs/account_pool.json
```

2. **调整防抖时间**:
```json
{
  "saveDebounceTime": 1000
}
```

3. **手动触发保存**:
```bash
# 通过 API 的重载功能
# 或直接调用 save 方法
```

---

### 问题 6: 切换存储类型后数据不同步

**症状**:
- 从 JSON 切换到 SQLite 后账号数量不对
- 从 SQLite 切换到 JSON 后状态丢失

**可能原因**:
1. 缓存未清除
2. 数据未正确迁移

**诊断步骤**:

1. 检查缓存:
```bash
grep "cached\|cache" logs/app.log
```

2. 对比数据源:
```bash
# JSON
cat configs/account_pool.json | jq '.accounts | length'

# SQLite
sqlite3 data/provider_pool.db "SELECT COUNT(*) FROM accounts;"
```

**解决方案**:

1. **清除缓存并重启**:
```bash
# 停止服务
# 删除缓存(如果有)
rm -rf /tmp/cache/*
# 重启服务
npm start
```

2. **重新执行迁移**:
- 参考[迁移指南](./ACCOUNT_POOL_MIGRATION_GUIDE.md)

---

### 问题 7: 健康检查总是失败

**症状**:
```
[Health Check] Account xxx failed: Error: Request timeout
```

**可能原因**:
1. 网络问题
2. 模型名称不正确
3. API 密钥无效
4. 超时时间太短

**诊断步骤**:

1. 检查网络:
```bash
ping api.anthropic.com
curl -I https://api.anthropic.com
```

2. 检查模型名称:
```bash
curl http://localhost:8045/stats | jq '.accountPool.details.accounts[].checkModelName'
```

3. 检查超时配置:
```bash
grep "KIRO_REQUEST_TIMEOUT" configs/config.json
```

**解决方案**:

1. **增加超时时间**:
```json
{
  "KIRO_REQUEST_TIMEOUT_MS": 180000,
  "KIRO_STREAM_TIMEOUT_MS": 240000
}
```

2. **检查模型名称**:
- 确保使用正确的模型名称
- 参考 Claude API 文档

3. **禁用某个账号的健康检查**:
```json
{
  "checkHealth": false
}
```

---

### 问题 8: /stats 端点返回错误

**症状**:
```json
{
  "error": "Failed to get stats: ..."
}
```

**可能原因**:
1. Store 实例不一致
2. 数据文件损坏
3. 权限问题

**诊断步骤**:

1. 检查 Store 实例:
```bash
grep "AccountStoreFactory\|AccountPoolService" logs/app.log
```

2. 检查数据文件完整性:
```bash
# JSON
cat configs/account_pool.json | jq '.'

# SQLite
sqlite3 data/provider_pool.db "PRAGMA integrity_check;"
```

**解决方案**:

1. **重启服务**:
```bash
# 清除缓存并重启
npm start
```

2. **修复数据文件**:
```bash
# 从备份恢复
cp configs/account_pool.json.backup configs/account_pool.json
```

3. **检查代码版本**:
```bash
git log --oneline -5
```

---

## 性能优化建议

### 1. 大规模账号池优化

如果账号数超过 100 个:

```json
{
  "USE_SQLITE_POOL": true,
  "HEALTH_CHECK_CONCURRENCY": 20,
  "USAGE_QUERY_CONCURRENCY": 30,
  "HEALTH_CHECK_INTERVAL": 300000
}
```

### 2. 减少健康检查频率

如果健康检查消耗过多资源:

```json
{
  "HEALTH_CHECK_INTERVAL": 600000
}
```

### 3. 使用 SQLite 索引

确保数据库有正确的索引:

```sql
CREATE INDEX IF NOT EXISTS idx_accounts_uuid ON accounts(uuid);
CREATE INDEX IF NOT EXISTS idx_accounts_healthy ON accounts(isHealthy);
CREATE INDEX IF NOT EXISTS idx_accounts_disabled ON accounts(isDisabled);
```

---

## 日志级别调整

如果需要更详细的日志进行诊断:

```json
{
  "LOG_LEVEL": "debug"
}
```

或在代码中:

```javascript
const service = createAccountPoolService(store, {
    logLevel: 'debug'
});
```

日志级别(从详细到简略):
- `verbose` - 最详细
- `debug` - 调试信息
- `info` - 一般信息(默认)
- `warn` - 警告
- `error` - 仅错误

---

## 获取帮助

如果以上方法都无法解决问题:

1. **收集诊断信息**:
   - 启动日志
   - `/stats` 端点输出
   - 配置文件(移除敏感信息)
   - 复现步骤

2. **查看相关文档**:
   - [迁移指南](./ACCOUNT_POOL_MIGRATION_GUIDE.md)
   - [任务计划](../Task/Active/ACCOUNT_POOL_STORAGE_ABSTRACTION.md)

3. **提交 Issue**:
   - 在 GitHub 仓库提交问题
   - 包含完整的诊断信息

---

## 预防性维护

### 定期备份

```bash
# JSON 模式
cp configs/account_pool.json backups/account_pool_$(date +%Y%m%d).json

# SQLite 模式
cp data/provider_pool.db backups/provider_pool_$(date +%Y%m%d).db
```

### 定期检查健康状态

```bash
# 每天检查一次
curl http://localhost:8045/stats | jq '.accountPool.stats'
```

### 监控日志

```bash
# 设置日志监控
tail -f logs/app.log | grep -E "ERROR|WARN"
```

---

## 快速参考

### 常用命令

| 操作 | 命令 |
|------|------|
| 查看状态 | `curl http://localhost:8045/stats \| jq .` |
| 查看日志 | `tail -f logs/app.log` |
| 重启服务 | `systemctl restart kiro2api` |
| 备份数据 | `cp configs/account_pool.json configs/account_pool.json.bak` |
| 检查数据库 | `sqlite3 data/provider_pool.db "PRAGMA integrity_check;"` |

### 配置文件位置

| 环境 | 配置文件 |
|------|---------|
| 开发 | `configs/config.json` |
| 生产 | `/etc/kiro2api/config.json` |
| Docker | `/app/configs/config.json` |

### 数据文件位置

| 存储类型 | 文件路径 |
|---------|---------|
| JSON | `configs/account_pool.json` |
| SQLite | `data/provider_pool.db` |

---

更新时间: 2026-01-06
