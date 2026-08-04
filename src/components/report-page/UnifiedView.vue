<script setup lang="ts">
import { computed } from 'vue';
import { useCompareStore } from '../../stores/compare';
import { useSearchStore } from '../../stores/search';
import { renderSegmentsToHTML } from '../../render/segmentRenderer';
import { useEditorStore } from '../../stores/editor';

const compareStore = useCompareStore();
const editorStore = useEditorStore();
const searchStore = useSearchStore();

const htmlContent = computed(() =>
  renderSegmentsToHTML(
    compareStore.segments,
    searchStore.matches.length > 0 ? searchStore.matches : undefined,
  ),
);
const emptyText = computed(() =>
  compareStore.isComplete && compareStore.segments.length === 0
    ? '两个文件内容完全相同，无差异。' : null,
);
</script>

<template>
  <!-- Rev. 5-21: a11y — status region announces the empty state; the diff
       document is focusable (tabindex=0) so keyboard users can scroll it. -->
  <div v-if="emptyText" role="status" class="empty-notice">{{ emptyText }}</div>
  <div
    v-else
    class="unified-view"
    role="document"
    aria-label="对比结果（统一视图）"
    tabindex="0"
    v-html="htmlContent"
  />
</template>

<style scoped>
.unified-view {
  flex: 1; overflow: auto; padding: 16px;
  font-family: var(--font-mono); font-size: var(--font-size-base);
  line-height: 1.6; white-space: pre-wrap; word-break: break-all;
}
.empty-notice {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: var(--color-text-secondary); font-size: 15px;
}
</style>
