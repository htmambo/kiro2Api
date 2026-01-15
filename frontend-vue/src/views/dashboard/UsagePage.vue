<script setup lang="ts">
/**
 * 用量统计页面
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  IconChartLine,
  IconRefresh,
  IconTrendingUp,
  IconLoader2,
  IconFile,
  IconCrown,
} from '@tabler/icons-vue'
import CardSpotlight from '@/components/ui/CardSpotlight.vue'
import Badge from '@/components/ui/Badge.vue'
import PageLoadingSkeleton from '@/components/ui/PageLoadingSkeleton.vue'
import { useToast } from '@/components/ui/toast'
import { fetchWithAuth, registerUnauthorizedHandler, isUnauthorizedError } from '@/lib/apiClient'

interface UsageBreakdown {
  displayName: string
  currentUsage: number
  usageLimit: number
  unit?: string
  freeTrial?: {
    currentUsage: number
    usageLimit: number
    expiresAt?: string
  }
}

interface ProviderInstance {
  uuid: string
  email?: string
  userId?: string
  usageCount?: number
  errorCount?: number
  isHealthy?: boolean
  isDisabled?: boolean
  credentialsPath?: string
  subscription?: {
    title: string
    type: string
  }
  limits?: {
    used?: number
    remaining?: number
    total?: number
    percentUsed?: number
    unit?: string
  }
  usageBreakdown?: UsageBreakdown[]
  nextDateReset?: string
  daysUntilReset?: number
}

interface ProviderData {
  providerType: string
  instances: ProviderInstance[]
  totalCount: number
  successCount: number
  errorCount: number
}

interface UsageResponse {
  timestamp: string
  providers: {
    [key: string]: ProviderData
  }
  fromCache?: boolean
}

interface QuotaSummary {
  totalQuota: number
  usedQuota: number
  remainingQuota: number
  percentUsed: number
  healthyCount: number
  bannedCount: number
  totalCount: number
}

const toast = useToast()

const usageData = ref<UsageResponse | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const error = ref<string | null>(null)
const activePool = ref<'all' | 'healthy' | 'banned'>('all')
const refreshingAccount = ref<string | null>(null)
const autoRefresh = ref(false)

let refreshInterval: ReturnType<typeof setInterval> | null = null
let unregisterUnauthorized: (() => void) | null = null

const providers = computed(() => usageData.value?.providers || {})

const calculateSummary = (): QuotaSummary => {
  let totalQuota = 0
  let usedQuota = 0
  let healthyCount = 0
  let bannedCount = 0
  let totalCount = 0

  for (const providerData of Object.values(providers.value)) {
    if (providerData.instances) {
      for (const instance of providerData.instances) {
        totalCount++
        if (instance.isHealthy && !instance.isDisabled) {
          healthyCount++
        } else {
          bannedCount++
        }
        if (instance.limits) {
          totalQuota += instance.limits.total || 0
          usedQuota += instance.limits.used || 0
        }
      }
    }
  }

  const remainingQuota = totalQuota - usedQuota
  const percentUsed = totalQuota > 0 ? (usedQuota / totalQuota) * 100 : 0

  return {
    totalQuota,
    usedQuota,
    remainingQuota,
    percentUsed,
    healthyCount,
    bannedCount,
    totalCount,
  }
}

const summary = computed(() => calculateSummary())

const loadStats = async (forceRefresh = true) => {
  refreshing.value = true
  error.value = null
  const startTime = Date.now()

  try {
    const url = forceRefresh ? '/api/usage?refresh=true' : '/api/usage'
    const response = await fetchWithAuth(url)

    if (!response.ok) {
      throw new Error('加载用量数据失败')
    }

    usageData.value = await response.json()
  } catch (err) {
    if (isUnauthorizedError(err)) {
      return
    }
    console.error('Failed to load usage stats:', err)
    error.value = '加载用量数据失败'
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

const refreshAccountUsage = async (uuid: string) => {
  refreshingAccount.value = uuid
  try {
    const response = await fetchWithAuth(`/api/usage/${uuid}?refresh=true`)

    if (!response.ok) {
      throw new Error('刷新失败')
    }

    await loadStats(false)
    toast.success('刷新成功')
  } catch (err) {
    if (isUnauthorizedError(err)) {
      return
    }
    console.error('Failed to refresh account usage:', err)
    toast.error('刷新失败')
  } finally {
    refreshingAccount.value = null
  }
}

const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString('zh-CN')
const formatPercentage = (value?: number) => `${(value ?? 0).toFixed(1)}%`

const getAccountPool = (instance: ProviderInstance): 'healthy' | 'banned' => {
  if (instance.isDisabled || !instance.isHealthy) {
    return 'banned'
  }
  return 'healthy'
}

const filterInstances = (instances: ProviderInstance[]) => {
  if (activePool.value === 'all') return instances
  return instances.filter(instance => getAccountPool(instance) === activePool.value)
}

const providerEntries = computed(() => Object.entries(providers.value).filter(([, provider]) => {
  return filterInstances(provider.instances || []).length > 0
}))

watch(autoRefresh, value => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }

  if (value) {
    loadStats(true)
    refreshInterval = setInterval(() => {
      loadStats(true)
    }, 10000)
  }
})

onMounted(() => {
  unregisterUnauthorized = registerUnauthorizedHandler(() => {
    toast.error('请先登录以继续操作')
  })

  loadStats(false)
})

onBeforeUnmount(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }

  if (unregisterUnauthorized) {
    unregisterUnauthorized()
    unregisterUnauthorized = null
  }
})
</script>

<template>
  <PageLoadingSkeleton v-if="loading" />

  <div v-else-if="error" class="flex items-center justify-center h-64">
    <div class="text-red-400">{{ error }}</div>
  </div>

  <div v-else class="space-y-6">
    <div class="flex items-center justify-between animate-fade-in-up">
      <div>
        <h1 class="text-3xl font-bold mb-2">用量统计</h1>
        <p class="text-gray-400">API 使用情况和配额监控</p>
        <p v-if="usageData?.timestamp" class="text-xs text-gray-500 mt-1">
          更新时间: {{ formatDate(usageData.timestamp) }}
          <span v-if="usageData.fromCache" class="ml-2 text-blue-400">(缓存)</span>
        </p>
      </div>
      <div class="flex items-center gap-4">
        <label class="flex items-center gap-2 cursor-pointer group">
          <div class="relative">
            <input v-model="autoRefresh" type="checkbox" class="sr-only peer" />
            <div class="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </div>
          <span class="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
            自动刷新 <span v-if="autoRefresh" class="text-xs text-gray-500">(10秒)</span>
          </span>
        </label>

        <button
          class="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 rounded-lg font-semibold transition-all duration-200 hover:shadow-lg hover:shadow-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="refreshing || autoRefresh"
          @click="loadStats(true)"
        >
          <IconLoader2 v-if="refreshing" class="w-5 h-5 animate-spin" />
          <IconRefresh v-else class="w-5 h-5" />
          <span>{{ refreshing ? '刷新中...' : '刷新全部' }}</span>
        </button>
      </div>
    </div>

    <CardSpotlight class="overflow-hidden">
      <div class="flex flex-col lg:flex-row lg:items-center gap-6">
        <div class="flex-1">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <IconTrendingUp class="w-6 h-6" />
            </div>
            <div>
              <h2 class="text-xl font-bold">总额度概览</h2>
              <p class="text-sm text-gray-400">{{ summary.totalCount }} 个账号</p>
            </div>
          </div>

          <div class="mb-3">
            <div class="flex justify-between text-sm mb-2">
              <span class="text-gray-400">已使用 / 总额度</span>
              <span class="font-bold">
                <span :class="summary.percentUsed > 80 ? 'text-red-400' : summary.percentUsed > 50 ? 'text-orange-400' : 'text-green-400'">
                  {{ summary.usedQuota.toFixed(1) }}
                </span>
                <span class="text-gray-500"> / </span>
                <span class="text-white">{{ summary.totalQuota.toFixed(1) }}</span>
              </span>
            </div>
            <div class="h-4 bg-white/10 rounded-full overflow-hidden">
              <div
                class="h-full transition-all duration-500"
                :class="summary.percentUsed > 80
                  ? 'bg-gradient-to-r from-red-500 to-pink-600'
                  : summary.percentUsed > 50
                    ? 'bg-gradient-to-r from-orange-500 to-yellow-500'
                    : 'bg-gradient-to-r from-green-500 to-emerald-600'"
                :style="{ width: `${Math.min(summary.percentUsed, 100)}%` }"
              />
            </div>
            <div class="flex justify-between text-xs text-gray-500 mt-1">
              <span>{{ summary.percentUsed.toFixed(1) }}% 已使用</span>
              <span>剩余 {{ summary.remainingQuota.toFixed(1) }}</span>
            </div>
          </div>
        </div>

        <div class="lg:w-64 lg:border-l lg:border-white/10 lg:pl-6">
          <h3 class="text-sm font-medium text-gray-400 mb-3">按状态筛选</h3>
          <div class="grid grid-cols-3 gap-2">
            <button
              class="text-center p-3 rounded-lg border transition-all"
              :class="activePool === 'all'
                ? 'bg-blue-500/20 border-blue-500/50 ring-2 ring-blue-500'
                : 'bg-white/5 border-white/10 hover:bg-white/10'"
              @click="activePool = 'all'"
            >
              <div class="text-lg font-bold">{{ summary.totalCount }}</div>
              <div class="text-xs text-gray-400">全部</div>
            </button>
            <button
              class="text-center p-3 rounded-lg border transition-all"
              :class="activePool === 'healthy'
                ? 'bg-green-500/20 border-green-500/50 ring-2 ring-green-500'
                : 'bg-white/5 border-white/10 hover:bg-white/10'"
              @click="activePool = 'healthy'"
            >
              <div class="text-lg font-bold text-green-400">{{ summary.healthyCount }}</div>
              <div class="text-xs text-gray-400">健康</div>
            </button>
            <button
              class="text-center p-3 rounded-lg border transition-all"
              :class="activePool === 'banned'
                ? 'bg-red-500/20 border-red-500/50 ring-2 ring-red-500'
                : 'bg-white/5 border-white/10 hover:bg-white/10'"
              @click="activePool = 'banned'"
            >
              <div class="text-lg font-bold text-red-400">{{ summary.bannedCount }}</div>
              <div class="text-xs text-gray-400">异常</div>
            </button>
          </div>
        </div>
      </div>
    </CardSpotlight>

    <div
      v-for="[providerName, providerData] in providerEntries"
      :key="providerName"
      class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4"
    >
        <CardSpotlight
          v-for="(instance, index) in filterInstances(providerData.instances || [])"
          :key="instance.uuid || index"
          no-padding
          class="rounded-lg"
        >
          <div class="p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <span class="font-medium text-sm" :title="instance.email">
                  {{ instance.email || `账户 ${index + 1}` }}
                </span>
                <Badge v-if="getAccountPool(instance) === 'healthy'" class="bg-green-500/20 text-green-400 border-green-500/30">
                  健康
                </Badge>
                <Badge v-else class="bg-red-500/20 text-red-400 border-red-500/30">
                  异常
                </Badge>
              </div>
              <div class="flex items-center gap-2">
                <Badge v-if="instance.subscription" variant="outline" class="flex items-center gap-1">
                  <IconCrown class="w-3 h-3" />
                  {{ instance.subscription.title }}
                </Badge>
                <button
                  class="p-1.5 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
                  :disabled="refreshingAccount === instance.uuid"
                  title="刷新此账号用量"
                  @click="refreshAccountUsage(instance.uuid)"
                >
                  <IconLoader2 v-if="refreshingAccount === instance.uuid" class="w-4 h-4 animate-spin" />
                  <IconRefresh v-else class="w-4 h-4" />
                </button>
              </div>
            </div>

            <div v-if="instance.credentialsPath" class="flex items-center gap-2 mb-3 text-xs text-gray-500">
              <IconFile class="w-3 h-3" />
              <span class="truncate" :title="instance.credentialsPath">{{ instance.credentialsPath }}</span>
            </div>

            <div v-if="instance.limits" class="mb-4 p-3 rounded-lg border border-white/10" style="background-color: var(--fitness-card-hover);">
              <div class="flex justify-between text-sm mb-2">
                <span class="text-gray-400">总用量</span>
                <span class="font-medium">
                  {{ (instance.limits.used || 0).toFixed(2) }} / {{ (instance.limits.total || 0).toFixed(2) }}
                </span>
              </div>
              <div class="h-2.5 bg-black/40 rounded-full overflow-hidden mb-1 ring-1 ring-white/10">
                <div
                  class="h-full rounded-full transition-all"
                  :class="(instance.limits.percentUsed || 0) > 90
                    ? 'bg-red-500'
                    : (instance.limits.percentUsed || 0) > 70
                      ? 'bg-orange-500'
                      : 'bg-gradient-to-r from-green-500 to-emerald-600'"
                  :style="{ width: `${Math.min(instance.limits.percentUsed || 0, 100)}%` }"
                />
              </div>
              <p
                class="text-xs text-right font-medium"
                :class="(instance.limits.percentUsed || 0) > 90
                  ? 'text-red-400'
                  : (instance.limits.percentUsed || 0) > 70
                    ? 'text-orange-400'
                    : 'text-emerald-300'"
              >
                {{ formatPercentage(instance.limits.percentUsed) }}
              </p>
            </div>

            <div v-if="instance.usageBreakdown && instance.usageBreakdown.length" class="space-y-2 mb-3">
              <div v-for="(breakdown, idx) in instance.usageBreakdown" :key="idx" class="text-sm">
                <div class="flex justify-between text-gray-400">
                  <span>{{ breakdown.displayName }}</span>
                  <span>
                    {{ (breakdown.currentUsage || 0).toFixed(2) }} / {{ (breakdown.usageLimit || 0).toFixed(2) }}
                  </span>
                </div>
                <div v-if="breakdown.freeTrial" class="mt-1 pl-3 border-l-2 border-purple-500/50">
                  <div class="flex justify-between text-xs text-purple-400">
                    <span>免费试用</span>
                    <span>
                      {{ (breakdown.freeTrial.currentUsage || 0).toFixed(2) }} / {{ (breakdown.freeTrial.usageLimit || 0).toFixed(2) }}
                    </span>
                  </div>
                  <p v-if="breakdown.freeTrial.expiresAt" class="text-xs text-gray-500">
                    到期: {{ new Date(breakdown.freeTrial.expiresAt).toLocaleString('zh-CN') }}
                  </p>
                </div>
              </div>
            </div>

            <div class="pt-3 border-t border-white/10 grid grid-cols-2 gap-2 text-xs text-gray-400">
              <div v-if="instance.usageCount !== undefined" class="flex justify-between">
                <span>使用次数:</span>
                <span class="text-white">{{ instance.usageCount }}</span>
              </div>
              <div v-if="instance.errorCount !== undefined && instance.errorCount > 0" class="flex justify-between">
                <span>错误次数:</span>
                <span class="text-red-400">{{ instance.errorCount }}</span>
              </div>
              <div v-if="instance.daysUntilReset !== undefined" class="flex justify-between">
                <span>重置倒计时:</span>
                <span class="text-blue-400">{{ instance.daysUntilReset }} 天</span>
              </div>
            </div>
          </div>
        </CardSpotlight>
    </div>

    <CardSpotlight v-if="Object.keys(providers).length === 0">
      <div class="text-center py-12">
        <IconChartLine class="w-12 h-12 mx-auto text-gray-600 mb-4" />
        <p class="text-gray-400 text-lg">暂无用量数据</p>
        <p class="text-gray-500 text-sm mt-2">配置号池后将在此显示用量统计</p>
      </div>
    </CardSpotlight>

    <CardSpotlight
      v-else-if="Object.values(providers).every(provider => filterInstances(provider.instances || []).length === 0)"
    >
      <div class="text-center py-12">
        <p class="text-gray-400 text-lg">
          {{ activePool === 'healthy' ? '健康池' : '异常池' }}暂无账号
        </p>
        <button class="mt-4 text-blue-400 hover:underline" @click="activePool = 'all'">
          查看全部账号
        </button>
      </div>
    </CardSpotlight>
  </div>
</template>
