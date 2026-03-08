<script setup lang="ts">
/**
 * 登录页面
 */

import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores'
import { IconBolt, IconEye, IconEyeOff, IconLogin, IconSparkles } from '@tabler/icons-vue'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const password = ref('')
const showPassword = ref(false)
const error = ref('')
const loading = ref(false)

const handleSubmit = async (e: Event) => {
  e.preventDefault()
  error.value = ''
  loading.value = true

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: password.value }),
    })

    if (!response.ok) {
      throw new Error('登录失败')
    }

    const data: { success?: boolean; token?: string; message?: string } = await response.json()

    if (data.success && data.token) {
      authStore.setToken(data.token)
      const redirect = (route.query.redirect as string) || '/dashboard'
      router.push(redirect)
    } else {
      error.value = data.message || '密码错误，请重试'
      password.value = ''
    }
  } catch (err) {
    error.value = '登录失败，请检查网络连接'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex relative overflow-hidden">
    <!-- Unified background for both sides -->
    <div
      class="absolute inset-0"
      style="background: radial-gradient(ellipse 120% 100% at 35% 50%, rgba(6, 95, 70, 0.3) 0%, rgba(10, 20, 16, 1) 100%)"
    />

    <!-- Left Side - Animated Background (65%) -->
    <div class="hidden lg:flex lg:w-[65%] relative overflow-hidden">
      <!-- Gradient Overlay -->
      <div class="absolute inset-0 bg-gradient-to-br from-emerald-900/10 via-transparent to-transparent pointer-events-none" />

      <!-- Content -->
      <div class="relative z-10 flex flex-col px-20 pt-16">
        <div class="animate-fade-in-up">
          <div class="flex items-center gap-4">
            <img
              src="/logo.png"
              alt="Kiro2API Logo"
              class="w-14 h-14 drop-shadow-lg"
            />
            <h1 class="text-3xl font-bold text-white">Kiro2API</h1>
          </div>
        </div>
      </div>
    </div>

    <!-- Right Side - Login Form (35%) -->
    <div class="w-full lg:w-[35%] flex items-center justify-center p-8 relative">
      <!-- Mobile background -->
      <div class="lg:hidden absolute inset-0 bg-gradient-to-br from-emerald-900/10 via-emerald-700/10 to-emerald-400/10" />

      <div class="w-full max-w-md relative z-10 animate-scale-in">
        <!-- Login Card -->
        <div class="rounded-2xl p-[1px] relative bg-transparent">
          <!-- Inner card -->
          <div
            class="rounded-2xl border p-8 backdrop-blur-2xl relative"
            style="background-color: rgba(22, 22, 22, 0.8); border-color: rgba(255, 255, 255, 0.1); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5)"
          >
            <!-- Mobile Logo -->
            <div class="lg:hidden text-center mb-8">
              <div
                class="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
                style="background-color: rgba(0, 217, 163, 0.1)"
              >
                <IconBolt class="w-8 h-8" style="color: #00d9a3" />
              </div>
              <h1 class="text-2xl font-bold text-white">Kiro2API</h1>
            </div>

            <div class="mb-8">
              <h2 class="text-2xl font-bold text-white mb-2">登录</h2>
              <p class="text-sm text-gray-500">请输入密码以访问控制台</p>
            </div>

            <form @submit="handleSubmit" class="space-y-6">
              <!-- Password Input -->
              <div>
                <label for="password" class="block text-sm font-medium text-gray-400 mb-2">
                  密码
                </label>
                <div class="relative group">
                  <input
                    :type="showPassword ? 'text' : 'password'"
                    id="password"
                    v-model="password"
                    class="w-full px-4 py-3 rounded-lg border bg-black/30 text-white placeholder-gray-600 focus:outline-none ease-smooth transition-all relative z-10"
                    style="border-color: rgba(255, 255, 255, 0.05)"
                    placeholder="请输入密码"
                    required
                    autofocus
                  />
                  <button
                    type="button"
                    @click="showPassword = !showPassword"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 ease-smooth transition-colors z-20"
                  >
                    <IconEyeOff v-if="showPassword" class="w-5 h-5" />
                    <IconEye v-else class="w-5 h-5" />
                  </button>
                </div>

                <div v-if="error" class="mt-2 flex items-center gap-2 text-sm text-red-400 animate-fade-in">
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                  {{ error }}
                </div>
              </div>

              <!-- Submit Button -->
              <button
                type="submit"
                :disabled="loading"
                class="w-full py-3 px-4 rounded-lg font-semibold text-white flex items-center justify-center gap-2 ease-smooth transition-all duration-200 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 relative overflow-hidden group"
                style="background: linear-gradient(135deg, #00d9a3, #10b981, #00d9a3); box-shadow: 0 4px 20px rgba(0, 217, 163, 0.2)"
              >
                <!-- Shimmer effect -->
                <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full ease-smooth transition-transform duration-1000" />

                <span class="relative z-10 flex items-center gap-2">
                  <svg v-if="loading" class="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <IconLogin v-else class="w-5 h-5" />
                  {{ loading ? '登录中...' : '登录' }}
                </span>
              </button>
            </form>

            <!-- Divider -->
            <div class="relative my-6">
              <div class="absolute inset-0 flex items-center">
                <div class="w-full border-t" style="border-color: rgba(255, 255, 255, 0.05)" />
              </div>
              <div class="relative flex justify-center text-xs">
                <span class="px-2 text-gray-600" style="background-color: rgb(22, 22, 22)">
                  v1.0.0
                </span>
              </div>
            </div>

            <!-- Footer -->
            <div class="text-center space-y-3">
              <div class="flex items-center justify-center gap-2 text-xs text-gray-600">
                <IconSparkles class="w-4 h-4" style="color: #00d9a3" />
                <span>支持 Claude 协议</span>
              </div>
              <p class="text-xs text-gray-700">© 2025 Kiro2API. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
