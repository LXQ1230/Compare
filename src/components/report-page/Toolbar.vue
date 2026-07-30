<script setup lang="ts">
import { useCompareStore } from '../../stores/compare';
import { useViewStore } from '../../stores/view';
import { useEditorStore } from '../../stores/editor';
import { useSearchStore } from '../../stores/search';

const compareStore = useCompareStore();
const viewStore = useViewStore();
const editorStore = useEditorStore();
const searchStore = useSearchStore();

function handleEditToggle(): void {
  if (editorStore.isEditing) {
    editorStore.exitEdit();
  } else {
    editorStore.enterEdit();
  }
}

defineEmits<{ export: [] }>();
</script>

<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <span class="file-label" v-if="compareStore.fileAName">
        {{ compareStore.fileAName }} ↔ {{ compareStore.fileBName }}
      </span>
      <span class="stats-badge" v-if="compareStore.stats.total > 0">
        {{ compareStore.stats.total }} 处变更
      </span>
    </div>
    <div class="toolbar-right">
      <button class="tb-btn" @click="searchStore.toggle()" title="搜索 (Ctrl+F)">🔍 搜索</button>
      <button class="tb-btn" @click="viewStore.toggleView()" title="切换视图">
        {{ viewStore.viewMode === 'unified' ? '⇶ 分栏' : '≡ 统一' }}
      </button>
      <button
        class="tb-btn edit-btn" :class="{ active: editorStore.isEditing }"
        @click="handleEditToggle"
        title="编辑模式 (Ctrl+E)"
      >✏️ {{ editorStore.isEditing ? '退出编辑' : '编辑' }}</button>
      <button class="tb-btn" @click="$emit('export')" title="导出">📥 导出</button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 16px; border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary); flex-shrink: 0;
}
.toolbar-left { display: flex; align-items: center; gap: 12px; }
.file-label { font-size: 14px; font-weight: 600; }
.stats-badge {
  font-size: 12px; background: var(--color-focus-border); color: #fff;
  padding: 2px 8px; border-radius: 10px;
}
.toolbar-right { display: flex; gap: 6px; }
.tb-btn {
  padding: 6px 12px; font-size: 13px; border: 1px solid var(--color-border);
  border-radius: 6px; background: var(--color-bg); cursor: pointer;
}
.tb-btn:hover { background: var(--color-bg-hover); }
.edit-btn.active {
  background: var(--color-user-add-bg);
  border-color: var(--color-user-add-text);
  color: var(--color-user-add-text);
}
</style>
