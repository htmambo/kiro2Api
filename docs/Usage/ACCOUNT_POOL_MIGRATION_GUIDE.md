# 账号池存储迁移指南

## 概述

本指南说明如何在 JSON 文件存储和 SQLite 数据库存储之间迁移账号池数据。

---

## 从 JSON 迁移到 SQLite

### 步骤 1: 备份现有数据

在迁移之前,请务必备份现有的账号池配置文件:

```bash
cp configs/account_pool.json configs/account_pool.json.backup
```

### 步骤 2: 更新配置文件

编辑 `configs/config.json`,添加以下配置:

```json
{
  "USE_SQLITE_POOL": true,
  "SQLITE_DB_PATH": "data/provider_pool.db"
}
```

### 步骤 3: 创建数据目录

确保 SQLite 数据库的目录存在:

```bash
mkdir -p data
```

### 步骤 4: 重启服务

重启应用,系统会自动将现有的 JSON 数据导入到 SQLite:

```bash
npm start
```

### 步骤 5: 验证迁移

启动后,检查日志确认迁移成功:

```
[Account Pool] Account Pool Manager initialized
[Account Pool] Storage type: SQLite
[Account Pool] Storage path: data/provider_pool.db
[Account Pool] Total accounts: 10
```

访问 `/stats` 端点验证账号数据:

```bash
curl http://localhost:8045/stats
```

---

## 从 SQLite 迁移到 JSON

### 步骤 1: 备份数据库

```bash
cp data/provider_pool.db data/provider_pool.db.backup
```

### 步骤 2: 导出 SQLite 数据

使用内置的导出功能或手动查询:

```bash
# 方法 1: 通过 API 导出
curl http://localhost:8045/stats > account_pool_export.json

# 方法 2: 使用 sqlite3 命令
sqlite3 data/provider_pool.db "SELECT * FROM accounts;" > accounts.txt
```

### 步骤 3: 更新配置文件

编辑 `configs/config.json`:

```json
{
  "USE_SQLITE_POOL": false,
  "ACCOUNT_POOL_FILE_PATH": "configs/account_pool.json"
}
```

### 步骤 4: 创建 JSON 文件

根据导出的数据创建 `configs/account_pool.json`:

```json
{
  "accounts": [
    {
      "uuid": "account-uuid-1",
      "isHealthy": true,
      "isDisabled": false,
      "usageCount": 0,
      "errorCount": 0,
      "KIRO_OAUTH_CREDS_FILE_PATH": "/path/to/creds.json"
    }
  ]
}
```

### 步骤 5: 重启服务

```bash
npm start
```

---

## 配置参数说明

### JSON 存储模式

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `USE_SQLITE_POOL` | `false` | 禁用 SQLite,使用 JSON |
| `ACCOUNT_POOL_FILE_PATH` | `./configs/account_pool.json` | JSON 文件路径 |

### SQLite 存储模式

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `USE_SQLITE_POOL` | `true` | 启用 SQLite |
| `SQLITE_DB_PATH` | `data/provider_pool.db` | 数据库文件路径 |
| `HEALTH_CHECK_CONCURRENCY` | `5` | 健康检查并发数 |
| `USAGE_QUERY_CONCURRENCY` | `10` | 使用查询并发数 |

---

## 验证迁移结果

### 1. 检查账号数量

```bash
# 通过 API
curl http://localhost:8045/stats | jq '.accountPool.stats.total'

# 通过日志
# 查看启动日志中的 "Total accounts" 数量
```

### 2. 验证账号健康状态

```bash
curl http://localhost:8045/stats | jq '.accountPool.stats'
```

### 3. 测试账号选择

发起一个 API 请求,验证账号池是否正常工作:

```bash
curl -X POST http://localhost:8045/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

## 常见问题

### Q1: 迁移后账号数量不对?

**A**: 检查 JSON 文件格式是否正确,确保 `accounts` 数组包含所有账号。查看日志中的错误信息。

### Q2: SQLite 模式启动失败?

**A**: 确保 `data/` 目录存在且有写入权限:

```bash
mkdir -p data
chmod 755 data
```

### Q3: 如何在两种模式间快速切换?

**A**: 修改 `USE_SQLITE_POOL` 配置项后重启服务即可。系统会自动处理数据加载。

### Q4: 可以同时使用 JSON 和 SQLite 吗?

**A**: 不可以。一次只能使用一种存储模式。但可以保留两种格式的数据文件作为备份。

### Q5: 迁移后如何清理旧数据?

**A**: 确认新模式正常工作后,可以安全删除旧文件:

```bash
# 从 JSON 迁移到 SQLite 后
rm configs/account_pool.json.backup

# 从 SQLite 迁移到 JSON 后
rm data/provider_pool.db.backup
```

---

## 性能对比

### JSON 文件模式

**优点**:
- 简单直观,易于手动编辑
- 文件可以直接复制和备份
- 适合小规模部署(< 50 个账号)

**缺点**:
- 大账号池时文件加载较慢
- 并发读写可能有性能瓶颈
- 不支持复杂查询

### SQLite 数据库模式

**优点**:
- 支持大规模账号池(100+ 账号)
- 并发性能更好
- 支持事务和复杂查询
- 数据更安全(ACID 特性)

**缺点**:
- 需要 SQLite 知识才能直接查看数据
- 文件不可直接编辑

---

## 建议

- **小规模部署** (< 50 账号): 使用 JSON 模式,简单方便
- **大规模部署** (> 50 账号): 使用 SQLite 模式,性能更好
- **生产环境**: 建议使用 SQLite,并定期备份数据库文件

---

## 回滚步骤

如果迁移后出现问题,可以快速回滚:

### 从 SQLite 回滚到 JSON

```bash
# 1. 停止服务
# 2. 恢复配置
cp configs/config.json.backup configs/config.json
# 3. 恢复 JSON 数据
cp configs/account_pool.json.backup configs/account_pool.json
# 4. 重启服务
npm start
```

### 从 JSON 回滚到 SQLite

```bash
# 1. 停止服务
# 2. 恢复配置
cp configs/config.json.backup configs/config.json
# 3. 恢复数据库
cp data/provider_pool.db.backup data/provider_pool.db
# 4. 重启服务
npm start
```

---

## 技术支持

如果遇到问题,请查看:
1. 应用日志文件
2. `/stats` 端点的状态信息
3. 本项目的故障排查指南
