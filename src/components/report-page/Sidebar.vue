<script setup lang="ts">
import { useCompareStore } from '../../stores/compare';
import { useViewStore } from '../../stores/view';
import { useSearchStore } from '../../stores/search';

const compareStore = useCompareStore();
const viewStore = useViewStore();
const searchStore = useSearchStore();
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: viewStore.minimapCollapsed }">
    <button class="collapse-btn" @click="viewStore.toggleMinimap()">
      {{ viewStore.minimapCollapsed ? '◀' : '▶' }}
    </button>
    <div v-if="!viewStore.minimapCollapsed" class="sidebar-content">
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-num">{{ compareStore.stats.total }}</span><span class="stat-label">总变更</span>
        </div>
        <div class="stat-item add">
          <span class="stat-num">{{ compareStore.stats.add }}</span><span class="stat-label">新增</span>
        </div>
        <div class="stat-item del">
          <span class="stat-num">{{ compareStore.stats.del }}</span><span class="stat-label">删除</span>
        </div>
        <div class="stat-item mod">
          <span class="stat-num">{{ compareStore.stats.mod }}</span><span class="stat-label">修改</span>
        </div>
      </div>
      <div class="minimap-section">
        <h4 class="section-title">变更分布</h4>
        <div class="minimap-heatmap">
          <span
            v-for="(seg, idx) in compareStore.segments.filter(s => s.operation !== 'none').slice(0, 60)"
            :key="idx" class="heat-dot" :class="`dot-${seg.operation}`"
          />
        </div>
      </div>
      <div class="change-list">
        <h4 class="section-title">变更列表</h4>
        <div v-if="compareStore.contexts.length === 0" class="empty-hint">暂无变更</div>
        <div
          v-for="ctx in compareStore.contexts.slice(0, 50)" :key="ctx.index"
          class="change-item" :class="`change-${ctx.type}`"
        >
          <span class="change-type">{{ ctx.type === 'add' ? '+' : ctx.type === 'del' ? '-' : '~' }}</span>
          <span class="change-text">{{ ctx.highlight.slice(0, 40) }}</span>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 240px; border-left: 1px solid var(--color-border); display: flex;
  flex-shrink: 0; position: relative; background: var(--color-bg-secondary);
}
.sidebar.collapsed { width: 24px; }
.collapse-btn {
  position: absolute; top: 8px; left: -12px; width: 24px; height: 24px;
  border-radius: 50%; border: 1px solid var(--color-border); background: var(--color-bg);
  cursor: pointer; font-size: 10px; display: flex; align-items: center;
  justify-content: center; z-index: 1;
}
.sidebar-content { padding: 16px 12px; overflow-y: auto; flex: 1; }
.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
.stat-item { text-align: center; padding: 8px; border-radius: 6px; background: var(--color-bg); }
.stat-item.add { background: var(--color-add-bg); }
.stat-item.del { background: var(--color-del-bg); }
.stat-item.mod { background: var(--color-mod-new-bg); }
.stat-num { font-size: 20px; font-weight: 700; display: block; }
.stat-label { font-size: 11px; color: var(--color-text-secondary); }
.section-title { font-size: 12px; font-weight: 600; margin: 12px 0 6px; color: var(--color-text-secondary); }
.minimap-heatmap { display: flex; flex-wrap: wrap; gap: 2px; }
.heat-dot { width: 10px; height: 10px; border-radius: 2px; }
.dot-add { background: var(--color-add-text); }
.dot-del { background: var(--color-del-text); }
.dot-mod { background: var(--color-mod-old-text); }
.change-list { max-height: 300px; overflow-y: auto; }
.change-item { display: flex; gap: 6px; padding: 3px 0; font-size: 12px; border-bottom: 1px solid var(--color-border); }
.change-type { font-weight: 700; width: 16px; flex-shrink: 0; }
.change-add .change-type { color: var(--color-add-text); }
.change-del .change-type { color: var(--color-del-text); }
.change-mod .change-type { color: var(--color-mod-old-text); }
.change-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty-hint { font-size: 12px; color: var(--color-text-secondary); }
</style>
