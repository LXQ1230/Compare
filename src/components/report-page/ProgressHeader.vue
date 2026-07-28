<script setup lang="ts">
import { useCompareStore } from '../../stores/compare';

const compareStore = useCompareStore();
</script>

<template>
  <div v-if="compareStore.isComparing" class="progress-header">
    <div class="progress-bar">
      <div class="progress-fill" :style="{ width: compareStore.progress + '%' }" />
    </div>
    <span class="progress-label">{{ compareStore.currentPhase }}</span>
  </div>
</template>

<style scoped>
.progress-header {
  padding: 4px 16px; background: var(--color-focus-bg);
  border-bottom: 1px solid var(--color-border); display: flex;
  align-items: center; gap: 12px; flex-shrink: 0;
}
.progress-bar {
  flex: 1; height: 4px; background: var(--color-border); border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%; background: var(--color-focus-border);
  transition: width 0.3s ease;
}
.progress-label { font-size: 12px; color: var(--color-text-secondary); white-space: nowrap; }
</style>
