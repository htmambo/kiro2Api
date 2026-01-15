import { ref } from 'vue'

type ThemeMode = 'dark' | 'light'

const STORAGE_KEY = 'ui-theme'
const theme = ref<ThemeMode>('dark')

const applyThemeClass = (mode: ThemeMode) => {
  if (typeof document === 'undefined') return
  const roots = [document.documentElement, document.body].filter(Boolean)
  roots.forEach(root => {
    root.classList.toggle('dark', mode === 'dark')
    root.classList.toggle('theme-light', mode === 'light')
  })
}

const resolveInitialTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'dark'
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  return media?.matches ? 'dark' : 'light'
}

export const initTheme = () => {
  theme.value = resolveInitialTheme()
  applyThemeClass(theme.value)
}

export const setTheme = (mode: ThemeMode) => {
  theme.value = mode
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, mode)
  }
  applyThemeClass(mode)
}

export const toggleTheme = () => {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}

export const useTheme = () => ({
  theme,
  setTheme,
  toggleTheme,
})
