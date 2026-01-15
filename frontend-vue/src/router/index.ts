/**
 * Vue Router 配置
 *
 * 定义应用路由和导航守卫
 */

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores'

// 路由配置
const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/LoginPage.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/dashboard',
    component: () => import('@/layouts/DashboardLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'dashboard',
        component: () => import('@/views/dashboard/DashboardPage.vue'),
      },
      {
        path: 'config',
        name: 'config',
        component: () => import('@/views/dashboard/ConfigPage.vue'),
      },
      {
        path: 'providers',
        name: 'providers',
        component: () => import('@/views/dashboard/ProvidersPage.vue'),
      },
      {
        path: 'credentials',
        name: 'credentials',
        component: () => import('@/views/dashboard/CredentialsPage.vue'),
      },
      {
        path: 'usage',
        name: 'usage',
        component: () => import('@/views/dashboard/UsagePage.vue'),
      },
      {
        path: 'logs',
        name: 'logs',
        component: () => import('@/views/dashboard/LogsPage.vue'),
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard',
  },
]

// 创建 router 实例
export const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 导航守卫：检查认证状态
router.beforeEach((to, _from, next) => {
  const authStore = useAuthStore()

  // 加载 token（首次访问时）
  if (authStore.token === null) {
    authStore.loadTokenFromStorage()
  }

  const requiresAuth = to.meta.requiresAuth !== false // 默认需要认证

  if (requiresAuth && !authStore.isAuthenticated) {
    // 需要认证但未登录，跳转到登录页
    next({ name: 'login', query: { redirect: to.fullPath } })
  } else if (to.name === 'login' && authStore.isAuthenticated) {
    // 已登录用户访问登录页，跳转到 dashboard
    next({ name: 'dashboard' })
  } else {
    next()
  }
})

export default router
