<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  files: [files: File[]]
}>();

// Rev. 5-15: keep the container mounted at all times — when no files are
// selected the placeholder copy below serves as the empty state, so the
// page never "jumps" between an input and its absence. The hover/dragover
// class gives immediate visual feedback for the drop gesture.
const isDragging = ref(false);

function onDrop(e: DragEvent): void {
  isDragging.value = false;
  const dt = e.dataTransfer;
  if (dt?.files) emit('files', Array.from(dt.files));
}

function onDragEnter(e: DragEvent): void {
  // Only react when the drag actually carries files (avoids flicker from
  // dragging text/links over the zone).
  if (e.dataTransfer?.types.includes('Files')) isDragging.value = true;
}

function onDragLeave(e: DragEvent): void {
  // Ignore leave events on child elements (dragenter/leave fire per element).
  if (!e.currentTarget || (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
  isDragging.value = false;
}
</script>

<template>
  <div
    class="drop-zone"
    :class="{ dragging: isDragging }"
    @dragover.prevent
    @dragenter.prevent="onDragEnter"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input
      type="file"
      multiple
      class="drop-input"
      @change="(e: Event) => {
        const input = e.target as HTMLInputElement;
        if (input.files) emit('files', Array.from(input.files));
      }"
    />
    <p class="drop-text">拖拽文件到此处，或点击选择</p>
    <p class="drop-sub">支持 .txt / .docx / .md / .idml 格式</p>
  </div>
</template>

<style scoped>
.drop-zone {
  width: 100%; max-width: 480px; border: 2px dashed var(--color-border);
  border-radius: 12px; padding: 40px 24px; text-align: center;
  cursor: pointer; position: relative; transition: border-color 0.2s, background 0.2s;
}
.drop-zone:hover { border-color: var(--color-focus-border); }
.drop-zone.dragging {
  border-color: var(--color-focus-border);
  background: var(--color-focus-bg);
}
.drop-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.drop-text { font-size: 16px; color: var(--color-text); margin-bottom: 4px; }
.drop-sub { font-size: 13px; color: var(--color-text-secondary); }
</style>
