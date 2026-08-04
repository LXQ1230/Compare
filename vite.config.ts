/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:17890',
    },
  },
  build: {
    outDir: 'dist',
    // Rev. edit-persistence: sandbox safe-delete intercepts rmSync on dist
    // and fails (trash path conversion). Skip the empty-out step instead.
    emptyOutDir: false,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
  },
})
