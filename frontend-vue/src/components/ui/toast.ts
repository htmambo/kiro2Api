import { inject } from 'vue'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number
}

export interface ToastContext {
  showToast: (type: ToastType, title: string, message?: string, duration?: number) => void
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
}

export const toastKey = Symbol('toast')

export function useToast(): ToastContext {
  const context = inject<ToastContext | null>(toastKey, null)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
