<script setup lang="ts">
/**
 * 运行日志页面
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { IconTrash, IconDownload, IconRefresh, IconFilter, IconSearch } from '@tabler/icons-vue'
import { fetchWithAuth, isUnauthorizedError } from '@/lib/apiClient'

interface LogEntry {
  timestamp: string
  level: 'info' | 'error'
  message: string
}

const logs = ref<LogEntry[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const autoScroll = ref(true)
const filterLevel = ref<'all' | 'info' | 'error'>('all')
const searchQuery = ref('')
const logsEndRef = ref<HTMLDivElement | null>(null)

let eventSource: EventSource | null = null

const filteredLogs = computed(() => {
  let filtered = logs.value

  if (filterLevel.value !== 'all') {
    filtered = filtered.filter(log => log.level === filterLevel.value)
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(log => log.message.toLowerCase().includes(query))
  }

  return filtered
})

const scrollToBottom = () => {
  if (autoScroll.value && logsEndRef.value) {
    logsEndRef.value.scrollIntoView({ behavior: 'smooth' })
  }
}

watch([logs, autoScroll], () => {
  scrollToBottom()
})

const fetchLogs = async () => {
  try {
    loading.value = true
    const response = await fetchWithAuth('/api/logs')

    if (!response.ok) {
      throw new Error('获取日志失败')
    }

    logs.value = await response.json()
    error.value = null
  } catch (err) {
    if (isUnauthorizedError(err)) {
      return
    }
    error.value = err instanceof Error ? err.message : '获取日志失败'
  } finally {
    loading.value = false
  }
}

const clearLogs = async () => {
  if (!confirm('确定要清空所有日志吗？')) {
    return
  }

  try {
    const response = await fetchWithAuth('/api/logs', { method: 'DELETE' })
    if (!response.ok) {
      throw new Error('清空日志失败')
    }

    logs.value = []
    error.value = null
  } catch (err) {
    if (isUnauthorizedError(err)) {
      return
    }
    error.value = err instanceof Error ? err.message : '清空日志失败'
  }
}

const exportLogs = () => {
  const dataStr = JSON.stringify(logs.value, null, 2)
  const dataBlob = new Blob([dataStr], { type: 'application/json' })
  const url = URL.createObjectURL(dataBlob)
  const link = document.createElement('a')
  link.href = url
  link.download = `logs-${new Date().toISOString()}.json`
  link.click()
  URL.revokeObjectURL(url)
}

const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

const getLevelStyle = (level: string) => {
  switch (level) {
    case 'error':
      return 'bg-red-500/20 text-red-500'
    case 'info':
      return 'bg-blue-500/20 text-blue-500'
    default:
      return 'bg-gray-500/20 text-gray-500'
  }
}

onMounted(() => {
  fetchLogs()

  const token = localStorage.getItem('authToken') || ''
  eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)

  eventSource.addEventListener('log', event => {
    try {
      const logEntry = JSON.parse(event.data)
      logs.value = [...logs.value, logEntry].slice(-100)
      scrollToBottom()
    } catch (err) {
      console.error('解析日志事件失败:', err)
    }
  })

  eventSource.onerror = err => {
    console.error('SSE 连接错误:', err)
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
  <div class="space-y-6">
    <div>
      <h1 class="text-3xl font-bold" style="color: var(--text);">系统日志</h1>
      <p class="mt-2" style="color: var(--muted-text);">
        查看系统运行日志，最多保留 100 条最新记录
      </p>
    </div>

    <div v-if="error" class="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
      <p class="text-red-500">{{ error }}</p>
    </div>

    <div class="rounded-lg shadow p-4 border" style="background-color: var(--fitness-card); border-color: var(--fitness-border);">
      <div class="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div class="flex flex-col sm:flex-row gap-3 flex-1 w-full sm:w-auto">
          <div class="relative flex-1 min-w-[200px]">
            <IconSearch class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索日志..."
              class="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              style="background-color: var(--panel); color: var(--text); border-color: var(--fitness-border);"
            />
          </div>

          <div class="flex items-center gap-2">
            <IconFilter class="h-4 w-4 text-gray-500" />
            <select
              v-model="filterLevel"
              class="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              style="background-color: var(--panel); color: var(--text); border-color: var(--fitness-border);"
            >
              <option value="all">全部级别</option>
              <option value="info">信息</option>
              <option value="error">错误</option>
            </select>
          </div>
        </div>

        <div class="flex gap-2 w-full sm:w-auto">
          <button
            class="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            @click="fetchLogs"
          >
            <IconRefresh class="h-4 w-4" />
            刷新
          </button>
          <button
            class="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="logs.length === 0"
            @click="exportLogs"
          >
            <IconDownload class="h-4 w-4" />
            导出
          </button>
          <button
            class="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="logs.length === 0"
            @click="clearLogs"
          >
            <IconTrash class="h-4 w-4" />
            清空
          </button>
        </div>
      </div>
    </div>

    <div class="rounded-lg shadow overflow-hidden border" style="background-color: var(--fitness-card); border-color: var(--fitness-border);">
      <div v-if="loading && logs.length === 0" class="flex items-center justify-center h-64">
        <div class="text-center">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p class="mt-4" style="color: var(--muted-text);">加载日志中...</p>
        </div>
      </div>

      <div v-else class="divide-y divide-[color:var(--fitness-border)]">
        <div
          v-for="(log, index) in filteredLogs"
          :key="index"
          class="p-4 transition-colors hover:bg-[color:var(--fitness-card-hover)]"
        >
          <div class="flex items-start gap-4">
            <span class="text-sm min-w-[140px]" style="color: var(--muted-text);">
              {{ formatTimestamp(log.timestamp) }}
            </span>
            <span class="inline-flex px-2 py-1 text-xs font-medium rounded-full" :class="getLevelStyle(log.level)">
              {{ log.level.toUpperCase() }}
            </span>
            <p class="text-sm flex-1 break-words" style="color: var(--text);">
              {{ log.message }}
            </p>
          </div>
        </div>
        <div ref="logsEndRef"></div>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <input id="autoScroll" v-model="autoScroll" type="checkbox" class="rounded text-blue-600 focus:ring-blue-500" />
      <label for="autoScroll" class="text-sm" style="color: var(--muted-text);">自动滚动到最新</label>
    </div>
  </div>
</template>
