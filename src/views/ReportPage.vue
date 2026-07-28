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
  onEdit: () => editorStore.enterEdit(),
  onExport: () => { isExportDialogVisible.value = true; },
  onEscape: () => {
    if (searchStore.isOpen) searchStore.close();
    if (isExportDialogVisible.value) isExportDialogVisible.value = false;
  },
  onNextChange: () => { /* navigate to next change in contexts */ },
  onPrevChange: () => { /* navigate to previous change in contexts */ },
});

compareStore.buildContexts();
versionStore.loadVersions();
</script>

<template>
  <div class="report-page">
    <Toolbar @export="isExportDialogVisible = true" />
    <ProgressHeader />
    <SearchBar />
    <ErrorDisplay :error="compareStore.error" @dismiss="compareStore.error = null" />
    <div class="report-body">
      <main class="report-main">
        <UnifiedView v-if="viewStore.viewMode === 'unified'" />
        <SplitView v-else />
      </main>
      <Sidebar />
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
