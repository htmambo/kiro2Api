<script setup lang="ts">
/**
 * 号池管理页面
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  IconCheck,
  IconX,
  IconRefresh,
  IconTrash,
  IconEye,
  IconEyeOff,
  IconUser,
  IconMail,
  IconClock,
  IconAlertTriangle,
  IconHeartbeat,
  IconLink,
  IconPlayerPlay,
  IconLoader2,
  IconKey,
  IconChevronRight,
  IconClipboard,
  IconExternalLink,
  IconCopy,
} from '@tabler/icons-vue'
import CardSpotlight from '@/components/ui/CardSpotlight.vue'
import Badge from '@/components/ui/Badge.vue'
import PageLoadingSkeleton from '@/components/ui/PageLoadingSkeleton.vue'
import { useToast } from '@/components/ui/toast'
import { fetchWithAuth, isUnauthorizedError } from '@/lib/apiClient'

interface ErrorStatus {
  status: string
  message: string
  statusType: 'ok' | 'banned' | 'quota_exceeded' | 'expired' | 'rate_limit' | 'server_error' | 'network_error' | 'unknown'
}

interface ProviderAccount {
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

interface ProviderPools {
  [providerType: string]: ProviderAccount[]
}

interface AccountPoolStats {
  healthy: number
  checking: number
  banned: number
  total: number
  totalUsageCount: number
  totalErrorCount: number
  cacheHitRate: string
}

const toast = useToast()

const providers = ref<ProviderPools>({})
const poolStats = ref<AccountPoolStats | null>(null)
const activePool = ref<'all' | 'healthy' | 'checking' | 'banned'>('all')
const loading = ref(true)
const refreshing = ref(false)
const activeProvider = ref('claude-kiro-oauth')
const healthChecking = ref(false)
const bannedHealthChecking = ref(false)
const resettingHealth = ref(false)
const generatingAuth = ref(false)
const authUrl = ref<string | null>(null)
const showSocialAuthModal = ref(false)
const socialAuthProvider = ref('')
const authState = ref('')

const accountHealthChecking = ref<string | null>(null)
const accountTesting = ref<string | null>(null)
const accountResetting = ref<string | null>(null)
const accountDeleting = ref<string | null>(null)

const selectedAccounts = ref<Set<string>>(new Set())
const batchDeleting = ref(false)

const showAuthMethodModal = ref(false)
const showManualImportModal = ref(false)
const showAWSAuthModal = ref(false)
const accountNumber = ref(1)
const manualRefreshToken = ref('')
const manualProfileArn = ref('')
const awsStartUrl = ref('https://view.awsapps.com/start')
const deviceAuthResult = ref<any>(null)

let eventSource: EventSource | null = null
let authPollInterval: ReturnType<typeof setInterval> | null = null

const getApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    if (!response) {
      return fallback
    }
    const payload = await response.clone().json()
    if (payload?.error?.message) {
      return payload.error.message
    }
    if (payload?.message) {
      return payload.message
    }
  } catch {
    // ignore parsing errors
  }
  return fallback
}

const loadProviders = async () => {
  refreshing.value = true
  const startTime = Date.now()

  try {
    const response = await fetchWithAuth('/api/accounts')
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '加载号池失败'))
    }
    const data = await response.json()
    if (data._accountPoolStats) {
      poolStats.value = data._accountPoolStats
    }
    const accounts = Array.isArray(data.accounts) ? (data.accounts as ProviderAccount[]) : []
    providers.value = { 'claude-kiro-oauth': accounts }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Failed to load providers:', error)
    toast.error('加载号池失败', error instanceof Error ? error.message : undefined)
  } finally {
    const elapsed = Date.now() - startTime
    const minDelay = 800
    if (elapsed < minDelay) {
      await new Promise(resolve => setTimeout(resolve, minDelay - elapsed))
    }
    loading.value = false
    refreshing.value = false
  }
}

const runBatchHealthCheck = async (poolFilter?: 'healthy' | 'checking' | 'banned') => {
  if (poolFilter === 'banned') {
    bannedHealthChecking.value = true
  } else {
    healthChecking.value = true
  }

  try {
    const response = await fetchWithAuth('/api/accounts/health-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: poolFilter ? JSON.stringify({ pool: poolFilter }) : undefined,
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '健康检查失败'))
    }

    const result = await response.json()
    await loadProviders()
    const poolName = poolFilter === 'banned' ? '异常池' : poolFilter === 'checking' ? '检查池' : ''
    toast.success(`${poolName}健康检查完成`, `${result.successCount} 个恢复健康, ${result.failCount} 个仍异常`)
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Batch health check failed:', error)
    toast.error('健康检查失败', error instanceof Error ? error.message : undefined)
  } finally {
    healthChecking.value = false
    bannedHealthChecking.value = false
  }
}

const resetAllHealth = async () => {
  if (!confirm('确定要重置所有账号的健康状态吗？')) return

  resettingHealth.value = true
  try {
    const response = await fetchWithAuth('/api/accounts/reset-health', {
      method: 'POST',
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '重置失败'))
    }

    const result = await response.json()
    await loadProviders()
    toast.success('重置成功', result.message || '健康状态已重置')
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Reset health failed:', error)
    toast.error('重置失败', error instanceof Error ? error.message : undefined)
  } finally {
    resettingHealth.value = false
  }
}

const generateAuthUrl = () => {
  const accounts = providers.value[activeProvider.value] || []
  let maxNumber = 0
  for (const account of accounts) {
    const filePath = account.KIRO_OAUTH_CREDS_FILE_PATH || ''
    const match = filePath.match(/kiro-auth-token-(\d+)\.json/)
    const matchedNumber = match?.[1]
    if (matchedNumber) {
      const num = Number.parseInt(matchedNumber, 10)
      if (num > maxNumber) {
        maxNumber = num
      }
    }
  }
  accountNumber.value = maxNumber + 1
  showAuthMethodModal.value = true
}

const handleManualImport = async () => {
  if (!manualRefreshToken.value.trim()) {
    toast.error('请输入 RefreshToken')
    return
  }
  if (!manualRefreshToken.value.startsWith('aorAAAAAG')) {
    toast.error('RefreshToken 格式不正确，应该以 aorAAAAAG 开头')
    return
  }

  generatingAuth.value = true
  try {
    const response = await fetchWithAuth('/api/kiro/oauth/manual-import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refreshToken: manualRefreshToken.value,
        profileArn: manualProfileArn.value,
        accountNumber: accountNumber.value,
      }),
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '导入失败'))
    }

    toast.success('导入成功', 'RefreshToken 已保存')
    showManualImportModal.value = false
    manualRefreshToken.value = ''
    manualProfileArn.value = ''
    await loadProviders()
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Manual import failed:', error)
    toast.error('导入失败', error instanceof Error ? error.message : undefined)
  } finally {
    generatingAuth.value = false
  }
}

const handleAWSDeviceAuth = async () => {
  generatingAuth.value = true
  deviceAuthResult.value = null
  try {
    const response = await fetchWithAuth('/api/kiro/oauth/aws-sso/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accountNumber: accountNumber.value,
        startUrl: awsStartUrl.value,
      }),
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '启动失败'))
    }

    const result = await response.json()
    if (result.success) {
      deviceAuthResult.value = result
      toast.success('设备授权已启动', '请在浏览器中完成授权')
    } else {
      toast.error('启动失败', result.error || '未知错误')
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('AWS device auth failed:', error)
    toast.error('启动设备授权失败', error instanceof Error ? error.message : undefined)
  } finally {
    generatingAuth.value = false
  }
}

const openAwsAuthModal = () => {
  showAuthMethodModal.value = false
  showAWSAuthModal.value = true
}

const openManualImportModal = () => {
  showAuthMethodModal.value = false
  showManualImportModal.value = true
}

const closeAwsModal = () => {
  showAWSAuthModal.value = false
  deviceAuthResult.value = null
}

const copyAuthUrl = () => {
  if (authUrl.value) {
    navigator.clipboard.writeText(authUrl.value)
    toast.success('已复制', '请在无痕模式中打开此链接')
  }
}

const openAuthUrl = () => {
  if (authUrl.value) {
    window.open(authUrl.value, '_blank')
  }
}

const copyAndPromptIncognito = () => {
  if (authUrl.value) {
    navigator.clipboard.writeText(authUrl.value)
    toast.success('链接已复制！', '请打开无痕模式 (Ctrl+Shift+N) 粘贴访问')
  }
}

const copyDeviceAuthLink = () => {
  if (!deviceAuthResult.value?.verificationUriComplete) return

  const url = deviceAuthResult.value.verificationUriComplete
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      toast.success('已复制', '验证链接已复制到剪贴板')
    }).catch(() => {
      toast.error('复制失败', '请手动复制链接')
    })
  } else {
    const textarea = document.createElement('textarea')
    textarea.value = url
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      toast.success('已复制', '验证链接已复制到剪贴板')
    } catch {
      toast.error('复制失败', '请手动复制链接')
    }
    document.body.removeChild(textarea)
  }
}

const toggleAccountStatus = async (uuid: string, currentStatus: boolean) => {
  try {
    const response = await fetchWithAuth(`/api/accounts/${uuid}/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isDisabled: !currentStatus }),
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '更新失败'))
    }

    await loadProviders()
    toast.success('状态已更新', currentStatus ? '账号已启用' : '账号已禁用')
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Failed to toggle account:', error)
    toast.error('更新失败', error instanceof Error ? error.message : undefined)
  }
}

const runHealthCheck = async (uuid: string) => {
  accountHealthChecking.value = uuid
  try {
    const response = await fetchWithAuth(`/api/accounts/${uuid}/health-check`, {
      method: 'POST',
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '健康检查失败'))
    }

    const result = await response.json()
    await loadProviders()
    if (result.isHealthy) {
      toast.success('账号健康', result.modelName ? `模型: ${result.modelName}` : undefined)
    } else {
      toast.warning('账号异常', result.error || undefined)
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Health check failed:', error)
    toast.error('健康检查失败', error instanceof Error ? error.message : undefined)
  } finally {
    accountHealthChecking.value = null
  }
}

const testAccount = async (uuid: string) => {
  accountTesting.value = uuid
  try {
    const response = await fetchWithAuth(`/api/accounts/${uuid}/test`, {
      method: 'POST',
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '测试失败'))
    }

    const result = await response.json()
    await loadProviders()
    if (result.success) {
      toast.success('测试成功', result.message || '账号正常')
    } else {
      toast.error('测试失败', result.error || '未知错误')
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Test failed:', error)
    toast.error('测试失败', error instanceof Error ? error.message : undefined)
  } finally {
    accountTesting.value = null
  }
}

const resetAccountHealth = async (uuid: string) => {
  accountResetting.value = uuid
  try {
    const response = await fetchWithAuth(`/api/accounts/${uuid}/reset-health`, {
      method: 'POST',
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '重置失败'))
    }

    await loadProviders()
    toast.success('重置成功', '健康状态已重置')
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Reset failed:', error)
    toast.error('重置失败', error instanceof Error ? error.message : undefined)
  } finally {
    accountResetting.value = null
  }
}

const deleteAccount = async (uuid: string, accountIndex: number) => {
  if (!confirm(`确定要删除账号 #${accountIndex + 1} 吗？\n\n该操作将同时删除对应的 token 文件，且不可恢复！`)) return

  accountDeleting.value = uuid
  try {
    const response = await fetchWithAuth(`/api/accounts/${uuid}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '删除失败'))
    }

    await loadProviders()
    toast.success('删除成功', `账号 #${accountIndex + 1} 已删除`)
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Delete failed:', error)
    toast.error('删除失败', error instanceof Error ? error.message : undefined)
  } finally {
    accountDeleting.value = null
  }
}

const batchDeleteAccounts = async () => {
  if (selectedAccounts.value.size === 0) {
    toast.warning('请先选择账号')
    return
  }

  const selectedCount = selectedAccounts.value.size
  if (!confirm(`确定要删除选中的 ${selectedCount} 个账号吗？\n\n该操作将同时删除对应的 token 文件，且不可恢复！`)) return

  batchDeleting.value = true
  try {
    const response = await fetchWithAuth('/api/accounts/batch-delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uuids: Array.from(selectedAccounts.value),
      }),
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '批量删除失败'))
    }

    const result = await response.json()
    selectedAccounts.value = new Set()
    await loadProviders()
    toast.success('批量删除成功', result.message)
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Batch delete failed:', error)
    toast.error('批量删除失败', error instanceof Error ? error.message : undefined)
  } finally {
    batchDeleting.value = false
  }
}

const batchDeleteByStatus = async (statusTypes: string[]) => {
  const statusNames = statusTypes.map(type => {
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
  }).join('/')

  if (!confirm(`确定要删除所有 ${statusNames} 的账号吗？\n\n该操作将同时删除对应的 token 文件，且不可恢复！`)) return

  batchDeleting.value = true
  try {
    const response = await fetchWithAuth('/api/accounts/batch-delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deleteByStatus: statusTypes,
      }),
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '批量删除失败'))
    }

    const result = await response.json()
    selectedAccounts.value = new Set()
    await loadProviders()
    toast.success('批量删除成功', result.message)
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Batch delete by status failed:', error)
    toast.error('批量删除失败', error instanceof Error ? error.message : undefined)
  } finally {
    batchDeleting.value = false
  }
}

const toggleSelectAll = () => {
  if (selectedAccounts.value.size === filteredAccounts.value.length) {
    selectedAccounts.value = new Set()
  } else {
    selectedAccounts.value = new Set(filteredAccounts.value.map(account => account.uuid))
  }
}

const toggleAccountSelection = (uuid: string) => {
  const next = new Set(selectedAccounts.value)
  if (next.has(uuid)) {
    next.delete(uuid)
  } else {
    next.add(uuid)
  }
  selectedAccounts.value = next
}

const getErrorStatusBadge = (errorStatus?: ErrorStatus) => {
  if (!errorStatus || errorStatus.statusType === 'ok') return null

  const styles: Record<string, { bg: string; text: string; border: string }> = {
    banned: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
    quota_exceeded: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
    expired: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
    rate_limit: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
    server_error: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
    network_error: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
    unknown: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
  }

  const style = styles[errorStatus.statusType] || styles.unknown
  return { ...style, status: errorStatus.status, message: errorStatus.message }
}

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '--'
  return new Date(dateStr).toLocaleString('zh-CN')
}

const formatRelativeTime = (dateStr?: string) => {
  if (!dateStr) return '--'
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}天前`
  if (hours > 0) return `${hours}小时前`
  if (minutes > 0) return `${minutes}分钟前`
  return `${seconds}秒前`
}

const activeAccounts = computed(() => providers.value[activeProvider.value] || [])
const totalAccounts = computed(() => activeAccounts.value.length)
const healthyAccounts = computed(() => activeAccounts.value.filter(account => account.isHealthy).length)
const totalUsage = computed(() => activeAccounts.value.reduce((sum, account) => sum + account.usageCount, 0))
const totalErrors = computed(() => activeAccounts.value.reduce((sum, account) => sum + account.errorCount, 0))

const getAccountPool = (account: ProviderAccount): 'healthy' | 'checking' | 'banned' => {
  if (account.isDisabled || !account.isHealthy) {
    return 'banned'
  }
  if (account.errorCount > 0 && account.isHealthy) {
    return 'checking'
  }
  return 'healthy'
}

const getPoolBadge = (pool: 'healthy' | 'checking' | 'banned') => {
  switch (pool) {
    case 'healthy':
      return { text: '健康池', className: 'bg-green-500/20 text-green-400 border-green-500/30' }
    case 'checking':
      return { text: '检查池', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' }
    case 'banned':
      return { text: '异常池', className: 'bg-red-500/20 text-red-400 border-red-500/30' }
  }
}

const filteredAccounts = computed(() => {
  if (activePool.value === 'all') {
    return activeAccounts.value
  }
  return activeAccounts.value.filter(account => getAccountPool(account) === activePool.value)
})

watch([showSocialAuthModal, authState], ([show, state]) => {
  if (!show || !state) {
    if (authPollInterval) {
      clearInterval(authPollInterval)
      authPollInterval = null
    }
    return
  }

  if (authPollInterval) {
    clearInterval(authPollInterval)
  }

  authPollInterval = setInterval(async () => {
    try {
      const response = await fetchWithAuth(`/api/kiro/oauth/check-state?state=${state}`)
      if (response.ok) {
        const result = await response.json()
        if (result.completed) {
          if (authPollInterval) {
            clearInterval(authPollInterval)
            authPollInterval = null
          }
          showSocialAuthModal.value = false
          toast.success('授权成功！', `账号 #${result.accountNumber || ''} 已添加`)
          await loadProviders()
        }
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        return
      }
      console.warn('Polling auth state failed:', error)
    }
  }, 2000)
})

onMounted(() => {
  loadProviders()

  const token = localStorage.getItem('authToken') || ''
  eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)

  eventSource.addEventListener('account_update', event => {
    try {
      const data = JSON.parse(event.data)
      console.log('Account update event received:', data)
      loadProviders()
    } catch (error) {
      console.error('Failed to parse account_update event:', error)
    }
  })

  eventSource.addEventListener('config_update', event => {
    try {
      const data = JSON.parse(event.data)
      console.log('Config update event received:', data)
      if (data.type === 'account_pool' || data.filePath?.includes('account_pool')) {
        loadProviders()
      }
    } catch (error) {
      console.error('Failed to parse config_update event:', error)
    }
  })

  eventSource.addEventListener('oauth_success', event => {
    try {
      const data = JSON.parse(event.data)
      console.log('OAuth success event received:', data)
      if (data.provider === 'claude-kiro-oauth-builderid') {
        showAWSAuthModal.value = false
        deviceAuthResult.value = null
        toast.success('AWS 授权成功！', data.credPath ? `Token 已保存: ${data.credPath}` : '')
        loadProviders()
      }
    } catch (error) {
      console.error('Failed to parse oauth_success event:', error)
    }
  })

  eventSource.addEventListener('oauth_error', event => {
    try {
      const data = JSON.parse(event.data)
      console.log('OAuth error event received:', data)
      if (data.provider === 'claude-kiro-oauth-builderid') {
        toast.error('AWS 授权失败', data.error || '未知错误')
        deviceAuthResult.value = null
      }
    } catch (error) {
      console.error('Failed to parse oauth_error event:', error)
    }
  })

  eventSource.addEventListener('provider_update', event => {
    try {
      const data = JSON.parse(event.data)
      console.log('Provider update event received:', data)
      loadProviders()
    } catch (error) {
      console.error('Failed to parse provider_update event:', error)
    }
  })

  eventSource.onerror = error => {
    console.error('SSE connection error:', error)
  }
})

onBeforeUnmount(() => {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }

  if (authPollInterval) {
    clearInterval(authPollInterval)
    authPollInterval = null
  }
})
</script>

<template>
  <PageLoadingSkeleton v-if="loading" />

  <div v-else class="space-y-6">
    <div class="flex items-center justify-between animate-fade-in-up">
      <div>
        <h1 class="text-3xl font-bold mb-2">号池管理</h1>
        <p class="text-gray-400">管理和监控多账号池</p>
      </div>
      <div class="flex items-center gap-3">
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-all disabled:opacity-50"
          :disabled="refreshing"
          @click="loadProviders"
        >
          <IconLoader2 v-if="refreshing" class="w-4 h-4 animate-spin" />
          <IconRefresh v-else class="w-4 h-4" />
          <span>{{ refreshing ? '刷新中...' : '刷新' }}</span>
        </button>
      </div>
    </div>

    <CardSpotlight>
      <div class="flex flex-wrap items-center gap-3">
        <button
          class="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 rounded-lg font-medium transition-all disabled:opacity-50"
          :disabled="healthChecking"
          @click="runBatchHealthCheck()"
        >
          <IconLoader2 v-if="healthChecking" class="w-4 h-4 animate-spin" />
          <IconHeartbeat v-else class="w-4 h-4" />
          <span>{{ healthChecking ? '检测中...' : '批量健康检测' }}</span>
        </button>
        <button
          class="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700 rounded-lg font-medium transition-all disabled:opacity-50"
          :disabled="bannedHealthChecking"
          title="重新检测异常池中的账号，看是否有误判或已恢复的账号"
          @click="runBatchHealthCheck('banned')"
        >
          <IconLoader2 v-if="bannedHealthChecking" class="w-4 h-4 animate-spin" />
          <IconAlertTriangle v-else class="w-4 h-4" />
          <span>{{ bannedHealthChecking ? '检测中...' : '检查异常池' }}</span>
        </button>
        <button
          class="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 rounded-lg font-medium transition-all disabled:opacity-50"
          :disabled="resettingHealth"
          @click="resetAllHealth"
        >
          <IconLoader2 v-if="resettingHealth" class="w-4 h-4 animate-spin" />
          <IconRefresh v-else class="w-4 h-4" />
          <span>{{ resettingHealth ? '重置中...' : '重置健康状态' }}</span>
        </button>
        <button
          class="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 rounded-lg font-medium transition-all disabled:opacity-50"
          :disabled="generatingAuth"
          @click="generateAuthUrl"
        >
          <IconLoader2 v-if="generatingAuth" class="w-4 h-4 animate-spin" />
          <IconLink v-else class="w-4 h-4" />
          <span>{{ generatingAuth ? '生成中...' : '生成授权' }}</span>
        </button>

        <div class="w-px h-8 bg-white/10" />

        <button
          class="flex items-center gap-2 px-4 py-2 bg-red-500/20 border border-red-500/30 hover:bg-red-500/30 text-red-400 rounded-lg font-medium transition-all disabled:opacity-50"
          :disabled="batchDeleting || selectedAccounts.size === 0"
          @click="batchDeleteAccounts"
        >
          <IconLoader2 v-if="batchDeleting" class="w-4 h-4 animate-spin" />
          <IconTrash v-else class="w-4 h-4" />
          <span>删除选中 ({{ selectedAccounts.size }})</span>
        </button>

        <button
          class="flex items-center gap-2 px-4 py-2 bg-orange-500/20 border border-orange-500/30 hover:bg-orange-500/30 text-orange-400 rounded-lg font-medium transition-all disabled:opacity-50"
          :disabled="batchDeleting"
          title="删除所有封禁和额度用尽的账号"
          @click="batchDeleteByStatus(['banned', 'quota_exceeded'])"
        >
          <IconLoader2 v-if="batchDeleting" class="w-4 h-4 animate-spin" />
          <IconTrash v-else class="w-4 h-4" />
          <span>清理异常账号</span>
        </button>
      </div>
    </CardSpotlight>

    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <div class="animate-scale-in delay-100">
        <div
          class="cursor-pointer transition-all"
          :class="activePool === 'healthy' ? 'ring-2 ring-green-500 rounded-xl' : ''"
          @click="activePool = activePool === 'healthy' ? 'all' : 'healthy'"
        >
          <CardSpotlight>
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                <IconCheck class="w-5 h-5" />
              </div>
              <div>
                <p class="text-gray-400 text-xs">健康池</p>
                <h3 class="text-xl font-bold text-green-400">{{ poolStats?.healthy ?? healthyAccounts }}</h3>
              </div>
            </div>
          </CardSpotlight>
        </div>
      </div>

      <div class="animate-scale-in delay-150">
        <div
          class="cursor-pointer transition-all"
          :class="activePool === 'checking' ? 'ring-2 ring-yellow-500 rounded-xl' : ''"
          @click="activePool = activePool === 'checking' ? 'all' : 'checking'"
        >
          <CardSpotlight>
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-yellow-500 to-orange-600 flex items-center justify-center">
                <IconHeartbeat class="w-5 h-5" />
              </div>
              <div>
                <p class="text-gray-400 text-xs">检查池</p>
                <h3 class="text-xl font-bold text-yellow-400">{{ poolStats?.checking ?? 0 }}</h3>
              </div>
            </div>
          </CardSpotlight>
        </div>
      </div>

      <div class="animate-scale-in delay-200">
        <div
          class="cursor-pointer transition-all"
          :class="activePool === 'banned' ? 'ring-2 ring-red-500 rounded-xl' : ''"
          @click="activePool = activePool === 'banned' ? 'all' : 'banned'"
        >
          <CardSpotlight>
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-red-500 to-pink-600 flex items-center justify-center">
                <IconX class="w-5 h-5" />
              </div>
              <div>
                <p class="text-gray-400 text-xs">异常池</p>
                <h3 class="text-xl font-bold text-red-400">{{ poolStats?.banned ?? 0 }}</h3>
              </div>
            </div>
          </CardSpotlight>
        </div>
      </div>

      <div class="animate-scale-in delay-250">
        <div
          class="cursor-pointer transition-all"
          :class="activePool === 'all' ? 'ring-2 ring-blue-500 rounded-xl' : ''"
          @click="activePool = 'all'"
        >
          <CardSpotlight>
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <IconUser class="w-5 h-5" />
              </div>
              <div>
                <p class="text-gray-400 text-xs">总账户</p>
                <h3 class="text-xl font-bold">{{ poolStats?.total ?? totalAccounts }}</h3>
              </div>
            </div>
          </CardSpotlight>
        </div>
      </div>

      <div class="animate-scale-in delay-300">
        <CardSpotlight>
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <IconRefresh class="w-5 h-5" />
            </div>
            <div>
              <p class="text-gray-400 text-xs">缓存命中</p>
              <h3 class="text-xl font-bold text-cyan-400">{{ poolStats?.cacheHitRate ?? '0%' }}</h3>
            </div>
          </div>
        </CardSpotlight>
      </div>

      <div class="animate-scale-in delay-350">
        <CardSpotlight>
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <IconClock class="w-5 h-5" />
            </div>
            <div>
              <p class="text-gray-400 text-xs">使用/错误</p>
              <h3 class="text-lg font-bold">
                <span class="text-green-400">{{ poolStats?.totalUsageCount ?? totalUsage }}</span>
                <span class="text-gray-500">/</span>
                <span class="text-red-400">{{ poolStats?.totalErrorCount ?? totalErrors }}</span>
              </h3>
            </div>
          </div>
        </CardSpotlight>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-6">
      <div
        v-if="filteredAccounts.length"
        class="flex items-center gap-4 px-4 py-2 bg-white/5 rounded-lg border border-white/10"
      >
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            class="w-4 h-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
            :checked="selectedAccounts.size === filteredAccounts.length && filteredAccounts.length > 0"
            @change="toggleSelectAll"
          />
          <span class="text-sm text-gray-400">全选 ({{ selectedAccounts.size }}/{{ filteredAccounts.length }})</span>
        </label>
        <span v-if="selectedAccounts.size > 0" class="text-sm text-blue-400">
          已选中 {{ selectedAccounts.size }} 个账号
        </span>
      </div>

      <CardSpotlight v-if="filteredAccounts.length === 0">
        <div class="text-center py-12">
          <p class="text-gray-400 text-lg">
            {{ activePool === 'all'
              ? '暂无账号'
              : `${activePool === 'healthy' ? '健康池' : activePool === 'checking' ? '检查池' : '异常池'}暂无账号` }}
          </p>
          <p class="text-gray-500 text-sm mt-2">
            <button v-if="activePool !== 'all'" class="text-blue-400 hover:underline" @click="activePool = 'all'">查看全部账号</button>
          </p>
        </div>
      </CardSpotlight>

      <CardSpotlight
        v-for="(account, index) in filteredAccounts"
        :key="account.uuid"
        :class="selectedAccounts.has(account.uuid) ? 'ring-2 ring-blue-500' : ''"
      >
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <input
                type="checkbox"
                class="w-5 h-5 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                :checked="selectedAccounts.has(account.uuid)"
                @change="toggleAccountSelection(account.uuid)"
              />
              <h3 class="text-xl font-bold">账号 #{{ activeAccounts.findIndex(item => item.uuid === account.uuid) + 1 }}</h3>
              <span class="px-2 py-0.5 text-xs rounded-full border" :class="getPoolBadge(getAccountPool(account))?.className">
                {{ getPoolBadge(getAccountPool(account))?.text }}
              </span>
              <span
                v-if="getErrorStatusBadge(account.errorStatus)"
                class="px-2 py-0.5 text-xs rounded-full border"
                :class="`${getErrorStatusBadge(account.errorStatus)?.bg} ${getErrorStatusBadge(account.errorStatus)?.text} ${getErrorStatusBadge(account.errorStatus)?.border}`"
                :title="getErrorStatusBadge(account.errorStatus)?.message"
              >
                {{ getErrorStatusBadge(account.errorStatus)?.status }}
              </span>
              <Badge v-if="account.isDisabled" variant="outline">
                <IconEyeOff class="w-3 h-3 mr-1" />
                已禁用
              </Badge>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 transition-all disabled:opacity-50"
                :disabled="accountTesting === account.uuid"
                title="测试账号"
                @click="testAccount(account.uuid)"
              >
                <IconLoader2 v-if="accountTesting === account.uuid" class="w-4 h-4 animate-spin" />
                <IconPlayerPlay v-else class="w-4 h-4" />
                <span>测试</span>
              </button>
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 transition-all disabled:opacity-50"
                :disabled="accountHealthChecking === account.uuid"
                title="健康检查"
                @click="runHealthCheck(account.uuid)"
              >
                <IconLoader2 v-if="accountHealthChecking === account.uuid" class="w-4 h-4 animate-spin" />
                <IconHeartbeat v-else class="w-4 h-4" />
                <span>检测</span>
              </button>
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 transition-all disabled:opacity-50"
                :disabled="accountResetting === account.uuid"
                title="重置健康状态"
                @click="resetAccountHealth(account.uuid)"
              >
                <IconLoader2 v-if="accountResetting === account.uuid" class="w-4 h-4 animate-spin" />
                <IconRefresh v-else class="w-4 h-4" />
                <span>重置</span>
              </button>
              <button
                class="px-3 py-1.5 text-sm rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                :title="account.isDisabled ? '启用账号' : '禁用账号'"
                @click="toggleAccountStatus(account.uuid, account.isDisabled)"
              >
                <IconEye v-if="account.isDisabled" class="w-4 h-4" />
                <IconEyeOff v-else class="w-4 h-4" />
              </button>
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-red-500/20 border border-red-500/30 hover:bg-red-500/30 text-red-400 transition-all disabled:opacity-50"
                :disabled="accountDeleting === account.uuid"
                title="删除账号"
                @click="deleteAccount(account.uuid, index)"
              >
                <IconLoader2 v-if="accountDeleting === account.uuid" class="w-4 h-4 animate-spin" />
                <IconTrash v-else class="w-4 h-4" />
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div v-if="account.cachedEmail" class="flex items-center gap-3 p-3 rounded-lg bg-white/5">
              <IconMail class="w-5 h-5 text-blue-400" />
              <div>
                <p class="text-xs text-gray-400">邮箱</p>
                <p class="text-sm font-medium">{{ account.cachedEmail }}</p>
              </div>
            </div>

            <div class="flex items-center gap-3 p-3 rounded-lg bg-white/5">
              <IconClock class="w-5 h-5 text-green-400" />
              <div>
                <p class="text-xs text-gray-400">使用次数</p>
                <p class="text-sm font-medium">{{ account.usageCount }}</p>
              </div>
            </div>

            <div class="flex items-center gap-3 p-3 rounded-lg bg-white/5">
              <IconAlertTriangle class="w-5 h-5 text-red-400" />
              <div>
                <p class="text-xs text-gray-400">错误次数</p>
                <p class="text-sm font-medium">{{ account.errorCount }}</p>
              </div>
            </div>

            <div v-if="account.lastUsed" class="flex items-center gap-3 p-3 rounded-lg bg-white/5">
              <div>
                <p class="text-xs text-gray-400">最后使用</p>
                <p class="text-sm font-medium">{{ formatRelativeTime(account.lastUsed) }}</p>
                <p class="text-sm text-gray-500">{{ formatDate(account.lastUsed) }}</p>
              </div>
            </div>

            <div v-if="account.lastHealthCheckTime" class="flex items-center gap-3 p-3 rounded-lg bg-white/5">
              <div>
                <p class="text-xs text-gray-400">最后健康检查</p>
                <p class="text-sm font-medium">{{ formatRelativeTime(account.lastHealthCheckTime) }}</p>
                <p class="text-sm text-gray-500">{{ formatDate(account.lastHealthCheckTime) }}</p>
              </div>
            </div>

            <div v-if="account.lastErrorTime" class="flex items-center gap-3 p-3 rounded-lg bg-white/5">
              <div>
                <p class="text-xs text-gray-400">最后错误</p>
                <p class="text-sm font-medium text-red-400">{{ formatRelativeTime(account.lastErrorTime) }}</p>
                <p class="text-sm text-gray-500">{{ formatDate(account.lastErrorTime) }}</p>
              </div>
            </div>
          </div>

          <div v-if="account.lastErrorMessage" class="p-3 rounded-lg border" :class="getErrorStatusBadge(account.errorStatus) ? `${getErrorStatusBadge(account.errorStatus)?.bg} ${getErrorStatusBadge(account.errorStatus)?.border}` : 'bg-red-500/10 border-red-500/20'">
            <div class="flex items-center justify-between mb-1">
              <p class="text-xs text-gray-400">错误信息</p>
              <span v-if="getErrorStatusBadge(account.errorStatus)" class="px-2 py-0.5 text-xs rounded-full" :class="`${getErrorStatusBadge(account.errorStatus)?.bg} ${getErrorStatusBadge(account.errorStatus)?.text} ${getErrorStatusBadge(account.errorStatus)?.border}`">
                {{ getErrorStatusBadge(account.errorStatus)?.status }}
              </span>
            </div>
            <p class="text-sm font-medium" :class="getErrorStatusBadge(account.errorStatus)?.text || 'text-red-400'">
              {{ getErrorStatusBadge(account.errorStatus)?.message || account.lastErrorMessage }}
            </p>
            <p v-if="getErrorStatusBadge(account.errorStatus)" class="text-xs text-gray-500 mt-1 font-mono">
              {{ account.lastErrorMessage }}
            </p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div v-if="account.KIRO_OAUTH_CREDS_FILE_PATH" class="p-3 rounded-lg bg-white/5 border border-white/10">
              <p class="text-xs text-gray-400 mb-1">凭据文件路径</p>
              <p class="text-sm font-mono text-gray-300">{{ account.KIRO_OAUTH_CREDS_FILE_PATH }}</p>
            </div>

            <div class="p-3 rounded-lg bg-white/5 border border-white/10">
              <div class="text-xs text-gray-400 mb-1">
                UUID: <span class="text-sm text-gray-300 font-mono">{{ account.uuid }}</span>
              </div>
              <div class="space-y-1">
                <div v-if="account.checkModelName" class="text-xs text-gray-400">
                  检查模型: <span class="text-sm text-gray-300">{{ account.checkModelName }}</span>
                </div>
                <div v-if="account.lastHealthCheckModel" class="text-xs text-gray-400">
                  最后检查模型: <span class="text-sm text-gray-300">{{ account.lastHealthCheckModel }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardSpotlight>
    </div>

    <div
      v-if="showAuthMethodModal"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]"
      @click="showAuthMethodModal = false"
    >
      <div
        class="bg-gray-900 rounded-xl border border-white/10 max-w-lg w-full overflow-hidden animate-[slideUp_0.3s_ease-out]"
        @click.stop
      >
        <div class="p-6 border-b border-white/10">
          <div class="flex items-center justify-between">
            <h3 class="text-xl font-bold flex items-center gap-2">
              <IconKey class="w-5 h-5 text-blue-400" />
              Kiro OAuth 授权
            </h3>
            <button class="text-gray-400 hover:text-white" @click="showAuthMethodModal = false">
              <IconX class="w-5 h-5" />
            </button>
          </div>
        </div>
        <div class="p-6 space-y-4">
          <h4 class="text-sm font-medium text-gray-300 mb-3">请选择登录方式：</h4>

          <button
            class="w-full p-4 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-all flex items-center gap-4 text-left group"
            :disabled="generatingAuth"
          @click="openAwsAuthModal"
          >
            <div class="w-10 h-10 rounded-lg bg-[#232f3e] flex items-center justify-center">
              <svg class="w-6 h-6 text-[#FF9900]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6.763 10.036c0 .296.032.535.088.71.064.176.144.368.256.576.04.063.056.127.056.183 0 .08-.048.16-.152.24l-.503.335a.383.383 0 0 1-.208.072c-.08 0-.16-.04-.239-.112a2.47 2.47 0 0 1-.287-.375 6.18 6.18 0 0 1-.248-.471c-.622.734-1.405 1.101-2.347 1.101-.67 0-1.205-.191-1.596-.574-.391-.384-.59-.894-.59-1.533 0-.678.239-1.23.726-1.644.487-.415 1.133-.623 1.955-.623.272 0 .551.024.846.064.296.04.6.104.918.176v-.583c0-.607-.127-1.03-.375-1.277-.255-.248-.686-.367-1.3-.367-.28 0-.568.031-.863.103-.295.072-.583.16-.862.272a2.287 2.287 0 0 1-.28.104.488.488 0 0 1-.127.023c-.112 0-.168-.08-.168-.247v-.391c0-.128.016-.224.056-.28a.597.597 0 0 1 .224-.167c.279-.144.614-.264 1.005-.36a4.84 4.84 0 0 1 1.246-.151c.95 0 1.644.216 2.091.647.439.43.662 1.085.662 1.963v2.586z"/>
              </svg>
            </div>
            <div class="flex-1">
              <div class="font-semibold">AWS Builder ID 登录</div>
              <div class="text-sm text-gray-400">使用 AWS IAM Identity Center（自动注册Client）</div>
            </div>
            <IconChevronRight class="w-5 h-5 text-gray-500 group-hover:text-white transition-colors" />
          </button>

          <button
            class="w-full p-4 rounded-lg border-2 border-green-500/50 bg-gradient-to-r from-green-500/10 to-emerald-500/10 hover:from-green-500/20 hover:to-emerald-500/20 transition-all flex items-center gap-4 text-left group"
            :disabled="generatingAuth"
          @click="openManualImportModal"
          >
            <div class="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
              <IconClipboard class="w-5 h-5 text-green-400" />
            </div>
            <div class="flex-1">
              <div class="font-semibold text-green-400">手动导入 RefreshToken</div>
              <div class="text-sm text-gray-400">直接粘贴 refreshToken，无需 OAuth 授权（推荐）</div>
            </div>
            <IconChevronRight class="w-5 h-5 text-gray-500 group-hover:text-green-400 transition-colors" />
          </button>

          <div class="mt-4 p-4 rounded-lg bg-white/5 border border-white/10">
            <label class="block text-sm font-medium text-gray-300 mb-2">账号编号：</label>
            <input
              v-model.number="accountNumber"
              type="number"
              min="1"
              class="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p class="text-xs text-gray-500 mt-2">Token 文件名: kiro-auth-token-{{ accountNumber }}.json</p>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="showManualImportModal"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]"
      @click="showManualImportModal = false"
    >
      <div
        class="bg-gray-900 rounded-xl border border-white/10 max-w-xl w-full overflow-hidden animate-[slideUp_0.3s_ease-out]"
        @click.stop
      >
        <div class="p-6 border-b border-white/10">
          <div class="flex items-center justify-between">
            <h3 class="text-xl font-bold flex items-center gap-2">
              <IconClipboard class="w-5 h-5 text-green-400" />
              手动导入 RefreshToken
            </h3>
            <button class="text-gray-400 hover:text-white" @click="showManualImportModal = false">
              <IconX class="w-5 h-5" />
            </button>
          </div>
        </div>
        <div class="p-6 space-y-4">
          <div class="p-4 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30">
            <div class="flex items-start gap-3">
              <IconCheck class="w-5 h-5 text-green-400 mt-0.5" />
              <div>
                <div class="font-semibold text-green-400">推荐方式 - 无需 OAuth 授权</div>
                <ul class="text-sm text-gray-400 mt-2 space-y-1">
                  <li>• 直接粘贴 refreshToken，系统自动保存</li>
                  <li>• 永久有效，后端自动刷新 accessToken</li>
                  <li>• 无需每次浏览器授权，无需无痕模式</li>
                </ul>
              </div>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              RefreshToken <span class="text-red-400">*</span>
            </label>
            <textarea
              v-model="manualRefreshToken"
              rows="4"
              placeholder="粘贴 refreshToken (以 aorAAAAAG 开头...)"
              class="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 font-mono text-sm resize-none"
            />
            <p class="text-xs text-gray-500 mt-1">从 Kiro IDE 流量拦截或朋友处获取</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              ProfileArn <span class="text-gray-500">(可选)</span>
            </label>
            <input
              v-model="manualProfileArn"
              type="text"
              placeholder="arn:aws:codewhisperer:us-east-1:..."
              class="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 font-mono text-sm"
            />
            <p class="text-xs text-gray-500 mt-1">可选，系统会自动获取</p>
          </div>

          <div class="p-3 rounded-lg bg-white/5 border border-white/10">
            <span class="text-gray-400">账号编号: </span>
            <span class="font-bold text-lg">{{ accountNumber }}</span>
            <p class="text-xs text-gray-500 mt-1">Token 文件: kiro-auth-token-{{ accountNumber }}.json</p>
          </div>

          <div class="p-4 rounded-lg bg-gradient-to-r from-green-500/5 to-emerald-500/5 border border-green-500/20">
            <div class="font-medium text-green-400 mb-2">如何获取 RefreshToken？</div>
            <div class="text-sm text-gray-400">
              <div class="font-medium text-white mb-1">最简单：从已有账号复制</div>
              <p>如果你或朋友已有 Kiro 账号，直接打开 token 文件</p>
              <p class="mt-1">文件位置: <code class="bg-white/10 px-1.5 py-0.5 rounded text-xs">configs/kiro/kiro-auth-token-*.json</code></p>
              <p class="mt-1">复制其中的 <code class="bg-white/10 px-1.5 py-0.5 rounded text-xs">refreshToken</code> 字段即可！</p>
            </div>
          </div>
        </div>
        <div class="p-6 border-t border-white/10 flex justify-end gap-3">
          <button class="px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors" @click="showManualImportModal = false">
            取消
          </button>
          <button
            class="px-6 py-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 font-semibold transition-all disabled:opacity-50 flex items-center gap-2"
            :disabled="generatingAuth"
            @click="handleManualImport"
          >
            <IconLoader2 v-if="generatingAuth" class="w-4 h-4 animate-spin" />
            <IconCheck v-else class="w-4 h-4" />
            导入并保存
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showAWSAuthModal"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]"
      @click="closeAwsModal"
    >
      <div
        class="bg-gray-900 rounded-xl border border-white/10 max-w-xl w-full overflow-hidden animate-[slideUp_0.3s_ease-out]"
        @click.stop
      >
        <div class="p-6 border-b border-white/10">
          <div class="flex items-center justify-between">
            <h3 class="text-xl font-bold flex items-center gap-2">
              <svg class="w-5 h-5 text-[#FF9900]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6.763 10.036c0 .296.032.535.088.71.064.176.144.368.256.576.04.063.056.127.056.183 0 .08-.048.16-.152.24l-.503.335a.383.383 0 0 1-.208.072c-.08 0-.16-.04-.239-.112a2.47 2.47 0 0 1-.287-.375 6.18 6.0 0 0 1-.248-.471c-.622.734-1.405 1.101-2.347 1.101-.67 0-1.205-.191-1.596-.574-.391-.384-.59-.894-.59-1.533 0-.678.239-1.23.726-1.644.487-.415 1.133-.623 1.955-.623.272 0 .551.024.846.064.296.04.6.104.918.176v-.583c0-.607-.127-1.03-.375-1.277-.255-.248-.686-.367-1.3-.367-.28 0-.568.031-.863.103-.295.072-.583.16-.862.272a2.287 2.287 0 0 1-.28.104.488.488 0 0 1-.127.023c-.112 0-.168-.08-.168-.247v-.391c0-.128.016-.224.056-.28a.597.597 0 0 1 .224-.167c.279-.144.614-.264 1.005-.36a4.84 4.84 0 0 1 1.246-.151c.95 0 1.644.216 2.091.647.439.43.662 1.085.662 1.963v2.586z" />
              </svg>
              AWS Builder ID 授权
            </h3>
            <button class="text-gray-400 hover:text-white" @click="showAWSAuthModal = false">
              <IconX class="w-5 h-5" />
            </button>
          </div>
        </div>
        <div class="p-6 space-y-4">
          <div class="p-4 rounded-lg bg-[#232f3e] border border-[#FF9900]/30">
            <div class="text-sm space-y-1">
              <div><span class="text-gray-400">账号编号:</span> <span class="font-bold">{{ accountNumber }}</span></div>
              <div><span class="text-gray-400">Token文件:</span> <code class="text-xs bg-white/10 px-1.5 py-0.5 rounded">kiro-auth-token-{{ accountNumber }}.json</code></div>
              <div><span class="text-gray-400">认证方式:</span> <span class="font-bold">AWS IAM Identity Center (BuilderId)</span></div>
            </div>
          </div>

          <div class="p-3 rounded-lg bg-gradient-to-r from-[#FF9900]/10 to-[#ec7211]/10 border border-[#FF9900]/30">
            <div class="flex items-center gap-2 text-sm">
              <IconPlayerPlay class="w-4 h-4 text-[#FF9900]" />
              <span class="text-[#FF9900] font-medium">自动注册模式</span>
            </div>
            <p class="text-xs text-gray-400 mt-1">系统会自动调用 AWS SSO OIDC API 注册客户端，无需手动输入 Client ID 和 Client Secret！</p>
          </div>

          <div v-if="!deviceAuthResult">
            <label class="block text-sm font-medium text-gray-300 mb-2">
              Start URL <span class="text-gray-500">(可选，通常使用默认值即可)</span>
            </label>
            <input
              v-model="awsStartUrl"
              type="text"
              placeholder="默认: https://view.awsapps.com/start"
              class="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF9900]"
            />
          </div>

          <div v-if="deviceAuthResult" class="p-4 rounded-lg bg-green-500/10 border border-green-500/30 space-y-4">
            <div class="flex items-center gap-2 text-green-400 font-medium">
              <IconCheck class="w-5 h-5" />
              设备授权已启动
            </div>

            <div>
              <div class="text-sm text-gray-400 mb-2">用户码:</div>
              <div class="text-3xl font-bold text-center text-[#FF9900] tracking-widest font-mono p-4 rounded-lg bg-white/5">
                {{ deviceAuthResult.userCode }}
              </div>
            </div>

            <div>
              <div class="text-sm text-gray-400 mb-2">验证链接(推荐复制后新开无痕窗口打开):</div>
              <div class="flex gap-2">
                <input
                  type="text"
                  readonly
                  :value="deviceAuthResult.verificationUriComplete"
                  class="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-mono text-green-400 truncate"
                  :title="deviceAuthResult.verificationUriComplete"
                />
                <button
                  class="px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors flex items-center gap-2"
                  title="复制链接"
                  @click="copyDeviceAuthLink"
                >
                  <IconCopy class="w-4 h-4" />
                </button>
              </div>
            </div>

            <a
              :href="deviceAuthResult.verificationUriComplete"
              target="_blank"
              rel="noopener noreferrer"
              class="block w-full py-3 px-4 rounded-lg bg-gradient-to-r from-[#FF9900] to-[#ec7211] text-white text-center font-semibold hover:opacity-90 transition-opacity"
            >
              <IconLink class="w-4 h-4 inline mr-2" />
              点击打开授权页面
            </a>

            <div class="text-sm text-gray-400">
              <IconClock class="w-4 h-4 inline mr-1" />
              请在 <span class="font-bold text-white">{{ Math.floor(deviceAuthResult.expiresIn / 60) }} 分钟</span>内完成授权
            </div>

            <div class="p-3 rounded-lg bg-white/5 flex items-center gap-2 text-sm text-gray-400">
              <IconLoader2 class="w-4 h-4 animate-spin text-green-400" />
              系统正在后台轮询授权状态，完成授权后将自动保存 token...
            </div>
          </div>

          <div v-if="!deviceAuthResult">
            <div class="text-sm font-medium text-gray-300 mb-2">授权步骤：</div>
            <ol class="text-sm text-gray-400 space-y-1 list-decimal list-inside">
              <li>点击下方"开始设备授权"按钮</li>
              <li>系统自动注册客户端并获取用户码</li>
              <li>在弹出的验证链接中输入用户码</li>
              <li>使用您的 AWS Builder ID 登录</li>
              <li>授权成功后 token 自动保存</li>
            </ol>
          </div>
        </div>
        <div class="p-6 border-t border-white/10 flex justify-end gap-3">
            <button
              class="px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
              @click="closeAwsModal"
            >
              关闭
            </button>
          <button
            v-if="!deviceAuthResult"
            class="px-6 py-2 rounded-lg bg-[#FF9900] hover:bg-[#ec7211] font-semibold transition-all disabled:opacity-50 flex items-center gap-2"
            :disabled="generatingAuth"
            @click="handleAWSDeviceAuth"
          >
            <IconLoader2 v-if="generatingAuth" class="w-4 h-4 animate-spin" />
            <IconPlayerPlay v-else class="w-4 h-4" />
            开始设备授权
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showSocialAuthModal && authUrl"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]"
      @click="showSocialAuthModal = false"
    >
      <div
        class="bg-gray-900 rounded-xl border border-white/10 max-w-lg w-full overflow-hidden animate-[slideUp_0.3s_ease-out] max-h-[90vh] overflow-y-auto"
        @click.stop
      >
        <div class="p-4 border-b border-white/10">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-bold flex items-center gap-2">
              <IconKey class="w-4 h-4 text-blue-400" />
              {{ socialAuthProvider }} 授权 · 账号 #{{ accountNumber }}
            </h3>
            <button class="text-gray-400 hover:text-white" @click="showSocialAuthModal = false">
              <IconX class="w-5 h-5" />
            </button>
          </div>
        </div>
        <div class="p-4 space-y-3">
          <div class="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm">
            <div class="flex items-center gap-2 text-yellow-400 font-medium mb-1">
              <IconAlertTriangle class="w-4 h-4" />
              使用无痕模式登录不同账号
            </div>
            <p class="text-gray-400 text-xs">
              Chrome/Edge: <kbd class="bg-white/10 px-1 rounded">Ctrl+Shift+N</kbd> ·
              Firefox: <kbd class="bg-white/10 px-1 rounded">Ctrl+Shift+P</kbd>
            </p>
          </div>

          <div>
            <label class="block text-xs text-gray-400 mb-1">授权链接：</label>
            <div class="flex gap-2">
              <input
                type="text"
                readonly
                :value="authUrl"
                class="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-mono text-green-400 truncate"
              />
              <button
                class="px-3 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                title="复制链接"
                @click="copyAuthUrl"
              >
                <IconCopy class="w-4 h-4" />
              </button>
            </div>
          </div>

          <div class="p-2 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-2 text-sm">
            <IconLoader2 class="w-4 h-4 animate-spin text-green-400" />
            <span class="text-green-400">正在自动检测授权完成状态...</span>
          </div>
        </div>
        <div class="p-4 border-t border-white/10 flex gap-2">
          <button
            class="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 font-medium transition-all flex items-center justify-center gap-2"
            @click="copyAndPromptIncognito"
          >
            <IconCopy class="w-4 h-4" />
            复制到无痕
          </button>
          <button
            class="px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors flex items-center gap-2"
            @click="openAuthUrl"
          >
            <IconExternalLink class="w-4 h-4" />
            打开
          </button>
          <button class="px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors" @click="showSocialAuthModal = false">
            关闭
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
