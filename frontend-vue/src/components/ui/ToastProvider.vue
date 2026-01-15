<script setup lang="ts">
import { provide, ref } from 'vue'
import { IconCheck, IconX, IconAlertTriangle, IconInfoCircle } from '@tabler/icons-vue'
import { toastKey, type Toast, type ToastContext, type ToastType } from './toast'

const toasts = ref<Toast[]>([])

const removeToast = (id: string) => {
  toasts.value = toasts.value.filter(toast => toast.id !== id)
}

const showToast = (type: ToastType, title: string, message?: string, duration = 3000) => {
  const id = Math.random().toString(36).substring(2, 9)
  toasts.value = [...toasts.value, { id, type, title, message, duration }]

  if (duration > 0) {
    setTimeout(() => removeToast(id), duration)
  }
}

const context: ToastContext = {
  showToast,
  success: (title, message) => showToast('success', title, message),
  error: (title, message) => showToast('error', title, message, 5000),
  warning: (title, message) => showToast('warning', title, message, 4000),
  info: (title, message) => showToast('info', title, message),
}

provide(toastKey, context)

const icons = {
  success: IconCheck,
  error: IconX,
  warning: IconAlertTriangle,
  info: IconInfoCircle,
}

const colors = {
  success: 'from-green-500 to-emerald-600',
  error: 'from-red-500 to-rose-600',
  warning: 'from-orange-500 to-amber-600',
  info: 'from-blue-500 to-purple-600',
}

const bgColors = {
  success: 'bg-green-500/10 border-green-500/20',
  error: 'bg-red-500/10 border-red-500/20',
  warning: 'bg-orange-500/10 border-orange-500/20',
  info: 'bg-blue-500/10 border-blue-500/20',
}
</script>

<template>
  <slot />

  <TransitionGroup
    v-if="toasts.length"
    name="toast"
    tag="div"
    class="fixed top-4 right-4 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="pointer-events-auto"
    >
      <div
        class="relative overflow-hidden rounded-xl border backdrop-blur-xl shadow-2xl shadow-black/20"
        :class="bgColors[toast.type]"
      >
        <div class="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b" :class="colors[toast.type]" />

        <div class="flex items-start gap-3 p-4 pl-5">
          <div
            class="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white"
            :class="`bg-gradient-to-br ${colors[toast.type]}`"
          >
            <component :is="icons[toast.type]" class="w-5 h-5" />
          </div>

          <div class="flex-1 min-w-0">
            <h4 class="font-semibold text-white text-sm">{{ toast.title }}</h4>
            <p v-if="toast.message" class="mt-1 text-sm text-gray-400 break-words">{{ toast.message }}</p>
          </div>

          <button
            class="flex-shrink-0 p-1 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
            @click="removeToast(toast.id)"
          >
            <IconX class="w-4 h-4" />
          </button>
        </div>

        <div v-if="toast.duration && toast.duration > 0" class="h-0.5 bg-white/5">
          <div
            class="h-full"
            :class="`bg-gradient-to-r ${colors[toast.type]}`"
            :style="{ animation: `toast-shrink ${toast.duration}ms linear forwards` }"
          />
        </div>
      </div>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease-out;
}

.toast-enter-to,
.toast-leave-from {
  opacity: 1;
  transform: translateX(0);
}

@keyframes toast-shrink {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}
</style>
