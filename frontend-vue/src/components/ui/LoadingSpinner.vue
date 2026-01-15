<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg' }>(), {
  size: 'md',
})

const sizeClass = computed(() => {
  const map = {
    sm: 'w-4 h-4 border-2',
    md: 'w-5 h-5 border-2',
    lg: 'w-8 h-8 border-3',
  }
  return map[props.size]
})
</script>

<template>
  <div
    class="rounded-full border-t-transparent animate-spin border-current"
    :class="sizeClass"
    :style="{ animation: 'spin 0.8s linear infinite' }"
  />
</template>
