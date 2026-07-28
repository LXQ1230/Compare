<script setup lang="ts">
import { computed } from 'vue';
import { useCompareStore } from '../../stores/compare';
import { renderSegmentsToHTML } from '../../render/segmentRenderer';
import { useEditorStore } from '../../stores/editor';

const compareStore = useCompareStore();
const editorStore = useEditorStore();

const htmlContent = computed(() => renderSegmentsToHTML(compareStore.segments));
const emptyText = computed(() =>
  compareStore.isComplete && compareStore.segments.length === 0
    ? '两个文件内容完全相同，无差异。' : null,
);
</script>

<template>
  <div v-if="emptyText" class="empty-notice">{{ emptyText }}</div>
  <div v-else class="unified-view" :contenteditable="editorStore.isEditing" v-html="htmlContent" />
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
