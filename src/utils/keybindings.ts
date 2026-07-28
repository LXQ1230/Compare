/**
 * Keyboard shortcut bindings for the report page.
 */

import { onMounted, onUnmounted } from 'vue';

export interface ShortcutConfig {
  onSearchToggle: () => void;
  onToggleView: () => void;
  onEdit: () => void;
  onExport: () => void;
  onEscape: () => void;
  onNextChange: () => void;
  onPrevChange: () => void;
}

/**
 * Registers global keyboard shortcuts. Returns void — cleanup is automatic via Vue lifecycle.
 *
 * Bindings:
 *   Ctrl+F / Cmd+F → search toggle
 *   Ctrl+E → edit mode
 *   Escape → exit search / close dialog
 */
export function useKeyboardShortcuts(config: ShortcutConfig): void {
  function handler(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;

    const activeTag = document.activeElement?.tagName.toLowerCase() ?? '';
    const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

    if (mod && e.key === 'f') {
      e.preventDefault();
      config.onSearchToggle();
      return;
    }
    if (mod && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      config.onEdit();
      return;
    }
    if (e.key === 'Escape') {
      config.onEscape();
      return;
    }
    if (isInput) return;
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      config.onNextChange();
      return;
    }
    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      config.onPrevChange();
      return;
    }
    if (e.key === 'v' || e.key === 'V') {
      config.onToggleView();
      return;
    }
  }

  onMounted(() => window.addEventListener('keydown', handler));
  onUnmounted(() => window.removeEventListener('keydown', handler));
}
