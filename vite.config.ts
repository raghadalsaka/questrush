import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { gameCatalog } from './build/gameCatalog.ts'

// The repo-root .env holds the VITE_* settings; only VITE_* values reach the browser.
const ENV_DIR: string = '.'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ENV_DIR, '')
  return {
    base: process.env.VITE_BASE || '/',
    envDir: ENV_DIR,
    plugins: [vue(), tailwindcss(), gameCatalog()],
    server: {
      proxy: {
        '/api': { target: env.VITE_PROXY_TARGET || 'http://localhost:8080' },
      },
    },
    test: {
      environment: 'happy-dom',
      include: ['tests/**/*.test.ts'],
    },
  }
})
