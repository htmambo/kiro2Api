<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  icon: Component
  title: string
  value: string
  subtitle?: string
  gradient: string
  loading?: boolean
}>()
</script>

<template>
  <div class="group relative bg-gradient-to-br from-white/[0.05] to-white/[0.02] rounded-2xl border border-white/10 p-5 hover:border-white/20 transition-all duration-300 overflow-hidden">
    <div class="absolute -right-4 -top-4 w-24 h-24 rounded-full bg-gradient-to-br opacity-10 blur-2xl group-hover:opacity-20 transition-opacity" :class="gradient" />

    <div class="relative flex items-start justify-between">
      <div>
        <p class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{{ title }}</p>
        <h3 class="text-2xl font-bold text-white mb-1">
          <span v-if="loading" class="animate-pulse">--</span>
          <span v-else>{{ value }}</span>
        </h3>
        <p v-if="subtitle" class="text-xs text-gray-600">{{ subtitle }}</p>
      </div>
      <div class="p-2.5 rounded-xl bg-gradient-to-br" :class="gradient">
        <component :is="icon" class="w-5 h-5 text-white" />
      </div>
    </div>
  </div>
</template>
