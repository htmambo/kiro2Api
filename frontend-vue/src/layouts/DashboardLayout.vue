<script setup lang="ts">
/**
 * Dashboard 布局组件
 *
 * 提供侧边栏和主内容区域的布局
 */

import { RouterLink, useRoute } from 'vue-router'
import { computed } from 'vue'
import { IconDashboard, IconSettings, IconServer, IconKey, IconChartBar, IconFileText, IconLogout, IconMoon, IconSun } from '@tabler/icons-vue'
import { useAuthStore } from '@/stores'
import { useRouter } from 'vue-router'
import { useTheme } from '@/lib/theme'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { theme, toggleTheme } = useTheme()

const isDarkMode = computed(() => theme.value === 'dark')

const navigation = [
  { name: '概览', href: '/dashboard', icon: IconDashboard },
  { name: '配置管理', href: '/dashboard/config', icon: IconSettings },
  { name: '号池管理', href: '/dashboard/providers', icon: IconServer },
  { name: '凭据文件', href: '/dashboard/credentials', icon: IconKey },
  { name: '用量统计', href: '/dashboard/usage', icon: IconChartBar },
  { name: '运行日志', href: '/dashboard/logs', icon: IconFileText },
]

const currentPage = computed(() => {
  const item = navigation.find(n => n.href === route.path)
  return item?.name || 'Dashboard'
})

const handleLogout = () => {
  authStore.clearToken()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen" style="background-color: var(--fitness-bg);">
    <!-- Sidebar -->
    <aside class="fixed inset-y-0 left-0 w-64 border-r flex flex-col bg-[--panel]" style="border-color: var(--fitness-border)">
      <!-- Logo -->
      <div class="p-6 border-b" style="border-color: var(--fitness-border)">
        <div class="flex items-center gap-3">
          <img src="/logo.png" alt="Kiro2API" class="w-8 h-8" />
          <span class="text-lg font-bold text-white">Kiro2API</span>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 p-4 space-y-1">
        <RouterLink
          v-for="item in navigation"
          :key="item.name"
          :to="item.href"
          class="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all"
          :class="route.path === item.href
            ? 'bg-white/10 text-white'
            : 'text-gray-400 hover:text-white hover:bg-white/5'"
        >
          <component :is="item.icon" class="w-5 h-5" />
          {{ item.name }}
        </RouterLink>
      </nav>

      <!-- Logout -->
      <div class="p-4 border-t" style="border-color: var(--fitness-border)">
        <button
          @click="handleLogout"
          class="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all"
        >
          <IconLogout class="w-5 h-5" />
          退出登录
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="ml-64 h-screen flex flex-col">
      <!-- Header -->
      <header
        class="z-20 border-b px-8 py-4 shrink-0"
        style="border-color: var(--fitness-border); background-color: var(--panel);"
      >
        <div class="flex items-center justify-between">
          <h1 class="text-xl font-semibold text-white">{{ currentPage }}</h1>
          <button
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/10 transition-colors text-sm"
            @click="toggleTheme"
            :title="isDarkMode ? '切换到亮色' : '切换到暗色'"
          >
            <IconSun v-if="isDarkMode" class="w-4 h-4" />
            <IconMoon v-else class="w-4 h-4" />
            <span>{{ isDarkMode ? '亮色' : '暗色' }}</span>
          </button>
        </div>
      </header>

      <!-- Page Content -->
      <div class="flex-1 overflow-y-auto p-8">
        <RouterView />
      </div>
    </main>
  </div>
</template>
