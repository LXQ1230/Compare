import { defineStore } from "pinia";
import { ref } from "vue";
import type { Segment } from "@/types";
import { useCompareStore } from "./compare";

function cloneSegments(src: Segment[]): Segment[] {
  return src.map((s) => ({ ...s }));
}

export const useEditorStore = defineStore("editor", () => {
  const isEditing = ref(false);
  const editSegments = ref<Segment[]>([]);
  const editText = ref("");
  const hasEdits = ref(false);

  const compareStore = useCompareStore();

  function enterEdit(): void {
    if (!hasEdits.value) {
      editSegments.value = cloneSegments(compareStore.segments);
      editText.value = editSegments.value.map((s) => s.text).join("");
    }
    isEditing.value = true;
  }

  function exitEdit(): void {
    isEditing.value = false;
  }

  function resetToOriginal(): void {
    editSegments.value = cloneSegments(compareStore.segments);
    hasEdits.value = false;
    editText.value = "";
  }

  return { isEditing, editSegments, editText, hasEdits,
    enterEdit, exitEdit, resetToOriginal };
});
