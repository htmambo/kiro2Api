<script setup lang="ts">
import Skeleton from './Skeleton.vue'
</script>

<template>
  <div class="p-6 rounded-xl bg-white/[0.02] border border-white/10">
    <div class="flex items-center gap-4">
      <Skeleton class="w-12 h-12 rounded-lg" />
      <div class="flex-1 space-y-2">
        <Skeleton class="h-4 w-24" />
        <Skeleton class="h-6 w-16" />
      </div>
    </div>
  </div>
</template>
