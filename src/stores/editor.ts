import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { Segment, ChangeContext } from "@/types";
import { useCompareStore } from "./compare";
import { classifyEdit, buildDocText, normalizeLineEndings } from "@/render/editClassifier";

function cloneSegments(src: Segment[]): Segment[] {
  return src.map((s) => ({ ...s }));
}

export const useEditorStore = defineStore("editor", () => {
  const isEditing = ref(false);
  const editSegments = ref<Segment[]>([]);
  const editText = ref("");
  const hasEdits = ref(false);

  /** Monotonic token — bumped by resetToOriginal so CodeMirrorDiff can clear user decorations (rev. C2). */
  const resetToken = ref(0);

  /**
   * Synchronous flush callback registered by CodeMirrorDiff (rev. D1/6-5).
   * Export needs to read `editText` fresh even while the debounced classify
   * is still pending, so the flush must run synchronously — a watched token
   * would be async and arrive too late.
   */
  let flushFn: (() => void) | null = null;

  function registerFlush(fn: () => void): void {
    flushFn = fn;
  }

  function flushEditsSync(): void {
    flushFn?.();
  }

  /** Baseline fixed at enterEdit time — NEVER reassigned (rev. 6-2). */
  const originalBaseline = ref("");

  const compareStore = useCompareStore();

  function enterEdit(): void {
    if (!hasEdits.value) {
      editSegments.value = cloneSegments(compareStore.segments);
      editText.value = normalizeLineEndings(buildDocText(editSegments.value));
      originalBaseline.value = normalizeLineEndings(buildDocText(compareStore.segments));
    }
    isEditing.value = true;
  }

  function exitEdit(): void {
    isEditing.value = false;
  }

  function resetToOriginal(): void {
    editSegments.value = cloneSegments(compareStore.segments);
    editText.value = "";
    hasEdits.value = false;
    resetToken.value++;
  }

  /** Classify current edits against the FIXED baseline (rev. A2). */
  function getEditedSegments(): Segment[] {
    const edited = normalizeLineEndings(editText.value);
    if (edited === originalBaseline.value) return [];
    return classifyEdit(originalBaseline.value, edited).segments;
  }

  const editedStats = computed(() => {
    let total = 0, add = 0, del = 0, mod = 0;
    for (const s of getEditedSegments()) {
      total++;
      if (s.operation === "add") add++;
      else if (s.operation === "del") del++;
      else if (s.operation === "mod") mod++;
    }
    return { total, add, del, mod };
  });

  /** Sidebar change contexts rebuilt from the edited segments. */
  const editedContexts = computed<ChangeContext[]>(() => {
    const segs = getEditedSegments();
    const result: ChangeContext[] = [];
    let ci = 0;
    for (const s of segs) {
      if (s.operation === "none") continue;
      ci++;
      const type = s.operation === "add" ? "add" : s.operation === "del" ? "del" : "mod";
      result.push({ index: ci, total: editedStats.value.total, type, side: s.side, lineA: 0, lineB: 0, before: "", highlight: s.text, after: "" });
    }
    return result;
  });

  return { isEditing, editSegments, editText, hasEdits, originalBaseline, resetToken,
    registerFlush, flushEditsSync,
    enterEdit, exitEdit, resetToOriginal, getEditedSegments, editedStats, editedContexts };
});
