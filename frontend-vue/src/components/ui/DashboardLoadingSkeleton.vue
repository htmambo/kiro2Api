<script setup lang="ts">
import Skeleton from './Skeleton.vue'
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="flex items-center justify-between">
      <div class="space-y-2">
        <Skeleton class="h-8 w-32" />
        <Skeleton class="h-4 w-48" />
      </div>
      <Skeleton class="h-10 w-28 rounded-lg" />
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div v-for="i in 4" :key="i" class="p-6 rounded-xl bg-white/[0.02] border border-white/10">
        <div class="flex items-center gap-4">
          <Skeleton class="w-14 h-14 rounded-xl" />
          <div class="space-y-2">
            <Skeleton class="h-3 w-16" />
            <Skeleton class="h-7 w-12" />
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="p-6 rounded-xl bg-white/[0.02] border border-white/10">
        <Skeleton class="h-5 w-32 mb-4" />
        <Skeleton class="h-64 w-full rounded-lg" />
      </div>
      <div class="p-6 rounded-xl bg-white/[0.02] border border-white/10">
        <Skeleton class="h-5 w-32 mb-4" />
        <Skeleton class="h-64 w-full rounded-lg" />
      </div>
    </div>
  </div>
</template>
