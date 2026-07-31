/**
 * Editor store — manages edit mode state independent of view mode.
 *
 * Edit mode owns its own `editSegments` array.  The view mode
 * (`compareStore.segments`) is NEVER modified by editing — the two
 * modes are fully decoupled.
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Segment } from '@/types';
import { useCompareStore } from './compare';
import { classifyEdit } from '@/render/editClassifier';

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

  function applyEdit(currentText: string): Segment[] {
    if (!currentText || currentText === baseline.value) return editSegments.value;

    const userResult = classifyEdit(baseline.value, currentText);
    if (!userResult.dirty) return editSegments.value;

    const merged = mergeUserEdits(editSegments.value, userResult.segments);
    editSegments.value = merged;
    hasEdits.value = true;
    baseline.value = currentText;
    return merged;
  }

  function resetToOriginal(): void {
    editSegments.value = cloneSegments(compareStore.segments);
    hasEdits.value = false;
    baseline.value = '';
  }

  return { isEditing, baseline, editSegments, hasEdits,
    enterEdit, exitEdit, applyEdit, resetToOriginal };
});

// ── mergeUserEdits ──────────────────────────────────────────────────

type EditOp = 'none' | 'add' | 'del' | 'mod'

/**
 * Walk user segments (character-level diff of baseline → current) and align
 * them with the original segments to preserve original diff colors for
 * unchanged text.
 *
 *   none     → consume from original, keep original color
 *   add      → NEW text — does NOT consume from original
 *   del      → consume from original, user-delete color
 *   mod old  → consume from original, user-delete color
 *   mod new  → NEW text — does NOT consume from original
 */
function mergeUserEdits(original: Segment[], user: Segment[]): Segment[] {
  const out: Segment[] = []
  let oi = 0
  let oc = 0

  for (const us of user) {
    const op: EditOp = us.operation
    const isNew = op === 'add' || (op === 'mod' && us.side === 'new')

    if (isNew) {
      // New text — don't touch original pointer
      out.push({ text: us.text, operation: 'add', origin: 'user' })
      continue
    }

    // none / del / mod-old: consume from original
    let remaining = us.text.length
    while (remaining > 0 && oi < original.length) {
      const orig = original[oi]
      const avail = orig.text.length - oc
      const take = Math.min(remaining, avail)
      const chunk = orig.text.slice(oc, oc + take)

      if (op === 'none') {
        out.push({ ...orig, text: chunk, origin: orig.origin })
      } else {
        // del or mod-old → user-delete color
        out.push({ text: chunk, operation: 'del', origin: 'user' })
      }

      oc += take
      remaining -= take
      if (oc >= orig.text.length) { oi++; oc = 0 }
    }
  }

  return out
}
