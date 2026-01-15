<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string
  path: string
  description: string
  recommended?: boolean
  gradient: string
}>(), {
  recommended: false,
})
</script>

<template>
  <div class="group relative bg-gradient-to-br from-white/[0.05] to-white/[0.02] rounded-xl border border-white/10 p-4 hover:border-white/20 transition-all duration-300">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full bg-gradient-to-r" :class="gradient" />
        <h3 class="text-sm font-semibold text-white">{{ title }}</h3>
      </div>
      <span v-if="recommended" class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
        推荐
      </span>
    </div>
    <div class="bg-black/40 rounded-lg p-3 border border-white/5 mb-2 overflow-x-auto">
      <code class="text-xs font-mono">
        <span class="text-gray-500">POST</span>
        <span class="ml-2 bg-gradient-to-r bg-clip-text text-transparent" :class="gradient">{{ path }}</span>
      </code>
    </div>
    <p class="text-xs text-gray-500">{{ description }}</p>
  </div>
</template>
