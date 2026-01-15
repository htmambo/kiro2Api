<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label: string
    modelValue: any
    type?: 'text' | 'number' | 'textarea' | 'checkbox'
    placeholder?: string
    hint?: string
  }>(),
  {
    type: 'text',
    placeholder: '',
    hint: '',
  }
)

const emit = defineEmits<{ (e: 'update:modelValue', value: any): void }>()

const handleChange = (event: Event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement
  if (props.type === 'checkbox' && target instanceof HTMLInputElement) {
    emit('update:modelValue', target.checked)
    return
  }

  if (props.type === 'number') {
    const rawValue = (target as HTMLInputElement).value
    emit('update:modelValue', rawValue === '' ? '' : Number.parseInt(rawValue, 10))
    return
  }

  emit('update:modelValue', target.value)
}
</script>

<template>
  <div class="space-y-1.5">
    <label class="text-sm font-medium text-gray-300">{{ label }}</label>

    <textarea
      v-if="type === 'textarea'"
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      rows="3"
      class="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all resize-none placeholder:text-gray-600"
      @input="handleChange"
    />

    <label
      v-else-if="type === 'checkbox'"
      class="flex items-center gap-3 p-3 bg-black/20 rounded-lg border border-white/5 cursor-pointer hover:bg-black/30 transition-colors"
    >
      <div class="relative">
        <input type="checkbox" :checked="!!modelValue" class="sr-only" @change="handleChange" />
        <div :class="['w-10 h-6 rounded-full transition-colors', modelValue ? 'bg-blue-500' : 'bg-gray-700']">
          <div
            :class="['absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform', modelValue ? 'translate-x-5' : 'translate-x-1']"
          />
        </div>
      </div>
      <span class="text-sm text-gray-300">{{ hint || label }}</span>
    </label>

    <input
      v-else
      :type="type"
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      class="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all placeholder:text-gray-600"
      @input="handleChange"
    />

    <p v-if="hint && type !== 'checkbox'" class="text-xs text-gray-600">{{ hint }}</p>
  </div>
</template>
