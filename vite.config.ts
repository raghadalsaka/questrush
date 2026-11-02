import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { gameCatalog } from './build/gameCatalog.ts'

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [vue(), tailwindcss(), gameCatalog()],
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
})
