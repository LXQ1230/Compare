<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useCompareStore } from '../../stores/compare';
import { useEditorStore } from '../../stores/editor';
import { renderSegmentsToHTML } from '../../render/segmentRenderer';

const compareStore = useCompareStore();
const editorStore = useEditorStore();

const editableRef = ref<HTMLDivElement | null>(null);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Build the editable HTML from current editSegments (or compareStore on first entry). */
function buildEditHtml(): string {
  const src = editorStore.editSegments.length > 0
    ? editorStore.editSegments
    : compareStore.segments;
  return renderSegmentsToHTML(src);
}

/** Save cursor offset via TreeWalker into editable content. */
function saveCursor(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return -1;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return -1;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let offset = range.startOffset;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node === range.startContainer) return offset;
    offset += (node.textContent ?? '').length;
  }
  return -1;
}

/** Restore cursor to absolute character offset into editable content. */
function restoreCursor(el: HTMLElement, targetOffset: number) {
  if (targetOffset < 0) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  let accum = 0;
  while ((node = walker.nextNode() as Text | null)) {
    const len = (node.textContent ?? '').length;
    if (accum + len >= targetOffset) {
      const range = document.createRange();
      range.setStart(node, targetOffset - accum);
      range.collapse(true);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return;
    }
    accum += len;
  }
}

/**
 * Called on each input — debounce 600ms then diff and re-render
 * with cursor preservation.
 */
function onInput() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    if (!editableRef.value) return;
    const cursorPos = saveCursor(editableRef.value);
    const currentText = editableRef.value.textContent ?? '';
    const merged = editorStore.applyEdit(currentText);
    if (editorStore.editSegments === merged) return; // no change

    await nextTick();
    if (!editableRef.value) return;
    editableRef.value.innerHTML = renderSegmentsToHTML(merged);
    restoreCursor(editableRef.value, cursorPos);
  }, 600);
}

// On first entry, populate with original view-mode HTML
watch(
  () => editorStore.isEditing,
  (editing) => {
    if (editing && editableRef.value) {
      editableRef.value.innerHTML = buildEditHtml();
    }
  },
);
</script>

<template>
  <div v-if="editorStore.isEditing" class="edit-panel">
    <h4 class="pane-title">编辑模式 — 琥珀色=新增 紫色=删除 绿色/红色=原始差异</h4>
    <div
      ref="editableRef"
      class="edit-content"
      contenteditable="true"
      spellcheck="false"
      v-html="buildEditHtml()"
      @input="onInput"
    />
  </div>
</template>

<style scoped>
.edit-panel {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}
.pane-title {
  font-size: 12px; font-weight: 600; padding: 6px 12px;
  background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.edit-content {
  flex: 1; padding: 16px; overflow: auto;
  font-family: var(--font-mono); font-size: var(--font-size-base);
  line-height: 1.6; white-space: pre-wrap; word-break: break-all;
  background: var(--color-bg); color: var(--color-text);
  outline: 2px solid var(--color-focus-border);
  outline-offset: -2px;
}
</style>
