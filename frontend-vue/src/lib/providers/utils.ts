import type {
  AccountPoolStatus,
  ErrorStatus,
  ErrorStatusBadge,
  ErrorStatusType,
  PoolBadge,
  ProviderAccount,
} from '@/lib/providers/types'

export const DEFAULT_PROVIDER_KEY = 'claude-kiro-oauth'
export const DEFAULT_AWS_START_URL = 'https://view.awsapps.com/start'

const errorStatusStyles: Record<Exclude<ErrorStatusType, 'ok'>, Omit<ErrorStatusBadge, 'status' | 'message'>> = {
  banned: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
  quota_exceeded: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  expired: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  rate_limit: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  server_error: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
  network_error: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
  unknown: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
}

const poolBadges: Record<AccountPoolStatus, PoolBadge> = {
  healthy: { text: '健康池', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
  checking: { text: '检查池', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  banned: { text: '异常池', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

export async function getApiErrorMessage(
  response: Response | null | undefined,
  fallback: string
): Promise<string> {
  try {
    if (!response) {
      return fallback
    }

    const payload = (await response.clone().json()) as unknown
    if (!isRecord(payload)) {
      return fallback
    }

    const error = payload.error
    if (isRecord(error)) {
      const nestedMessage = getStringField(error, 'message')
      if (nestedMessage) {
        return nestedMessage
      }
    }

    const topLevelMessage = getStringField(payload, 'message')
    if (topLevelMessage) {
      return topLevelMessage
    }
  } catch {
    return fallback
  }

  return fallback
}

export function getNextAccountNumber(accounts: ProviderAccount[]): number {
  let maxNumber = 0

  for (const account of accounts) {
    const filePath = account.KIRO_OAUTH_CREDS_FILE_PATH ?? ''
    const match = filePath.match(/kiro-auth-token-(\d+)\.json/)
    const matchedNumber = match?.[1]

    if (!matchedNumber) {
      continue
    }

    const parsedNumber = Number.parseInt(matchedNumber, 10)
    if (parsedNumber > maxNumber) {
      maxNumber = parsedNumber
    }
  }

  return maxNumber + 1
}

export function getBatchDeleteStatusNames(statusTypes: string[]): string {
  return statusTypes
    .map(type => {
      switch (type) {
        case 'banned':
          return '封禁'
        case 'quota_exceeded':
          return '额度用尽'
        case 'expired':
          return '过期'
        default:
          return type
      }
    })
    .join('/')
}

export function getErrorStatusBadge(errorStatus?: ErrorStatus): ErrorStatusBadge | null {
  if (!errorStatus || errorStatus.statusType === 'ok') {
    return null
  }

  const style = errorStatusStyles[errorStatus.statusType] ?? errorStatusStyles.unknown
  return {
    ...style,
    status: errorStatus.status,
    message: errorStatus.message,
  }
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) {
    return '--'
  }

  return new Date(dateStr).toLocaleString('zh-CN')
}

export function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) {
    return '--'
  }

  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}天前`
  }
  if (hours > 0) {
    return `${hours}小时前`
  }
  if (minutes > 0) {
    return `${minutes}分钟前`
  }

  return `${seconds}秒前`
}

export function getAccountPool(account: ProviderAccount): AccountPoolStatus {
  if (account.isDisabled || !account.isHealthy) {
    return 'banned'
  }

  if (account.errorCount > 0 && account.isHealthy) {
    return 'checking'
  }

  return 'healthy'
}

export function getPoolBadge(pool: AccountPoolStatus): PoolBadge {
  return poolBadges[pool]
}
