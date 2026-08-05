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
   * 保存编辑草稿：完整数据（segments 在 IndexedDB segments store 仍去冗余，
   * 但 baseline 快照与 userSegments 保留——方案 B 恢复免重算需配套校验）
   * 写入 IndexedDB drafts store；localStorage 只存索引摘要供首页列表。
   * 返回 Promise（IndexedDB 异步），调用方 fire-and-forget。
   */
  async saveEditDraft(draft: EditSessionDraft): Promise<void> {
    // 去冗余存储（方案 L5 §4.5）：segments 仍在 segments store；baseline 快照
    // 与 userSegments 保留（方案 B：恢复时逐字节复用 baseline，userSegments 直接
    // buildDecoSet，免 DMP diff——二者配套，缺一不可）
    const { segments: _seg, ...full } = draft;
    // pinia ref 数组是 Proxy，structured clone 会抛 DataCloneError
    // （"[object Object] could not be cloned"）→ 转普通数组再存。
    // 注意：processedCis（number）浅拷贝即可；userSegments 元素是 Segment 对象，
    // 经 pinia deep reactive 后为 Proxy，浅拷贝数组不够——必须逐段 {...s} 解构
    // 成纯对象，否则 IDB put 抛 DataCloneError（方案 B 实测踩坑）。
    const plain = {
      ...full,
      processedCis: Array.isArray(full.processedCis) ? [...full.processedCis] : full.processedCis,
      userSegments: Array.isArray(full.userSegments)
        ? full.userSegments.map((s) => ({ ...s }))
        : full.userSegments,
      // IDML 样式区间（§6.6 链路 2）：同样逐项解构剥离 pinia Proxy
      baselineStyle: Array.isArray(full.baselineStyle)
        ? full.baselineStyle.map((sp) => ({ ...sp }))
        : full.baselineStyle,
    };
    await indexedDB.put('drafts', { key: draft.key, value: plain });
    // 方案 P2-7: 摘要存真实 processedCis（紧凑编码），消除 listEditDrafts
    // 的 [1..count] 近似——用户实际处理的 ci 与进度显示一致。
    const summary = {
      key: draft.key,
      fileAName: draft.fileAName,
      fileBName: draft.fileBName,
      timestamp: draft.timestamp,
      processedCount: draft.processedCis.length,
      processedCisStr: Array.isArray(draft.processedCis) ? draft.processedCis.join(',') : '',
      hasEdits: draft.hasEdits,
    };
    try {
      localStorage.setItem(EDIT_DRAFT_PREFIX + draft.key, JSON.stringify(summary));
    } catch {
      // 摘要都超配额（极端）— 静默，IndexedDB 主体仍在
    }
  },

  /** 加载完整草稿（IndexedDB）。segments 字段由调用方重建（segments store）。 */
  async loadEditDraft(key: string): Promise<EditSessionDraft | null> {
    const row = await indexedDB.get('drafts', key);
    if (!row) return null;
    return {
      ...(row.value as Omit<EditSessionDraft, 'segments'>),
      // 方案 B：baseline 快照从存储原样返回（旧草稿无该字段 → undefined，
      // 调用方重建；userSegments 同源同失，天然配套）
      segments: undefined,
    } as EditSessionDraft;
  },

  /**
   * 删除草稿：先清 localStorage 摘要（索引），再删 IndexedDB 主体（方案 P2-7）。
   * 摘要缺失 → 首页不再展示；IDB 残留由同 key 下次保存覆盖兜底（主体不构成 UI 污染）。
   */
  async clearEditDraft(key: string): Promise<void> {
    localStorage.removeItem(EDIT_DRAFT_PREFIX + key);
    await indexedDB.delete('drafts', key).catch(() => { /* 主体残留可覆盖 */ });
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
            processedCisStr?: string;
          };
          // 方案 P2-7: 优先用真实 processedCis（紧凑编码），旧摘要（无 str 字段）回退近似
          const processedCis = summary.processedCisStr
            ? summary.processedCisStr.split(',').filter(Boolean).map(Number)
            : new Array(summary.processedCount).fill(0).map((_, i) => i + 1);
          drafts.push({
            key: summary.key,
            fileAName: summary.fileAName,
            fileBName: summary.fileBName,
            timestamp: summary.timestamp,
            processedCis,
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
