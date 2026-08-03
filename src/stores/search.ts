/**
 * Search store — manages search state, options, and match navigation.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { SearchMatch } from '@/utils/search';
import { searchInSegments, type SearchOptions } from '@/utils/search';
import { useCompareStore } from './compare';
import { useEditorStore } from './editor';

export const useSearchStore = defineStore('search', () => {
  const isOpen = ref(false);
  const query = ref('');
  const options = ref<SearchOptions>({ caseSensitive: false, wholeWord: false, useRegex: false });
  const matches = ref<SearchMatch[]>([]);
  const activeMatchIndex = ref(-1);

  const activeMatch = computed(() =>
    activeMatchIndex.value >= 0 ? (matches.value[activeMatchIndex.value] ?? null) : null,
  );
  const totalMatches = computed(() => matches.value.length);
  const currentPosition = computed(() =>
    activeMatchIndex.value >= 0
      ? `${activeMatchIndex.value + 1}/${totalMatches.value}`
      : totalMatches.value > 0
        ? `${totalMatches.value} 个`
        : '0/0',
  );

  function toggle(): void {
    isOpen.value ? close() : open();
  }

  function open(): void {
    isOpen.value = true;
  }

  function close(): void {
    isOpen.value = false;
    matches.value = [];
    activeMatchIndex.value = -1;
  }

  function search(): void {
    const compareStore = useCompareStore();
    const editorStore = useEditorStore();
    // Rev. E1: while editing, search the EDITED segments so hits match the
    // live editor document (and its search-highlight layer).
    const source = editorStore.isEditing
      ? editorStore.getEditedSegments()
      : compareStore.segments;
    matches.value = searchInSegments(source, query.value, options.value);
    activeMatchIndex.value = matches.value.length > 0 ? 0 : -1;
  }

  function next(): void {
    if (matches.value.length === 0) return;
    activeMatchIndex.value = (activeMatchIndex.value + 1) % matches.value.length;
    scrollToActiveMatch();
  }

  function prev(): void {
    if (matches.value.length === 0) return;
    activeMatchIndex.value =
      (activeMatchIndex.value - 1 + matches.value.length) % matches.value.length;
    scrollToActiveMatch();
  }

  /** Scroll the active search match into view and flash it. */
  function scrollToActiveMatch(): void {
    const m = activeMatch.value;
    if (!m) return;
    // Find the parent <mark data-ci> containing this match's segment
    const compareStore = useCompareStore();
    const segments = compareStore.segments;
    const idx = m.segmentIndex;
    if (idx < 0 || idx >= segments.length) return;
    const ci = segments[idx].ci;
    if (ci == null) return;
    const el = document.getElementById(`ci-${ci}`);
    if (!el) return;
    // Find our specific <mark class="seg-search-hl"> inside
    const hls = el.querySelectorAll<HTMLElement>('.seg-search-hl');
    if (hls.length === 0) return;
    // Determine which search-hl mark corresponds to this match by position
    // Build an array of {hl, offset} then pick the one matching this match's textOffset
    let cumulativeOffset = 0;
    for (const hl of hls) {
      const textLen = (hl.textContent ?? '').length;
      if (
        cumulativeOffset <= m.textOffset &&
        m.textOffset < cumulativeOffset + textLen
      ) {
        hl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const allHls = document.querySelectorAll('.seg-search-hl.current');
        allHls.forEach((h) => h.classList.remove('current'));
        hl.classList.add('current');
        return;
      }
      cumulativeOffset += textLen;
    }
  }

  function toggleCaseSensitive(): void {
    options.value = { ...options.value, caseSensitive: !options.value.caseSensitive };
    search();
  }

  function toggleWholeWord(): void {
    options.value = { ...options.value, wholeWord: !options.value.wholeWord };
    search();
  }

  function toggleRegex(): void {
    options.value = { ...options.value, useRegex: !options.value.useRegex };
    search();
  }

  return { isOpen, query, options, matches, activeMatchIndex, activeMatch, totalMatches, currentPosition, toggle, open, close, search, next, prev, toggleCaseSensitive, toggleWholeWord, toggleRegex };
});
