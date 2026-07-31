<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick } from "vue";
import { EditorView, Decoration, DecorationSet } from "@codemirror/view";
import { EditorState, StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import { useCompareStore } from "../../stores/compare";
import { useEditorStore } from "../../stores/editor";
import { classifyEdit } from "../../render/editClassifier";
import type { Segment } from "@/types";

const compareStore = useCompareStore();
const editorStore = useEditorStore();

const containerRef = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
let classifyTimer: ReturnType<typeof setTimeout> | null = null;
let lastBaseline = "";

// ── Effects ──────────────────────────────────────────────────
const setDiffDecos = StateEffect.define<DecorationSet>();
const setUserDecos = StateEffect.define<DecorationSet>();

// ── State fields: DecorationSet ─────────────────────────────────
const diffField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (val, tr) => {
    for (const e of tr.effects) if (e.is(setDiffDecos)) val = e.value;
    return val;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const userField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (val, tr) => {
    for (const e of tr.effects) if (e.is(setUserDecos)) val = e.value;
    return val;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Helpers ──────────────────────────────────────────────────
function markClass(s: Segment): string {
  if (s.origin === "user") {
    if (s.operation === "add") return "cm-user-add";
    if (s.operation === "del" || s.operation === "mod") return "cm-user-del";
    return "";
  }
  switch (s.operation) {
    case "add": return "cm-add";
    case "del": return "cm-del";
    case "mod": return s.side === "old" ? "cm-mod-old" : "cm-mod-new";
    default: return "";
  }
}

function buildDecoSet(segs: Segment[], mode: "diff" | "user"): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let pos = 0;
  for (const s of segs) {
    const len = s.text.length;
    if (len === 0) continue;
    if (mode === "user" && s.operation === "none") { pos += len; continue; }
    const cls = markClass(s);
    if (cls) {
      builder.add(pos, pos + len, Decoration.mark({ class: cls }));
    }
    pos += len;
  }
  return builder.finish();
}

// ── Editor lifecycle ─────────────────────────────────────────
function createEditor(text: string, diffSegments: Segment[]) {
  if (view) { view.destroy(); view = null; }

  const state = EditorState.create({
    doc: text || "",
    extensions: [
      diffField,
      userField,
      EditorView.editable.of(true),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || !view) return;
        const current = update.state.doc.toString();
        if (!current || current === lastBaseline) return;

        if (classifyTimer) clearTimeout(classifyTimer);
        classifyTimer = setTimeout(() => {
          const v = view;
          if (!v) return;
          const fresh = v.state.doc.toString();
          if (!fresh || fresh === lastBaseline) return;

          const userResult = classifyEdit(lastBaseline, fresh);
          if (!userResult.dirty) return;

          v.dispatch({ effects: setUserDecos.of(buildDecoSet(userResult.segments, "user")) });

          lastBaseline = fresh;
          editorStore.editText = fresh;
          editorStore.hasEdits = true;
        }, 300);
      }),
    ],
  });

  view = new EditorView({
    state,
    parent: containerRef.value!,
  });

  // Apply diff decorations after mount
  view.dispatch({ effects: setDiffDecos.of(buildDecoSet(diffSegments, "diff")) });
}

watch(
  () => editorStore.isEditing,
  async (editing) => {
    await nextTick();
    if (!editing) return;

    const segs = editorStore.editSegments.length > 0
      ? editorStore.editSegments
      : compareStore.segments;
    const fullText = segs.map((s: Segment) => s.text).join("");
    lastBaseline = fullText;
    editorStore.editText = fullText;
    createEditor(fullText, segs);
  },
);

onBeforeUnmount(() => {
  if (classifyTimer) clearTimeout(classifyTimer);
  view?.destroy();
});
</script>

<template>
  <div v-if="editorStore.isEditing" class="cm-diff-wrapper">
    <h4 class="pane-title">
      编辑模式
      <span class="hint">琥珀=新增 紫=删除 绿/红/黄=原始差异</span>
    </h4>
    <div ref="containerRef" class="cm-container" />
  </div>
</template>

<style scoped>
.cm-diff-wrapper {
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
.cm-container {
  flex: 1; overflow: auto; padding: 8px 16px;
  font-family: var(--font-mono); font-size: var(--font-size-base);
}
</style>

<style>
/* Global — CodeMirror renders outside scoped styles */
.cm-container .cm-editor { height: 100%; }
.cm-container .cm-editor .cm-content {
  font-family: var(--font-mono); font-size: var(--font-size-base);
  line-height: 1.6; padding: 8px 0;
}
.cm-container .cm-editor .cm-gutters { display: none; }

/* Original diff colors */
.cm-add { background: var(--color-add-bg); color: var(--color-add-text); }
.cm-del { background: var(--color-del-bg); color: var(--color-del-text); text-decoration: line-through; }
.cm-mod-old { background: var(--color-mod-old-bg); color: var(--color-mod-old-text); text-decoration: line-through; }
.cm-mod-new { background: var(--color-mod-new-bg); color: var(--color-mod-new-text); }

/* User edit colors — applied as the TOP decoration, so they win */
.cm-user-add { background: var(--color-user-add-bg); color: var(--color-user-add-text); }
.cm-user-del { background: var(--color-user-del-bg); color: var(--color-user-del-text); }
</style>
