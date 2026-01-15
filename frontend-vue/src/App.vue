<script setup lang="ts">
/**
 * 应用根组件
 *
 * 提供路由视图容器
 */
import ToastProvider from '@/components/ui/ToastProvider.vue'
import { onMounted } from 'vue'
import { useToast } from '@/components/ui/toast'

const DARKREADER_TOAST_KEY = 'darkreader-toast-shown'
const toast = useToast()

const detectDarkReader = () => {
  if (typeof document === 'undefined') return false
  const root = document.documentElement
  if (root.getAttribute('data-darkreader-mode') || root.getAttribute('data-darkreader-scheme')) {
    return true
  }
  if (document.querySelector('style.darkreader')) {
    return true
  }
  const globalHint = (window as any).__darkreader__
  return Boolean(globalHint)
}

onMounted(() => {
  if (typeof window === 'undefined') return
  if (window.sessionStorage.getItem(DARKREADER_TOAST_KEY) === '1') return
  if (!detectDarkReader()) return
  window.sessionStorage.setItem(DARKREADER_TOAST_KEY, '1')
  toast.warning('检测到 Dark Reader', '该扩展可能影响配色，请在此站点禁用')
})
</script>

<template>
  <ToastProvider>
    <RouterView />
  </ToastProvider>
</template>

<style>
/* 全局样式已通过 main.ts 引入 */
</style>
