<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCompareStore } from '../stores/compare';
import { useViewStore } from '../stores/view';
import { useEditorStore } from '../stores/editor';
import { useSearchStore } from '../stores/search';
import { useVersionStore } from '../stores/version';
import { useKeyboardShortcuts } from '../utils/keybindings';
import { storage } from '../utils/storage';
import { fnv1aHash } from '../utils/hash';
import type { SegmentId } from '../types';
import Toolbar from '../components/report-page/Toolbar.vue';
import ProgressHeader from '../components/report-page/ProgressHeader.vue';
import SearchBar from '../components/report-page/SearchBar.vue';
import UnifiedView from '../components/report-page/UnifiedView.vue';
import SplitView from '../components/report-page/SplitView.vue';
import CodeMirrorDiff from '../components/report-page/CodeMirrorDiff.vue';
import Sidebar from '../components/report-page/Sidebar.vue';
import ErrorDisplay from '../components/report-page/ErrorDisplay.vue';
import ExportDialog from '../components/report-page/ExportDialog.vue';
import VersionHistory from '../components/report-page/VersionHistory.vue';

const route = useRoute();
const router = useRouter();
const compareStore = useCompareStore();
const viewStore = useViewStore();
const searchStore = useSearchStore();
const editorStore = useEditorStore();
const versionStore = useVersionStore();

const isExportDialogVisible = ref(false);
const showVersions = ref(false);

/**
 * Rev. 5-3: hard-reload recovery. On mount, if the store has no data for the
 * session id in the URL, re-derive the id from persisted meta (localStorage)
 * and restore segments from IndexedDB. Falls back to the select page when the
 * session is gone (e.g. a stale bookmark after clearAll).
 */
onMounted(async () => {
  const sid = String(route.params.sessionId ?? '');
  if (!sid) {
    router.replace('/');
    return;
  }
  // Normal entry: store already holds this session (startCompare / resumeDraft).
  if (compareStore.segments.length > 0 && compareStore.sessionId === sid) return;

  const meta = storage.loadMeta();
  const computed = meta
    ? fnv1aHash(`${meta.fileA}\u0000${meta.fileB}\u0000${meta.timestamp}`)
    : '';
  if (meta && computed === sid) {
    try {
      const rows = await storage.loadSegments();
      const segs = rows.flat();
      if (segs.length > 0) {
        compareStore.restoreFromDraft(segs, {
          fileAName: meta.fileA,
          fileBName: meta.fileB,
          timestamp: meta.timestamp,
          stats: meta.stats,
          totalChunks: meta.totalChunks,
        });
        return;
      }
    } catch {
      /* fall through to the select page */
    }
  }
  router.replace('/');
});

/**
 * 方案 P2-3：大文档（scale M/L）查看态由只读 CodeMirror 承接（虚拟行渲染），
 * v-html 视图仅用于小文档（scale S）。统一引用 compareStore.isLargeDoc。
 * 注意：不做本地 const 赋值（setup 解包后失去响应性），模板/script 直接访问 store。
 */

useKeyboardShortcuts({
  onSearchToggle: () => searchStore.toggle(),
  onToggleView: () => viewStore.toggleView(),
  onEdit: async () => {
    if (editorStore.isEditing) {
      editorStore.exitEdit();
    } else {
      await editorStore.enterEdit();
    }
  },
  onExport: () => { isExportDialogVisible.value = true; },
  onEscape: () => {
    if (editorStore.isEditing) { editorStore.exitEdit(); return; }
    if (searchStore.isOpen) { searchStore.close(); return; }
    if (isExportDialogVisible.value) { isExportDialogVisible.value = false; return; }
  },
  onNextChange: () => {
    const ctxs = compareStore.contexts;
    if (ctxs.length === 0) return;
    let next = activeContextIdx.value + 1;
    if (next >= ctxs.length) next = 0;
    activeContextIdx.value = next;
    scrollToContext(ctxs[next]);
  },
  onPrevChange: () => {
    const ctxs = compareStore.contexts;
    if (ctxs.length === 0) return;
    let prev = activeContextIdx.value - 1;
    if (prev < 0) prev = ctxs.length - 1;
    activeContextIdx.value = prev;
    scrollToContext(ctxs[prev]);
  },
});

const activeContextIdx = ref(-1);

function scrollToContext(ctx: { index: SegmentId }): void {
  // Rev. E3 + 方案 P2: 编辑模式或大文档查看态都走 CodeMirror 通道
  // (__cmScrollToCi)，否则经典 ci-N DOM 锚点。
  const host = document.querySelector('.report-main') as
    | (HTMLElement & { __cmScrollToCi?: (ci: SegmentId) => void })
    | null;
  // 方案 P2-3: 统一引用 compareStore.isLargeDoc（store getter 响应式，
  // 模板与 script 直接访问自动解包为 boolean）
  if ((editorStore.isEditing || compareStore.isLargeDoc) && host?.__cmScrollToCi) {
    host.__cmScrollToCi(ctx.index);
    return;
  }
  const el = document.getElementById(`ci-${ctx.index}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ci-flash');
    setTimeout(() => el.classList.remove('ci-flash'), 1200);
  }
}

versionStore.loadVersions();
</script>

<template>
  <div class="report-page">
    <Toolbar @export="isExportDialogVisible = true" @versions="showVersions = true" />
    <ProgressHeader />
    <SearchBar />
    <ErrorDisplay :error="compareStore.error" @dismiss="compareStore.error = null" />
    <div class="report-body">
      <Sidebar />
      <main class="report-main">
        <CodeMirrorDiff />
        <!-- 方案 P2: 大文档查看态由 CodeMirrorDiff 内的只读 CM 承接 -->
        <UnifiedView v-if="viewStore.viewMode === 'unified' && !editorStore.isEditing && !compareStore.isLargeDoc" />
        <SplitView v-else-if="!editorStore.isEditing && !compareStore.isLargeDoc" />
      </main>
    </div>
    <ExportDialog v-if="isExportDialogVisible" @close="isExportDialogVisible = false" />
    <VersionHistory v-if="showVersions" @close="showVersions = false" />
  </div>
</template>

<style scoped>
.report-page { display: flex; flex-direction: column; height: 100vh; }
.report-body { display: flex; flex: 1; overflow: hidden; }
.report-main { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
</style>
