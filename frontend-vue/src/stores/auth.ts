/**
 * 认证状态管理 Store
 *
 * 管理用户认证状态和 token
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  // State
  const token = ref<string | null>(null)
  const isAuthenticated = computed(() => token.value !== null)

  // Actions
  function setToken(newToken: string) {
    token.value = newToken
    if (typeof window !== 'undefined') {
      localStorage.setItem('authToken', newToken)
    }
  }

  function clearToken() {
    token.value = null
    if (typeof window !== 'undefined') {
      localStorage.removeItem('authToken')
    }
  }

  function loadTokenFromStorage() {
    if (typeof window !== 'undefined') {
      const savedToken = localStorage.getItem('authToken')
      if (savedToken) {
        token.value = savedToken
      }
    }
  }

  return {
    token,
    isAuthenticated,
    setToken,
    clearToken,
    loadTokenFromStorage,
  }
})
