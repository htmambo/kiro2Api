<script setup lang="ts">
import Skeleton from './Skeleton.vue'
</script>

<template>
  <div class="p-4 rounded-xl bg-white/[0.02] border border-white/10">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4 flex-1">
        <Skeleton class="w-10 h-10 rounded-lg" />
        <div class="flex-1 space-y-2">
          <Skeleton class="h-4 w-32" />
          <Skeleton class="h-3 w-48" />
        </div>
      </div>
      <div class="flex gap-2">
        <Skeleton class="w-16 h-8 rounded-lg" />
        <Skeleton class="w-16 h-8 rounded-lg" />
      </div>
    </div>
  </div>
</template>
