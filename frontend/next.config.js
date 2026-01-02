/** @type {import('next').NextConfig} */
const nextConfig = {
  // 禁用 swc 的压缩（JS 最小化）以保留可读性
  swcMinify: false,

  // 在生产构建中生成浏览器 source maps，便于调试（可选）
  productionBrowserSourceMaps: true,

  // 额外确保在 webpack 层面关闭所有 minimize（用于更严格的场景）
  webpack: (config, { dev }) => {
    if (!dev) {
      config.optimization = config.optimization || {};
      config.optimization.minimize = false;
      config.optimization.minimizer = [];
    }
    return config;
  },

  // 开发环境下代理 API 请求到后端 8045 端口
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8045/api/:path*',
      },
    ];
  },
  // 导出静态文件
  output: 'export',
  // 图片优化
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
