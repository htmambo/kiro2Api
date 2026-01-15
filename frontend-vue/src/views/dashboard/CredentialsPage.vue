<script setup lang="ts">
/**
 * 凭据文件页面
 */

import { computed, onMounted, ref } from 'vue'
import {
  IconFile,
  IconTrash,
  IconEye,
  IconRefresh,
  IconSearch,
  IconCheck,
  IconX,
  IconKey,
  IconLock,
  IconFileText,
  IconLoader2,
  IconLink,
} from '@tabler/icons-vue'
import CardSpotlight from '@/components/ui/CardSpotlight.vue'
import Badge from '@/components/ui/Badge.vue'
import PageLoadingSkeleton from '@/components/ui/PageLoadingSkeleton.vue'
import { useToast } from '@/components/ui/toast'
import { fetchWithAuth, isUnauthorizedError } from '@/lib/apiClient'

interface CredentialFile {
  name: string
  path: string
  size: number
  modified: string
  type: string
  isUsed: boolean
  usedBy?: string[]
}

interface BulkLinkResult {
  filePath: string
  success: boolean
  message: string
  alreadyLinked?: boolean
}

interface BulkLinkSummary {
  attempted: number
  successCount: number
  failureCount: number
  skippedCount: number
  results: BulkLinkResult[]
}

const toast = useToast()

const credentials = ref<CredentialFile[]>([])
const loading = ref(true)
const refreshing = ref(false)
const searchTerm = ref('')
const statusFilter = ref<'all' | 'used' | 'unused'>('all')
const selectedFile = ref<CredentialFile | null>(null)
const fileContent = ref('')
const showModal = ref(false)
const linkingPaths = ref<Set<string>>(new Set())
const bulkLinking = ref(false)
const bulkLinkSummary = ref<BulkLinkSummary | null>(null)

const filteredCredentials = computed(() => {
  let filtered = [...credentials.value]

  if (searchTerm.value) {
    const term = searchTerm.value.toLowerCase()
    filtered = filtered.filter(cred =>
      cred.name.toLowerCase().includes(term) ||
      cred.path.toLowerCase().includes(term)
    )
  }

  if (statusFilter.value !== 'all') {
    filtered = filtered.filter(cred => statusFilter.value === 'used' ? cred.isUsed : !cred.isUsed)
  }

  return filtered
})

const totalFiles = computed(() => credentials.value.length)
const usedFiles = computed(() => credentials.value.filter(file => file.isUsed).length)
const unusedFiles = computed(() => totalFiles.value - usedFiles.value)
const totalSize = computed(() => credentials.value.reduce((sum, file) => sum + file.size, 0))

const getErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = await response.clone().json()
    if (payload?.error?.message) {
      return payload.error.message
    }
    if (payload?.message) {
      return payload.message
    }
  } catch {
    // ignore parse errors
  }
  return fallback
}

const loadCredentials = async (options?: { clearBulkSummary?: boolean }) => {
  refreshing.value = true
  if (options?.clearBulkSummary !== false) {
    bulkLinkSummary.value = null
  }
  const startTime = Date.now()

  try {
    const response = await fetchWithAuth('/api/upload-configs')
    if (!response.ok) {
      throw new Error(await getErrorMessage(response, '加载凭据失败'))
    }
    credentials.value = await response.json()
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Failed to load credentials:', error)
    toast.error('加载凭据失败', error instanceof Error ? error.message : undefined)
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

const viewFile = async (file: CredentialFile) => {
  try {
    const response = await fetchWithAuth(`/api/upload-configs/view/${encodeURIComponent(file.path)}`)
    if (!response.ok) {
      throw new Error(await getErrorMessage(response, '加载失败'))
    }
    const data = await response.json()
    fileContent.value = data.content || JSON.stringify(data, null, 2)
    selectedFile.value = file
    showModal.value = true
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Failed to load file content:', error)
    toast.error('加载失败', error instanceof Error ? error.message : '加载文件内容失败')
  }
}

const deleteFile = async (filePath: string) => {
  if (!confirm('确定要删除此文件吗？此操作不可撤销。')) {
    return
  }

  try {
    const response = await fetchWithAuth(`/api/upload-configs/delete/${encodeURIComponent(filePath)}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(await getErrorMessage(response, '删除失败'))
    }

    await loadCredentials()
    toast.success('删除成功', '文件已删除')
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Failed to delete file:', error)
    toast.error('删除失败', error instanceof Error ? error.message : undefined)
  }
}

const linkFile = async (filePath: string) => {
  if (linkingPaths.value.has(filePath)) return

  linkingPaths.value = new Set(linkingPaths.value).add(filePath)

  try {
    const response = await fetchWithAuth('/api/quick-link-provider', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filePath }),
    })

    if (!response.ok) {
      throw new Error(await getErrorMessage(response, '关联失败'))
    }

    const data = await response.json()
    if (!data?.success) {
      throw new Error(data?.message || data?.error?.message || '关联失败')
    }

    await loadCredentials()
    toast.success('关联成功', data?.message || '凭据已关联')
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Failed to link credential file:', error)
    toast.error('关联失败', error instanceof Error ? error.message : undefined)
  } finally {
    const next = new Set(linkingPaths.value)
    next.delete(filePath)
    linkingPaths.value = next
  }
}

const handleBulkLink = async () => {
  if (bulkLinking.value) return

  const unused = credentials.value.filter(file => !file.isUsed)
  if (unused.length === 0) {
    toast.info('当前没有未关联的凭据文件')
    return
  }

  bulkLinking.value = true
  bulkLinkSummary.value = null

  try {
    const response = await fetchWithAuth('/api/quick-link-provider/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filePaths: unused.map(file => file.path) }),
    })

    if (!response.ok) {
      throw new Error(await getErrorMessage(response, '批量关联失败'))
    }

    const data = await response.json()
    if (!data?.success) {
      throw new Error(data?.message || data?.error?.message || '批量关联失败')
    }

    const summary: BulkLinkSummary = {
      attempted: data.summary?.attempted || unused.length,
      successCount: data.summary?.successCount || 0,
      failureCount: data.summary?.failureCount || 0,
      skippedCount: data.summary?.skippedCount || 0,
      results: data.results || [],
    }

    bulkLinkSummary.value = summary

    if (summary.successCount === 0 && summary.failureCount > 0) {
      toast.error('批量关联失败', '所有文件关联失败，请检查失败详情')
    } else if (summary.failureCount > 0) {
      toast.warning('批量关联部分成功', `成功 ${summary.successCount} 个，失败 ${summary.failureCount} 个，已关联 ${summary.skippedCount} 个`)
    } else {
      toast.success('批量关联完成', data.message || `成功关联 ${summary.successCount} 个文件${summary.skippedCount > 0 ? `，跳过 ${summary.skippedCount} 个已关联文件` : ''}`)
    }

    await loadCredentials({ clearBulkSummary: false })
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }
    console.error('Failed to bulk link credential files:', error)
    toast.error('批量关联失败', error instanceof Error ? error.message : undefined)
  } finally {
    bulkLinking.value = false
  }
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString('zh-CN')

const getFileTypeIcon = (type: string) => {
  switch (type) {
    case 'oauth':
      return IconKey
    case 'api-key':
      return IconLock
    case 'system-prompt':
      return IconFileText
    default:
      return IconFile
  }
}

const getFileTypeClass = (type: string) => {
  switch (type) {
    case 'oauth':
      return 'text-blue-400'
    case 'api-key':
      return 'text-green-400'
    case 'system-prompt':
      return 'text-purple-400'
    default:
      return 'text-gray-400'
  }
}

const failedResults = computed(() => bulkLinkSummary.value?.results.filter(item => !item.success) ?? [])

onMounted(() => {
  loadCredentials()
})
</script>

<template>
  <PageLoadingSkeleton v-if="loading" />

  <div v-else class="space-y-6">
    <div class="flex items-center justify-between animate-fade-in-up">
      <div>
        <h1 class="text-3xl font-bold mb-2">凭据文件管理</h1>
        <p class="text-gray-400">管理 OAuth 凭据和配置文件</p>
      </div>
      <button
        class="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 rounded-lg font-semibold transition-all duration-200 hover:shadow-lg hover:shadow-purple-500/50 disabled:opacity-50"
        :disabled="refreshing"
        @click="() => loadCredentials()"
      >
        <IconLoader2 v-if="refreshing" class="w-5 h-5 animate-spin" />
        <IconRefresh v-else class="w-5 h-5" />
        <span>{{ refreshing ? '刷新中...' : '刷新列表' }}</span>
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
      <div class="animate-scale-in delay-100">
        <CardSpotlight>
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <IconFile class="w-6 h-6" />
            </div>
            <div>
              <p class="text-gray-400 text-sm">总文件数</p>
              <h3 class="text-2xl font-bold">{{ totalFiles }}</h3>
            </div>
          </div>
        </CardSpotlight>
      </div>

      <div class="animate-scale-in delay-200">
        <CardSpotlight>
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <IconCheck class="w-6 h-6" />
            </div>
            <div>
              <p class="text-gray-400 text-sm">已使用</p>
              <h3 class="text-2xl font-bold">{{ usedFiles }}</h3>
            </div>
          </div>
        </CardSpotlight>
      </div>

      <div class="animate-scale-in delay-300">
        <CardSpotlight>
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
              <IconX class="w-6 h-6" />
            </div>
            <div>
              <p class="text-gray-400 text-sm">未使用</p>
              <h3 class="text-2xl font-bold">{{ unusedFiles }}</h3>
            </div>
          </div>
        </CardSpotlight>
      </div>

      <div class="animate-scale-in delay-400">
        <CardSpotlight>
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
              <IconFile class="w-6 h-6" />
            </div>
            <div>
              <p class="text-gray-400 text-sm">总大小</p>
              <h3 class="text-2xl font-bold">{{ formatFileSize(totalSize) }}</h3>
            </div>
          </div>
        </CardSpotlight>
      </div>
    </div>

    <CardSpotlight>
      <div class="flex flex-col md:flex-row gap-4">
        <div class="flex-1 relative">
          <IconSearch class="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            v-model="searchTerm"
            type="text"
            placeholder="搜索文件名或路径..."
            class="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          />
        </div>
        <div class="flex gap-2">
          <button
            class="px-4 py-2 rounded-lg transition-all"
            :class="statusFilter === 'all' ? 'bg-blue-500 text-white' : 'bg-white/5 hover:bg-white/10'"
            @click="statusFilter = 'all'"
          >
            全部
          </button>
          <button
            class="px-4 py-2 rounded-lg transition-all"
            :class="statusFilter === 'used' ? 'bg-green-500 text-white' : 'bg-white/5 hover:bg-white/10'"
            @click="statusFilter = 'used'"
          >
            已使用
          </button>
          <button
            class="px-4 py-2 rounded-lg transition-all"
            :class="statusFilter === 'unused' ? 'bg-orange-500 text-white' : 'bg-white/5 hover:bg-white/10'"
            @click="statusFilter = 'unused'"
          >
            未使用
          </button>
          <button
            class="px-4 py-2 rounded-lg transition-all flex items-center gap-2"
            :disabled="bulkLinking || unusedFiles === 0"
            :class="bulkLinking
              ? 'bg-purple-500/80 text-white cursor-wait'
              : unusedFiles === 0
                ? 'bg-white/10 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600'"
            @click="handleBulkLink"
          >
            <IconLoader2 v-if="bulkLinking" class="w-4 h-4 animate-spin" />
            <IconLink v-else class="w-4 h-4" />
            <span>{{ bulkLinking ? '批量关联中...' : '批量关联' }}</span>
          </button>
        </div>
      </div>
      <div v-if="bulkLinkSummary" class="mt-4 p-4 bg-white/5 rounded-lg border border-white/10">
        <div class="flex items-start justify-between mb-2">
          <p class="text-sm text-gray-300">
            批量关联结果：共处理 {{ bulkLinkSummary.attempted }} 个文件，
            成功 <span class="text-green-400 font-semibold">{{ bulkLinkSummary.successCount }}</span> 个，
            失败 <span class="text-red-400 font-semibold">{{ bulkLinkSummary.failureCount }}</span> 个，
            已关联 <span class="text-yellow-400 font-semibold">{{ bulkLinkSummary.skippedCount }}</span> 个
          </p>
          <button
            class="text-gray-400 hover:text-white transition-colors"
            title="清除结果"
            @click="bulkLinkSummary = null"
          >
            <IconX class="w-4 h-4" />
          </button>
        </div>
        <div v-if="failedResults.length" class="mt-2 space-y-1">
          <p class="text-xs text-red-300 font-semibold">失败详情：</p>
          <div class="space-y-1 max-h-32 overflow-y-auto">
            <p
              v-for="(item, index) in failedResults.slice(0, 5)"
              :key="index"
              class="text-xs text-red-300 truncate"
              :title="`${item.filePath}: ${item.message}`"
            >
              • {{ item.filePath }}: {{ item.message }}
            </p>
            <p v-if="failedResults.length > 5" class="text-xs text-gray-400 italic">
              还有 {{ failedResults.length - 5 }} 个失败项未显示
            </p>
          </div>
        </div>
      </div>
    </CardSpotlight>

    <div class="grid grid-cols-1 gap-4">
      <CardSpotlight v-if="filteredCredentials.length === 0">
        <div class="text-center py-12">
          <p class="text-gray-400 text-lg">暂无凭据文件</p>
          <p class="text-gray-500 text-sm mt-2">请上传 OAuth 凭据文件</p>
        </div>
      </CardSpotlight>

      <CardSpotlight v-for="file in filteredCredentials" :key="file.path">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4 flex-1">
            <component :is="getFileTypeIcon(file.type)" class="w-5 h-5" :class="getFileTypeClass(file.type)" />
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <h3 class="font-semibold">{{ file.name }}</h3>
                <Badge v-if="file.isUsed" variant="default" class="bg-green-500">
                  <IconCheck class="w-3 h-3 mr-1" />
                  已使用
                </Badge>
                <Badge v-else variant="outline">
                  未使用
                </Badge>
              </div>
              <p class="text-sm text-gray-400 truncate max-w-lg" :title="file.path">
                {{ file.path }}
              </p>
              <div class="flex items-center gap-4 text-xs text-gray-500 mt-1">
                <span>{{ formatFileSize(file.size) }}</span>
                <span>{{ formatDate(file.modified) }}</span>
                <span v-if="file.usedBy && file.usedBy.length" class="text-blue-400">
                  关联: {{ file.usedBy.join(', ') }}
                </span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button
              v-if="!file.isUsed"
              class="px-3 py-1.5 text-sm rounded-lg border border-blue-500/50 text-blue-400 hover:bg-blue-500/10 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="linkingPaths.has(file.path)"
              @click="linkFile(file.path)"
            >
              <IconLoader2 v-if="linkingPaths.has(file.path)" class="w-4 h-4 animate-spin" />
              <IconLink v-else class="w-4 h-4" />
              <span>{{ linkingPaths.has(file.path) ? '关联中' : '关联' }}</span>
            </button>
            <button
              class="px-3 py-1.5 text-sm rounded-lg border border-white/10 hover:bg-white/5 transition-colors flex items-center gap-1"
              @click="viewFile(file)"
            >
              <IconEye class="w-4 h-4" />
              查看
            </button>
            <button
              class="px-3 py-1.5 text-sm rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1"
              @click="deleteFile(file.path)"
            >
              <IconTrash class="w-4 h-4" />
              删除
            </button>
          </div>
        </div>
      </CardSpotlight>
    </div>

    <div v-if="showModal && selectedFile" class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" @click="showModal = false">
      <div
        class="bg-gray-900 rounded-xl border border-white/10 max-w-4xl w-full max-h-[80vh] overflow-hidden"
        @click.stop
      >
        <div class="p-6 border-b border-white/10">
          <div class="flex items-center justify-between">
            <h3 class="text-xl font-bold">{{ selectedFile.name }}</h3>
            <button
              class="px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
              @click="showModal = false"
            >
              关闭
            </button>
          </div>
          <p class="text-sm text-gray-400 mt-1">{{ selectedFile.path }}</p>
        </div>
        <div class="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
          <pre class="bg-black/50 p-4 rounded-lg border border-white/10 overflow-x-auto">
            <code class="text-sm text-green-400 font-mono">{{ fileContent }}</code>
          </pre>
        </div>
      </div>
    </div>
  </div>
</template>
