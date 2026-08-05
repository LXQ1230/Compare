/**
 * 方案 P2-7: 草稿摘要与 IndexedDB 一致性测试。
 *
 * - saveEditDraft 摘要携带真实 processedCis（紧凑编码）
 * - listEditDrafts 从 processedCisStr 还原真实集合（非 [1..count] 近似）
 * - clearEditDraft 先清 localStorage 摘要、再删 IDB 主体（顺序反转）
 * - 旧格式摘要（无 processedCisStr）回退近似
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  idbPut: vi.fn(() => Promise.resolve()),
  idbGet: vi.fn(() => Promise.resolve(undefined)),
  idbDelete: vi.fn(() => Promise.resolve()),
  idbPutAll: vi.fn(() => Promise.resolve()),
  idbGetAll: vi.fn(() => Promise.resolve([])),
  idbClear: vi.fn(() => Promise.resolve()),
  idbClearAll: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/utils/indexeddb', () => ({
  indexedDB: {
    put: mocks.idbPut,
    get: mocks.idbGet,
    delete: mocks.idbDelete,
    putAll: mocks.idbPutAll,
    getAll: mocks.idbGetAll,
    clear: mocks.idbClear,
    clearAll: mocks.idbClearAll,
  },
}));

import { storage } from '../storage';

const PREFIX = 'cmp_edit_';

function clearLocalStorage(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
}

beforeEach(() => {
  clearLocalStorage();
  vi.clearAllMocks();
  mocks.idbDelete.mockImplementation(() => Promise.resolve());
  mocks.idbPut.mockImplementation(() => Promise.resolve());
});

afterEach(() => clearLocalStorage());

describe('saveEditDraft 摘要 (方案 P2-7: 真实 processedCis)', () => {
  it('摘要写入 processedCisStr 紧凑编码', async () => {
    await storage.saveEditDraft({
      key: 'k1',
      editText: 'edited',
      baseline: '',
      hasEdits: true,
      cursorPos: 0,
      scrollPos: 0,
      lastEditOffset: -1,
      processedCis: [1, 3, 7, 9],
      fileAName: 'a.txt',
      fileBName: 'b.txt',
      timestamp: 1000,
      segments: [],
    });
    expect(mocks.idbPut).toHaveBeenCalledTimes(1);
    const summary = JSON.parse(localStorage.getItem(PREFIX + 'k1')!);
    expect(summary.processedCisStr).toBe('1,3,7,9');
    expect(summary.processedCount).toBe(4);
  });

  it('IDB 写入失败时摘要也不写（主体缺失则索引不应存在）', async () => {
    mocks.idbPut.mockImplementation(() => Promise.reject(new Error('quota')));
    await expect(storage.saveEditDraft({
      key: 'k2',
      editText: 'edited',
      baseline: '',
      hasEdits: true,
      cursorPos: 0,
      scrollPos: 0,
      lastEditOffset: -1,
      processedCis: [1, 2],
      fileAName: 'a.txt',
      fileBName: 'b.txt',
      timestamp: 2000,
      segments: [],
    })).rejects.toThrow('quota');
    // IDB 失败 → 异常抛出，摘要未写（调用方 fire-and-forget，首页不会展示孤儿）
    expect(localStorage.getItem(PREFIX + 'k2')).toBeNull();
  });
});

describe('listEditDrafts 还原 (方案 P2-7: 真实 processedCis)', () => {
  it('从 processedCisStr 还原真实集合', () => {
    localStorage.setItem(PREFIX + 'k3', JSON.stringify({
      key: 'k3', fileAName: 'a.txt', fileBName: 'b.txt',
      timestamp: 3000, processedCount: 4, processedCisStr: '1,3,7,9', hasEdits: true,
    }));
    const drafts = storage.listEditDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].processedCis).toEqual([1, 3, 7, 9]);
  });

  it('旧格式摘要（无 processedCisStr）回退 [1..count] 近似', () => {
    localStorage.setItem(PREFIX + 'k4', JSON.stringify({
      key: 'k4', fileAName: 'a.txt', fileBName: 'b.txt',
      timestamp: 4000, processedCount: 3, hasEdits: true,
    }));
    const drafts = storage.listEditDrafts();
    expect(drafts[0].processedCis).toEqual([1, 2, 3]);
  });

  it('损坏摘要跳过', () => {
    localStorage.setItem(PREFIX + 'k5', '{corrupt json');
    expect(storage.listEditDrafts()).toHaveLength(0);
  });
});

describe('clearEditDraft 顺序 (方案 P2-7: 先清索引再删主体)', () => {
  it('IDB 删除失败时 localStorage 摘要已先行清除', async () => {
    localStorage.setItem(PREFIX + 'k6', JSON.stringify({ key: 'k6', hasEdits: true }));
    mocks.idbDelete.mockImplementation(() => Promise.reject(new Error('idb down')));
    await storage.clearEditDraft('k6');
    // 摘要已删（首页不再展示）；IDB 残留由同 key 下次保存覆盖兜底
    expect(localStorage.getItem(PREFIX + 'k6')).toBeNull();
    expect(mocks.idbDelete).toHaveBeenCalledWith('drafts', 'k6');
  });

  it('正常路径两者都清', async () => {
    localStorage.setItem(PREFIX + 'k7', JSON.stringify({ key: 'k7', hasEdits: true }));
    await storage.clearEditDraft('k7');
    expect(localStorage.getItem(PREFIX + 'k7')).toBeNull();
    expect(mocks.idbDelete).toHaveBeenCalledWith('drafts', 'k7');
  });
});
