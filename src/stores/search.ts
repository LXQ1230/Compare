/**
 * Search store — manages search state, options, and match navigation.
 */

import { defineStore } from 'pinia';
import { ref, computed, nextTick } from 'vue';
import type { SearchMatch } from '@/utils/search';
import { searchInSegments, type SearchOptions } from '@/utils/search';
import { useCompareStore } from './compare';
import { useEditorStore } from './editor';
import { docOffsetsOf } from '@/render/editClassifier';

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
    // Auto-scroll to first match after DOM updates (renders search highlights).
    if (activeMatchIndex.value >= 0) {
      nextTick(() => scrollToActiveMatch());
    }
  }

  function next(): void {
    if (matches.value.length === 0) return;
    activeMatchIndex.value = (activeMatchIndex.value + 1) % matches.value.length;
    nextTick(() => scrollToActiveMatch());
  }

  function prev(): void {
    if (matches.value.length === 0) return;
    activeMatchIndex.value =
      (activeMatchIndex.value - 1 + matches.value.length) % matches.value.length;
    nextTick(() => scrollToActiveMatch());
  }

  /** Jump to a specific match by index (for clicking search result list). */
  function jumpTo(index: number): void {
    if (index < 0 || index >= matches.value.length) return;
    activeMatchIndex.value = index;
    nextTick(() => scrollToActiveMatch());
  }

  /** Scroll the active search match into view and flash it. */
  function scrollToActiveMatch(): void {
    const m = activeMatch.value;
    if (!m) return;
    const editorStore = useEditorStore();
    if (editorStore.isEditing) {
      // 编辑态：CM 替代渲染，走 CM 通道——
      // 偏移 = editedSegments（与 buildSearchDecos 同源）累计 doc 偏移 + 段内 offset。
      const segs = editorStore.getEditedSegments();
      if (m.segmentIndex < 0 || m.segmentIndex >= segs.length) return;
      const offsets = docOffsetsOf(segs);
      const host = document.querySelector('.report-main') as
        | (HTMLElement & { __cmScrollToSearchOffset?: (o: number) => void })
        | null;
      host?.__cmScrollToSearchOffset?.(offsets[m.segmentIndex] + m.textOffset);
      return;
    }
    // 查看态：通过 data-offset 属性精确定位 <mark>，不再用脆弱的偏移累加。
    const compareStore = useCompareStore();
    const segments = compareStore.segments;
    const idx = m.segmentIndex;
    if (idx < 0 || idx >= segments.length) return;
    const ci = segments[idx].ci;
    if (ci == null) return;
    const el = document.getElementById(`ci-${ci}`);
    if (!el) {
      // 段无 ci（operation='none'）——搜索匹配在普通文本段，直接按 data-offset 全局查找
      const globalHl = document.querySelector<HTMLElement>(
        `.seg-search-hl[data-offset="${m.textOffset}"]`,
      );
      if (globalHl) {
        globalHl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.querySelectorAll('.seg-search-hl.current').forEach((h) => h.classList.remove('current'));
        globalHl.classList.add('current');
      }
      return;
    }
    // 在段容器内精确查找 data-offset 匹配的 <mark>
    const hl = el.querySelector<HTMLElement>(
      `.seg-search-hl[data-offset="${m.textOffset}"]`,
    );
    if (!hl) return;
    hl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelectorAll('.seg-search-hl.current').forEach((h) => h.classList.remove('current'));
    hl.classList.add('current');
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

  return { isOpen, query, options, matches, activeMatchIndex, activeMatch, totalMatches, currentPosition, toggle, open, close, search, next, prev, jumpTo, toggleCaseSensitive, toggleWholeWord, toggleRegex };
});
