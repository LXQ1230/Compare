<script setup lang="ts">
import { useCompareStore } from '../../stores/compare';
import { useViewStore } from '../../stores/view';

const compareStore = useCompareStore();
const viewStore = useViewStore();

/** 增/删/改 中文标签 */
function typeLabel(type: string): string {
  if (type === 'add') return '新增';
  if (type === 'del') return '删除';
  return '修改';
}

function scrollTo(ci: number) {
  const el = document.getElementById(`ci-${ci}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ci-flash');
    setTimeout(() => el.classList.remove('ci-flash'), 1200);
  }
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: viewStore.minimapCollapsed }">
    <button class="collapse-btn" @click="viewStore.toggleMinimap()">
      {{ viewStore.minimapCollapsed ? '◀' : '▶' }}
    </button>
    <div v-if="!viewStore.minimapCollapsed" class="sidebar-content">
      <!-- Stats grid -->
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

      <!-- Minimap / change density -->
      <div class="minimap-section">
        <h4 class="section-title">变更分布</h4>
        <div class="minimap-heatmap">
          <span
            v-for="(seg, idx) in compareStore.segments.filter(s => s.operation !== 'none').slice(0, 60)"
            :key="idx" class="heat-dot" :class="`dot-${seg.operation}`"
          />
        </div>
      </div>

      <!-- Change list -->
      <div class="change-list">
        <h4 class="section-title">变更列表 ({{ Math.min(compareStore.contexts.length, 50) }}/{{ compareStore.contexts.length }})</h4>
        <div v-if="compareStore.contexts.length === 0" class="empty-hint">暂无变更</div>
        <div
          v-for="ctx in compareStore.contexts.slice(0, 50)" :key="ctx.index"
          class="change-item" :class="`change-${ctx.type}`"
          @click="scrollTo(ctx.index)"
        >
          <!-- Type badge -->
          <span class="change-badge">{{ typeLabel(ctx.type) }}</span>
          <!-- Context snippet -->
          <div class="change-body">
            <div class="change-context-line">
              <span class="ctx-fragment ctx-before">{{ ctx.before || '···' }}</span>
              <span class="ctx-fragment ctx-highlight">{{ ctx.highlight.slice(0, 60) }}{{ ctx.highlight.length > 60 ? '…' : '' }}</span>
              <span class="ctx-fragment ctx-after">{{ ctx.after || '···' }}</span>
            </div>
            <!-- Location line -->
            <div class="change-location">
              <template v-if="ctx.type === 'add'">修改第 {{ ctx.lineB }} 行</template>
              <template v-else-if="ctx.type === 'del'">原始第 {{ ctx.lineA }} 行</template>
              <template v-else>原始 {{ ctx.lineA }} 行 → 修改 {{ ctx.lineB }} 行</template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 300px; border-right: 1px solid var(--color-border); display: flex;
  flex-shrink: 0; position: relative; background: var(--color-bg-secondary);
}
.sidebar.collapsed { width: 24px; }
.collapse-btn {
  position: absolute; top: 8px; right: -12px; width: 24px; height: 24px;
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

/* Change list */
.change-list { max-height: calc(100vh - 320px); overflow-y: auto; }
.change-item {
  display: flex; gap: 6px; padding: 8px 4px; font-size: 12px;
  border-bottom: 1px solid var(--color-border); cursor: pointer; border-radius: 4px;
  transition: background 0.15s;
}
.change-item:hover { background: var(--color-bg-hover); }

/* Type badge */
.change-badge {
  flex-shrink: 0; width: 36px; height: 20px; font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; border-radius: 4px;
  color: #fff; line-height: 1; margin-top: 1px;
}
.change-add .change-badge { background: var(--color-add-text); }
.change-del .change-badge { background: var(--color-del-text); }
.change-mod .change-badge { background: var(--color-mod-old-text); }

.change-body { flex: 1; min-width: 0; overflow: hidden; }

/* Context line — before (dim) + highlight (bold) + after (dim) */
.change-context-line {
  font-family: var(--font-mono); font-size: 11px; line-height: 1.4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ctx-fragment { display: inline; }
.ctx-before { color: var(--color-text-secondary); }
.ctx-highlight { color: var(--color-text); font-weight: 700; }
.ctx-after { color: var(--color-text-secondary); }

/* Location line */
.change-location {
  font-size: 10px; color: var(--color-focus-border); margin-top: 2px; font-weight: 500;
}

.empty-hint { font-size: 12px; color: var(--color-text-secondary); }
</style>
