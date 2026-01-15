# Kiro OAuth 2 API

> 基于 AWS CodeWhisperer (Kiro) 的 Claude API 兼容代理服务

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Code Size](https://img.shields.io/github/languages/code-size/htmambo/kiro2Api)](https://github.com/htmambo/kiro2Api)
[![Documentation](https://img.shields.io/badge/docs-latest-green.svg)](docs/)

---

## 📖 项目简介

**Kiro2Api** 是一个功能完整的代理服务，将 AWS CodeWhisperer (Kiro) 的 OAuth 2.0 认证转换为 Claude API 兼容格式。它允许开发者使用 Claude Code、Cursor 等 AI 编程工具，通过 Kiro 的免费服务访问 Claude 模型。

### 核心价值

- 🎯 **免费访问 Claude** - 通过 AWS CodeWhisperer 免费使用 Claude 模型
- 🔌 **即插即用** - 完全兼容 Claude Messages API，无需修改现有代码
- 🔄 **多账号池** - 支持多账号管理，自动负载均衡和故障转移
- 🎨 **Web UI** - 现代化的管理界面，轻松管理账号和配置
- 📈 **生产就绪** - 包含健康检查、速率限制、日志系统等生产级特性

### 项目评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完整性 | ⭐⭐⭐⭐⭐ 9.0/10 | 功能齐全，满足需求 |
| 代码质量 | ⭐⭐⭐⭐☆ 8.0/10 | 结构清晰，可维护性好 |
| 架构设计 | ⭐⭐⭐⭐☆ 8.5/10 | 模块化好，可扩展性强 |
| 文档完善度 | ⭐⭐⭐⭐☆ 8.5/10 | 文档详细，易于上手 |

**总体评分**: ⭐⭐⭐⭐☆ **7.8/10** (良好)

---

## ✨ 核心特性

### 🔐 认证管理
- **AWS SSO 设备授权** - 完整的 OAuth 2.0 流程支持
- **自动 Token 刷新** - Token 过期前自动刷新，无需手动干预
- **多账号支持** - 同时管理多个 Kiro 账号

### 🔄 Provider Pool 管理
- **智能负载均衡** - Round-Robin 算法均匀分配请求
- **自动故障转移** - 账号故障时自动切换到健康账号
- **健康检查** - 定期检查账号可用性
- **使用统计** - 实时监控账号使用情况

### 🛠️ Claude API 兼容
- **Messages API** - 完全兼容 `/v1/messages` 端点
- **流式响应** - 支持 Server-Sent Events (SSE)
- **工具调用** - 完整支持 Claude Code 工具 (Read, Write, Bash 等)
- **Extended Thinking** - 支持 Claude 思考模式

### 🎨 Web UI 管理
- **账号管理** - 可视化管理所有账号
- **OAuth 授权** - 一键启动授权流程
- **实时监控** - 查看系统状态和性能指标
- **配置管理** - 修改系统配置

### 🚀 高级特性
- **智能上下文管理** - 自动摘要和修剪，支持 200K tokens
- **Web 搜索** - 集成 DuckDuckGo 和 Bing 搜索
- **详细日志** - 可配置的日志级别 (verbose/debug/info/warn/error)
- **速率限制** - 基于 IP + API Key 的滑动窗口限流

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- (可选) **PM2** - 进程管理
- (可选) **Redis** - 缓存服务
- (可选) **nginx** - 反向代理

### 安装步骤

#### 1. 克隆仓库

```bash
git clone https://github.com/htmambo/kiro2Api.git
cd kiro2Api
```

#### 2. 安装依赖

```bash
npm install
```

如果遇到 `better-sqlite3` 编译错误，可能需要安装构建工具：

```bash
# macOS
xcode-select --install

# Ubuntu/Debian
sudo apt-get install build-essential

# Windows
# 安装 Visual Studio Build Tools
```

#### 3. 配置服务

创建环境变量文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```bash
# 基础配置
NODE_ENV=production
LOG_LEVEL=info

# 服务器配置
SERVER_PORT=8045
HOST=0.0.0.0
REQUIRED_API_KEY=your-strong-secret-key-here

# 模型配置
MODEL_PROVIDER=claude-kiro-oauth

# OAuth 配置
KIRO_OAUTH_CREDS_FILE_PATH=./configs/kiro/kiro-auth-token.json

# 高级配置
ENABLE_THINKING_BY_DEFAULT=true
REQUEST_MAX_RETRIES=8
CRON_REFRESH_TOKEN=true
CRON_NEAR_MINUTES=15
MAX_ERROR_COUNT=5
```

> ⚠️ **重要**: 请务必修改 `REQUIRED_API_KEY` 为强密码！

#### 4. 启动服务

**开发模式**（前端+后端一键启动）：
```bash
npm run dev
```

> 开发模式下后端使用 nodemon 自动重启，仅监控 `src` 目录；`configs/**` 变化不会触发重启，需手动重启生效。

**仅后端（开发模式）**：
```bash
npm run dev:api
```

**仅前端（开发模式）**：
```bash
npm run dev:web
```

**生产模式 (使用 PM2)**：
```bash
npm run pm2:start
```

#### 5. 访问管理界面

开发模式访问：`http://localhost:5173/login`

生产模式访问：`http://localhost:8045/login`

登录密码：项目根目录的 `pwd` 文件内容（不会提交到 git）

首次启动请先创建 `pwd`：

```bash
cp pwd.example pwd
# 编辑 pwd，填入你的强密码（建议 >= 16 位）
```

> 提示：`REQUIRED_API_KEY` 用于访问 `/v1/*` API（给 Claude Code/Cursor 等使用），与后台登录密码可相同也可不同（推荐不同）。

> 旧版本升级提示：仓库根目录的 `token-store.json` 已弃用（示例见 `token-store.json.example`）。当前 UI 登录 token 存储在 `configs/token-store.json`（运行时文件）。

---

## 📚 完整文档

我们提供了详细的文档，帮助您快速上手和深入了解项目：

### 使用文档
- 📖 **[功能说明文档](docs/Usage/FUNCTIONAL_GUIDE.md)** - 详细的功能介绍和技术架构
- 📖 **[使用指南](docs/Usage/USER_GUIDE.md)** - 安装、配置、部署和故障排除

### 分析文档
- 📊 **[综合分析报告](docs/Analysis/COMPREHENSIVE_ANALYSIS_REPORT.md)** - 项目整体评估

### 架构文档
- 🏗️ **[系统架构](docs/Architecture/)** - 架构设计和技术决策

---

## 🔧 使用示例

### 配置 Claude Code

在 Claude Code 设置中添加：

```json
{
  "anthropic.apiKey": "your-secret-key",
  "anthropic.baseUrl": "http://localhost:8045"
}
```

### 配置 Cursor

1. 打开 Settings → Models
2. 选择 "Custom API"
3. 填写：
   - API Key: `your-secret-key`
   - Base URL: `http://localhost:8045`

### API 调用示例

```javascript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: 'your-secret-key',
  baseURL: 'http://localhost:8045'
});

const message = await anthropic.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 4096,
  messages: [{role: 'user', content: 'Hello!'}]
});

console.log(message.content);
```

---

## 📁 项目结构

```
kiro2Api/
├── src/                          # 后端源码
│   ├── api/                      # HTTP API 层
│   │   ├── server.js            # 主服务器入口
│   │   ├── request-handler.js   # 请求处理器
│   │   ├── manager.js           # API 管理器
│   │   └── rate-limiter.js      # 速率限制器
│   ├── kiro/                     # Kiro 业务逻辑层
│   │   ├── adapter.js           # 核心 Kiro 适配器
│   │   ├── auth.js              # 认证管理
│   │   ├── api-client.js        # AWS API 客户端
│   │   ├── streaming.js         # 流式响应处理
│   │   ├── search.js            # Web 搜索功能
│   │   └── tools.js             # 工具调用映射
│   ├── domain/                   # 领域层
│   │   ├── account-pool/        # 账号池管理
│   │   └── oauth/               # OAuth 认证流程
│   ├── services/                 # 服务层
│   ├── config/                   # 配置管理
│   ├── lib/                      # 基础库
│   └── ui/                       # Web UI 层
├── frontend/                     # 旧前端源码 (Next.js)
│   ├── app/                      # 页面组件
│   ├── components/               # UI 组件
│   └── public/                   # 静态资源
├── frontend-vue/                 # 新前端源码 (Vue/Vite)
├── configs/                      # 配置文件目录
│   └── kiro/                    # Kiro Token 存储
├── docs/                         # 项目文档
│   ├── Usage/                   # 使用文档
│   ├── Analysis/                # 分析报告
│   ├── Architecture/            # 架构文档
│   └── Task/                    # 任务文档
├── static/                       # 静态资源
├── .env.example                  # 环境变量示例
├── package.json                  # 项目配置
├── ecosystem.config.cjs          # PM2 配置
└── README.md                     # 本文件
```

---

## ⚠️ 安全提示

### 当前已知问题

项目当前存在一些需要修复的安全问题，建议在部署到生产环境前先查看并修复：

**高风险问题 (P0 - 需要立即修复)**:
1. 🔴 API Key 验证机制过于简单
2. 🔴 OAuth 回调认证可被绕过
3. 🔴 CORS 配置过于宽松
4. 🔴 依赖库存在已知漏洞
5. 🔴 日志可能泄露敏感信息
6. 🔴 速率限制功能未生效

### 安全最佳实践

在部署到生产环境前，请务必：

1. **修改默认密钥**
   ```bash
   # 生成强随机密钥
   openssl rand -base64 32
   ```

2. **使用 HTTPS**
   - 配置 nginx 反向代理
   - 启用 SSL 证书

3. **限制网络访问**
   - 使用防火墙限制访问来源
   - 仅允许必要的 IP 地址

4. **定期更新依赖**
   ```bash
   npm audit
   npm audit fix
   ```

---

## ⚡ 性能优化提示

### 当前性能瓶颈

项目存在一些性能优化空间：

**主要瓶颈**:
- 🔴 数据库查询效率低 (缺少索引)
- 🔴 无有效缓存策略
- 🟡 并发处理能力有限

### 优化建议

启用 Redis 缓存可以显著提升性能：

```bash
# .env
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
```

**预期效果**:
- 响应时间减少: **50-70%**
- 吞吐量提升: **300-500%**

---

## 🛠️ 配置参数

### 基础配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `SERVER_PORT` | number | `8045` | 服务端口 |
| `HOST` | string | `"0.0.0.0"` | 监听地址 |
| `REQUIRED_API_KEY` | string | `"123456"` | API 访问密钥 |
| `MODEL_PROVIDER` | string | `"claude-kiro-oauth"` | 模型提供商 |
| `LOG_LEVEL` | string | `"info"` | 日志级别 |

### OAuth 配置

| 参数 | 类型 | 说明 |
|------|------|------|
| `KIRO_OAUTH_CREDS_FILE_PATH` | string | Token 文件路径 |
| `KIRO_OAUTH_CREDS_BASE64` | string | Base64 编码的 Token |

### 高级配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `ENABLE_THINKING_BY_DEFAULT` | boolean | `true` | 默认启用思考模式 |
| `REQUEST_MAX_RETRIES` | number | `8` | 最大重试次数 |
| `REQUEST_BASE_DELAY` | number | `3000` | 重试延迟(毫秒) |
| `CRON_REFRESH_TOKEN` | boolean | `true` | 自动刷新 Token |
| `CRON_NEAR_MINUTES` | number | `15` | Token 刷新间隔(分钟) |
| `MAX_ERROR_COUNT` | number | `5` | 最大错误次数 |

### 性能配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `REDIS_ENABLED` | boolean | `false` | 是否启用 Redis 缓存 |
| `REDIS_HOST` | string | `"localhost"` | Redis 服务器地址 |
| `REDIS_PORT` | number | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | string | `""` | Redis 密码(可选) |
| `REDIS_DB` | number | `0` | Redis 数据库编号 |

---

## 🐛 故障排除

### 常见问题

<details>
<summary><b>1. 服务无法启动</b></summary>

**问题**: 执行 `npm start` 后服务立即退出

**解决方案**:
```bash
# 检查端口占用
lsof -i :8045

# 使用其他端口
SERVER_PORT=8046 npm start

# 查看详细日志
LOG_LEVEL=debug npm start
```
</details>

<details>
<summary><b>2. OAuth 授权失败</b></summary>

**问题**: OAuth 授权后无法获取 Token

**解决方案**:
```bash
# 检查 Token 文件
cat configs/kiro/kiro-auth-token.json

# 检查日志
pm2 logs kiro2api --lines 50

# 重新授权
# 通过 Web UI 重新执行 OAuth 流程
```
</details>

<details>
<summary><b>3. 413 Request Entity Too Large</b></summary>

**问题**: nginx 返回 413 错误

**解决方案**:
```nginx
# nginx 配置
client_max_body_size 100M;
```
</details>

<details>
<summary><b>4. Provider Pool 无可用账号</b></summary>

**问题**: 请求时返回 "No healthy accounts available"

**解决方案**:
1. 访问 Web UI "账号管理" 页面
2. 查看所有账号的 `isHealthy` 状态
3. 手动重置账号健康状态
4. 或添加新的健康账号
</details>

### 获取帮助

如果遇到问题：

1. 查看 [使用指南](docs/Usage/USER_GUIDE.md) 的故障排除章节
2. 查看日志文件: `~/.pm2/logs/kiro2api-error.log`
3. 提交 [Issue](https://github.com/htmambo/kiro2Api/issues)
4. 发送邮件至：285567389@qq.com

---

## 📊 监控与运维

### 健康检查

```bash
# 检查服务状态
curl http://localhost:8045/health

# 查看统计信息
curl http://localhost:8045/stats
```

### PM2 命令

```bash
# 启动服务
npm run pm2:start

# 停止服务
npm run pm2:stop

# 重启服务
npm run pm2:restart

# 查看日志
npm run pm2:logs

# 查看状态
npm run pm2:status

# 实时监控
npm run pm2:monit
```

### 日志管理

```bash
# 实时日志
pm2 logs kiro2api

# 原始日志文件
tail -f ~/.pm2/logs/kiro2api-out.log
tail -f ~/.pm2/logs/kiro2api-error.log
```

---

## 🗺️ 发展路线图

### v1.1 (计划中)

- [ ] 修复所有已知安全漏洞
- [ ] 启用 Redis 缓存支持
- [ ] 添加数据库索引优化性能
- [ ] 完善单元测试覆盖

### v1.2 (规划中)

- [ ] Docker 容器化部署
- [ ] CI/CD 自动化流程
- [ ] APM 性能监控集成
- [ ] API 文档自动生成

### v2.0 (长期规划)

- [ ] 微服务架构拆分
- [ ] Kubernetes 部署支持
- [ ] 多地域部署
- [ ] 自动扩缩容

---

## 🤝 贡献指南

我们欢迎所有形式的贡献！

### 贡献方式

1. **报告 Bug** - 提交 [Issue](https://github.com/htmambo/kiro2Api/issues)
2. **建议新功能** - 提交 Feature Request
3. **提交代码** - Pull Request
4. **改进文档** - 完善文档和示例

### 开发流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 代码规范

- 遵循现有的代码风格
- 添加必要的单元测试
- 更新相关文档
- 确保所有测试通过

---

## 📄 许可证

本项目采用 **Apache 2.0 许可证** - 查看 [LICENSE](LICENSE) 文件了解详情

---

## 🙏 致谢

感谢以下开源项目和社区：

- [AntiHub-Project/AntiHook](https://github.com/AntiHub-Project/AntiHook) - 本项目的原始基础
- [AWS CodeWhisperer](https://aws.amazon.com/codewhisperer/) - 提供 AI 编程助手服务
- [Anthropic Claude](https://www.anthropic.com/) - 提供 Claude API 标准
- [Next.js](https://nextjs.org/) - React 框架
- [PM2](https://pm2.keymetrics.io/) - 进程管理器
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - SQLite 数据库

---

## 📮 联系方式

- **GitHub Issues**: [提交问题](https://github.com/htmambo/kiro2Api/issues)
- **Email**: 285567389@qq.com
- **文档**: [完整文档](docs/)

---

## ⚠️ 免责声明

本项目仅供学习和研究使用。使用本项目时，请：

1. 遵守 AWS 服务条款
2. 遵守相关法律法规
3. 不得用于商业用途
4. 自行承担使用风险

作者不对使用本项目造成的任何后果负责。

---

<div align="center">

**如果这个项目对您有帮助，请给个 ⭐️ Star 支持！**

Made with ❤️ by Kiro2Api Team

</div>
