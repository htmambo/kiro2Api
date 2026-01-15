<script setup lang="ts">
/**
 * 配置管理页面
 */

import { ref, onMounted, onBeforeUnmount } from 'vue'
import {
  IconCheck,
  IconRefresh,
  IconSettings,
  IconLoader2,
  IconServer,
  IconKey,
  IconSparkles,
  IconFileText,
  IconAdjustments,
  IconClock,
  IconDatabase,
  IconShieldCheck,
} from '@tabler/icons-vue'
import { fetchWithAuth, isUnauthorizedError } from '@/lib/apiClient'
import { useToast } from '@/components/ui/toast'
import PageLoadingSkeleton from '@/components/ui/PageLoadingSkeleton.vue'
import ConfigCard from '@/components/config/ConfigCard.vue'
import ConfigInput from '@/components/config/ConfigInput.vue'
import ConfigSelect from '@/components/config/ConfigSelect.vue'

interface ConfigData {
  REQUIRED_API_KEY: string
  HOST: string
  SERVER_PORT: number
  MODEL_PROVIDER: string
  systemPrompt: string
  KIRO_OAUTH_CREDS_BASE64?: string
  KIRO_OAUTH_CREDS_FILE_PATH?: string
  SYSTEM_PROMPT_FILE_PATH?: string
  SYSTEM_PROMPT_MODE?: string
  PROMPT_LOG_BASE_NAME?: string
  PROMPT_LOG_MODE?: string
  REQUEST_MAX_RETRIES?: number
  REQUEST_BASE_DELAY?: number
  CRON_NEAR_MINUTES?: number
  CRON_REFRESH_TOKEN?: boolean
  PROVIDER_POOLS_FILE_PATH?: string
  MAX_ERROR_COUNT?: number
  ENABLE_THINKING_BY_DEFAULT?: boolean
  USE_SQLITE_POOL?: boolean
  SQLITE_DB_PATH?: string
  USAGE_CACHE_TTL?: number
  HEALTH_CHECK_CONCURRENCY?: number
  USAGE_QUERY_CONCURRENCY?: number
}

const toast = useToast()

const config = ref<ConfigData | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const saving = ref(false)
const kiroCredsType = ref<'base64' | 'file'>('file')

let eventSource: EventSource | null = null

const normalizeConfigPayload = (payload: unknown): ConfigData | null => {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const raw = payload as Record<string, any>
  const data = raw.data ?? raw.config ?? raw

  if (!data || typeof data !== 'object') {
    return null
  }

  return data as ConfigData
}

const loadConfig = async () => {
  refreshing.value = true
  try {
    const response = await fetchWithAuth('/api/config')
    if (!response.ok) {
      throw new Error('加载配置失败')
    }

    const payload = await response.json()
    if (payload?.error?.message) {
      throw new Error(payload.error.message)
    }

    const data = normalizeConfigPayload(payload)
    if (!data) {
      throw new Error('配置数据为空或格式不正确')
    }

    config.value = data
    if (data.KIRO_OAUTH_CREDS_BASE64) {
      kiroCredsType.value = 'base64'
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Failed to load config:', error)
    toast.error('加载配置失败', error instanceof Error ? error.message : undefined)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

const saveConfig = async () => {
  if (!config.value) return
  saving.value = true

  try {
    const saveData = { ...config.value } as Record<string, any>
    if (config.value.MODEL_PROVIDER === 'claude-kiro-oauth') {
      if (kiroCredsType.value === 'base64') {
        delete saveData.KIRO_OAUTH_CREDS_FILE_PATH
      } else {
        delete saveData.KIRO_OAUTH_CREDS_BASE64
      }
    }

    const response = await fetchWithAuth('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(saveData),
    })

    if (!response.ok) {
      throw new Error('保存配置失败')
    }

    await fetchWithAuth('/api/reload-config', { method: 'POST' })
    toast.success('配置已保存')
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Failed to save config:', error)
    toast.error('保存配置失败', error instanceof Error ? error.message : undefined)
  } finally {
    saving.value = false
  }
}

const updateConfig = (key: keyof ConfigData, value: any) => {
  if (!config.value) return
  config.value = { ...config.value, [key]: value }
}

onMounted(() => {
  loadConfig()

  const token = localStorage.getItem('authToken') || ''
  eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)

  eventSource.addEventListener('config_update', event => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'main_config' || data.type === 'system_prompt') {
        loadConfig()
      }
    } catch (error) {
      console.error('Failed to parse config_update event:', error)
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
})
</script>

<template>
  <PageLoadingSkeleton v-if="loading || !config" />

  <div v-else class="space-y-6 animate-fade-in">
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/30">
          <IconSettings class="w-6 h-6 text-violet-400" />
        </div>
        <div>
          <h1 class="text-2xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            配置管理
          </h1>
          <p class="text-sm text-gray-500">系统配置，小心操作，确保正确无误。</p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-white/5 border border-white/10 hover:bg-white/10 transition-all disabled:opacity-50"
          :disabled="refreshing"
          @click="loadConfig"
        >
          <IconLoader2 v-if="refreshing" class="w-4 h-4 animate-spin" />
          <IconRefresh v-else class="w-4 h-4" />
          刷新
        </button>
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 transition-all shadow-lg shadow-blue-500/25 disabled:opacity-50"
          :disabled="saving"
          @click="saveConfig"
        >
          <IconLoader2 v-if="saving" class="w-4 h-4 animate-spin" />
          <IconCheck v-else class="w-4 h-4" />
          保存配置
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ConfigCard
        :accent-color="'#0000ff'"
        :accent-dim="'#0000ff55'"
        :icon="IconServer"
        title="服务器设置"
        description="API 端口和主机配置"
        gradient="from-blue-500 to-cyan-500"
      >
        <div class="grid grid-cols-2 gap-3">
          <ConfigInput
            label="端口"
            type="number"
            placeholder="8088"
            :model-value="config.SERVER_PORT"
            @update:model-value="value => updateConfig('SERVER_PORT', value)"
          />
          <ConfigInput
            label="主机"
            placeholder="localhost"
            :model-value="config.HOST"
            @update:model-value="value => updateConfig('HOST', value)"
          />
        </div>
      </ConfigCard>

      <ConfigCard
        :accent-color="'#ff6900'"
        :accent-dim="'#ff690055'"
        :icon="IconKey"
        title="认证设置"
        description="API 密钥与凭据"
        gradient="from-amber-500 to-orange-500"
      >
        <ConfigInput
          label="API Key"
          placeholder="your-api-key"
          hint="用于验证 API 请求"
          :model-value="config.REQUIRED_API_KEY"
          @update:model-value="value => updateConfig('REQUIRED_API_KEY', value)"
        />
    </ConfigCard>

      <ConfigCard
        :accent-color="'#ff0000'"
        :accent-dim="'#ff000055'"
        :icon="IconSparkles"
        title="AI 功能"
        description="模型行为设置"
        gradient="from-pink-500 to-rose-500"
      >
        <ConfigInput
          label="默认启用 Thinking"
          type="checkbox"
          hint="为支持的模型启用思考模式"
          :model-value="config.ENABLE_THINKING_BY_DEFAULT"
          @update:model-value="value => updateConfig('ENABLE_THINKING_BY_DEFAULT', value)"
        />
        <ConfigInput
          label="系统提示词"
          type="textarea"
          placeholder="可选的系统提示词..."
          :model-value="config.systemPrompt"
          @update:model-value="value => updateConfig('systemPrompt', value)"
        />
      </ConfigCard>

      <ConfigCard
        :icon="IconFileText"
        title="提示词设置"
        description="系统提示词文件配置"
        gradient="from-emerald-500 to-teal-500"
      >
        <ConfigInput
          label="提示词文件路径"
          placeholder="input_system_prompt.txt"
          :model-value="config.SYSTEM_PROMPT_FILE_PATH"
          @update:model-value="value => updateConfig('SYSTEM_PROMPT_FILE_PATH', value)"
        />
        <ConfigSelect
          label="提示词模式"
          :model-value="config.SYSTEM_PROMPT_MODE || 'append'"
          :options="[
            { value: 'append', label: '追加模式' },
            { value: 'overwrite', label: '覆盖模式' },
          ]"
          @update:model-value="value => updateConfig('SYSTEM_PROMPT_MODE', value)"
        />
      </ConfigCard>

      <ConfigCard
        :accent-color="'#8200db'"
        :accent-dim="'#8200db55'"
        :icon="IconAdjustments"
        title="请求设置"
        description="重试与延迟配置"
        gradient="from-indigo-500 to-violet-500"
      >
        <div class="grid grid-cols-3 gap-3">
          <ConfigInput
            label="最大重试"
            type="number"
            placeholder="3"
            :model-value="config.REQUEST_MAX_RETRIES"
            @update:model-value="value => updateConfig('REQUEST_MAX_RETRIES', value)"
          />
          <ConfigInput
            label="延迟 (ms)"
            type="number"
            placeholder="1000"
            :model-value="config.REQUEST_BASE_DELAY"
            @update:model-value="value => updateConfig('REQUEST_BASE_DELAY', value)"
          />
          <ConfigInput
            label="最大错误"
            type="number"
            placeholder="3"
            :model-value="config.MAX_ERROR_COUNT"
            @update:model-value="value => updateConfig('MAX_ERROR_COUNT', value)"
          />
        <ConfigInput
            label="缓存时长(秒)"
            type="number"
            placeholder="300"
            :model-value="config.USAGE_CACHE_TTL"
            @update:model-value="value => updateConfig('USAGE_CACHE_TTL', value)"
        />
        <ConfigInput
            label="检查并发"
            type="number"
            placeholder="5"
            :model-value="config.HEALTH_CHECK_CONCURRENCY"
            @update:model-value="value => updateConfig('HEALTH_CHECK_CONCURRENCY', value)"
        />
        <ConfigInput
            label="查询并发"
            type="number"
            placeholder="10"
            :model-value="config.USAGE_QUERY_CONCURRENCY"
            @update:model-value="value => updateConfig('USAGE_QUERY_CONCURRENCY', value)"
        />

        </div>
      </ConfigCard>

      <ConfigCard
        :accent-color="'#155bfc'"
        :accent-dim="'#155bfc55'"
        :icon="IconClock"
        title="定时任务"
        description="Token 刷新设置"
        gradient="from-sky-500 to-blue-500"
      >
        <ConfigInput
          label="临近时间 (分钟)"
          type="number"
          placeholder="15"
          hint="Token 过期前多少分钟刷新"
          :model-value="config.CRON_NEAR_MINUTES"
          @update:model-value="value => updateConfig('CRON_NEAR_MINUTES', value)"
        />
        <ConfigInput
          label="自动刷新 Token"
          type="checkbox"
          hint="定时刷新 OAuth Token"
          :model-value="config.CRON_REFRESH_TOKEN"
          @update:model-value="value => updateConfig('CRON_REFRESH_TOKEN', value)"
        />
      </ConfigCard>

      <ConfigCard
        :accent-color="'#62748e'"
        :accent-dim="'#62748e55'"
        :icon="IconDatabase"
        title="日志设置"
        description="请求日志记录"
        gradient="from-gray-500 to-slate-500"
      >
        <ConfigInput
          label="日志文件名"
          placeholder="prompt_log"
          :model-value="config.PROMPT_LOG_BASE_NAME"
          @update:model-value="value => updateConfig('PROMPT_LOG_BASE_NAME', value)"
        />
        <ConfigSelect
          label="日志模式"
          :model-value="config.PROMPT_LOG_MODE || 'none'"
          :options="[
            { value: 'none', label: '禁用' },
            { value: 'console', label: '控制台' },
            { value: 'file', label: '文件' },
          ]"
          @update:model-value="value => updateConfig('PROMPT_LOG_MODE', value)"
        />
      </ConfigCard>

      <ConfigCard
        :accent-color="'#ec003f'"
        :accent-dim="'#ec003f55'"
        :icon="IconShieldCheck"
        title="号池管理"
        description="多账号池配置"
        gradient="from-fuchsia-500 to-pink-500"
      >
        <ConfigInput
          label="配置文件路径"
          placeholder="provider_pools.json"
          hint="多账号负载均衡配置"
          :model-value="config.PROVIDER_POOLS_FILE_PATH"
          @update:model-value="value => updateConfig('PROVIDER_POOLS_FILE_PATH', value)"
        />
      </ConfigCard>
    </div>
  </div>
</template>
