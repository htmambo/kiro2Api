<script setup lang="ts">
const props = defineProps<{
  label: string
  modelValue: string
  options: { value: string; label: string }[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const handleChange = (event: Event) => {
  const target = event.target as HTMLSelectElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <div class="space-y-1.5">
    <label class="text-sm font-medium text-gray-300">{{ label }}</label>
    <select
      :value="modelValue"
      class="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all appearance-none cursor-pointer"
      style="background-image: url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E&quot;); background-repeat: no-repeat; background-position: right 0.75rem center; background-size: 1rem;"
      @change="handleChange"
    >
      <option v-for="option in options" :key="option.value" :value="option.value" class="bg-gray-900">
        {{ option.label }}
      </option>
    </select>
  </div>
</template>
