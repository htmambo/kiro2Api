export type ErrorStatusType =
  | 'ok'
  | 'banned'
  | 'quota_exceeded'
  | 'expired'
  | 'rate_limit'
  | 'server_error'
  | 'network_error'
  | 'unknown'

export interface ErrorStatus {
  status: string
  message: string
  statusType: ErrorStatusType
}

export type AccountPoolFilter = 'all' | 'healthy' | 'checking' | 'banned'
export type AccountPoolStatus = Exclude<AccountPoolFilter, 'all'>

export interface ProviderAccount {
  KIRO_OAUTH_CREDS_FILE_PATH?: string
  uuid: string
  checkModelName?: string
  checkHealth?: boolean
  isHealthy: boolean
  isDisabled: boolean
  lastUsed?: string
  usageCount: number
  errorCount: number
  lastErrorTime?: string
  lastHealthCheckTime?: string
  lastHealthCheckModel?: string
  lastErrorMessage?: string | null
  cachedUserId?: string
  cachedEmail?: string
  cachedAt?: string
  errorStatus?: ErrorStatus
  poolType?: 'healthy' | 'checking' | 'banned' | 'disabled'
}

export interface ProviderPools {
  [providerType: string]: ProviderAccount[]
}

export interface AccountPoolStats {
  healthy: number
  checking: number
  banned: number
  total: number
  totalUsageCount: number
  totalErrorCount: number
  cacheHitRate: string
}

export interface ProviderAccountsPayload {
  _accountPoolStats?: AccountPoolStats
  accounts?: ProviderAccount[]
}

export interface BatchHealthCheckResponse {
  successCount: number
  failCount: number
}

export interface MessageResponse {
  message?: string
}

export interface HealthCheckResult {
  isHealthy: boolean
  modelName?: string
  error?: string
}

export interface TestAccountResult {
  success: boolean
  message?: string
  error?: string
}

export interface DeviceAuthSuccessResult {
  success: true
  verificationUriComplete: string
  userCode: string
  expiresIn: number
  error?: string
}

export interface DeviceAuthFailureResult {
  success: false
  error?: string
}

export type DeviceAuthResponse = DeviceAuthSuccessResult | DeviceAuthFailureResult

export interface AuthStateResult {
  completed: boolean
  accountNumber?: number
}

export interface ProviderEventPayload {
  provider?: string
  credPath?: string
  error?: string
}

export interface ConfigUpdateEventPayload {
  type?: string
  filePath?: string
}

export interface PoolBadge {
  text: string
  className: string
}

export interface ErrorStatusBadge {
  bg: string
  text: string
  border: string
  status: string
  message: string
}
