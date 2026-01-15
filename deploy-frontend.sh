#!/bin/bash

# 前端自动部署脚本（Vue/Vite）
# 功能：编译前端 -> 复制到 static 目录 -> 重启服务

set -e

echo "=========================================="
echo "🚀 开始前端部署流程"
echo "=========================================="

# 1. 进入前端目录并编译
echo ""
echo "📦 步骤 1/3: 编译前端..."
cd frontend-vue
npm run build

# 2. 复制编译结果到 static 目录
echo ""
echo "📂 步骤 2/3: 复制文件到 static 目录..."
cd ..

# 删除旧的 static 目录内容（保留目录本身）
if [ -d "static" ]; then
    echo "   清理旧文件..."
    rm -rf static/*
else
    echo "   创建 static 目录..."
    mkdir -p static
fi

# 复制新的编译结果
echo "   复制新文件..."
cp -r frontend-vue/dist/* static/
echo "   ✅ 文件复制完成"

# 3. 重启服务
echo ""
echo "🔄 步骤 3/3: 重启服务..."

# 检查是否使用 PM2
if command -v pm2 &> /dev/null && pm2 list | grep -q "kiro2api"; then
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
echo "   - 文件数量: $(find static -type f | wc -l | xargs)"
echo ""
