<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue'
import type { ClassValue } from 'clsx'
import { cn } from '@/lib/utils'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{ noBackground?: boolean; noPadding?: boolean }>(), {
  noBackground: false,
  noPadding: false,
})

const attrs = useAttrs()

const containerRef = ref<HTMLDivElement | null>(null)
const isFocused = ref(false)
const opacity = ref(0)
const position = ref({ x: 0, y: 0 })

const handleMouseMove = (event: MouseEvent) => {
  if (!containerRef.value || isFocused.value) return
  const rect = containerRef.value.getBoundingClientRect()
  position.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  }
}

const handleFocus = () => {
  isFocused.value = true
  opacity.value = 1
}

const handleBlur = () => {
  isFocused.value = false
  opacity.value = 0
}

const handleMouseEnter = () => {
  opacity.value = 1
}

const handleMouseLeave = () => {
  opacity.value = 0
}

const paddingClass = computed(() => (props.noPadding ? '' : 'p-6'))
const rootClass = computed(() => cn(paddingClass.value, attrs.class as ClassValue))

const containerStyle = computed(() => ({
  borderColor: 'var(--fitness-border)',
  boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
  ...(props.noBackground ? {} : { backgroundColor: 'var(--fitness-card)' }),
}))

const attrsWithoutClass = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})
</script>

<template>
  <div
    ref="containerRef"
    class="group relative overflow-hidden rounded-xl border ease-smooth transition-all duration-300"
    :class="rootClass"
    v-bind="attrsWithoutClass"
    :style="containerStyle"
    @mousemove="handleMouseMove"
    @focus="handleFocus"
    @blur="handleBlur"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <div
      v-if="!noBackground"
      class="absolute inset-0 opacity-0 group-hover:opacity-100 ease-smooth transition-opacity duration-300 -z-10"
      :style="{ backgroundColor: 'var(--fitness-card-hover)' }"
    />

    <div
      v-if="!noBackground"
      class="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-2xl -z-20"
      :style="{ backgroundColor: 'var(--fitness-accent-dim)' }"
    />

    <div
      v-if="!noBackground"
      class="pointer-events-none absolute -inset-px opacity-0 ease-smooth transition-opacity duration-300 rounded-xl"
      :style="{
        opacity,
        background: `radial-gradient(600px circle at ${position.x}px ${position.y}px, rgba(0, 217, 163, 0.08), rgba(0, 217, 163, 0.03), transparent 50%)`,
      }"
    />

    <div class="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.03] to-transparent" />

    <div
      class="absolute left-0 top-0 bottom-0 w-[2px] rounded-full opacity-0 group-hover:opacity-100 ease-smooth transition-opacity duration-500"
      :style="{ background: 'linear-gradient(to bottom, transparent, var(--fitness-accent), transparent)' }"
    />

    <div class="relative z-10">
      <slot />
    </div>
  </div>
</template>
