<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useCompareStore } from '../../stores/compare';
import { renderSplitColumns } from '../../render/splitRenderer';
import { getDocContainerStyle } from '../../render/segmentRenderer';
import { setupPagedWheel, syncScrollRatio, type ScrollAxis } from '../../utils/pagedScroll';

const compareStore = useCompareStore();
const docMeta = computed(() => compareStore.meta?.docMeta);
const containerStyle = computed(() => getDocContainerStyle(docMeta.value));
const isVertical = computed(() => docMeta.value?.vertical === true);
// 大文档竖排 IDML（2026-08-06 方案 A）：同 UnifiedView——等 isComplete
// 一次性渲染，避免流式 push 期间每个 chunk 全量重算（17.5MB HTML）。
const isLargeVertical = computed(
  () => compareStore.isLargeDoc && docMeta.value?.vertical === true,
);
const splitHtml = computed(() => {
  if (isLargeVertical.value && !compareStore.isComplete) return { left: '', right: '' };
  return renderSplitColumns(compareStore.segments, { vertical: isVertical.value });
});

// 滚轮翻页 + 双栏比例同步（2026-08-05）：竖排 IDML 滚轮映射到阅读方向（x 轴），
// 横排纵向翻页（y 轴）；左右 pane 滚动按比例联动（内容长度不同，用比例不用像素）。
// 同步走 debounce（scroll 静默 120ms 后对齐一次），smooth 翻页动画全程不被打断。
// 大文档竖排视图 isComplete 后才挂载 DOM → watch 后再初始化。
const paneARef = ref<HTMLElement | null>(null);
const paneBRef = ref<HTMLElement | null>(null);
let cleanupWheelA: (() => void) | null = null;
let cleanupWheelB: (() => void) | null = null;
let cleanupSync: (() => void) | null = null;
function initWheels(): void {
  cleanupWheelA?.();
  cleanupWheelB?.();
  cleanupSync?.();
  const axis: ScrollAxis = isVertical.value ? 'x' : 'y';
  if (paneARef.value) cleanupWheelA = setupPagedWheel(paneARef.value, { axis });
  if (paneBRef.value) cleanupWheelB = setupPagedWheel(paneBRef.value, { axis });
  if (paneARef.value && paneBRef.value) {
    cleanupSync = syncScrollRatio(paneARef.value, paneBRef.value, axis).cleanup;
  }
}
onMounted(initWheels);
watch(
  () => compareStore.isComplete,
  (val) => { if (val) nextTick(initWheels); },
);
onBeforeUnmount(() => {
  cleanupWheelA?.();
  cleanupWheelB?.();
  cleanupSync?.();
});
</script>

<template>
  <!-- Rev. 5-21: a11y — both panes focusable for keyboard scroll. -->
  <div class="split-view">
    <template v-if="isLargeVertical && !compareStore.isComplete">
      <div class="view-loading" role="status">
        <span class="loading-spinner" aria-hidden="true" />
        正在生成竖排视图…（大文档需等待对比完成）
      </div>
    </template>
    <template v-else>
      <div
        ref="paneARef"
        class="split-pane" :class="{ 'doc-vertical': isVertical }" :style="containerStyle"
        role="document" aria-label="对比结果（文件 A 原始）" tabindex="0" v-html="splitHtml.left"
      />
      <div class="split-gutter" role="separator" aria-hidden="true" />
      <div
        ref="paneBRef"
        class="split-pane" :class="{ 'doc-vertical': isVertical }" :style="containerStyle"
        role="document" aria-label="对比结果（文件 B 修改）" tabindex="0" v-html="splitHtml.right"
      />
    </template>
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
/* IDML 竖排（方案 §6.4） */
.doc-vertical {
  word-break: normal;
  font-family: 'SourceHanSerifCN', 'Source Han Serif CN', serif;
}
.split-gutter { background: var(--color-border); width: 24px; }
.view-loading {
  grid-column: 1 / -1;
  display: flex; align-items: center; justify-content: center; gap: 8px;
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
