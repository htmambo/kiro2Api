/**
 * Router 类 - 路由器核心实现
 *
 * 功能特性：
 * - 支持静态路径和正则路径匹配
 * - 支持路由元数据（认证、描述等）
 * - 自动提取路径参数
 * - 提供路由信息查询接口
 */

export class Router {
    constructor() {
        this.routes = [];
        this.middlewares = [];
    }

    /**
     * 注册路由
     * @param {string} method - HTTP 方法（GET、POST、DELETE 等）
     * @param {string|RegExp} path - 路由路径（支持字符串或正则表达式）
     * @param {Function} handler - 处理函数
     * @param {Object} options - 路由选项
     * @param {boolean} options.auth - 是否需要认证（默认 true）
     * @param {string} options.description - 路由描述
     * @param {Object} options.metadata - 额外的元数据
     * @returns {Router} 返回自身，支持链式调用
     */
    addRoute(method, path, handler, options = {}) {
        // 标准化路径（去除尾部斜杠）
        const normalizedPath = typeof path === 'string'
            ? path.replace(/\/+$/, '') || '/'
            : path;

        this.routes.push({
            method: method.toUpperCase(),
            path: normalizedPath,
            handler,
            auth: options.auth !== false, // 默认需要认证
            description: options.description || '',
            metadata: options.metadata || {}
        });

        return this; // 支持链式调用
    }

    /**
     * 注册全局中间件
     * @param {Function} middleware - 中间件函数
     * @returns {Router} 返回自身，支持链式调用
     */
    use(middleware) {
        this.middlewares.push(middleware);
        return this;
    }

    /**
     * 匹配路由
     * @param {string} method - HTTP 方法
     * @param {string} path - 请求路径
     * @returns {Object|null} 匹配结果
     *   - route: 路由配置对象
     *   - match: 正则匹配结果（仅正则路由）
     *   - params: 路径参数对象
     */
    match(method, path) {
        // 标准化请求路径
        const normalizedPath = path.replace(/\/+$/, '') || '/';

        for (const route of this.routes) {
            // 方法不匹配则跳过
            if (route.method !== method.toUpperCase()) continue;

            // 正则路径匹配
            if (route.path instanceof RegExp) {
                const match = normalizedPath.match(route.path);
                if (match) {
                    return {
                        route,
                        match,
                        params: this.extractParams(match)
                    };
                }
            }
            // 精确匹配
            else if (route.path === normalizedPath) {
                return {
                    route,
                    match: null,
                    params: {}
                };
            }
        }

        return null;
    }

    /**
     * 从正则匹配结果中提取参数
     * @param {Array} match - 正则匹配结果
     * @returns {Object} 参数对象
     */
    extractParams(match) {
        const params = {};
        // match[0] 是完整匹配，从 match[1] 开始是捕获组
        for (let i = 1; i < match.length; i++) {
            params[`param${i}`] = match[i];
        }
        return params;
    }

    /**
     * 获取所有路由信息（用于文档生成）
     * @returns {Array} 路由列表
     */
    getRoutes() {
        return this.routes.map(route => ({
            method: route.method,
            path: route.path instanceof RegExp ? route.path.toString() : route.path,
            auth: route.auth,
            description: route.description,
            metadata: route.metadata
        }));
    }

    /**
     * 根据方法获取路由
     * @param {string} method - HTTP 方法
     * @returns {Array} 路由列表
     */
    getRoutesByMethod(method) {
        return this.routes.filter(route =>
            route.method === method.toUpperCase()
        );
    }

    /**
     * 生成路由文档（Markdown 格式）
     * @returns {string} Markdown 格式的路由文档
     */
    generateMarkdownDoc() {
        let doc = '# API 路由文档\n\n';
        doc += `生成时间: ${new Date().toISOString()}\n\n`;

        const grouped = {};
        for (const route of this.routes) {
            const prefix = route.path.split('/')[1] || 'other';
            if (!grouped[prefix]) {
                grouped[prefix] = [];
            }
            grouped[prefix].push(route);
        }

        for (const [prefix, routes] of Object.entries(grouped)) {
            doc += `## ${prefix.toUpperCase()}\n\n`;
            for (const route of routes) {
                const path = route.path instanceof RegExp
                    ? route.path.toString()
                    : route.path;

                doc += `### ${route.method} ${path}\n\n`;
                if (route.description) {
                    doc += `${route.description}\n\n`;
                }
                doc += `- **认证**: ${route.auth ? '是' : '否'}\n`;
                doc += `\n`;
            }
        }

        return doc;
    }

    /**
     * 清空所有路由（主要用于测试）
     */
    clear() {
        this.routes = [];
        this.middlewares = [];
    }
}
