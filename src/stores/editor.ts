/**
 * Editor store — manages edit mode state and baseline tracking.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useCompareStore } from './compare';

export const useEditorStore = defineStore('editor', () => {
  const isEditing = ref(false);
  const baseline = ref('');

  const compareStore = useCompareStore();
  const currentText = computed(() => compareStore.segments.map((s) => s.text).join(''));

  function enterEdit(): void {
    baseline.value = currentText.value;
    isEditing.value = true;
  }

  function exitEdit(): void {
    isEditing.value = false;
    baseline.value = '';
  }

  function scheduleAutosave(): number {
    return window.setTimeout(() => {
      /* autosave wired by the view component */
    }, 2000);
  }

  return { isEditing, baseline, currentText, enterEdit, exitEdit, scheduleAutosave };
});
