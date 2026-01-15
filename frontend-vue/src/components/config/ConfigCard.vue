<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ icon: Component; title: string; description?: string; gradient: string }>()
</script>

<template>
  <div class="group relative bg-gradient-to-br from-white/[0.05] to-white/[0.02] rounded-2xl border border-white/10 overflow-hidden hover:border-white/20 transition-all duration-300">
    <div class="h-1 bg-gradient-to-r" :class="gradient" />

    <div class="p-5">
      <div class="flex items-start gap-3 mb-4">
        <div class="p-2 rounded-xl bg-gradient-to-br bg-opacity-20" :class="gradient">
          <component :is="icon" class="w-5 h-5 text-white" />
        </div>
        <div class="flex-1">
          <h3 class="font-semibold text-white">{{ title }}</h3>
          <p v-if="description" class="text-xs text-gray-500 mt-0.5">{{ description }}</p>
        </div>
      </div>

      <div class="space-y-4">
        <slot />
      </div>
    </div>
  </div>
</template>
