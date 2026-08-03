<script setup lang="ts">
import { useCompareStore } from '../../stores/compare';
import { useEditorStore } from '../../stores/editor';
import { useViewStore } from '../../stores/view';

const compareStore = useCompareStore();
const editorStore = useEditorStore();
const viewStore = useViewStore();

function typeBadge(type: string): { label: string; cls: string } {
  if (type === 'add') return { label: '+', cls: 'badge-add' };
  if (type === 'del') return { label: '-', cls: 'badge-del' };
  return { label: '~', cls: 'badge-mod' };
}

function typeLabel(type: string): string {
  if (type === 'add') return '新增';
  if (type === 'del') return '删除';
  return '修改';
}

function locationLabel(ctx: { type: string; lineA: number; lineB: number; side?: 'old' | 'new' }): string {
  if (ctx.type === 'add') return `行 ${ctx.lineB}`;
  if (ctx.type === 'del') return `行 ${ctx.lineA}`;
  return `行 ${ctx.lineA} → ${ctx.lineB}`;
}

function scrollTo(ci: number) {
  // Rev. E3: editing mode navigates through the CodeMirror channel
  // (__cmScrollToCi), otherwise the classic ci-N DOM anchor.
  const host = document.querySelector('.report-main') as
    | (HTMLElement & { __cmScrollToCi?: (ci: number) => void })
    | null;
  if (editorStore.isEditing && host?.__cmScrollToCi) {
    host.__cmScrollToCi(ci);
    return;
  }
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

      <!-- Minimap -->
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
        <h4 class="section-title">变更列表</h4>
        <div v-if="compareStore.contexts.length === 0" class="empty-hint">暂无变更</div>
        <div
          v-for="ctx in compareStore.contexts" :key="`${ctx.index}-${ctx.side ?? 'none'}`"
          class="change-item" :class="`change-${ctx.type}`"
          @click="scrollTo(ctx.index)"
        >
          <span class="change-badge" :class="typeBadge(ctx.type).cls">{{ typeBadge(ctx.type).label }}</span>
          <div class="change-row">
            <!-- upper: ... [changed] ... -->
            <div class="change-context">
              <span class="ctx-before">{{ ctx.before || '···' }}</span
              ><span class="ctx-hl">{{ ctx.highlight }}</span
              ><span class="ctx-after">{{ ctx.after || '···' }}</span>
            </div>
            <!-- lower: type + position -->
            <div class="change-meta">
              <span class="meta-type">{{ typeLabel(ctx.type) }}</span>
              <span class="meta-sep">·</span>
              <span class="meta-loc">{{ locationLabel(ctx) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* ── layout ─────────────────────────────────────────────── */
.sidebar {
  width: 300px; border-right: 1px solid var(--color-border); display: flex;
  flex-shrink: 0; position: relative; background: var(--color-bg-secondary);
  order: -1;
}
.sidebar.collapsed { width: 24px; }
.collapse-btn {
  position: absolute; top: 8px; right: -12px; width: 24px; height: 24px;
  border-radius: 50%; border: 1px solid var(--color-border); background: var(--color-bg);
  cursor: pointer; font-size: 10px; display: flex; align-items: center;
  justify-content: center; z-index: 1;
}
.sidebar-content { padding: 16px 12px; overflow-y: auto; flex: 1; }

/* ── stats ──────────────────────────────────────────────── */
.stats-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px; }
.stat-item { text-align: center; padding: 8px 4px; border-radius: 6px; background: var(--color-bg); }
.stat-item.add { background: var(--color-add-bg); }
.stat-item.del { background: var(--color-del-bg); }
.stat-item.mod { background: var(--color-mod-new-bg); }
.stat-num { font-size: 20px; font-weight: 700; display: block; }
.stat-label { font-size: 11px; color: var(--color-text-secondary); }

/* ── minimap ────────────────────────────────────────────── */
.section-title { font-size: 12px; font-weight: 600; margin: 12px 0 6px; color: var(--color-text-secondary); }
.minimap-heatmap { display: flex; flex-wrap: wrap; gap: 2px; }
.heat-dot { width: 8px; height: 8px; border-radius: 2px; }
.dot-add { background: var(--color-add-text); }
.dot-del { background: var(--color-del-text); }
.dot-mod { background: var(--color-mod-old-text); }

/* ── change list ────────────────────────────────────────── */
.change-list { max-height: calc(100vh - 280px); overflow-y: auto; }
.change-item {
  display: flex; gap: 8px; padding: 8px 6px; font-size: 12px;
  border-bottom: 1px solid var(--color-border); cursor: pointer; border-radius: 4px;
  transition: background 0.15s;
}
.change-item:hover { background: var(--color-bg-hover); }

/*  + / - / ~  circle */
.change-badge {
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; color: #fff; line-height: 1; margin-top: 2px;
}
.badge-add { background: var(--color-add-text); }
.badge-del { background: var(--color-del-text); }
.badge-mod { background: var(--color-mod-old-text); }

.change-row { flex: 1; min-width: 0; overflow: hidden; }

/* context: before ··· HIGHLIGHT ··· after (single line, ellipsis) */
.change-context {
  font-family: var(--font-mono); font-size: 11px; line-height: 1.45;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ctx-before { color: var(--color-text-secondary); }
.ctx-hl    { color: var(--color-text); font-weight: 700; }
.ctx-after { color: var(--color-text-secondary); }

/* meta: 新增 · 行 5 */
.change-meta { font-size: 10px; color: var(--color-text-secondary); margin-top: 2px; }
.meta-type { font-weight: 600; }
.meta-sep  { margin: 0 4px; color: var(--color-border); }
.meta-loc  { color: var(--color-focus-border); }

.empty-hint { font-size: 12px; color: var(--color-text-secondary); }
</style>
