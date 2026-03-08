import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useToast } from '@/components/ui/toast'
import { fetchWithAuth, isUnauthorizedError } from '@/lib/apiClient'
import type {
  AccountPoolFilter,
  AccountPoolStatus,
  AccountPoolStats,
  AuthStateResult,
  BatchHealthCheckResponse,
  ConfigUpdateEventPayload,
  DeviceAuthResponse,
  DeviceAuthSuccessResult,
  HealthCheckResult,
  MessageResponse,
  ProviderAccountsPayload,
  ProviderEventPayload,
  ProviderPools,
  TestAccountResult,
} from '@/lib/providers/types'
import {
  DEFAULT_AWS_START_URL,
  DEFAULT_PROVIDER_KEY,
  formatDate,
  formatRelativeTime,
  getAccountPool,
  getApiErrorMessage,
  getBatchDeleteStatusNames,
  getErrorStatusBadge,
  getNextAccountNumber,
  getPoolBadge,
} from '@/lib/providers/utils'

function getErrorDetail(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined
}

export function useProvidersPage() {
  const toast = useToast()

  const providers = ref<ProviderPools>({})
  const poolStats = ref<AccountPoolStats | null>(null)
  const activePool = ref<AccountPoolFilter>('all')
  const loading = ref(true)
  const refreshing = ref(false)
  const activeProvider = ref(DEFAULT_PROVIDER_KEY)
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
  const awsStartUrl = ref(DEFAULT_AWS_START_URL)
  const deviceAuthResult = ref<DeviceAuthSuccessResult | null>(null)

  let eventSource: EventSource | null = null
  let authPollInterval: ReturnType<typeof setInterval> | null = null

  const activeAccounts = computed(() => providers.value[activeProvider.value] ?? [])
  const totalAccounts = computed(() => activeAccounts.value.length)
  const healthyAccounts = computed(() => activeAccounts.value.filter(account => account.isHealthy).length)
  const totalUsage = computed(() => activeAccounts.value.reduce((sum, account) => sum + account.usageCount, 0))
  const totalErrors = computed(() => activeAccounts.value.reduce((sum, account) => sum + account.errorCount, 0))
  const filteredAccounts = computed(() => {
    if (activePool.value === 'all') {
      return activeAccounts.value
    }

    return activeAccounts.value.filter(account => getAccountPool(account) === activePool.value)
  })

  function handleActionError(consoleMessage: string, title: string, error: unknown): boolean {
    if (isUnauthorizedError(error)) {
      return true
    }

    console.error(consoleMessage, error)
    toast.error(title, getErrorDetail(error))
    return false
  }

  async function ensureOk(response: Response, fallback: string): Promise<Response> {
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, fallback))
    }

    return response
  }

  async function readJson<T>(response: Response, fallback: string): Promise<T> {
    const okResponse = await ensureOk(response, fallback)
    return okResponse.json() as Promise<T>
  }

  function stopAuthPolling() {
    if (authPollInterval) {
      clearInterval(authPollInterval)
      authPollInterval = null
    }
  }

  function closeEventSource() {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }

  function parseEventData<T>(event: Event, label: string): T | null {
    try {
      const messageEvent = event as MessageEvent<string>
      return JSON.parse(messageEvent.data) as T
    } catch (error) {
      console.error(`Failed to parse ${label} event:`, error)
      return null
    }
  }

  async function loadProviders() {
    refreshing.value = true
    const startTime = Date.now()

    try {
      const response = await fetchWithAuth('/api/accounts')
      const data = await readJson<ProviderAccountsPayload>(response, '加载号池失败')
      poolStats.value = data._accountPoolStats ?? null
      const accounts = Array.isArray(data.accounts) ? data.accounts : []
      providers.value = { [DEFAULT_PROVIDER_KEY]: accounts }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        return
      }

      console.error('Failed to load providers:', error)
      toast.error('加载号池失败', getErrorDetail(error))
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

  async function runBatchHealthCheck(poolFilter?: AccountPoolStatus) {
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

      const result = await readJson<BatchHealthCheckResponse>(response, '健康检查失败')
      await loadProviders()

      const poolName =
        poolFilter === 'banned'
          ? '异常池'
          : poolFilter === 'checking'
            ? '检查池'
            : ''

      toast.success(`${poolName}健康检查完成`, `${result.successCount} 个恢复健康, ${result.failCount} 个仍异常`)
    } catch (error) {
      handleActionError('Batch health check failed:', '健康检查失败', error)
    } finally {
      healthChecking.value = false
      bannedHealthChecking.value = false
    }
  }

  async function resetAllHealth() {
    if (!confirm('确定要重置所有账号的健康状态吗？')) {
      return
    }

    resettingHealth.value = true

    try {
      const response = await fetchWithAuth('/api/accounts/reset-health', {
        method: 'POST',
      })

      const result = await readJson<MessageResponse>(response, '重置失败')
      await loadProviders()
      toast.success('重置成功', result.message || '健康状态已重置')
    } catch (error) {
      handleActionError('Reset health failed:', '重置失败', error)
    } finally {
      resettingHealth.value = false
    }
  }

  function generateAuthUrl() {
    accountNumber.value = getNextAccountNumber(activeAccounts.value)
    showAuthMethodModal.value = true
  }

  async function handleManualImport() {
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

      await ensureOk(response, '导入失败')
      toast.success('导入成功', 'RefreshToken 已保存')
      showManualImportModal.value = false
      manualRefreshToken.value = ''
      manualProfileArn.value = ''
      await loadProviders()
    } catch (error) {
      handleActionError('Manual import failed:', '导入失败', error)
    } finally {
      generatingAuth.value = false
    }
  }

  async function handleAWSDeviceAuth() {
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

      const result = await readJson<DeviceAuthResponse>(response, '启动失败')
      if (result.success) {
        deviceAuthResult.value = result
        toast.success('设备授权已启动', '请在浏览器中完成授权')
      } else {
        toast.error('启动失败', result.error || '未知错误')
      }
    } catch (error) {
      handleActionError('AWS device auth failed:', '启动设备授权失败', error)
    } finally {
      generatingAuth.value = false
    }
  }

  function openAwsAuthModal() {
    showAuthMethodModal.value = false
    showAWSAuthModal.value = true
  }

  function openManualImportModal() {
    showAuthMethodModal.value = false
    showManualImportModal.value = true
  }

  function closeAwsModal() {
    showAWSAuthModal.value = false
    deviceAuthResult.value = null
  }

  function copyAuthUrl() {
    if (!authUrl.value) {
      return
    }

    navigator.clipboard.writeText(authUrl.value)
    toast.success('已复制', '请在无痕模式中打开此链接')
  }

  function openAuthUrl() {
    if (!authUrl.value) {
      return
    }

    window.open(authUrl.value, '_blank')
  }

  function copyAndPromptIncognito() {
    if (!authUrl.value) {
      return
    }

    navigator.clipboard.writeText(authUrl.value)
    toast.success('链接已复制！', '请打开无痕模式 (Ctrl+Shift+N) 粘贴访问')
  }

  function copyDeviceAuthLink() {
    const url = deviceAuthResult.value?.verificationUriComplete
    if (!url) {
      return
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => {
          toast.success('已复制', '验证链接已复制到剪贴板')
        })
        .catch(() => {
          toast.error('复制失败', '请手动复制链接')
        })
      return
    }

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

  async function toggleAccountStatus(uuid: string, currentStatus: boolean) {
    try {
      const response = await fetchWithAuth(`/api/accounts/${uuid}/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isDisabled: !currentStatus }),
      })

      await ensureOk(response, '更新失败')
      await loadProviders()
      toast.success('状态已更新', currentStatus ? '账号已启用' : '账号已禁用')
    } catch (error) {
      handleActionError('Failed to toggle account:', '更新失败', error)
    }
  }

  async function runHealthCheck(uuid: string) {
    accountHealthChecking.value = uuid

    try {
      const response = await fetchWithAuth(`/api/accounts/${uuid}/health-check`, {
        method: 'POST',
      })

      const result = await readJson<HealthCheckResult>(response, '健康检查失败')
      await loadProviders()

      if (result.isHealthy) {
        toast.success('账号健康', result.modelName ? `模型: ${result.modelName}` : undefined)
      } else {
        toast.warning('账号异常', result.error || undefined)
      }
    } catch (error) {
      handleActionError('Health check failed:', '健康检查失败', error)
    } finally {
      accountHealthChecking.value = null
    }
  }

  async function testAccount(uuid: string) {
    accountTesting.value = uuid

    try {
      const response = await fetchWithAuth(`/api/accounts/${uuid}/test`, {
        method: 'POST',
      })

      const result = await readJson<TestAccountResult>(response, '测试失败')
      await loadProviders()

      if (result.success) {
        toast.success('测试成功', result.message || '账号正常')
      } else {
        toast.error('测试失败', result.error || '未知错误')
      }
    } catch (error) {
      handleActionError('Test failed:', '测试失败', error)
    } finally {
      accountTesting.value = null
    }
  }

  async function resetAccountHealth(uuid: string) {
    accountResetting.value = uuid

    try {
      const response = await fetchWithAuth(`/api/accounts/${uuid}/reset-health`, {
        method: 'POST',
      })

      await ensureOk(response, '重置失败')
      await loadProviders()
      toast.success('重置成功', '健康状态已重置')
    } catch (error) {
      handleActionError('Reset failed:', '重置失败', error)
    } finally {
      accountResetting.value = null
    }
  }

  async function deleteAccount(uuid: string, accountIndex: number) {
    if (!confirm(`确定要删除账号 #${accountIndex + 1} 吗？\n\n该操作将同时删除对应的 token 文件，且不可恢复！`)) {
      return
    }

    accountDeleting.value = uuid

    try {
      const response = await fetchWithAuth(`/api/accounts/${uuid}`, {
        method: 'DELETE',
      })

      await ensureOk(response, '删除失败')
      await loadProviders()
      toast.success('删除成功', `账号 #${accountIndex + 1} 已删除`)
    } catch (error) {
      handleActionError('Delete failed:', '删除失败', error)
    } finally {
      accountDeleting.value = null
    }
  }

  async function batchDeleteAccounts() {
    if (selectedAccounts.value.size === 0) {
      toast.warning('请先选择账号')
      return
    }

    const selectedCount = selectedAccounts.value.size
    if (!confirm(`确定要删除选中的 ${selectedCount} 个账号吗？\n\n该操作将同时删除对应的 token 文件，且不可恢复！`)) {
      return
    }

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

      const result = await readJson<MessageResponse>(response, '批量删除失败')
      selectedAccounts.value = new Set()
      await loadProviders()
      toast.success('批量删除成功', result.message)
    } catch (error) {
      handleActionError('Batch delete failed:', '批量删除失败', error)
    } finally {
      batchDeleting.value = false
    }
  }

  async function batchDeleteByStatus(statusTypes: string[]) {
    const statusNames = getBatchDeleteStatusNames(statusTypes)
    if (!confirm(`确定要删除所有 ${statusNames} 的账号吗？\n\n该操作将同时删除对应的 token 文件，且不可恢复！`)) {
      return
    }

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

      const result = await readJson<MessageResponse>(response, '批量删除失败')
      selectedAccounts.value = new Set()
      await loadProviders()
      toast.success('批量删除成功', result.message)
    } catch (error) {
      handleActionError('Batch delete by status failed:', '批量删除失败', error)
    } finally {
      batchDeleting.value = false
    }
  }

  function toggleSelectAll() {
    if (selectedAccounts.value.size === filteredAccounts.value.length) {
      selectedAccounts.value = new Set()
      return
    }

    selectedAccounts.value = new Set(filteredAccounts.value.map(account => account.uuid))
  }

  function toggleAccountSelection(uuid: string) {
    const next = new Set(selectedAccounts.value)
    if (next.has(uuid)) {
      next.delete(uuid)
    } else {
      next.add(uuid)
    }

    selectedAccounts.value = next
  }

  watch([showSocialAuthModal, authState], ([show, state]) => {
    if (!show || !state) {
      stopAuthPolling()
      return
    }

    stopAuthPolling()

    authPollInterval = setInterval(async () => {
      try {
        const response = await fetchWithAuth(`/api/kiro/oauth/check-state?state=${state}`)
        if (!response.ok) {
          return
        }

        const result = (await response.json()) as AuthStateResult
        if (!result.completed) {
          return
        }

        stopAuthPolling()
        showSocialAuthModal.value = false
        toast.success('授权成功！', `账号 #${result.accountNumber || ''} 已添加`)
        await loadProviders()
      } catch (error) {
        if (isUnauthorizedError(error)) {
          return
        }

        console.warn('Polling auth state failed:', error)
      }
    }, 2000)
  })

  onMounted(() => {
    void loadProviders()

    const token = localStorage.getItem('authToken') || ''
    eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)

    eventSource.addEventListener('account_update', event => {
      const data = parseEventData<Record<string, unknown>>(event, 'account_update')
      if (!data) {
        return
      }

      console.log('Account update event received:', data)
      void loadProviders()
    })

    eventSource.addEventListener('config_update', event => {
      const data = parseEventData<ConfigUpdateEventPayload>(event, 'config_update')
      if (!data) {
        return
      }

      console.log('Config update event received:', data)
      if (data.type === 'account_pool' || data.filePath?.includes('account_pool')) {
        void loadProviders()
      }
    })

    eventSource.addEventListener('oauth_success', event => {
      const data = parseEventData<ProviderEventPayload>(event, 'oauth_success')
      if (!data) {
        return
      }

      console.log('OAuth success event received:', data)
      if (data.provider === 'claude-kiro-oauth-builderid') {
        showAWSAuthModal.value = false
        deviceAuthResult.value = null
        toast.success('AWS 授权成功！', data.credPath ? `Token 已保存: ${data.credPath}` : '')
        void loadProviders()
      }
    })

    eventSource.addEventListener('oauth_error', event => {
      const data = parseEventData<ProviderEventPayload>(event, 'oauth_error')
      if (!data) {
        return
      }

      console.log('OAuth error event received:', data)
      if (data.provider === 'claude-kiro-oauth-builderid') {
        toast.error('AWS 授权失败', data.error || '未知错误')
        deviceAuthResult.value = null
      }
    })

    eventSource.addEventListener('provider_update', event => {
      const data = parseEventData<Record<string, unknown>>(event, 'provider_update')
      if (!data) {
        return
      }

      console.log('Provider update event received:', data)
      void loadProviders()
    })

    eventSource.onerror = error => {
      console.error('SSE connection error:', error)
    }
  })

  onBeforeUnmount(() => {
    closeEventSource()
    stopAuthPolling()
  })

  return {
    loading,
    refreshing,
    poolStats,
    activePool,
    healthChecking,
    bannedHealthChecking,
    resettingHealth,
    generatingAuth,
    authUrl,
    showSocialAuthModal,
    socialAuthProvider,
    accountHealthChecking,
    accountTesting,
    accountResetting,
    accountDeleting,
    selectedAccounts,
    batchDeleting,
    showAuthMethodModal,
    showManualImportModal,
    showAWSAuthModal,
    accountNumber,
    manualRefreshToken,
    manualProfileArn,
    awsStartUrl,
    deviceAuthResult,
    activeAccounts,
    totalAccounts,
    healthyAccounts,
    totalUsage,
    totalErrors,
    filteredAccounts,
    loadProviders,
    runBatchHealthCheck,
    resetAllHealth,
    generateAuthUrl,
    handleManualImport,
    handleAWSDeviceAuth,
    openAwsAuthModal,
    openManualImportModal,
    closeAwsModal,
    copyAuthUrl,
    openAuthUrl,
    copyAndPromptIncognito,
    copyDeviceAuthLink,
    toggleAccountStatus,
    runHealthCheck,
    testAccount,
    resetAccountHealth,
    deleteAccount,
    batchDeleteAccounts,
    batchDeleteByStatus,
    toggleSelectAll,
    toggleAccountSelection,
    getErrorStatusBadge,
    formatDate,
    formatRelativeTime,
    getAccountPool,
    getPoolBadge,
  }
}
