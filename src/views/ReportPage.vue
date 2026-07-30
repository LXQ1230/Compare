<script setup lang="ts">
import { ref } from 'vue';
import { useCompareStore } from '../stores/compare';
import { useViewStore } from '../stores/view';
import { useEditorStore } from '../stores/editor';
import { useSearchStore } from '../stores/search';
import { useVersionStore } from '../stores/version';
import { useKeyboardShortcuts } from '../utils/keybindings';
import Toolbar from '../components/report-page/Toolbar.vue';
import ProgressHeader from '../components/report-page/ProgressHeader.vue';
import SearchBar from '../components/report-page/SearchBar.vue';
import UnifiedView from '../components/report-page/UnifiedView.vue';
import SplitView from '../components/report-page/SplitView.vue';
import EditLivePanel from '../components/report-page/EditLivePanel.vue';
import Sidebar from '../components/report-page/Sidebar.vue';
import ErrorDisplay from '../components/report-page/ErrorDisplay.vue';
import ExportDialog from '../components/report-page/ExportDialog.vue';
import VersionHistory from '../components/report-page/VersionHistory.vue';

const compareStore = useCompareStore();
const viewStore = useViewStore();
const searchStore = useSearchStore();
const editorStore = useEditorStore();
const versionStore = useVersionStore();

const isExportDialogVisible = ref(false);
const showVersions = ref(false);

useKeyboardShortcuts({
  onSearchToggle: () => searchStore.toggle(),
  onToggleView: () => viewStore.toggleView(),
  onEdit: () => {
    if (editorStore.isEditing) {
      editorStore.exitEdit();
    } else {
      editorStore.enterEdit();
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

function scrollToContext(ctx: { index: number }): void {
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
    <Toolbar @export="isExportDialogVisible = true" />
    <ProgressHeader />
    <SearchBar />
    <ErrorDisplay :error="compareStore.error" @dismiss="compareStore.error = null" />
    <div class="report-body">
      <Sidebar />
      <main class="report-main">
        <EditLivePanel />
        <UnifiedView v-if="viewStore.viewMode === 'unified' && !editorStore.isEditing" />
        <SplitView v-else-if="!editorStore.isEditing" />
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
