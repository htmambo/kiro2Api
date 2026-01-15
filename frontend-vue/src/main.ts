/**
 * 应用入口
 *
 * 初始化 Vue 应用、Pinia、Router 和全局样式
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { initTheme } from './lib/theme'

// 导入全局样式
import './styles/globals.css'

// 创建 Vue 应用实例
const app = createApp(App)

// 初始化主题（默认 dark）
initTheme()

// 创建 Pinia 实例
const pinia = createPinia()

// 注册插件
app.use(pinia)
app.use(router)

// 挂载应用
app.mount('#app')
