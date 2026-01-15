<script setup lang="ts">
/**
 * Dashboard 布局组件
 *
 * 提供侧边栏和主内容区域的布局
 */

import { RouterLink, useRoute } from 'vue-router'
import { computed, ref, watch } from 'vue'
import { IconDashboard, IconSettings, IconServer, IconKey, IconChartBar, IconFileText, IconLogout, IconMoon, IconSun, IconMenu2, IconX } from '@tabler/icons-vue'
import { useAuthStore } from '@/stores'
import { useRouter } from 'vue-router'
import { useTheme } from '@/lib/theme'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { theme, toggleTheme } = useTheme()
const mobileMenuOpen = ref(false)

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

watch(() => route.path, () => {
  mobileMenuOpen.value = false
})

const handleLogout = () => {
  authStore.clearToken()
  router.push('/login')
}

const closeMobileMenu = () => {
  mobileMenuOpen.value = false
}
</script>

<template>
  <div class="min-h-screen" style="background-color: var(--fitness-bg);">
    <!-- Sidebar -->
    <aside class="fixed inset-y-0 left-0 w-40 border-r hidden md:flex flex-col bg-[var(--panel)]" style="border-color: var(--fitness-border)">
      <!-- Logo -->
      <div class="h-[51px] px-4 flex items-center border-b" style="border-color: var(--fitness-border)">
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

    <!-- Mobile Drawer -->
    <div
      class="fixed inset-0 z-40 md:hidden transition-opacity"
      :class="mobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'"
    >
      <div class="absolute inset-0 bg-black/60" @click="closeMobileMenu" />
      <aside
        class="absolute inset-y-0 left-0 w-64 max-w-[80vw] border-r flex flex-col bg-[var(--panel)] transition-transform"
        style="border-color: var(--fitness-border)"
        :class="mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'"
      >
        <div class="h-[51px] px-4 flex items-center justify-between border-b" style="border-color: var(--fitness-border)">
          <div class="flex items-center gap-3">
            <img src="/logo.png" alt="Kiro2API" class="w-7 h-7" />
            <span class="text-base font-bold text-white">Kiro2API</span>
          </div>
          <button
            class="p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="关闭菜单"
            @click="closeMobileMenu"
          >
            <IconX class="w-5 h-5" />
          </button>
        </div>

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
    </div>

    <!-- Main Content -->
    <main class="ml-0 md:ml-40 h-screen flex flex-col">
      <!-- Header -->
      <header
        class="z-20 border-b px-4 md:px-8 py-2 h-[51px] shrink-0 flex items-center"
        style="border-color: var(--fitness-border); background-color: var(--panel);"
      >
        <div class="flex items-center justify-between w-full">
          <div class="flex items-center gap-3">
            <button
              class="md:hidden p-2 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="打开菜单"
              @click="mobileMenuOpen = true"
            >
              <IconMenu2 class="w-5 h-5" />
            </button>
            <h1 class="text-xl font-semibold text-white">{{ currentPage }}</h1>
          </div>
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
      <div class="flex-1 overflow-y-auto p-4 md:p-8">
        <RouterView />
      </div>
    </main>
  </div>
</template>
