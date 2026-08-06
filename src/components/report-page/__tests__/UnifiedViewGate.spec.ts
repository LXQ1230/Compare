/**
 * UnifiedView gate 测试（2026-08-06 方案 A）：
 * 大文档竖排 IDML 查看态 → v-html 竖排，但流式 push 期间不增量渲染
 * （等 isComplete 一次性渲染，避免每个 chunk 全量重算 17.5MB HTML）。
 * 小文档保持原有流式边收边渲染（无 gate）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useCompareStore } from '../../../stores/compare';
import { useSearchStore } from '../../../stores/search';
import UnifiedView from '../UnifiedView.vue';

vi.mock('@/utils/storage', () => ({
  storage: {
    saveMeta: vi.fn(),
    loadMeta: vi.fn(() => null),
    clearSegments: vi.fn(() => Promise.resolve()),
    saveSegments: vi.fn(() => Promise.resolve()),
    loadSegments: vi.fn(() => Promise.resolve([])),
    saveVersions: vi.fn(),
    loadVersions: vi.fn(() => []),
    clearAll: vi.fn(() => Promise.resolve()),
    saveEditDraft: vi.fn(() => Promise.resolve()),
    loadEditDraft: vi.fn(() => Promise.resolve(null)),
    clearEditDraft: vi.fn(() => Promise.resolve()),
    listEditDrafts: vi.fn(() => []),
    saveAutosaveDraft: vi.fn(),
    loadAutosaveDraft: vi.fn(() => null),
    clearAutosaveDraft: vi.fn(),
  },
}));

// pagedScroll 依赖真实滚动容器，测试中 mock 掉
vi.mock('../../../utils/pagedScroll', () => ({
  setupPagedWheel: vi.fn(() => () => {}),
}));

function mountView(opts: {
  segments: { text: string; operation: string }[];
  vertical: boolean;
  scale: 'S' | 'M' | 'L';
  isComplete: boolean;
}) {
  setActivePinia(createPinia());
  const compare = useCompareStore();
  compare.segments = opts.segments as never;
  compare.meta = {
    fileA: 'a.txt',
    fileB: 'b.txt',
    stats: { total: 1, add: 0, del: 0, mod: 1 },
    timestamp: Date.now(),
    totalChunks: 1,
    scale: opts.scale,
    docMeta: {
      vertical: opts.vertical,
      leadingRatio: 1.536,
      firstLineIndent: 0,
      fontsUnavailable: [],
    },
  } as never;
  compare.isComplete = opts.isComplete;
  useSearchStore(); // ensure search store exists (UnifiedView reads it)
  return mount(UnifiedView);
}

describe('UnifiedView 大文档竖排 gate（方案 A）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('大文档竖排 + 未完成 → 显示加载占位，不渲染内容', () => {
    const w = mountView({
      segments: [{ text: '甲。', operation: 'none' }],
      vertical: true,
      scale: 'L',
      isComplete: false,
    });
    expect(w.find('.view-loading').exists()).toBe(true);
    expect(w.find('.unified-view').exists()).toBe(false);
    expect(w.text()).toContain('正在生成竖排视图');
  });

  it('大文档竖排 + 已完成 → 一次性渲染竖排内容', () => {
    const w = mountView({
      segments: [{ text: '甲。', operation: 'none' }],
      vertical: true,
      scale: 'L',
      isComplete: true,
    });
    expect(w.find('.view-loading').exists()).toBe(false);
    const view = w.find('.unified-view');
    expect(view.exists()).toBe(true);
    expect(view.classes()).toContain('doc-vertical');
    expect(view.attributes('style') ?? '').toContain('writing-mode: vertical-rl');
    expect(view.text()).toContain('甲。');
  });

  it('小文档（含竖排 IDML）不 gate：未完成也直接渲染', () => {
    const w = mountView({
      segments: [{ text: '小。', operation: 'none' }],
      vertical: true,
      scale: 'S',
      isComplete: false,
    });
    expect(w.find('.view-loading').exists()).toBe(false);
    expect(w.find('.unified-view').exists()).toBe(true);
    expect(w.find('.unified-view').text()).toContain('小。');
  });

  it('大文档横排不 gate（txt/md 走 CM，v-html 不承接）', () => {
    const w = mountView({
      segments: [{ text: 'plain', operation: 'none' }],
      vertical: false,
      scale: 'L',
      isComplete: false,
    });
    // 大文档横排时本组件通常不挂载（ReportPage 层拦截），
    // 但即使挂载也不应显示 loading（无 gate 依赖）
    expect(w.find('.unified-view').exists()).toBe(true);
    expect(w.find('.unified-view').text()).toContain('plain');
  });
});
