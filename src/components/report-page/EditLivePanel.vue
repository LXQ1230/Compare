<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useCompareStore } from '../../stores/compare';
import { useEditorStore } from '../../stores/editor';
import { renderSegmentsToHTML } from '../../render/segmentRenderer';
import { classifyEdit } from '../../render/editClassifier';

const compareStore = useCompareStore();
const editorStore = useEditorStore();

const editText = ref('');

// When entering edit mode, populate textarea from edit segments
watch(
  () => editorStore.isEditing,
  (editing) => {
    if (editing) {
      const src = editorStore.editSegments.length > 0
        ? editorStore.editSegments
        : compareStore.segments;
      editText.value = src.map((s) => s.text).join('');
    }
  },
);

/** Real-time preview: diff baseline vs current textarea, then merge with original colors. */
const liveHtml = computed(() => {
  if (!editorStore.isEditing || !editText.value) return '';
  if (editText.value === editorStore.baseline) {
    // No changes — show original segments as-is
    return renderSegmentsToHTML(
      editorStore.editSegments.length > 0 ? editorStore.editSegments : compareStore.segments
    );
  }
  // User made changes — classify and show merged result
  const result = classifyEdit(editorStore.baseline, editText.value);
  if (!result.dirty) return '';
  return renderSegmentsToHTML(result.segments);
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
</script>

<template>
  <div v-if="editorStore.isEditing" class="edit-panel">
    <div class="edit-panes">
      <div class="edit-pane edit-left">
        <h4 class="pane-title">
          编辑区
          <span class="hint">（琥珀色=新增 紫色=删除 绿色/红色=原始差异）</span>
        </h4>
        <textarea
          v-model="editText"
          class="edit-textarea"
          spellcheck="false"
          @input="editorStore.applyEdit(editText)"
        />
      </div>
      <div class="edit-pane edit-right">
        <h4 class="pane-title">实时预览</h4>
        <div class="edit-preview" v-html="liveHtml" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.edit-panel {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}
.edit-panes {
  flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 8px;
  overflow: hidden;
}
.edit-pane {
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid var(--color-border); border-radius: 8px;
}
.pane-title {
  font-size: 12px; font-weight: 600; padding: 6px 12px;
  background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border);
  margin: 0; display: flex; align-items: center; gap: 8px;
}
.pane-title .hint {
  font-weight: 400; color: var(--color-text-secondary); font-size: 11px;
}
.edit-textarea {
  flex: 1; padding: 12px;
  font-family: var(--font-mono); font-size: var(--font-size-base);
  line-height: 1.6; border: none; outline: none; resize: none;
  background: var(--color-bg); color: var(--color-text);
}
.edit-preview {
  flex: 1; padding: 12px; overflow: auto;
  font-family: var(--font-mono); font-size: var(--font-size-base);
  line-height: 1.6; white-space: pre-wrap; word-break: break-all;
  background: var(--color-bg);
}
</style>
