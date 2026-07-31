<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { useCompareStore } from "../../stores/compare";
import { useEditorStore } from "../../stores/editor";
import { diffMarks } from "../../editor/diffMarks";
import { segmentsToDoc } from "../../editor/segmentsToDoc";
import { classifyEdit } from "../../render/editClassifier";
import type { Segment } from "@/types";

const compareStore = useCompareStore();
const editorStore = useEditorStore();

let classifyTimer: ReturnType<typeof setTimeout> | null = null;
let lastBaseline = "";

const editor = useEditor({
  extensions: [Document, Paragraph, Text, ...diffMarks],
  editable: true,
  onUpdate({ editor: ed }) {
    if (classifyTimer) clearTimeout(classifyTimer);
    classifyTimer = setTimeout(() => {
      if (!ed || ed.isDestroyed) return;
      const currentText = ed.getText();
      if (!currentText || currentText === lastBaseline) return;

      const userResult = classifyEdit(lastBaseline, currentText);
      if (!userResult.dirty) return;

      const { state, view } = ed;
      const tr = state.tr;
      let pos = 0;

      for (const us of userResult.segments) {
        const len = us.text.length;
        if (us.operation === "none") {
          tr.removeMark(pos, pos + len, state.schema.marks.userAdd);
          tr.removeMark(pos, pos + len, state.schema.marks.userDel);
        } else if (us.operation === "add") {
          tr.removeMark(pos, pos + len, state.schema.marks.userDel);
          tr.addMark(pos, pos + len, state.schema.marks.userAdd.create());
        } else {
          tr.removeMark(pos, pos + len, state.schema.marks.userAdd);
          tr.addMark(pos, pos + len, state.schema.marks.userDel.create());
        }
        pos += len;
      }

      if (tr.steps.length > 0) {
        view.dispatch(tr);
      }

      lastBaseline = currentText;
      editorStore.editText = currentText;
      editorStore.hasEdits = true;
    }, 400);
  },
  content: { type: "doc", content: [{ type: "paragraph" }] },
});

watch(
  () => editorStore.isEditing,
  (editing) => {
    if (!editing || !editor.value) return;
    const segs = editorStore.editSegments.length > 0
      ? editorStore.editSegments
      : compareStore.segments;
    const doc = segmentsToDoc(segs);
    lastBaseline = segs.map((s: Segment) => s.text).join("");
    editorStore.editText = lastBaseline;
    editor.value.commands.setContent(doc);
  },
);

onBeforeUnmount(() => {
  if (classifyTimer) clearTimeout(classifyTimer);
  editor.value?.destroy();
});
</script>

<template>
  <div v-if="editorStore.isEditing" class="diff-editor-wrapper">
    <h4 class="pane-title">
      编辑模式
      <span class="hint">琥珀=新增 紫=删除 绿/红/黄=原始差异</span>
    </h4>
    <EditorContent :editor="editor" class="diff-editor-content" />
  </div>
</template>

<style scoped>
.diff-editor-wrapper {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}
.pane-title {
  font-size: 12px; font-weight: 600; padding: 6px 12px;
  background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border);
  flex-shrink: 0; display: flex; align-items: center; gap: 8px;
}
.pane-title .hint {
  font-weight: 400; color: var(--color-text-secondary); font-size: 11px;
}
.diff-editor-content {
  flex: 1; overflow: auto; padding: 16px;
  font-family: var(--font-mono); font-size: var(--font-size-base);
  line-height: 1.6;
  background: var(--color-bg); color: var(--color-text);
}
</style>
