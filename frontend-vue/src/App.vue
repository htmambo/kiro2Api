<script setup lang="ts">
/**
 * 应用根组件
 *
 * 提供路由视图容器
 */
import ToastProvider from '@/components/ui/ToastProvider.vue'
</script>

<template>
  <ToastProvider>
    <RouterView />
  </ToastProvider>
</template>

<style>
/* 全局样式已通过 main.ts 引入 */
</style>
