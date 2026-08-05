<script setup lang="ts">
import { useCompareStore } from '../../stores/compare';
import { useViewStore } from '../../stores/view';
import { useEditorStore } from '../../stores/editor';
import { useSearchStore } from '../../stores/search';

const compareStore = useCompareStore();
const viewStore = useViewStore();
const editorStore = useEditorStore();
const searchStore = useSearchStore();

/**
 * 方案 P2-3：大文档（scale M/L）查看态由只读 CM 承接（Unified 语义），
 * split 分栏仅小文档可用。模板中直接访问 compareStore.isLargeDoc
 * （setup 中 const 赋值会丢失响应性，故不在此缓存）。
 */

async function handleEditToggle(): Promise<void> {
  if (editorStore.isEditing) {
    editorStore.exitEdit();
  } else {
    await editorStore.enterEdit();
  }
}

function jumpToLastEdit(): void {
  const host = document.querySelector('.report-main') as
    | (HTMLElement & { __cmScrollToLastEdit?: () => void })
    | null;
  host?.__cmScrollToLastEdit?.();
}

defineEmits<{ export: []; versions: [] }>();
</script>

<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <span class="file-label" v-if="compareStore.fileAName">
        {{ compareStore.fileAName }} ↔ {{ compareStore.fileBName }}
      </span>
      <span class="stats-badge" v-if="compareStore.stats.total > 0">
        <!-- 三期 A 组（2-7）：编辑模式切换为编辑后统计（含已恢复） -->
        {{ editorStore.isEditing ? editorStore.editedStats.total : compareStore.stats.total }} 处变更
      </span>
      <span v-if="editorStore.isEditing && editorStore.editedStats.restored > 0" class="stats-badge restored-badge">
        ✓ {{ editorStore.editedStats.restored }} 处已恢复
      </span>
    </div>
    <div class="toolbar-right">
      <button class="tb-btn" @click="searchStore.toggle()" title="搜索 (Ctrl+F)">🔍 搜索</button>
      <button
        class="tb-btn" :disabled="compareStore.isLargeDoc && !editorStore.isEditing"
        @click="viewStore.toggleView()"
        :title="compareStore.isLargeDoc && !editorStore.isEditing ? '大文档仅支持统一视图' : '切换视图'"
      >
        {{ viewStore.viewMode === 'unified' ? '⇶ 分栏' : '≡ 统一' }}
      </button>
      <button
        v-if="editorStore.isEditing"
        class="tb-btn save-btn"
        @click="editorStore.saveDraft()"
        title="保存编辑草稿"
      >💾 保存草稿</button>
      <button
        v-if="editorStore.isEditing && editorStore.lastEditOffset >= 0"
        class="tb-btn"
        @click="jumpToLastEdit"
        title="跳到上次编辑位置"
      >📍 上次编辑</button>
      <button
        class="tb-btn edit-btn" :class="{ active: editorStore.isEditing }"
        @click="handleEditToggle"
        title="编辑模式 (Ctrl+E)"
      >✏️ {{ editorStore.isEditing ? '退出编辑' : '编辑' }}</button>
      <button class="tb-btn" @click="$emit('export')" title="导出">📥 导出</button>
      <button class="tb-btn" @click="$emit('versions')" title="版本历史">📚 版本</button>
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
/* 三期 A 组：已恢复原文徽标（绿色） */
.restored-badge { background: var(--color-user-restored-text); }
.toolbar-right { display: flex; gap: 6px; }
.tb-btn {
  padding: 6px 12px; font-size: 13px; border: 1px solid var(--color-border);
  border-radius: 6px; background: var(--color-bg); cursor: pointer;
}
.tb-btn:hover { background: var(--color-bg-hover); }
.tb-btn:disabled { opacity: 0.4; cursor: default; }
.tb-btn:disabled:hover { background: var(--color-bg); }
.edit-btn.active {
  background: var(--color-user-add-bg);
  border-color: var(--color-user-add-text);
  color: var(--color-user-add-text);
}
.save-btn {
  border-color: var(--color-focus-border);
  color: var(--color-focus-border);
}
</style>
