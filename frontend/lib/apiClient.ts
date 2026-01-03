/**
 * 统一的 API 客户端
 *
 * 提供带认证的 fetch 封装，自动处理：
 * - Authorization token 注入
 * - 401 未授权响应拦截
 * - 统一的错误处理
 * - 并发 401 请求去重
 */

/**
 * 未授权错误类
 * 当检测到 401 状态码或 UNAUTHORIZED 响应码时抛出
 */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';

    // 确保原型链正确（TypeScript 编译目标 < ES6 时需要）
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

/**
 * 未授权处理回调函数类型
 * 用于在检测到未授权时执行自定义逻辑（如显示 toast）
 */
type UnauthorizedCallback = () => void | Promise<void>;

/**
 * 全局未授权处理回调
 * 允许应用层注册自定义的未授权提示逻辑
 */
let unauthorizedCallback: UnauthorizedCallback | null = null;

/**
 * 未授权处理流程的 Promise
 * 用于确保多个并发 401 请求只触发一次处理流程
 */
let unauthorizedFlow: Promise<void> | null = null;

/**
 * 注册未授权处理回调
 *
 * @param handler - 未授权时执行的回调函数
 * @returns 清理函数，用于取消注册
 *
 * @example
 * ```tsx
 * useEffect(() => {
 *   const cleanup = registerUnauthorizedHandler(() => {
 *     toast.error('请先登录以继续操作');
 *   });
 *   return cleanup;
 * }, []);
 * ```
 */
export function registerUnauthorizedHandler(handler: UnauthorizedCallback): () => void {
  unauthorizedCallback = handler;

  return () => {
    if (unauthorizedCallback === handler) {
      unauthorizedCallback = null;
    }
  };
}

/**
 * 检查响应是否为 JSON 格式
 */
function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  return contentType !== null && contentType.toLowerCase().includes('application/json');
}

/**
 * 安全地解析 JSON 响应体
 *
 * @param response - Fetch Response 对象
 * @returns 解析后的 JSON 对象，解析失败返回 null
 */
async function parseJsonPayload(response: Response): Promise<Record<string, unknown> | null> {
  if (!isJsonResponse(response)) {
    return null;
  }

  try {
    // 使用 clone() 避免消耗原始响应流
    return await response.clone().json();
  } catch {
    return null;
  }
}

/**
 * 执行未授权处理流程
 *
 * 该函数确保：
 * 1. 只在浏览器环境执行
 * 2. 多个并发调用只执行一次
 * 3. 清理 token、执行回调、跳转登录页
 */
async function runUnauthorizedFlow(): Promise<void> {
  // 服务端渲染环境下不执行
  if (typeof window === 'undefined') {
    return;
  }

  // 如果已有处理流程在进行中，等待其完成
  if (unauthorizedFlow !== null) {
    await unauthorizedFlow;
    return;
  }

  // 创建新的处理流程
  const flow = (async () => {
    try {
      // 1. 清理本地存储的认证 token
      localStorage.removeItem('authToken');

      // 2. 执行应用层注册的回调（如显示 toast）
      if (unauthorizedCallback !== null) {
        await Promise.resolve(unauthorizedCallback());
      }

      // 3. 跳转到登录页
      // 使用 replace 避免用户通过后退按钮返回
      window.location.replace('/login.html');
    } catch (error) {
      console.error('Error during unauthorized flow:', error);
      // 即使回调失败，也要确保跳转到登录页
      window.location.replace('/login.html');
    }
  })();

  // 保存流程 Promise，并在完成后清理
  unauthorizedFlow = flow.finally(() => {
    unauthorizedFlow = null;
  });

  await unauthorizedFlow;
}

/**
 * 类型守卫：检查错误是否为 UnauthorizedError
 *
 * @param error - 待检查的错误对象
 * @returns 是否为 UnauthorizedError 实例
 */
export function isUnauthorizedError(error: unknown): error is UnauthorizedError {
  return error instanceof UnauthorizedError;
}

/**
 * 带认证的 fetch 封装
 *
 * 自动处理：
 * - 从 localStorage 读取 token 并注入 Authorization header
 * - 检测 HTTP 401 状态码
 * - 检测响应 JSON 中的 code === 'UNAUTHORIZED'
 * - 触发统一的未授权处理流程
 *
 * @param input - 请求 URL 或 Request 对象
 * @param init - fetch 配置选项
 * @returns Response 对象
 * @throws {UnauthorizedError} 当检测到未授权时
 * @throws {Error} 当在服务端调用时
 *
 * @example
 * ```tsx
 * try {
 *   const response = await fetchWithAuth('/api/config');
 *   if (!response.ok) {
 *     throw new Error('请求失败');
 *   }
 *   const data = await response.json();
 * } catch (error) {
 *   if (isUnauthorizedError(error)) {
 *     // 未授权错误已被自动处理，无需额外操作
 *     return;
 *   }
 *   // 处理其他错误
 *   console.error(error);
 * }
 * ```
 */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  // 确保只在浏览器环境
  if (typeof window === 'undefined') {
    throw new Error('fetchWithAuth must run in the browser');
  }

  // 准备请求头
  const headers = new Headers(init.headers);
  const token = localStorage.getItem('authToken');

  // 自动注入 Authorization header（如果未手动设置）
  if (token !== null && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // 发起请求
  const response = await fetch(input, {
    ...init,
    headers,
  });

  // 检查 HTTP 401 状态码
  if (response.status === 401) {
    await runUnauthorizedFlow();
    throw new UnauthorizedError('HTTP 401 Unauthorized');
  }

  // 检查响应 JSON 中的 UNAUTHORIZED 代码
  const payload = await parseJsonPayload(response);
  if (payload && (payload as any).code === 'UNAUTHORIZED') {
    await runUnauthorizedFlow();
    throw new UnauthorizedError('API returned UNAUTHORIZED code');
  }

  return response;
}
