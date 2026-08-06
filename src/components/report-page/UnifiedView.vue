<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useCompareStore } from '../../stores/compare';
import { useSearchStore } from '../../stores/search';
import { renderSegmentsToHTML, getDocContainerStyle } from '../../render/segmentRenderer';
import { useEditorStore } from '../../stores/editor';
import { setupPagedWheel } from '../../utils/pagedScroll';

const compareStore = useCompareStore();
const editorStore = useEditorStore();
const searchStore = useSearchStore();

const docMeta = computed(() => compareStore.meta?.docMeta);
const containerStyle = computed(() => getDocContainerStyle(docMeta.value));
const isVertical = computed(() => docMeta.value?.vertical === true);
// 大文档竖排 IDML（2026-08-06 方案 A）：v-html 视图承接竖排查看——
// 流式 push 期间不增量渲染（避免每个 chunk 全量重算 17.5MB HTML），
// 等 isComplete 后一次性渲染；小文档保持原有流式边收边渲染。
const isLargeVertical = computed(
  () => compareStore.isLargeDoc && docMeta.value?.vertical === true,
);

const htmlContent = computed(() => {
  if (isLargeVertical.value && !compareStore.isComplete) return '';
  return renderSegmentsToHTML(
    compareStore.segments,
    searchStore.matches.length > 0 ? searchStore.matches : undefined,
    { vertical: isVertical.value },
  );
});
const emptyText = computed(() =>
  compareStore.isComplete && compareStore.segments.length === 0
    ? '两个文件内容完全相同，无差异。' : null,
);

// 滚轮翻页（2026-08-05）：横排=纵向翻页；竖排 IDML=滚轮映射到阅读方向翻页。
// 大文档竖排视图在 isComplete 后才挂载 DOM → onMounted 时 ref 为空，
// 需在 isComplete 后再初始化（watch + nextTick）。
const viewRef = ref<HTMLElement | null>(null);
let cleanupWheel: (() => void) | null = null;
function initWheel(): void {
  cleanupWheel?.();
  cleanupWheel = null;
  if (viewRef.value) {
    cleanupWheel = setupPagedWheel(viewRef.value, { axis: isVertical.value ? 'x' : 'y' });
  }
}
onMounted(initWheel);
watch(
  () => compareStore.isComplete,
  (val) => { if (val) nextTick(initWheel); },
);
onBeforeUnmount(() => { cleanupWheel?.(); });
</script>

<template>
  <!-- Rev. 5-21: a11y — status region announces the empty state; the diff
       document is focusable (tabindex=0) so keyboard users can scroll it. -->
  <div v-if="emptyText" role="status" class="empty-notice">{{ emptyText }}</div>
  <div
    v-else-if="isLargeVertical && !compareStore.isComplete"
    class="view-loading"
    role="status"
  >
    <span class="loading-spinner" aria-hidden="true" />
    正在生成竖排视图…（大文档需等待对比完成）
  </div>
  <div
    v-else
    ref="viewRef"
    class="unified-view"
    :class="{ 'doc-vertical': isVertical }"
    :style="containerStyle"
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
/* IDML 竖排（方案 §6.4）：竖排容器下禁用 break-all，避免打断字符成列 */
.doc-vertical {
  word-break: normal;
  font-family: 'SourceHanSerifCN', 'Source Han Serif CN', serif;
}
.empty-notice {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: var(--color-text-secondary); font-size: 15px;
}
.view-loading {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
  color: var(--color-text-secondary); font-size: 15px;
}
.loading-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary, #4a7cff);
  animation: view-spin 0.8s linear infinite;
}
@keyframes view-spin { to { transform: rotate(360deg); } }
</style>
