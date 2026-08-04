// vite.config.ts
import { defineConfig } from "file:///D:/Desktop/Compare/node_modules/vite/dist/node/index.js";
import vue from "file:///D:/Desktop/Compare/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import { resolve } from "path";
var __vite_injected_original_dirname = "D:\\Desktop\\Compare";
var vite_config_default = defineConfig(({ command }) => ({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__vite_injected_original_dirname, "src")
    }
  },
  server: {
    port: 5173,
    // Rev. 5-11: expose on all interfaces (LAN access for testing on other devices).
    host: true,
    proxy: {
      "/api": "http://127.0.0.1:17890"
    }
  },
  build: {
    outDir: "dist",
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
          "vendor-vue": ["vue", "vue-router", "pinia"],
          "vendor-codemirror": [
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/commands",
            "@codemirror/lang-markdown"
          ],
          "vendor-diff": ["diff-match-patch"]
        }
      }
    }
  },
  // Rev. 5-12: drop console/debugger ONLY in production builds — dev/serve
  // keeps them for debugging.
  esbuild: command === "build" ? { drop: ["console", "debugger"] } : {},
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.ts"]
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxEZXNrdG9wXFxcXENvbXBhcmVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkQ6XFxcXERlc2t0b3BcXFxcQ29tcGFyZVxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRDovRGVza3RvcC9Db21wYXJlL3ZpdGUuY29uZmlnLnRzXCI7Ly8vIDxyZWZlcmVuY2UgdHlwZXM9XCJ2aXRlc3RcIiAvPlxuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCB2dWUgZnJvbSAnQHZpdGVqcy9wbHVnaW4tdnVlJ1xuaW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gJ3BhdGgnXG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBjb21tYW5kIH0pID0+ICh7XG4gIHBsdWdpbnM6IFt2dWUoKV0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgJ0AnOiByZXNvbHZlKF9fZGlybmFtZSwgJ3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzMsXG4gICAgLy8gUmV2LiA1LTExOiBleHBvc2Ugb24gYWxsIGludGVyZmFjZXMgKExBTiBhY2Nlc3MgZm9yIHRlc3Rpbmcgb24gb3RoZXIgZGV2aWNlcykuXG4gICAgaG9zdDogdHJ1ZSxcbiAgICBwcm94eToge1xuICAgICAgJy9hcGknOiAnaHR0cDovLzEyNy4wLjAuMToxNzg5MCcsXG4gICAgfSxcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICBvdXREaXI6ICdkaXN0JyxcbiAgICAvLyBSZXYuIGVkaXQtcGVyc2lzdGVuY2U6IHNhbmRib3ggc2FmZS1kZWxldGUgaW50ZXJjZXB0cyBybVN5bmMgb24gZGlzdFxuICAgIC8vIGFuZCBmYWlscyAodHJhc2ggcGF0aCBjb252ZXJzaW9uKS4gU2tpcCB0aGUgZW1wdHktb3V0IHN0ZXAgaW5zdGVhZC5cbiAgICBlbXB0eU91dERpcjogZmFsc2UsXG4gICAgLy8gUmV2LiA1LTEwOiBzb3VyY2VtYXBzIGZvciBwcm9kdWN0aW9uIGRlYnVnZ2luZyArIHZlbmRvciBjaHVuayBzcGxpdHRpbmcuXG4gICAgc291cmNlbWFwOiB0cnVlLFxuICAgIC8vIFJldi4gNS0xMDoga2VlcCB0aGUgZGVmYXVsdCBlc2J1aWxkIG1pbmlmaWVyLCBzcGxpdCBzdGFibGUgdmVuZG9ycyBzb1xuICAgIC8vIHRoZSBsYXJnZSBDb2RlTWlycm9yL2RpZmYgYnVuZGxlcyBhcmUgY2FjaGVkIGluZGVwZW5kZW50bHkgb2YgYXBwIGNvZGUuXG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgb3V0cHV0OiB7XG4gICAgICAgIG1hbnVhbENodW5rczoge1xuICAgICAgICAgICd2ZW5kb3ItdnVlJzogWyd2dWUnLCAndnVlLXJvdXRlcicsICdwaW5pYSddLFxuICAgICAgICAgICd2ZW5kb3ItY29kZW1pcnJvcic6IFtcbiAgICAgICAgICAgICdAY29kZW1pcnJvci9zdGF0ZScsXG4gICAgICAgICAgICAnQGNvZGVtaXJyb3IvdmlldycsXG4gICAgICAgICAgICAnQGNvZGVtaXJyb3IvY29tbWFuZHMnLFxuICAgICAgICAgICAgJ0Bjb2RlbWlycm9yL2xhbmctbWFya2Rvd24nLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgJ3ZlbmRvci1kaWZmJzogWydkaWZmLW1hdGNoLXBhdGNoJ10sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIC8vIFJldi4gNS0xMjogZHJvcCBjb25zb2xlL2RlYnVnZ2VyIE9OTFkgaW4gcHJvZHVjdGlvbiBidWlsZHMgXHUyMDE0IGRldi9zZXJ2ZVxuICAvLyBrZWVwcyB0aGVtIGZvciBkZWJ1Z2dpbmcuXG4gIGVzYnVpbGQ6IGNvbW1hbmQgPT09ICdidWlsZCcgPyB7IGRyb3A6IFsnY29uc29sZScsICdkZWJ1Z2dlciddIH0gOiB7fSxcbiAgdGVzdDoge1xuICAgIGVudmlyb25tZW50OiAnanNkb20nLFxuICAgIGluY2x1ZGU6IFsnc3JjLyoqLyouc3BlYy50cyddLFxuICB9LFxufSkpXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQ0EsU0FBUyxvQkFBb0I7QUFDN0IsT0FBTyxTQUFTO0FBQ2hCLFNBQVMsZUFBZTtBQUh4QixJQUFNLG1DQUFtQztBQUt6QyxJQUFPLHNCQUFRLGFBQWEsQ0FBQyxFQUFFLFFBQVEsT0FBTztBQUFBLEVBQzVDLFNBQVMsQ0FBQyxJQUFJLENBQUM7QUFBQSxFQUNmLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssUUFBUSxrQ0FBVyxLQUFLO0FBQUEsSUFDL0I7QUFBQSxFQUNGO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUE7QUFBQSxJQUVOLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUFBLEVBQ0EsT0FBTztBQUFBLElBQ0wsUUFBUTtBQUFBO0FBQUE7QUFBQSxJQUdSLGFBQWE7QUFBQTtBQUFBLElBRWIsV0FBVztBQUFBO0FBQUE7QUFBQSxJQUdYLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQSxRQUNOLGNBQWM7QUFBQSxVQUNaLGNBQWMsQ0FBQyxPQUFPLGNBQWMsT0FBTztBQUFBLFVBQzNDLHFCQUFxQjtBQUFBLFlBQ25CO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsVUFDRjtBQUFBLFVBQ0EsZUFBZSxDQUFDLGtCQUFrQjtBQUFBLFFBQ3BDO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUE7QUFBQTtBQUFBLEVBR0EsU0FBUyxZQUFZLFVBQVUsRUFBRSxNQUFNLENBQUMsV0FBVyxVQUFVLEVBQUUsSUFBSSxDQUFDO0FBQUEsRUFDcEUsTUFBTTtBQUFBLElBQ0osYUFBYTtBQUFBLElBQ2IsU0FBUyxDQUFDLGtCQUFrQjtBQUFBLEVBQzlCO0FBQ0YsRUFBRTsiLAogICJuYW1lcyI6IFtdCn0K
