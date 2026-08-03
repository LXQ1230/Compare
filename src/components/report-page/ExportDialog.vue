<script setup lang="ts">
import { useCompareStore } from '../../stores/compare';
import { useEditorStore } from '../../stores/editor';
import { exportToTXT, exportToHTML, exportToMD, downloadFile } from '../../export/exporters';

const compareStore = useCompareStore();
const editorStore = useEditorStore();

defineEmits<{ close: [] }>();

const formats = [
  { id: 'txt', label: '纯文本 (.txt)', mime: 'text/plain' },
  { id: 'html', label: 'HTML (.html)', mime: 'text/html' },
  { id: 'md', label: 'Markdown (.md)', mime: 'text/markdown' },
];

/**
 * Force-flush any pending debounced classify, so the exported content is
 * never behind the cursor (rev. D1 / 6-5). The flush runs synchronously
 * through the callback registered by CodeMirrorDiff.
 */
function flushEdits(): void {
  if (editorStore.isEditing) {
    editorStore.flushEditsSync();
  }
}

function doExport(formatId: string) {
  const fmt = formats.find((f) => f.id === formatId);
  if (!fmt) return;

  // Rev. D1 / 6-6: TXT/HTML/MD all read the EDITED segments while editing,
  // the original compareStore segments otherwise.
  flushEdits();
  const segments = editorStore.isEditing
    ? editorStore.getEditedSegments()
    : compareStore.segments;

  let content: string;
  if (formatId === 'html') content = exportToHTML(segments);
  else if (formatId === 'md') content = exportToMD(segments);
  else content = exportToTXT(segments);
  downloadFile(content, `compare-report.${formatId}`, fmt.mime);
}
</script>

<template>
  <div class="export-overlay" @click.self="$emit('close')">
    <div class="export-dialog">
      <h3 class="dialog-title">导出对比结果</h3>
      <div v-for="fmt in formats" :key="fmt.id" class="export-option" @click="doExport(fmt.id)">
        {{ fmt.label }}
      </div>
      <button class="close-btn" @click="$emit('close')">关闭</button>
    </div>
  </div>
</template>

<style scoped>
.export-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.3);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.export-dialog { background: var(--color-bg); border-radius: 12px; padding: 24px; width: 320px; }
.dialog-title { font-size: 18px; margin-bottom: 16px; }
.export-option {
  padding: 10px 16px; border: 1px solid var(--color-border); border-radius: 8px;
  cursor: pointer; margin-bottom: 8px; font-size: 14px;
}
.export-option:hover { background: var(--color-bg-hover); }
.close-btn {
  margin-top: 8px; padding: 8px 24px; border: 1px solid var(--color-border);
  border-radius: 6px; background: var(--color-bg); cursor: pointer;
}
</style>
