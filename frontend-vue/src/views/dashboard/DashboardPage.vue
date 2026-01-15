<script setup lang="ts">
/**
 * Dashboard 首页
 */

import { computed, onMounted, ref } from 'vue'
import {
  IconBolt,
  IconClock,
  IconCpu,
  IconChartLine,
  IconRefresh,
  IconLoader2,
  IconTrendingUp,
  IconRocket,
  IconPower,
} from '@tabler/icons-vue'
import { fetchWithAuth, isUnauthorizedError } from '@/lib/apiClient'
import PageLoadingSkeleton from '@/components/ui/PageLoadingSkeleton.vue'
import StatCard from '@/components/dashboard/StatCard.vue'
import EndpointCard from '@/components/dashboard/EndpointCard.vue'

interface SystemInfo {
  uptime: number | string
  nodeVersion: string
  serverTime: string
  memoryUsage: string
  isWorker?: boolean
}

interface PoolStats {
  healthy: number
  checking: number
  banned: number
  total: number
  totalUsageCount: number
  totalErrorCount: number
  cacheHitRate: string
}

interface QuotaSummary {
  totalQuota: number
  usedQuota: number
  remainingQuota: number
  percentUsed: number
  healthyAccounts: number
  totalAccounts: number
  accountsWithQuota: number
}

const systemInfo = ref<SystemInfo | null>(null)
const poolStats = ref<PoolStats | null>(null)
const quotaSummary = ref<QuotaSummary | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const restarting = ref(false)

const getResponseErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = await response.clone().json()
    if (payload?.error?.message) {
      return payload.error.message
    }
    if (payload?.message) {
      return payload.message
    }
  } catch {
    // ignore parse issues
  }
  return fallback
}

const formatUptime = (uptimeValue: number | string) => {
  const seconds = typeof uptimeValue === 'string' ? Number.parseFloat(uptimeValue) : uptimeValue
  if (Number.isNaN(seconds)) return '--'

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}天 ${hours}时`
  if (hours > 0) return `${hours}时 ${minutes}分`
  return `${minutes}分钟`
}

const getGreeting = () => {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

const greeting = computed(() => getGreeting())

const handleRestart = async () => {
  if (!confirm('确定要重启服务器吗？服务将暂时不可用。页面将在5秒后刷新。')) return

  restarting.value = true
  try {
    const response = await fetchWithAuth('/api/restart', { method: 'POST' })
    const data = await response.json()
    if (data.success) {
      setTimeout(() => {
        window.location.reload()
      }, 5000)
    } else {
      alert(`重启失败: ${data.message || '未知错误'}`)
      restarting.value = false
    }
  } catch (error) {
    console.error('Restart failed:', error)
    alert('重启请求发送失败')
    restarting.value = false
  }
}

const calculateQuotaSummary = (usageData: any): QuotaSummary => {
  let totalQuota = 0
  let usedQuota = 0
  let healthyAccounts = 0
  let totalAccounts = 0
  let accountsWithQuota = 0

  if (usageData?.providers) {
    for (const providerData of Object.values(usageData.providers) as any[]) {
      if (providerData.instances) {
        for (const instance of providerData.instances) {
          totalAccounts++
          if (instance.isHealthy) healthyAccounts++
          if (instance.limits?.total) {
            accountsWithQuota++
            totalQuota += instance.limits.total || 0
            usedQuota += instance.limits.used || 0
          }
        }
      }
    }
  }

  return {
    totalQuota,
    usedQuota,
    remainingQuota: totalQuota - usedQuota,
    percentUsed: totalQuota > 0 ? (usedQuota / totalQuota) * 100 : 0,
    healthyAccounts,
    totalAccounts,
    accountsWithQuota,
  }
}

const fetchAllData = async () => {
  refreshing.value = true
  try {
    const [systemRes, providersRes, usageRes] = await Promise.all([
      fetchWithAuth('/api/system'),
      fetchWithAuth('/api/accounts'),
      fetchWithAuth('/api/usage'),
    ])

    if (!systemRes.ok) {
      throw new Error(await getResponseErrorMessage(systemRes, '获取系统信息失败'))
    }
    if (!providersRes.ok) {
      throw new Error(await getResponseErrorMessage(providersRes, '获取账号信息失败'))
    }
    if (!usageRes.ok) {
      throw new Error(await getResponseErrorMessage(usageRes, '获取用量数据失败'))
    }

    systemInfo.value = await systemRes.json()

    const providersData = await providersRes.json()
    if (providersData._accountPoolStats) {
      poolStats.value = providersData._accountPoolStats
    }

    const usageData = await usageRes.json()
    quotaSummary.value = calculateQuotaSummary(usageData)
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Failed to fetch data:', error)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

onMounted(() => {
  fetchAllData()
})
</script>

<template>
  <PageLoadingSkeleton v-if="loading" />

  <div v-else class="space-y-6 animate-fade-in">
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="p-2.5 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/30">
          <IconRocket class="w-6 h-6 text-blue-400" />
        </div>
        <div>
          <p class="text-sm text-gray-500">{{ greeting }}</p>
          <h1 class="text-2xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            欢迎回来
          </h1>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="systemInfo?.isWorker"
          class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-50"
          :disabled="restarting"
          @click="handleRestart"
        >
          <IconLoader2 v-if="restarting" class="w-4 h-4 animate-spin" />
          <IconPower v-else class="w-4 h-4" />
          {{ restarting ? '重启中...' : '重启' }}
        </button>

        <button
          class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-white/5 border border-white/10 hover:bg-white/10 transition-all disabled:opacity-50"
          :disabled="refreshing"
          @click="fetchAllData"
        >
          <IconLoader2 v-if="refreshing" class="w-4 h-4 animate-spin" />
          <IconRefresh v-else class="w-4 h-4" />
          {{ refreshing ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </div>

    <div
      v-if="quotaSummary && quotaSummary.accountsWithQuota > 0"
      class="bg-gradient-to-br from-white/[0.05] to-white/[0.02] rounded-2xl border border-white/10 p-5 overflow-hidden"
    >
      <div class="flex flex-col lg:flex-row lg:items-center gap-6">
        <div class="flex-1">
          <div class="flex items-center gap-3 mb-4">
            <div class="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600">
              <IconTrendingUp class="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 class="font-semibold text-white">额度概览</h2>
              <p class="text-xs text-gray-500">{{ quotaSummary.accountsWithQuota }} 个账号</p>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span class="text-gray-400">已使用</span>
              <span class="font-medium">
                <span
                  :class="quotaSummary.percentUsed > 80 ? 'text-red-400' : quotaSummary.percentUsed > 50 ? 'text-amber-400' : 'text-emerald-400'"
                >
                  {{ quotaSummary.usedQuota.toFixed(1) }}
                </span>
                <span class="text-gray-600"> / {{ quotaSummary.totalQuota.toFixed(1) }}</span>
              </span>
            </div>
            <div class="h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                class="h-full transition-all duration-700"
                :class="quotaSummary.percentUsed > 80
                  ? 'bg-gradient-to-r from-red-500 to-pink-500'
                  : quotaSummary.percentUsed > 50
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-500'"
                :style="{ width: `${Math.min(quotaSummary.percentUsed, 100)}%` }"
              />
            </div>
            <div class="flex justify-between text-xs text-gray-600">
              <span>{{ quotaSummary.percentUsed.toFixed(1) }}%</span>
              <span>剩余 {{ quotaSummary.remainingQuota.toFixed(1) }}</span>
            </div>
          </div>
        </div>

        <div v-if="poolStats" class="lg:w-72 lg:border-l lg:border-white/10 lg:pl-6">
          <p class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">账号池</p>
          <div class="grid grid-cols-3 gap-2">
            <div class="text-center p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <div class="text-xl font-bold text-emerald-400">{{ poolStats.healthy }}</div>
              <div class="text-[10px] text-gray-500">健康</div>
            </div>
            <div class="text-center p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div class="text-xl font-bold text-amber-400">{{ poolStats.checking }}</div>
              <div class="text-[10px] text-gray-500">检查</div>
            </div>
            <div class="text-center p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
              <div class="text-xl font-bold text-red-400">{{ poolStats.banned }}</div>
              <div class="text-[10px] text-gray-500">异常</div>
            </div>
          </div>
          <div class="mt-2 flex justify-between text-[10px] text-gray-600">
            <span>请求: {{ poolStats.totalUsageCount }}</span>
            <span>缓存: {{ poolStats.cacheHitRate }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        :icon="IconBolt"
        title="运行时间"
        :value="systemInfo?.uptime ? formatUptime(systemInfo.uptime) : '--'"
        gradient="from-amber-500 to-orange-500"
        :loading="loading"
      />
      <StatCard
        :icon="IconClock"
        title="服务器时间"
        :value="systemInfo?.serverTime ? new Date(systemInfo.serverTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '--'"
        gradient="from-blue-500 to-cyan-500"
        :loading="loading"
      />
      <StatCard
        :icon="IconCpu"
        title="Node 版本"
        :value="systemInfo?.nodeVersion || '--'"
        gradient="from-emerald-500 to-teal-500"
        :loading="loading"
      />
      <StatCard
        :icon="IconChartLine"
        title="内存使用"
        :value="systemInfo?.memoryUsage || '--'"
        gradient="from-purple-500 to-pink-500"
        :loading="loading"
      />
    </div>

    <div>
      <p class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">API 端点</p>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EndpointCard
          title="OpenAI 协议"
          path="/claude-kiro-oauth/v1/chat/completions"
          description="兼容 OpenAI SDK，支持流式输出"
          recommended
          gradient="from-emerald-500 to-teal-500"
        />
        <EndpointCard
          title="Claude 协议"
          path="/claude-kiro-oauth/v1/messages"
          description="原生 Claude API 格式"
          gradient="from-blue-500 to-indigo-500"
        />
      </div>
    </div>
  </div>
</template>
