/**
 * 方案 P1-1c / P2-1: 版本恢复会话重建 + 草稿恢复持久化测试。
 *
 * - buildSegmentsFromTexts: 与后端 diff_texts 规则一致（golden 对比，见
 *   tests/integration/test_api.py 同源输入验证）
 * - restoreFromDraft: 必须持久化 meta（硬刷新后 sessionId 可重算）
 * - restoreVersionSession: 重建完整会话（meta/stats/scale/持久化）
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Segment } from '@/types';

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

import { useCompareStore } from '../compare';
import { storage } from '@/utils/storage';

const mockedStorage = vi.mocked(storage);

function seg(text: string, operation: Segment['operation'], side?: 'old' | 'new', ci?: number): Segment {
  return { text, operation, origin: 'original', side, ci };
}

describe('buildSegmentsFromTexts (方案 P1-1c, golden 与后端 diff_texts 一致)', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('add-only diff: 与后端 golden 完全一致', () => {
    const store = useCompareStore();
    const segs = store.buildSegmentsFromTexts('甲丙丁戊庚', '甲乙丙丁戊己庚');
    expect(segs).toEqual([
      seg('甲', 'none'),
      seg('乙', 'add', undefined, 1),
      seg('丙丁戊', 'none'),
      seg('己', 'add', undefined, 2),
      seg('庚', 'none'),
    ]);
    // A 侧重建 = 原文；B 侧重建 = 修改版
    const rebuildA = segs.filter((s) => s.operation === 'none' || s.operation === 'del' || (s.operation === 'mod' && s.side === 'old')).map((s) => s.text).join('');
    const rebuildB = segs.filter((s) => !(s.operation === 'del' || (s.operation === 'mod' && s.side === 'old'))).map((s) => s.text).join('');
    expect(rebuildA).toBe('甲丙丁戊庚');
    expect(rebuildB).toBe('甲乙丙丁戊己庚');
  });

  it('del diff: 与后端 golden 一致', () => {
    const store = useCompareStore();
    const segs = store.buildSegmentsFromTexts('abcdefgh', 'abcfgh');
    expect(segs).toEqual([
      seg('abc', 'none'),
      seg('de', 'del', undefined, 1),
      seg('fgh', 'none'),
    ]);
  });

  it('mod diff: old/new 配对共享同一 ci', () => {
    const store = useCompareStore();
    const segs = store.buildSegmentsFromTexts('第一行原文内容', '第一行改动内容');
    expect(segs).toEqual([
      seg('第一行', 'none'),
      seg('原文', 'mod', 'old', 1),
      seg('改动', 'mod', 'new', 1),
      seg('内容', 'none'),
    ]);
  });

  it('identical texts produce only none segments', () => {
    const store = useCompareStore();
    const segs = store.buildSegmentsFromTexts('相同文本', '相同文本');
    expect(segs.every((s) => s.operation === 'none')).toBe(true);
  });
});

describe('restoreFromDraft (方案 P2-1: 硬刷新可恢复)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockedStorage.saveMeta.mockClear();
    mockedStorage.clearSegments.mockClear();
    mockedStorage.saveSegments.mockClear();
  });

  it('持久化 meta——硬刷新后才能用 meta 重算 sessionId', () => {
    const store = useCompareStore();
    store.restoreFromDraft(
      [seg('甲', 'none'), seg('乙', 'add', undefined, 1)],
      {
        fileAName: 'a.txt',
        fileBName: 'b.txt',
        timestamp: 1234567890,
        stats: { total: 1, add: 1, del: 0, mod: 0 },
      },
    );
    expect(mockedStorage.saveMeta).toHaveBeenCalledTimes(1);
    const meta = mockedStorage.saveMeta.mock.calls[0][0];
    expect(meta.fileA).toBe('a.txt');
    expect(meta.fileB).toBe('b.txt');
    expect(meta.timestamp).toBe(1234567890);
    // sessionId 由同一三元组派生（与 ReportPage onMounted 重算逻辑一致）
    expect(store.sessionId).toBeTruthy();
    expect(store.isComplete).toBe(true);
  });
});

describe('restoreVersionSession (方案 P1-1c: 恢复结果落地)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockedStorage.saveMeta.mockClear();
    mockedStorage.clearSegments.mockClear();
    mockedStorage.saveSegments.mockClear();
  });

  it('重建会话: segments/meta/stats/scale + 持久化', async () => {
    const store = useCompareStore();
    await store.restoreVersionSession('第一行原文内容', '第一行改动内容', '测试版本');
    expect(store.segments.length).toBe(4);
    expect(store.meta?.fileA).toBe('测试版本 · A');
    expect(store.meta?.fileB).toBe('测试版本 · B');
    expect(store.meta?.stats).toEqual({ total: 1, add: 0, del: 0, mod: 1 });
    expect(store.meta?.scale).toBe('S');
    expect(store.isComplete).toBe(true);
    // 持久化 meta + segments（硬刷新可恢复）
    expect(mockedStorage.saveMeta).toHaveBeenCalledTimes(1);
    expect(mockedStorage.saveSegments).toHaveBeenCalledTimes(1);
    // sessionId 与 meta 一致
    const { fnv1aHash } = await import('@/utils/hash');
    expect(store.sessionId).toBe(
      fnv1aHash(`${store.meta!.fileA}\u0000${store.meta!.fileB}\u0000${store.meta!.timestamp}`),
    );
  });

  it('长文本恢复时 scale 按长度重算（>10万 → M）', async () => {
    const store = useCompareStore();
    const longA = '甲'.repeat(150_000);
    const longB = '甲'.repeat(150_000) + '尾';
    await store.restoreVersionSession(longA, longB, '大文档版本');
    expect(store.meta?.scale).toBe('M');
  });
});
