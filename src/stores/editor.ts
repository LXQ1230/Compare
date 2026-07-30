/**
 * Editor store — manages edit mode state independent of view mode.
 *
 * Edit mode owns its own `editSegments` array.  The view mode
 * (`compareStore.segments`) is NEVER modified by editing — the two
 * modes are fully decoupled.
 *
 * - First entry: copies compareStore.segments into editSegments.
 * - Re-entry: resumes from the existing editSegments (last edit preserved).
 * - Exit: does NOT write back to compareStore.segments.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Segment } from '@/types';
import { useCompareStore } from './compare';
import { classifyEdit, type EditResult } from '@/render/editClassifier';

function cloneSegments(src: Segment[]): Segment[] {
  return src.map((s) => ({ ...s }));
}

export const useEditorStore = defineStore('editor', () => {
  const isEditing = ref(false);
  const baseline = ref('');
  const editSegments = ref<Segment[]>([]);
  const hasEdits = ref(false);

  const compareStore = useCompareStore();

  function enterEdit(): void {
    if (!hasEdits.value) {
      editSegments.value = cloneSegments(compareStore.segments);
    }
    baseline.value = editSegments.value.map((s) => s.text).join('');
    isEditing.value = true;
  }

  function exitEdit(): void {
    isEditing.value = false;
    baseline.value = '';
  }

  /** Called on debounced input — classifies user changes and merges with original. */
  function applyEdit(currentText: string): Segment[] {
    if (!currentText || currentText === baseline.value) return editSegments.value;

    const userResult = classifyEdit(baseline.value, currentText);
    if (!userResult.dirty) return editSegments.value;

    // Merge user-diff segments back into the original segments,
    // preserving the original colors for unchanged parts.
    const merged = mergeUserEdits(editSegments.value, userResult.segments);
    editSegments.value = merged;
    hasEdits.value = true;
    // Update baseline so re-diff is relative to last state
    baseline.value = currentText;
    return merged;
  }

  function resetToOriginal(): void {
    editSegments.value = cloneSegments(compareStore.segments);
    hasEdits.value = false;
    baseline.value = '';
  }

  return { isEditing, baseline, editSegments, hasEdits, enterEdit, exitEdit, applyEdit, resetToOriginal };
});

/**
 * Merge user-diff segments onto the original segments.
 * For each user segment:
 *   - If it's EQUAL (none) → keep corresponding original segment's color
 *   - If it's ADD/DEL/MOD → apply user colors (seg-user-add / seg-user-del)
 *
 * The user segments are a character-level diff of [baseline_text] vs [current_text],
 * which aligns with the concatenated text of the original segments.
 * We walk both arrays character-by-character to align them.
 */
function mergeUserEdits(original: Segment[], userSegments: Segment[]): Segment[] {
  const result: Segment[] = [];
  // Flatten original segments into characters for alignment
  const origText = original.map((s) => s.text).join('');
  const userText = userSegments.map((s) => s.text).join('');

  let oi = 0; // index into original array
  let oc = 0; // char offset within original[oi]
  let ui = 0;
  let uc = 0;

  while (ui < userSegments.length) {
    const us = userSegments[ui];
    let remaining = us.text.length;

    while (remaining > 0 && oi < original.length) {
      const orig = original[oi];
      const avail = orig.text.length - oc;
      const take = Math.min(remaining, avail);
      const chunk = orig.text.slice(oc, oc + take);

      if (us.operation === 'none') {
        // Unchanged — keep original color
        result.push({ ...orig, text: chunk, origin: orig.origin });
      } else if (us.operation === 'add') {
        result.push({ text: chunk, operation: 'add', origin: 'user' });
      } else if (us.operation === 'del') {
        result.push({ text: chunk, operation: 'del', origin: 'user' });
      } else if (us.operation === 'mod') {
        result.push({ text: chunk, operation: us.side === 'old' ? 'del' : 'add', origin: 'user' });
      }

      oc += take;
      remaining -= take;

      if (oc >= orig.text.length) {
        oi++;
        oc = 0;
      }
    }

    ui++;
  }

  return result;
}
