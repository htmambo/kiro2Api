# Kiro2Api 使用指南

**版本**: 1.0.0
**更新日期**: 2026-01-08
**项目**: Kiro OAuth 2 API

---

## 📖 文档概述

本指南提供 Kiro2Api 的详细使用说明,包括安装部署、配置管理、日常操作��故障排除。通过本文档,您将能够快速上手并熟练使用 Kiro2Api。

---

## 🚀 快速开始

### 环境要求

**必需软件**:
- Node.js >= 18.0.0
- npm >= 9.0.0

**可选软件**:
- PM2 (生产环境推荐)
- Redis (缓存服务)
- nginx (反向代理)

**系统要求**:
- 操���系统: Linux / macOS / Windows
- 内存: 最小 512MB, 推荐 1GB
- 磁盘: 最小 100MB 可用空间
- 网络: 能够访问 AWS 服务

### 安装步骤

#### 1. 克隆仓库

```bash
git clone https://github.com/Lavender3533/kiro2Api.git
cd kiro2Api
```

#### 2. 安装依赖

```bash
npm install
```

**注意**:
- 如果遇到 `better-sqlite3` 编译错误,可能需要安装构建工具:
  - macOS: `xcode-select --install`
  - Ubuntu/Debian: `sudo apt-get install build-essential`
  - Windows: 安装 Visual Studio Build Tools

#### 3. 配置服务

**创建配置文件**:
```bash
cp .env.example .env
```

**编辑 .env 文件**:
```bash
# 基础配置
NODE_ENV=production
LOG_LEVEL=info

# 服务器配置
SERVER_PORT=8045
HOST=0.0.0.0
REQUIRED_API_KEY=your-secret-key

# 模型配置
MODEL_PROVIDER=claude-kiro-oauth

# 账号池配置
ACCOUNT_POOL_MODE=legacy

# 超时配置
KIRO_REQUEST_TIMEOUT_MS=120000
KIRO_STREAM_TIMEOUT_MS=180000
```

#### 4. 启动服务

**开发模式**:
```bash
npm start
```

**生产模式 (使用 PM2)**:
```bash
npm run pm2:start
```

#### 5. 验证服务

**检查健康状态**:
```bash
curl http://localhost:8045/health
```

**预期输出**:
```json
{
  "status": "ok",
  "timestamp": "2026-01-08T12:00:00.000Z"
}
```

#### 6. 访问管理界面

打开浏览器访问: `http://localhost:8045/login.html`

默认登录密码: `.env` 文件中的 `REQUIRED_API_KEY`

---

## 🔑 OAuth 认证配置

### 方法 1: 通过 Web UI (推荐)

#### 步骤 1: 登录管理界面

访问: `http://localhost:8045/login.html`

输入 API Key 登录

#### 步骤 2: 进入 OAuth 授权页面

点击左侧菜单 "OAuth 管理"

点击 "开始 Kiro OAuth 授权" 按钮

#### 步骤 3: 完成 AWS Builder ID 授权

1. 浏览器会打开 AWS 登录页面
2. 使用 AWS Builder ID 账号登录
3. 授权成功后会自动跳转回管理界面
4. Token 会自动保存到 `configs/kiro/` 目录

#### 步骤 4: 验证授权

在 OAuth 管理页面查看:
- ✅ Token 状态: "有效"
- ✅ 过期时间: 显示过期日期
- ✅ 账号信息: 显示授权账号

### 方法 2: 手动导入 Token

如果您已有 Kiro OAuth Token:

#### 步骤 1: 准备 Token 文件

创建 `configs/kiro/kiro-auth-token.json`:

```json
{
  "device_code": "your-device-code",
  "user_code": "your-user-code",
  "verification_uri": "https://...",
  "access_token": "your-access-token",
  "refresh_token": "your-refresh-token",
  "id_token": "your-id-token",
  "expires_at": 1234567890,
  "token_type": "Bearer"
}
```

#### 步骤 2: 放置文件

```bash
mkdir -p configs/kiro
cp your-token.json configs/kiro/kiro-auth-token.json
```

#### 步骤 3: 重启服务

```bash
npm run pm2:restart
```

### 多账号配置

#### 方法 1: 使用 Provider Pool

编辑 `configs/account_pool.json`:

```json
{
  "claude-kiro-oauth": [
    {
      "uuid": "account-1",
      "KIRO_OAUTH_CREDS_FILE_PATH": "./configs/kiro/token-1.json",
      "isHealthy": true
    },
    {
      "uuid": "account-2",
      "KIRO_OAUTH_CREDS_FILE_PATH": "./configs/kiro/token-2.json",
      "isHealthy": true
    }
  ]
}
```

#### 方法 2: 使用 Web UI

1. 访问 "账号管理" 页面
2. 点击 "添加账号"
3. 上传 Token 文件或完成 OAuth 授权
4. 系统自动添加到账号池

---

## 🔧 Claude Code 配置

### 方法 1: 通过配置文件

#### 步骤 1: 编辑 Claude Code 配置

打开 Claude Code 设置 (JSON 模式):

```json
{
  "anthropic.apiKey": "your-secret-key",
  "anthropic.baseUrl": "http://localhost:8045"
}
```

#### 步骤 2: 重启 Claude Code

关闭并重新打开 Claude Code

#### 步骤 3: 验证连接

在 Claude Code 中发送消息:
```
你好,请介绍一下你自己。
```

如果收到回复,说明配置成功!

### 方法 2: 通过环境变量

```bash
export ANTHROPIC_API_KEY="your-secret-key"
export ANTHROPIC_BASE_URL="http://localhost:8045"
```

启动 Claude Code

### 高级配置

**启用 Extended Thinking**:
在 Kiro2Api 的 `.env` 文件中:
```bash
ENABLE_THINKING_BY_DEFAULT=true
```

**自定义模型**:
```json
{
  "anthropic.model": "claude-sonnet-4-5-20250929"
}
```

---

## 🔧 Cursor 配置

### 配置步骤

#### 步骤 1: 打开 Cursor 设置

快捷键: `Cmd + ,` (macOS) 或 `Ctrl + ,` (Windows/Linux)

#### 步骤 2: 配置 Custom API

1. 滚动到 "Models" 部分
2. 点击 "Add Custom API Provider"
3. 填写配置:

```
Name: Kiro2Api
API Key: your-secret-key
Base URL: http://localhost:8045
```

#### 步骤 3: 选择模型

在模型下拉菜单中选择:
- `claude-sonnet-4-5-20250929` (推荐)
- `claude-opus-4-5`
- `claude-haiku-4-5`

#### 步骤 4: 测试连接

在 Cursor 中打开 AI Chat,发送测试消息:
```
你好,请介绍一下你自己。
```

### 高级功能

**使用工具调用**:
Cursor 会自动使用 Kiro2Api 的工具调用功能,支持:
- 读取文件
- 执行命令
- 编辑代码

**流式响应**:
Cursor 会自动使用流式响应,提供实时的 AI 输出体验。

---

## 🌐 公网部署

### 使用 nginx 反向代理

#### 步骤 1: 安装 nginx

```bash
# Ubuntu/Debian
sudo apt-get install nginx

# macOS
brew install nginx

# Windows
# 从 nginx.org 下载安装包
```

#### 步骤 2: 配置 SSL 证书 (可选但推荐)

**使用 Let's Encrypt**:
```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

#### 步骤 3: 配置 nginx

创建配置文件 `/etc/nginx/sites-available/kiro2api`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 如果有 SSL,重定向到 HTTPS
    # return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    # SSL 配置
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 增加上传大小限制
    client_max_body_size 100M;

    # 代理配置
    location / {
        proxy_pass http://127.0.0.1:8045;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时配置
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
```

#### 步骤 4: 启用配置

```bash
sudo ln -s /etc/nginx/sites-available/kiro2api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 步骤 5: 更新配置

修改 `.env` 文件:
```bash
HOST=127.0.0.1  # 仅监听本地
```

重启 Kiro2Api:
```bash
npm run pm2:restart
```

### 使用 Docker 部署 (推荐)

#### 创建 Dockerfile

```dockerfile
FROM node:18-alpine

# 安装构建工具
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制应用代码
COPY . .

# 暴露端口
EXPOSE 8045

# 启动应用
CMD ["node", "src/api/server.js"]
```

#### 创建 docker-compose.yml

```yaml
version: '3.8'

services:
  kiro2api:
    build: .
    container_name: kiro2api
    restart: unless-stopped
    ports:
      - "8045:8045"
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
      - SERVER_PORT=8045
      - HOST=0.0.0.0
      - REQUIRED_API_KEY=${REQUIRED_API_KEY}
    volumes:
      - ./configs:/app/configs
      - ./data:/app/data
    networks:
      - kiro2api-net

  # 可选: Redis 缓存
  redis:
    image: redis:7-alpine
    container_name: kiro2api-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    networks:
      - kiro2api-net

networks:
  kiro2api-net:
    driver: bridge
```

#### 启动服务

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

---

## 📊 日常运维

### 服务管理

#### PM2 命令

```bash
# 启动服务
npm run pm2:start

# 停止服务
npm run pm2:stop

# 重启服务
npm run pm2:restart

# 删除服务
npm run pm2:delete

# 查看日志
npm run pm2:logs

# 查看状态
npm run pm2:status

# 实时监控
npm run pm2:monit
```

#### 日志管理

**查看实时日志**:
```bash
# PM2 日志
pm2 logs kiro2api

# 原始日志文件
tail -f ~/.pm2/logs/kiro2api-out.log
tail -f ~/.pm2/logs/kiro2api-error.log
```

**日志轮转**:
```bash
# 安装 pm2-logrotate
pm2 install pm2-logrotate

# 配置日志轮转
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7
```

### 监控和诊断

#### 健康检查

```bash
# 检查服务状态
curl http://localhost:8045/health

# 检查统计信息
curl http://localhost:8045/stats
```

#### 性能监控

**使用 PM2 监控**:
```bash
pm2 monit
```

**自定义监控脚本**:
```bash
#!/bin/bash
# monitor.sh

while true; do
  echo "=== $(date) ==="
  curl -s http://localhost:8045/stats | jq '.'
  echo ""
  sleep 60
done
```

#### 账号健康检查

通过 Web UI 查看账号健康状态:
1. 访问 "账号管理" 页面
2. 查看每个账号的 `isHealthy` 状态
3. 查看错误计数和使用统计

手动触发健康检查:
```bash
curl -X POST http://localhost:8045/api/accounts/health-check \
  -H "Authorization: Bearer your-api-key"
```

### 数据备份

#### 备份配置文件

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/path/to/backups/kiro2api"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# 备份配置
tar -czf "$BACKUP_DIR/configs_$DATE.tar.gz" configs/

# 备份数据库 (如果使用 SQLite)
cp data/kiro2api.db "$BACKUP_DIR/kiro2api_$DATE.db"

# 删除 7 天前的备份
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete
find "$BACKUP_DIR" -name "*.db" -mtime +7 -delete

echo "Backup completed: $DATE"
```

#### 定时备份

使用 cron 定时任务:
```bash
# 编辑 crontab
crontab -e

# 添加定时任务 (每天凌晨 2 点备份)
0 2 * * * /path/to/backup.sh
```

---

## 🔍 故障排除

### 常见问题

#### 1. 服务无法启动

**问题**: 执行 `npm start` 后服务立即退出

**排查步骤**:
```bash
# 检查端口占用
lsof -i :8045

# 检查配置文件
cat .env

# 查看详细日志
LOG_LEVEL=debug npm start
```

**解决方案**:
- 修改 `SERVER_PORT` 使用其他端口
- 检查 `.env` 文件语法
- 确保所有依赖已正确安装

#### 2. OAuth 授权失败

**问题**: OAuth 授权后无法获取 Token

**排查步骤**:
```bash
# 检查 Token 文件
cat configs/kiro/kiro-auth-token.json

# 检查日志
pm2 logs kiro2api --lines 50
```

**解决方案**:
- 确保 AWS Builder ID 账号有效
- 检查网络连接
- 重新执行 OAuth 授权流程

#### 3. API 请求返回 401

**问题**: Claude Code 请求时返回 401 Unauthorized

**排查步骤**:
```bash
# 检查 API Key 配置
grep REQUIRED_API_KEY .env

# 测试认证
curl -H "x-api-key: your-api-key" http://localhost:8045/health
```

**解决方案**:
- 确保 Claude Code 中的 API Key 与 `.env` 中一致
- 检查 API Key 是否包含特殊字符
- 避免在 URL 中传递 API Key

#### 4. 账号池无可用账号

**问题**: 请求时返回 "No healthy accounts available"

**排查步骤**:
1. 访问 Web UI "账号管理" 页面
2. 查看所有账号的 `isHealthy` 状态
3. 查看错误计数

**解决方案**:
- 手动重置账号健康状态
- 删除失效账号
- 添加新账号
- 检查账号 Token 是否过期

#### 5. 响应缓慢

**问题**: API 响应时间过长

**排查步骤**:
```bash
# 检查系统资源
pm2 monit

# 检查网络连接
ping amazonaws.com

# 检查日志中的性能警告
grep "performance" ~/.pm2/logs/kiro2api-out.log
```

**解决方案**:
- 启用 Redis 缓存
- 增加 `REQUEST_TIMEOUT_MS`
- 使用更快的网络环境
- 检查 AWS 服务状态

#### 6. 内存泄漏

**问题**: 服务运行一段时间后内存持续增长

**排查步骤**:
```bash
# 监控内存使用
pm2 monit

# 查看内存趋势
watch -n 5 'pm2 jlist | jq ".[0].monit.memory"'
```

**解决方案**:
- 定期重启服务 (`pm2 restart kiro2api --watch`)
- 设置 PM2 内存限制:
```bash
pm2 start src/api/server.js --max-memory-restart 1G
```

### 日志分析

#### 查看错误日志

```bash
# 最近 100 行错误
grep -i "error" ~/.pm2/logs/kiro2api-error.log | tail -100

# 统计错误类型
grep -i "error" ~/.pm2/logs/kiro2api-error.log | awk '{print $5}' | sort | uniq -c
```

#### 查看请求日志

```bash
# 查看最近的 API 请求
grep "POST /v1/messages" ~/.pm2/logs/kiro2api-out.log | tail -20

# 统计请求数
grep "POST /v1/messages" ~/.pm2/logs/kiro2api-out.log | wc -l
```

---

## 🔐 安全最佳实践

### 1. 修改默认密钥

**���须修改**:
```bash
# 生成强随机密钥
openssl rand -base64 32

# 更新 .env 文件
REQUIRED_API_KEY=生成的强密钥
```

### 2. 限制网络访问

**使用防火墙**:
```bash
# Ubuntu/Debian (ufw)
sudo ufw allow from 127.0.0.1 to any port 8045
sudo ufw enable

# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="127.0.0.1" port port="8045" protocol="tcp" accept'
sudo firewall-cmd --reload
```

### 3. 启用 HTTPS

**生产环境必须使用 HTTPS**:

参考前面 "公网部署" 章节的 nginx SSL 配置

### 4. 定期更新依赖

```bash
# 检查过时的依赖
npm outdated

# 更新依赖
npm update

# 审计安全漏洞
npm audit

# 修复漏洞
npm audit fix
```

### 5. 文件权限

**设置严格的文件权限**:
```bash
# 配置文件
chmod 600 .env
chmod 600 configs/kiro/*.json

# 数据库
chmod 600 data/kiro2api.db
```

---

## 📚 附录

### A. 配置文件完整示例

**.env 文件**:
```bash
# ==========================================
# Kiro2Api 环境变量配置
# ==========================================

# 运行环境: development | production | test
NODE_ENV=production

# 日志级别: verbose | debug | info | warn | error
LOG_LEVEL=info

# 服务器配置
SERVER_PORT=8045
HOST=0.0.0.0
REQUIRED_API_KEY=your-strong-secret-key

# 模型配置
MODEL_PROVIDER=claude-kiro-oauth

# OAuth 配置
KIRO_OAUTH_CREDS_FILE_PATH=./configs/kiro/kiro-auth-token.json

# 账号池配置
ACCOUNT_POOL_MODE=legacy
ACCOUNT_POOL_FILE_PATH=configs/account_pool.json

# 超时配置 (毫秒)
KIRO_REQUEST_TIMEOUT_MS=120000
KIRO_STREAM_TIMEOUT_MS=180000

# 高级配置
ENABLE_THINKING_BY_DEFAULT=true
REQUEST_MAX_RETRIES=8
REQUEST_BASE_DELAY=3000
CRON_REFRESH_TOKEN=true
CRON_NEAR_MINUTES=15
MAX_ERROR_COUNT=5

# Redis 配置 (可选)
REDIS_ENABLED=false
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Web 搜索配置
WEB_SEARCH_ENGINE=duckduckgo
BING_API_KEY=
WEB_SEARCH_MAX_RESULTS=5
```

### B. PM2 配置文件

**ecosystem.config.cjs**:
```javascript
module.exports = {
  apps: [{
    name: 'kiro2api',
    script: 'src/api/server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info'
    },
    error_file: '~/.pm2/logs/kiro2api-error.log',
    out_file: '~/.pm2/logs/kiro2api-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
```

### C. 常用命令速查

```bash
# 服务管理
npm start                      # 启动服务 (开发模式)
npm run pm2:start             # 启动服务 (生产模式)
npm run pm2:stop              # 停止服务
npm run pm2:restart           # 重启服务
npm run pm2:delete            # 删除服务
npm run pm2:logs              # 查看日志
npm run pm2:status            # 查看状态
npm run pm2:monit             # 实时监控

# 测试
npm test                      # 运行测试
npm run test:coverage         # 测试覆盖率

# 部署
npm run deploy:frontend       # 部署前端

# 其他
npm run build                 # 构建项目
```

### D. 目录结构

```
kiro2Api/
├── src/                      # 源代码
│   ├── api/                  # API 服务层
│   ├── kiro/                 # Kiro 业务逻辑
│   ├── domain/               # 领域层
│   ├── services/             # 服务层
│   ├── config/               # 配置管理
│   ├── ui/                   # Web UI
│   └── lib/                  # 基础库
├── frontend/                 # 前端代码
├── configs/                  # 配置文件
│   └── kiro/                # Kiro Token
├── data/                     # 数据文件
│   └── kiro2api.db          # SQLite 数据库
├── static/                   # 静态资源
├── docs/                     # 文档
├── .env                      # 环境变量
├── package.json              # 项目配置
└── ecosystem.config.cjs      # PM2 配置
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-01-08
**维护者**: Kiro2Api 项目组
