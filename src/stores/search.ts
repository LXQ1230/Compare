/**
 * Search store — manages search state, options, and match navigation.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { SearchMatch } from '@/utils/search';
import { searchInSegments, type SearchOptions } from '@/utils/search';
import { useCompareStore } from './compare';

export const useSearchStore = defineStore('search', () => {
  const isOpen = ref(false);
  const query = ref('');
  const options = ref<SearchOptions>({ caseSensitive: false, wholeWord: false, useRegex: false });
  const matches = ref<SearchMatch[]>([]);
  const activeMatchIndex = ref(-1);

  const activeMatch = computed(() => activeMatchIndex.value >= 0 ? matches.value[activeMatchIndex.value] ?? null : null);
  const totalMatches = computed(() => matches.value.length);
  const currentPosition = computed(() => activeMatchIndex.value >= 0 ? `${activeMatchIndex.value + 1}/${totalMatches.value}` : '0/0');

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
    matches.value = searchInSegments(compareStore.segments, query.value, options.value);
    activeMatchIndex.value = matches.value.length > 0 ? 0 : -1;
  }

  function next(): void {
    if (matches.value.length === 0) return;
    activeMatchIndex.value = (activeMatchIndex.value + 1) % matches.value.length;
  }

  function prev(): void {
    if (matches.value.length === 0) return;
    activeMatchIndex.value = (activeMatchIndex.value - 1 + matches.value.length) % matches.value.length;
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
