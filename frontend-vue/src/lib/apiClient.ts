/**
 * 统一的 API 客户端
 *
 * 提供带认证的 fetch 封装，自动处理：
 * - Authorization token 注入
 * - 401 未授权响应拦截
 * - 统一的错误处理
 * - 并发 401 请求去重
 */

import { useAuthStore } from '@/stores'

/**
 * 未授权错误类
 */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
    Object.setPrototypeOf(this, UnauthorizedError.prototype)
  }
}

/**
 * 未授权处理回调函数类型
 */
type UnauthorizedCallback = () => void | Promise<void>

/**
 * 全局未授权处理回调
 */
let unauthorizedCallback: UnauthorizedCallback | null = null

/**
 * 未授权处理流程的 Promise
 */
let unauthorizedFlow: Promise<void> | null = null

/**
 * 注册未授权处理回调
 */
export function registerUnauthorizedHandler(handler: UnauthorizedCallback): () => void {
  unauthorizedCallback = handler
  return () => {
    if (unauthorizedCallback === handler) {
      unauthorizedCallback = null
    }
  }
}

/**
 * 检查响应是否为 JSON 格式
 */
function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type')
  return contentType !== null && contentType.toLowerCase().includes('application/json')
}

/**
 * 安全地解析 JSON 响应体
 */
async function parseJsonPayload(response: Response): Promise<Record<string, unknown> | null> {
  if (!isJsonResponse(response)) {
    return null
  }
  try {
    return await response.clone().json()
  } catch {
    return null
  }
}

/**
 * 执行未授权处理流程
 */
async function runUnauthorizedFlow(): Promise<void> {
  if (typeof window === 'undefined') {
    return
  }

  if (unauthorizedFlow !== null) {
    await unauthorizedFlow
    return
  }

  const flow = (async () => {
    try {
      const authStore = useAuthStore()
      authStore.clearToken()

      if (unauthorizedCallback !== null) {
        await Promise.resolve(unauthorizedCallback())
      }

      // 使用 router 而不是 window.location.replace
      // 注意：这里需要在组件上下文中调用，或者使用全局 router 实例
      // 为了简化，这里使用 window.location.href 作为后备方案
      window.location.href = '/login'
    } catch (error) {
      console.error('Error during unauthorized flow:', error)
      window.location.href = '/login'
    }
  })()

  unauthorizedFlow = flow.finally(() => {
    unauthorizedFlow = null
  })

  await unauthorizedFlow
}

/**
 * 类型守卫：检查错误是否为 UnauthorizedError
 */
export function isUnauthorizedError(error: unknown): error is UnauthorizedError {
  return error instanceof UnauthorizedError
}

/**
 * 带认证的 fetch 封装
 */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  if (typeof window === 'undefined') {
    throw new Error('fetchWithAuth must run in the browser')
  }

  const headers = new Headers(init.headers)
  const authStore = useAuthStore()
  const token = authStore.token

  if (token !== null && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(input, {
    ...init,
    headers,
  })

  if (response.status === 401) {
    await runUnauthorizedFlow()
    throw new UnauthorizedError('HTTP 401 Unauthorized')
  }

  const payload = await parseJsonPayload(response)
  if (payload && (payload as any).code === 'UNAUTHORIZED') {
    await runUnauthorizedFlow()
    throw new UnauthorizedError('API returned UNAUTHORIZED code')
  }

  return response
}

/**
 * API 响应类型
 */
export interface ApiResponse<T = unknown> {
  code: string
  message?: string
  data?: T
}

/**
 * 通用 API 请求函数
 */
export async function apiRequest<T>(
  url: string,
  init?: RequestInit
): Promise<ApiResponse<T>> {
  // 合并 headers，支持 Headers 对象和普通对象
  const mergedHeaders: Record<string, string> = {}
  if (init?.headers) {
    const headers = init.headers
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        mergedHeaders[key] = value
      })
    } else if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => {
        mergedHeaders[key] = String(value)
      })
    } else {
      Object.assign(mergedHeaders, headers)
    }
  }

  const response = await fetchWithAuth(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...mergedHeaders,
    },
  })

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`)
  }

  return response.json()
}
