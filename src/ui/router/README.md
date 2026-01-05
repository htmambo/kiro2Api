# UI 路由器迁移 - 快速开始指南

## ✅ 已完成的工作

### 1. 基础设施搭建 ✅

- ✅ 创建完整的目录结构 (`src/ui/router/`)
- ✅ 实现 Router 类核心代码
- ✅ 创建响应格式化工具 (`utils/response.js`)
- ✅ 创建认证中间件 (`middleware/auth.middleware.js`)

### 2. 路由模块创建 ✅

- ✅ 系统路由 (6 个端点)
- ✅ 账号路由 (11 个端点，包含正则路由)
- ✅ 配置路由 (4 个端点)
- ✅ 用量路由 (4 个端点)
- ✅ OAuth 路由 (4 个端点)
- ✅ 上传路由 (6 个端点)

**总计**: 35 个 API 端点已配置到路由器中

### 3. Handler 模块创建 ✅

- ✅ 系统 Handler (所有业务逻辑)
- ✅ 账号 Handler (所有 CRUD 操作)
- ✅ 配置 Handler (配置管理)
- ✅ 用量 Handler (用量查询)
- ✅ OAuth Handler (OAuth 流程)
- ✅ 上传 Handler (文件上传和管理)

### 4. 集成到 ui-manager.js ✅

- ✅ 添加路由器导入
- ✅ 添加特性开关 (`ROUTER_CONFIG`)
- ✅ 在 `handleUIApiRequests` 中集成路由器逻辑
- ✅ 保留原有 if-else 代码作为后备

---

## 🚀 如何启用新路由器

### 方式 1: 通过配置文件启用（推荐）

编辑 `src/ui-manager.js`，修改路由器配置：

```javascript
export const ROUTER_CONFIG = {
    USE_NEW_ROUTER: true,  // 改为 true 启用新路由器
    ENABLE_ROUTER_LOGGING: true // 启用路由日志（可选）
};
```

### 方式 2: 通过环境变量启用（未来扩展）

可以在启动脚本中设置：

```bash
export USE_NEW_ROUTER=true
node src/index.js
```

---

## 📋 验证路由器是否工作

### 1. 启用路由器后启动服务

```bash
npm start
```

### 2. 检查日志输出

启用路由器日志后，你应该看到类似的输出：

```
[Router] Router initialized with 35 routes
[Router] Matched: GET /api/health -> 健康检查接口（用于前端 token 验证）
[Router] Handler completed: GET /api/health
```

### 3. 测试 API 端点

使用 curl 或 Postman 测试：

```bash
# 测试健康检查（无需认证）
curl http://localhost:3000/api/health

# 测试系统信息（需要认证）
curl http://localhost:3000/api/system -H "Authorization: Bearer YOUR_TOKEN"

# 测试账号列表（需要认证）
curl http://localhost:3000/api/accounts -H "Authorization: Bearer YOUR_TOKEN"

# 测试正则路由（删除账号）
curl -X DELETE http://localhost:3000/api/accounts/UUID -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 🔍 故障排查

### 问题 1: 路由器不工作

**检查点**:
1. 确认 `ROUTER_CONFIG.USE_NEW_ROUTER` 已设置为 `true`
2. 检查日志是否有路由器相关的输出
3. 查看控制台是否有错误信息

**解决方案**:
```bash
# 启用路由器日志
export ROUTER_CONFIG.ENABLE_ROUTER_LOGGING=true
```

### 问题 2: 某些 API 返回 404

**原因**: 该路由可能还未迁移到路由器

**解决方案**:
1. 检查路由器日志：`[Router] No match found for: METHOD /path`
2. 如果看到 "No match found"，说明该路由还未实现
3. 可以临时关闭路由器特性开关使用原实现

### 问题 3: Handler 导入错误

**检查点**:
1. 确认所有 handler 文件都存在
2. 检查导入路径是否正确
3. 查看具体的错误堆栈信息

---

## 📊 当前状态

### 已迁移的路由 (35/50+)

| 模块 | 路由数 | 状态 |
|------|--------|------|
| 系统 (system) | 6 | ✅ 完成 |
| 账号 (account) | 11 | ✅ 完成 |
| 配置 (config) | 4 | ✅ 完成 |
| 用量 (usage) | 4 | ✅ 完成 |
| OAuth (oauth) | 4 | ⚠️ 部分完成* |
| 上传 (upload) | 6 | ⚠️ 部分完成* |

*注意：OAuth 和上传模块中的复杂功能（如手动导入、AWS SSO、文件上传）需要进一步完善，当前返回 501 状态码。

### 未迁移的路由 (~15)

这些路由仍在使用原 if-else 实现，路由器会自动降级到原逻辑。

---

## 🎯 下一步行动

### 1. 测试现有路由 (必需)

在完全切换到新路由器之前，请完整测试：

- [ ] 所有系统接口（健康检查、系统信息、日志）
- [ ] 所有账号管理功能（CRUD、健康检查）
- [ ] 配置管理功能
- [ ] 用量查询功能

### 2. 完善复杂 Handler (可选)

某些 Handler 当前返回 501，需要完善实现：

- [ ] OAuth 手动导入
- [ ] AWS SSO 设备授权
- [ ] 文件上传（需要集成 multer 中间件）

### 3. 完全切换到新路由器 (经过测试后)

```javascript
// src/ui-manager.js
export const ROUTER_CONFIG = {
    USE_NEW_ROUTER: true,
    ENABLE_ROUTER_LOGGING: false // 生产环境关闭
};
```

### 4. 清理旧代码 (可选且谨慎)

**⚠️ 警告**: 删除旧代码前请确保：
1. 新路由器已完整测试
2. 所有功能都正常工作
3. 已备份代码
4. 保留 Git 历史记录

```bash
# 提交当前代码
git add .
git commit -m "feat: 启用新的路由器架构"

# 然后可以逐步删除旧的 if-else 代码（655-2500 行）
```

---

## 📚 相关文档

- [迁移评估分析](../../../docs/Task/Active/UI_ROUTER_MIGRATION_ANALYSIS.md)
- [详细实施方案](../../../docs/Task/Active/UI_ROUTER_MIGRATION_PLAN.md)
- [模块化架构设计](../../../docs/Architecture/UI_ROUTER_MODULE_STRUCTURE.md)
- [示例代码](../../../examples/router/README.md)

---

## 💡 开发提示

### 添加新路由

1. 在对应的 routes 文件中添加路由配置：
```javascript
// routes/myfeature.routes.js
router.addRoute('GET', '/api/mydata', myHandlers.getData, {
    auth: true,
    description: '获取我的数据'
});
```

2. 在对应的 handlers 文件中实现业务逻辑：
```javascript
// handlers/myfeature.handlers.js
export async function getData({ res }) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: '...' }));
}
```

3. 在 router/index.js 中注册路由模块：
```javascript
import { setupMyFeatureRoutes } from './routes/myfeature.routes.js';

export function createRouter() {
    const router = new Router();
    setupMyFeatureRoutes(router);
    return router;
}
```

### 调试路由

启用路由器日志：
```javascript
export const ROUTER_CONFIG = {
    USE_NEW_ROUTER: true,
    ENABLE_ROUTER_LOGGING: true
};
```

日志输出示例：
```
[Router] Matched: GET /api/accounts -> 获取所有账号列表及统计信息
[Router] Handler completed: GET /api/accounts
```

---

## ⚠️ 重要提示

1. **渐进式迁移**: 当前实现支持新旧路由器并存，通过特性开关切换
2. **保持兼容性**: 所有 Handler 通过 import 调用原有函数，保持行为一致
3. **充分测试**: 完全切换前务必进行完整的功能测试
4. **保留回滚能力**: 随时可以通过 `USE_NEW_ROUTER: false` 回退到原实现

---

**文档版本**: 1.0
**最后更新**: 2026-01-05
**状态**: ✅ 基础迁移完成，待测试验证
