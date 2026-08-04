/**
 * LocalStorage + IndexedDB hybrid wrapper for persisting compare state.
 */

import type { Segment, CompareMeta, VersionEntry, EditSessionDraft } from '@/types';
import { indexedDB } from './indexeddb';

const META_KEY = 'cmp_meta';
const AUTOSAVE_KEY = 'cmp_autosave';
const VERSION_KEY = 'cmp_versions';
const EDIT_DRAFT_PREFIX = 'cmp_edit_';

export const storage = {
  // ── metadata ────────────────────────────────────────────────────

  saveMeta(meta: CompareMeta): void {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  },

  loadMeta(): CompareMeta | null {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as CompareMeta) : null;
  },

  // ── autosave drafts ─────────────────────────────────────────────

  saveAutosaveDraft(text: string, html: string): void {
    localStorage.setItem(
      AUTOSAVE_KEY,
      JSON.stringify({ text, html, time: Date.now() }),
    );
  },

  loadAutosaveDraft(): { text: string; html: string; time: number } | null {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? (JSON.parse(raw) as { text: string; html: string; time: number }) : null;
  },

  clearAutosaveDraft(): void {
    localStorage.removeItem(AUTOSAVE_KEY);
  },

  // ── segments (IndexedDB) ────────────────────────────────────────

  async saveSegments(
    chunks: { id: string; index: number; data: Segment[] }[],
  ): Promise<void> {
    await indexedDB.putAll('segments', chunks as { id: string; index: number; data: unknown[] }[]);
  },

  async loadSegments(): Promise<Segment[][]> {
    const rows = await indexedDB.getAll('segments');
    return rows
      .sort((a, b) => a.index - b.index)
      .map((r) => r.data as Segment[]);
  },

  async clearSegments(): Promise<void> {
    await indexedDB.clear('segments');
  },

  // ── versions ────────────────────────────────────────────────────

  saveVersions(versions: VersionEntry[]): void {
    localStorage.setItem(VERSION_KEY, JSON.stringify(versions));
  },

  loadVersions(): VersionEntry[] {
    const raw = localStorage.getItem(VERSION_KEY);
    return raw ? (JSON.parse(raw) as VersionEntry[]) : [];
  },

  async clearAll(): Promise<void> {
    localStorage.removeItem(META_KEY);
    localStorage.removeItem(AUTOSAVE_KEY);
    localStorage.removeItem(VERSION_KEY);
    await indexedDB.clearAll();
  },

  // ── edit session drafts (方案 L5/P4: IndexedDB 主体 + localStorage 摘要) ──

  /**
   * 保存编辑草稿：完整数据（去 segments/baseline 冗余——segments 在
   * IndexedDB segments store、baseline 可由 buildDocText(segments) 重建）
   * 写入 IndexedDB drafts store；localStorage 只存索引摘要供首页列表。
   * 返回 Promise（IndexedDB 异步），调用方 fire-and-forget。
   */
  async saveEditDraft(draft: EditSessionDraft): Promise<void> {
    // 去冗余存储（方案 L5 §4.5）：segments 与 baseline 均可重建
    const { segments: _seg, baseline: _base, ...full } = draft;
    // pinia ref 数组是 Proxy，structured clone 会抛 DataCloneError
    // （"[object Array] could not be cloned"）→ 转普通数组再存
    const plain = {
      ...full,
      processedCis: Array.isArray(full.processedCis) ? [...full.processedCis] : full.processedCis,
    };
    await indexedDB.put('drafts', { key: draft.key, value: plain });
    const summary = {
      key: draft.key,
      fileAName: draft.fileAName,
      fileBName: draft.fileBName,
      timestamp: draft.timestamp,
      processedCount: draft.processedCis.length,
      hasEdits: draft.hasEdits,
    };
    try {
      localStorage.setItem(EDIT_DRAFT_PREFIX + draft.key, JSON.stringify(summary));
    } catch {
      // 摘要都超配额（极端）— 静默，IndexedDB 主体仍在
    }
  },

  /** 加载完整草稿（IndexedDB）。baseline/segments 字段由调用方重建。 */
  async loadEditDraft(key: string): Promise<EditSessionDraft | null> {
    const row = await indexedDB.get('drafts', key);
    if (!row) return null;
    return {
      ...(row.value as Omit<EditSessionDraft, 'baseline' | 'segments'>),
      baseline: '',
      segments: undefined,
    } as EditSessionDraft;
  },

  /** 删除草稿：IndexedDB 主体 + localStorage 摘要。 */
  async clearEditDraft(key: string): Promise<void> {
    await indexedDB.delete('drafts', key);
    localStorage.removeItem(EDIT_DRAFT_PREFIX + key);
  },

  /** 首页草稿列表：从 localStorage 索引摘要读取（无 editText 正文）。 */
  listEditDrafts(): EditSessionDraft[] {
    const drafts: EditSessionDraft[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(EDIT_DRAFT_PREFIX)) {
        try {
          const summary = JSON.parse(localStorage.getItem(k)!) as {
            key: string; fileAName: string; fileBName: string;
            timestamp: number; processedCount: number; hasEdits: boolean;
          };
          drafts.push({
            key: summary.key,
            fileAName: summary.fileAName,
            fileBName: summary.fileBName,
            timestamp: summary.timestamp,
            processedCis: new Array(summary.processedCount).fill(0).map((_, i) => i + 1),
            hasEdits: summary.hasEdits,
            editText: '',
            baseline: '',
            cursorPos: 0, scrollPos: 0, lastEditOffset: -1,
          } as EditSessionDraft);
        } catch {
          // skip corrupt entries
        }
      }
    }
    return drafts.sort((a, b) => b.timestamp - a.timestamp);
  },
};
