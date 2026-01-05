# Token 刷新流程分析（Kiro OAuth vs AWS OIDC）

本文档基于代码静态分析，聚焦 Token 刷新流程：`refreshAccessTokenIfNeeded()` 的完整逻辑，以及 Kiro OAuth（social）与 AWS OIDC（IdC）两种认证方式差异。

---

## 1. 关键对象与字段

`KiroService` 实例内维护：

| 字段 | 说明 |
|---|---|
| `accessToken` | 上游 API Bearer token |
| `refreshToken` | 刷新用 token |
| `expiresAt` | ISO 时间字符串（用于判断是否接近过期） |
| `authMethod` | 认证方式：`social`（Kiro OAuth）或 `IdC`（AWS OIDC） |
| `clientId` / `clientSecret` | IdC 模式下刷新所需 |
| `region` | 用于拼接刷新 URL 与 API URL |

### 认证方式常量

- `social`（Kiro OAuth / Kiro Desktop Auth）
  - 常量：`KIRO_CONSTANTS.AUTH_METHOD_SOCIAL`
  - 代码位置：`src/core/claude-kiro.js:33`

- `IdC`（AWS OIDC / Builder ID）
  - 常量：`KIRO_CONSTANTS.AUTH_METHOD_IDC`
  - 代码位置：`src/core/claude-kiro.js:34`

### 相关 URL 常量

- **Kiro OAuth refresh**：`https://prod.{region}.auth.desktop.kiro.dev/refreshToken`
  - 代码位置：`src/core/claude-kiro.js:20`

- **AWS OIDC token**：`https://oidc.{region}.amazonaws.com/token`
  - 代码位置：`src/core/claude-kiro.js:21`

---

## 2. initializeAuth()：凭据加载与 URL 派生

`initializeAuth(forceRefresh=false)` 做两件关键事：

1. 从 Base64 或 creds 文件加载凭据（accessToken/refreshToken/clientId/clientSecret/authMethod/expiresAt/profileArn/region…）
2. 基于 region 计算出 refreshUrl/refreshIDCUrl/baseUrl/amazonQUrl

### 2.1 Region 默认值与 URL 拼接

- region 若缺失，默认 `us-east-1`（仅用于 URL 拼接）
  - `src/core/claude-kiro.js:1004-1008`

- 拼接 URL：
  ```javascript
  this.refreshUrl = REFRESH_URL.replace("{{region}}", this.region)
  this.refreshIDCUrl = REFRESH_IDC_URL.replace("{{region}}", this.region)
  this.baseUrl = BASE_URL.replace("{{region}}", this.region)
  this.amazonQUrl = AMAZON_Q_URL.replace("{{region}}", this.region)
  ```
  - `src/core/claude-kiro.js:1010-1013`

### 2.2 触发刷新的条件

只有在以下条件触发刷新逻辑：
- `forceRefresh === true` **或**
- `(!this.accessToken && this.refreshToken)`（没有 accessToken 但有 refreshToken）

此时调用 `refreshAccessTokenIfNeeded()`
- `src/core/claude-kiro.js:1018-1021`

若最终仍无 accessToken：抛错
- `src/core/claude-kiro.js:1023-1025`

---

## 3. refreshAccessTokenIfNeeded()：完整刷新判定与防抖/并发控制

函数入口：`src/core/claude-kiro.js:1032`

### 3.1 前置条件

若缺少 `refreshToken`：直接抛错 `"No refresh token available"`
- `src/core/claude-kiro.js:1033-1035`

### 3.2 per-refreshToken 的并发去重与防抖

使用全局 map（按 refreshToken 维度）保存状态：
```javascript
refreshTokenDebounceMap.get(this.refreshToken)
```

state 结构：
```javascript
{
  lastAttemptTime: Date,
  promise: Promise|null
}
```
- `src/core/claude-kiro.js:1037-1042`

**并发控制**（官方 AWS SDK 行为仿制）：
- 如果 `debounceState.promise` 存在，说明该 refreshToken 正在刷新：
  - 直接 await 并返回（复用同一个刷新 promise）
  - `src/core/claude-kiro.js:1044-1048`

### 3.3 过期窗口判断（5分钟）

使用 `expiresAt` 来判断是否需要刷新：
```javascript
expiresAt = new Date(this.expiresAt).getTime()
timeUntilExpiry = expiresAt - Date.now()
```

若 `timeUntilExpiry > EXPIRE_WINDOW_MS`（5分钟）：
- 直接 return（不刷新）
- `src/core/claude-kiro.js:1050-1060`

### 3.4 30秒防抖与"已过期"的特殊处理

计算距离上次尝试刷新时间：
```javascript
timeSinceLastRefresh = now - lastAttemptTime
```

若 `< REFRESH_DEBOUNCE_MS`（30秒）：
- 打日志并 return
- 但如果此时 token 已经 `timeUntilExpiry <= 0`（已过期）：
  - 抛出 `Token is expired. Please refresh SSO session.`
- `src/core/claude-kiro.js:1062-1071`

### 3.5 触发实际刷新

- 设置 `lastAttemptTime = now`
  - `src/core/claude-kiro.js:1073-1074`

- `debounceState.promise = this._doRefreshToken()` 并 await
  - `src/core/claude-kiro.js:1076-1083`

- finally 清空 `debounceState.promise`，允许下次刷新

---

## 4. _doRefreshToken()：两种认证方式的差异

函数入口：`src/core/claude-kiro.js:1089`

它做的事情是：选择 refresh URL + 组装 request body + POST + 解析响应 + 更新本地 token + 写回文件。

### 4.1 URL 与请求参数

**共有字段**
```javascript
requestBody.refreshToken = this.refreshToken
```
- `src/core/claude-kiro.js:1095-1097`

**分支差异**

| authMethod | refreshUrl | requestBody 附加字段 | 代码位置 |
|---|---|---|---|
| `social`（Kiro OAuth） | `this.refreshUrl`<br>（`prod.{region}.auth.desktop.kiro.dev/refreshToken`） | 无额外字段（只传 refreshToken） | `src/core/claude-kiro.js:1099-1105`（走 else 分支） |
| 非 `social`（即 IdC / AWS OIDC） | `this.refreshIDCUrl`<br>（`oidc.{region}.amazonaws.com/token`） | `clientId`, `clientSecret`, `grantType: 'refresh_token'` | `src/core/claude-kiro.js:1100-1105` |

**实际请求发送**
```javascript
const response = await this.axiosInstance.post(refreshUrl, requestBody)
```
- `src/core/claude-kiro.js:1112`

### 4.2 响应处理与 expiresAt 计算

**成功条件**
- `response.data.accessToken` 存在，否则抛 `Invalid refresh response: Missing accessToken`
- `src/core/claude-kiro.js:1117-1152`

**写入字段**
```javascript
this.accessToken = response.data.accessToken
this.refreshToken = response.data.refreshToken || this.refreshToken
this.profileArn = response.data.profileArn || this.profileArn
```
- `src/core/claude-kiro.js:1117-1120`

**expiresAt 推导优先级**
1. 若 `response.data.expiresIn` 有值：`now + expiresIn * 1000`
2. 否则若 `response.data.expiresAt` 有值：直接使用
3. 否则：默认 1 小时

代码位置：`src/core/claude-kiro.js:1122-1134`

**写回文件**（重要：持久化 token）
- 文件路径：`this.credsFilePath || path.join(this.credPath, KIRO_AUTH_TOKEN_FILE)`
- 写回字段：`accessToken/refreshToken/expiresAt`，以及可选 `profileArn`
- `src/core/claude-kiro.js:1139-1149`

**失败处理**
- catch 后抛 `Token refresh failed: ...`
- `src/core/claude-kiro.js:1153-1156`

---

## 5. Token 过期判断逻辑（两套）

本项目里有两套"接近过期/需要刷新"的逻辑：

### 5.1 请求前刷新（5分钟窗口 + 30秒防抖）

`refreshAccessTokenIfNeeded()`
- **5分钟窗口**：`KIRO_CONSTANTS.EXPIRE_WINDOW_MS = 5min`
  - 常量定义：`src/core/claude-kiro.js:37`
- **防抖**：`KIRO_CONSTANTS.REFRESH_DEBOUNCE_MS = 30s`
  - 常量定义：`src/core/claude-kiro.js:38`
- **使用字段**：`this.expiresAt`
- 代码：`src/core/claude-kiro.js:1032-1084`

### 5.2 定时/心跳刷新（CRON_NEAR_MINUTES 窗口）

`checkToken()` + `isExpiryDateNear()`

- `isExpiryDateNear()` 判断 `expiresAt <= now + CRON_NEAR_MINUTES`（默认 10min）
  - `src/core/claude-kiro.js:5479-5492`

- `checkToken()` 若 near 则调用 `initializeAuth(true)` 强制刷新
  - `src/core/claude-kiro.js:821-826`

> 结论：请求路径更偏向 "临近 5min 才刷新"，而心跳/cron 更偏向 "临近 N 分钟（默认 10）就刷新"。两者都依赖 `expiresAt`。

---

## 6. AWS OIDC（IdC）认证方式补充：设备授权获取初始 token

虽然本文档聚焦刷新，但代码中也包含 IdC 模式的"获取 token"流程，用于解释 IdC 体系与 social 的不同来源：

### 6.1 启动设备授权

`startDeviceAuthorization(startUrl)`
- **URL**：`DEVICE_AUTH_URL = https://oidc.{region}.amazonaws.com/device_authorization`
- **body**：`{ clientId, clientSecret, startUrl }`
- 代码位置：`src/core/claude-kiro.js:1166-1211`

### 6.2 轮询换取 token

`pollDeviceToken(deviceCode, interval, expiresIn)`
- **URL**：`tokenUrl = https://oidc.{region}.amazonaws.com/token`（同 refreshIDCUrl）
- **body**：`{ clientId, clientSecret, deviceCode, grantType: DEVICE_GRANT_TYPE }`
- 成功后写入 token 文件，并明确写 `authMethod: AUTH_METHOD_IDC`
- 代码位置：`src/core/claude-kiro.js:1223-1323`

这也解释了为什么 IdC 刷新必须携带 `clientId/clientSecret/grantType`：它遵循 AWS OIDC token endpoint 的规范，而 social 模式走的是 Kiro Desktop 的 refreshToken endpoint（仅 refreshToken）。

---

## 7. 两种认证方式对比总结

| 特性 | Kiro OAuth (social) | AWS OIDC (IdC) |
|---|---|---|
| **认证方式** | Kiro Desktop OAuth | AWS Builder ID / OIDC |
| **刷新 URL** | `prod.{region}.auth.desktop.kiro.dev/refreshToken` | `oidc.{region}.amazonaws.com/token` |
| **刷新请求参数** | `{ refreshToken }` | `{ refreshToken, clientId, clientSecret, grantType: 'refresh_token' }` |
| **初始授权方式** | 直接从凭据文件加载 | 设备授权流程（device code flow） |
| **authMethod 标识** | `social` | `IdC` |
| **是否需要 clientId/Secret** | 否 | 是 |

---

## 8. Token 刷新流程图

```
请求到达
    ↓
callApi() / streamApiReal()
    ↓
refreshAccessTokenIfNeeded()
    ↓
检查 refreshToken 是否存在 ──→ 否 ──→ 抛错
    ↓ 是
检查是否有正在进行的刷新 ──→ 是 ──→ 等待并复用
    ↓ 否
检查距离过期时间 > 5分钟 ──→ 是 ──→ 跳过刷新
    ↓ 否
检查距离上次刷新 < 30秒 ──→ 是 ──→ 跳过刷新（或抛错如果已过期）
    ↓ 否
_doRefreshToken()
    ↓
根据 authMethod 选择 URL 和参数
    ↓
POST 请求到刷新端点
    ↓
解析响应，更新 accessToken/refreshToken/expiresAt
    ↓
写回凭据文件
    ↓
返回成功
```

---

## 参考索引（快速定位）

- initializeAuth / URL 派生：`src/core/claude-kiro.js:937`, `src/core/claude-kiro.js:1010`
- refreshAccessTokenIfNeeded：`src/core/claude-kiro.js:1032`
- _doRefreshToken（social vs IdC）：`src/core/claude-kiro.js:1089`, `src/core/claude-kiro.js:1100`, `src/core/claude-kiro.js:1112`
- isExpiryDateNear / checkToken：`src/core/claude-kiro.js:5479`, `src/core/claude-kiro.js:821`
- 设备授权流程：`src/core/claude-kiro.js:1166`, `src/core/claude-kiro.js:1223`
