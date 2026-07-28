/**
 * View store — manages view mode and minimap visibility.
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ViewMode } from '@/types';

export const useViewStore = defineStore('view', () => {
  const viewMode = ref<ViewMode>('unified');
  const minimapCollapsed = ref(false);

  function toggleView(): void {
    viewMode.value = viewMode.value === 'unified' ? 'split' : 'unified';
  }

  function setView(mode: ViewMode): void {
    viewMode.value = mode;
  }

  function toggleMinimap(): void {
    minimapCollapsed.value = !minimapCollapsed.value;
  }

  return { viewMode, minimapCollapsed, toggleView, setView, toggleMinimap };
});
