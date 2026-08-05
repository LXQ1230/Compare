/**
 * 方案 B（草稿恢复免重算）: editor store 的 userSegments 缓存链路测试。
 *
 * - saveDraft: 仅缓存"与当前 editText 配套"的 classify 结果（workerEditedText === editText）
 * - saveDraft: baseline 快照保留（storage 层不再剥离，恢复可逐字节复用）
 * - resumeFromDraft / enterEdit: 草稿 userSegments 带入 draftUserSegments（恢复免重算）
 * - resetToOriginal / discardDraft: 清理 draftUserSegments
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Segment } from '@/types';

vi.mock('@/utils/storage', () => ({
  storage: {
    saveEditDraft: vi.fn(() => Promise.resolve()),
    loadEditDraft: vi.fn(() => Promise.resolve(null)),
    clearEditDraft: vi.fn(() => Promise.resolve()),
    saveMeta: vi.fn(),
    loadMeta: vi.fn(() => null),
    saveSegments: vi.fn(() => Promise.resolve()),
    loadSegments: vi.fn(() => Promise.resolve([])),
    clearSegments: vi.fn(() => Promise.resolve()),
    saveVersions: vi.fn(),
    loadVersions: vi.fn(() => []),
    clearAll: vi.fn(() => Promise.resolve()),
    listEditDrafts: vi.fn(() => []),
    saveAutosaveDraft: vi.fn(),
    loadAutosaveDraft: vi.fn(() => null),
    clearAutosaveDraft: vi.fn(),
  },
}));

vi.mock('@/utils/api', () => ({
  api: {
    autosave: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

import { useEditorStore } from '../editor';
import { useCompareStore } from '../compare';
import { storage } from '@/utils/storage';
import { api } from '@/utils/api';

const mockedStorage = vi.mocked(storage);
const mockedApi = vi.mocked(api);

function userSegs(): Segment[] {
  return [
    { text: '已编辑', operation: 'mod', origin: 'user', side: 'new', ci: 1 },
    { text: '原文', operation: 'mod', origin: 'user', side: 'old', ci: 1 },
  ];
}

function seedStore(): { editor: ReturnType<typeof useEditorStore>; compare: ReturnType<typeof useCompareStore> } {
  setActivePinia(createPinia());
  const compare = useCompareStore();
  const editor = useEditorStore();
  // 供 computeDraftKey / buildDocText / saveDraft 使用的最小会话（fileAName 是
  // computed 只读，须经 restoreFromDraft 设置 meta 派生）
  compare.restoreFromDraft(
    [{ text: '基线文本', operation: 'none', origin: 'original' }],
    {
      fileAName: 'a.txt',
      fileBName: 'b.txt',
      timestamp: 12345,
      stats: { total: 0, add: 0, del: 0, mod: 0 },
    },
  );
  editor.isEditing = true; // saveDraft 早退条件
  return { editor, compare };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedStorage.saveEditDraft.mockImplementation(() => Promise.resolve());
  mockedApi.autosave.mockImplementation(() => Promise.resolve({ ok: true }));
});

describe('saveDraft userSegments 缓存（方案 B）', () => {
  it('缓存与 editText 配套（workerEditedText === editText）→ 写入 userSegments + baseline 快照', () => {
    const { editor } = seedStore();
    editor.draftKey = 'k1';
    editor.editText = '已编辑的全文';
    editor.originalBaseline = '基线全文';
    editor.hasEdits = true;
    const segs = userSegs();
    editor.setWorkerResult(1, segs, '已编辑的全文'); // 配套快照

    editor.saveDraft();
    expect(mockedStorage.saveEditDraft).toHaveBeenCalledTimes(1);
    const draft = mockedStorage.saveEditDraft.mock.calls[0][0];
    expect(draft.userSegments).toEqual(segs);
    expect(draft.baseline).toBe('基线全文'); // 快照保留（storage 层不再剥离）
    expect(draft.editText).toBe('已编辑的全文');
  });

  it('缓存过期（workerEditedText !== editText）→ 不写 userSegments（恢复回退 worker）', () => {
    const { editor } = seedStore();
    editor.draftKey = 'k2';
    editor.editText = '最新编辑';
    editor.originalBaseline = '基线';
    editor.hasEdits = true;
    editor.setWorkerResult(1, userSegs(), '旧文本'); // 缓存对应旧文本

    editor.saveDraft();
    const draft = mockedStorage.saveEditDraft.mock.calls[0][0];
    expect(draft.userSegments).toBeUndefined();
  });

  it('缓存未就绪（workerSegments 为 null）→ 不写 userSegments，保存不抛错', () => {
    const { editor } = seedStore();
    editor.draftKey = 'k3';
    editor.editText = '刚编辑';
    editor.originalBaseline = '基线';
    editor.hasEdits = true;
    // workerSegments 保持默认 null

    expect(() => editor.saveDraft()).not.toThrow();
    const draft = mockedStorage.saveEditDraft.mock.calls[0][0];
    expect(draft.userSegments).toBeUndefined();
  });

  it('空缓存（segments 长度为 0）→ 不写 userSegments', () => {
    const { editor } = seedStore();
    editor.draftKey = 'k4';
    editor.editText = '文本';
    editor.originalBaseline = '基线';
    editor.hasEdits = true;
    editor.setWorkerResult(1, [], '文本'); // 分类结果为空（无编辑）

    editor.saveDraft();
    const draft = mockedStorage.saveEditDraft.mock.calls[0][0];
    expect(draft.userSegments).toBeUndefined();
  });

  it('无编辑（undo 回基线）→ 跳过保存，不产生空草稿', () => {
    const { editor } = seedStore();
    editor.draftKey = 'k5';
    editor.editText = '基线全文';
    editor.originalBaseline = '基线全文';
    editor.hasEdits = false;

    editor.saveDraft();
    expect(mockedStorage.saveEditDraft).not.toHaveBeenCalled();
    expect(mockedApi.autosave).not.toHaveBeenCalled();
  });
});

describe('resumeFromDraft / enterEdit 传递（方案 B）', () => {
  it('resumeFromDraft 携带 userSegments → draftUserSegments 就位', () => {
    const { editor } = seedStore();
    const segs = userSegs();
    editor.resumeFromDraft({
      key: 'r1',
      editText: '已编辑的全文',
      baseline: '基线全文',
      hasEdits: true,
      cursorPos: 5,
      scrollPos: 100,
      lastEditOffset: 3,
      processedCis: [1],
      fileAName: 'a.txt',
      fileBName: 'b.txt',
      timestamp: Date.now(),
      userSegments: segs,
    });
    expect(editor.draftUserSegments).toEqual(segs);
    expect(editor.originalBaseline).toBe('基线全文'); // 快照优先，不重建
  });

  it('resumeFromDraft 无 userSegments（旧草稿）→ draftUserSegments 为 null', () => {
    const { editor } = seedStore();
    editor.resumeFromDraft({
      key: 'r2',
      editText: '已编辑',
      baseline: '基线',
      hasEdits: true,
      cursorPos: 0,
      scrollPos: 0,
      lastEditOffset: -1,
      processedCis: [],
      fileAName: 'a.txt',
      fileBName: 'b.txt',
      timestamp: Date.now(),
    });
    expect(editor.draftUserSegments).toBeNull();
  });

  it('enterEdit 命中草稿 → draftUserSegments 就位（重传文件弹窗路径）', async () => {
    const { editor } = seedStore();
    const segs = userSegs();
    mockedStorage.loadEditDraft.mockResolvedValue({
      key: 'k6',
      editText: '已编辑的全文',
      baseline: '基线文本',
      hasEdits: true,
      cursorPos: 0,
      scrollPos: 0,
      lastEditOffset: -1,
      processedCis: [],
      fileAName: 'a.txt',
      fileBName: 'b.txt',
      timestamp: Date.now(),
      userSegments: segs,
    } as never);

    await editor.enterEdit();
    expect(editor.hasPendingDraft).toBe(true);
    expect(editor.draftUserSegments).toEqual(segs);
  });

  it('enterEdit 无草稿 → draftUserSegments 清空', async () => {
    const { editor } = seedStore();
    editor.draftUserSegments = userSegs(); // 上一个会话残留
    mockedStorage.loadEditDraft.mockResolvedValue(null);

    await editor.enterEdit();
    expect(editor.draftUserSegments).toBeNull();
  });

  it('resetToOriginal 清理 draftUserSegments', () => {
    const { editor } = seedStore();
    editor.draftUserSegments = userSegs();
    editor.resetToOriginal();
    expect(editor.draftUserSegments).toBeNull();
  });

  it('discardDraft 清理 draftUserSegments', () => {
    const { editor } = seedStore();
    editor.hasPendingDraft = true;
    editor.draftUserSegments = userSegs();
    editor.discardDraft();
    expect(editor.draftUserSegments).toBeNull();
  });
});
