/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    // Rev. 5-11: expose on all interfaces (LAN access for testing on other devices).
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:17890',
    },
  },
  build: {
    outDir: 'dist',
    // Rev. edit-persistence: sandbox safe-delete intercepts rmSync on dist
    // and fails (trash path conversion). Skip the empty-out step instead.
    emptyOutDir: false,
    // Rev. 5-10: sourcemaps for production debugging + vendor chunk splitting.
    sourcemap: true,
    // Rev. 5-10: keep the default esbuild minifier, split stable vendors so
    // the large CodeMirror/diff bundles are cached independently of app code.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-codemirror': [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/commands',
            '@codemirror/lang-markdown',
          ],
          'vendor-diff': ['diff-match-patch'],
        },
      },
    },
  },
  // Rev. 5-12: drop console/debugger ONLY in production builds — dev/serve
  // keeps them for debugging.
  esbuild: command === 'build' ? { drop: ['console', 'debugger'] } : {},
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
  },
}))
