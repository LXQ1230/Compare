<script setup lang="ts">
import { computed } from 'vue';
import { useCompareStore } from '../../stores/compare';
import { renderSplitColumns } from '../../render/splitRenderer';

const compareStore = useCompareStore();
const splitHtml = computed(() => renderSplitColumns(compareStore.segments));
</script>

<template>
  <!-- Rev. 5-21: a11y — both panes focusable for keyboard scroll. -->
  <div class="split-view">
    <div class="split-pane" role="document" aria-label="对比结果（文件 A 原始）" tabindex="0" v-html="splitHtml.left" />
    <div class="split-gutter" role="separator" aria-hidden="true" />
    <div class="split-pane" role="document" aria-label="对比结果（文件 B 修改）" tabindex="0" v-html="splitHtml.right" />
  </div>
</template>

<style scoped>
.split-view {
  display: grid; grid-template-columns: 1fr 24px 1fr;
  flex: 1; overflow: hidden;
}
.split-pane {
  overflow: auto; padding: 16px;
  font-family: var(--font-mono); font-size: var(--font-size-base);
  line-height: 1.6; white-space: pre-wrap; word-break: break-all;
}
.split-gutter { background: var(--color-border); width: 24px; }
</style>
