<script setup lang="ts">
import CardSkeleton from './CardSkeleton.vue'
import TableRowSkeleton from './TableRowSkeleton.vue'
import Skeleton from './Skeleton.vue'
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="flex items-center justify-between">
      <div class="space-y-2">
        <Skeleton class="h-8 w-48" />
        <Skeleton class="h-4 w-64" />
      </div>
      <Skeleton class="h-12 w-32 rounded-lg" />
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <CardSkeleton v-for="i in 4" :key="i" />
    </div>

    <div class="space-y-4">
      <TableRowSkeleton v-for="i in 3" :key="i" />
    </div>
  </div>
</template>
