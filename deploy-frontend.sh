#!/bin/bash

# 前端自动部署脚本（Vue/Vite）
# 功能：编译前端 -> 复制到 static 目录 -> 重启服务

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend-vue"
STATIC_DIR="$ROOT_DIR/static"

echo "=========================================="
echo "🚀 开始前端部署流程"
echo "=========================================="

echo ""
echo "📦 步骤 1/3: 编译前端..."
cd "$FRONTEND_DIR"
npm run build

echo ""
echo "📂 步骤 2/3: 复制文件到 static 目录..."
mkdir -p "$STATIC_DIR"

echo "   清理旧文件..."
find "$STATIC_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

echo "   复制新文件..."
cp -R "$FRONTEND_DIR/dist/." "$STATIC_DIR/"
echo "   ✅ 文件复制完成"

echo ""
echo "🔄 步骤 3/3: 重启服务..."
cd "$ROOT_DIR"

if command -v pm2 >/dev/null 2>&1 && pm2 list | grep -q "kiro2api"; then
    echo "   使用 PM2 重启..."
    npm run pm2:restart
    echo "   ✅ PM2 服务已重启"
else
    echo "   ⚠️  未检测到 PM2 进程"
    echo "   请手动重启服务: npm run dev 或 npm start"
fi

echo ""
echo "=========================================="
echo "✨ 前端部署完成！"
echo "=========================================="
echo ""
echo "📊 部署统计:"
echo "   - 编译输出: frontend-vue/dist/"
echo "   - 部署目录: static/"
echo "   - 文件数量: $(find "$STATIC_DIR" -type f | wc -l | xargs)"
echo ""
