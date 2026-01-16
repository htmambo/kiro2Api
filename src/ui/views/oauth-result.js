/**
 * OAuth 结果页面视图生成器。
 * 负责生成 OAuth 授权成功/失败的 HTML 页面，从 ui-manager.js 中分离以便维护。
 * @module ui/views/oauth-result
 */

/**
 * 生成 OAuth 结果页面 HTML。
 * @param {boolean} success - 是否成功。
 * @param {string} message - 提示消息。
 * @param {object | null} details - 详细信息（可选）。
 * @param {string} [details.provider] - 提供商名称。
 * @param {number} [details.accountNumber] - 账号编号。
 * @param {string} [details.tokenFile] - Token 文件名。
 * @returns {string} HTML 字符串。
 */
export function generateOAuthResultPage(success, message, details = null) {
    const iconColor = success ? '#10b981' : '#ef4444';
    const icon = success ? '✓' : '✗';
    const title = success ? '授权成功' : '授权失败';

    let detailsHtml = '';
    if (details) {
        // 仅在有详细信息时渲染附加卡片
        detailsHtml = `
            <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: left; max-width: 400px; margin: 0 auto 32px;">
                ${details.provider ? `<div style="color: #9ca3af; margin-bottom: 8px;">登录方式: <span style="color: #3b82f6; font-weight: 600;">${details.provider}</span></div>` : ''}
                ${details.accountNumber ? `<div style="color: #9ca3af; margin-bottom: 8px;">账号编号: <span style="color: #10b981; font-weight: 600;">#${details.accountNumber}</span></div>` : ''}
                ${details.tokenFile ? `<div style="color: #9ca3af; margin-bottom: 8px;">Token 文件: <code style="color: #f59e0b; background: rgba(245,158,11,0.1); padding: 2px 6px; border-radius: 4px;">${details.tokenFile}</code></div>` : ''}
                <div style="color: #9ca3af;">状态: <span style="color: #10b981;">已保存</span></div>
            </div>
        `;
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kiro OAuth - ${title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            min-height: 100vh;
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 40px;
            animation: fadeIn 0.5s ease-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, ${iconColor} 0%, ${iconColor}cc 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            box-shadow: 0 0 40px ${iconColor}66;
        }
        .icon span { font-size: 40px; }
        h1 { font-size: 32px; margin-bottom: 12px; }
        .message { color: #9ca3af; font-size: 18px; margin-bottom: 32px; max-width: 500px; }
        .btn {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 14px 32px;
            font-size: 16px;
            cursor: pointer;
            font-weight: 500;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
        }
        .hint { color: #6b7280; font-size: 14px; margin-top: 16px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon"><span>${icon}</span></div>
        <h1>${title}</h1>
        <p class="message">${message}</p>
        ${detailsHtml}
        <button class="btn" onclick="window.close()">关闭此页面</button>
        <p class="hint">此页面可以安全关闭</p>
    </div>
</body>
</html>`;
}

export default generateOAuthResultPage;
