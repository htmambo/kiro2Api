# 凭据文件页面过滤修复计划

**状态**: 🔄 进行中 (开始时间: 2026-01-15)

## 问题描述

凭据文件管理页面（`/dashboard/credentials`）列出了太多不相关的文件，包括：
- `config.json` - 系统配置
- `config.json.example` - 示例配置
- `usage-cache.json` - 使用缓存
- `provider_pools.json` - 提供商池
- `account_pool.json` - 账户池
- `token-store.json` - Token 存储
- `fetch_system_prompt.txt` - 系统提示

## 期望行为

只列出真正的 OAuth 凭据文件，如 `configs/kiro/*.json`

## 根因分析

`scanConfigFiles` 函数扫描整个 `configs` 目录，仅根据扩展名过滤（`.json`, `.oauth`, `.creds`, `.key`, `.pem`, `.txt`），没有区分系统配置文件和凭据文件。

## 修复方案

采用"目录白名单 + 内容特征检测 + 已使用文件补偿"策略：

1. **目录白名单**：默认只扫描 `configs/kiro` 目录
2. **内容特征检测**：在 `analyzeOAuthFile` 中增加凭据特征识别
3. **已使用文件补偿**：把正在被引用的凭据文件补充进列表

## 任务分解

- [x] 1. 分析问题根因
- [x] 2. 修改 `scanConfigFiles` 函数，限制扫描目录为 `configs/kiro`
- [x] 3. 添加"已使用文件补偿"逻辑，兼容非 kiro 目录的凭据
- [x] 4. 使用 codex 审核代码改动
- [x] 5. 根据 codex 建议补充 `.p12/.pfx` 扩展名支持
- [ ] 6. 验证修复效果

## 相关文件

- `src/ui/router/handlers/upload.handlers.js`

## 验收标准

1. `/dashboard/credentials` 页面不再显示系统配置文件
2. 仅显示 `configs/kiro/` 下的凭据文件
3. 正在被引用的凭据文件仍然正常显示并标记为"已使用"
