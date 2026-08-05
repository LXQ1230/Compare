/**
 * Compare store — manages diff segments, compare metadata, streaming state.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Segment, CompareMeta, CompareStats, ErrorEnvelope, StreamMessage, ChangeContext, ScaleLevel } from '@/types';
import { asSegmentId } from '@/types';
import { api } from '@/utils/api';
import { storage } from '@/utils/storage';
import { fnv1aHash } from '@/utils/hash';
import { diffSafely } from '@/render/unicode';
// 循环 import 安全：editor.ts 顶层 import compare.ts，两 store 均仅在
// setup 函数体内互调 useXxxStore()，模块初始化阶段无解引用。
import { useEditorStore } from './editor';

export const useCompareStore = defineStore('compare', () => {
  const segments = ref<Segment[]>([]);
  const contexts = ref<ChangeContext[]>([]);
  const meta = ref<CompareMeta | null>(null);
  const error = ref<ErrorEnvelope | null>(null);
  const isComparing = ref(false);
  const isComplete = ref(false);
  const currentPhase = ref('');
  const progress = ref(0);
  // Rev. 5-3: stable identity for the current compare session, carried in the
  // URL (/report/:sessionId). Derived from file names + timestamp so a hard
  // reload can re-derive it from persisted meta and validate the URL.
  const sessionId = ref('');

  const stats = computed<CompareStats>(() => meta.value?.stats ?? { total: 0, add: 0, del: 0, mod: 0 });
  const fileAName = computed(() => meta.value?.fileA ?? '');
  const fileBName = computed(() => meta.value?.fileB ?? '');

  /**
   * 方案 P2-3：大文档（scale M/L）共用 getter——Sidebar / ReportPage / Toolbar
   * 统一引用，消除三处重复 computed 的逻辑漂移。
   */
  const isLargeDoc = computed(() => {
    const s = meta.value?.scale;
    return s === 'M' || s === 'L';
  });

  function reset(): void {
    segments.value = [];
    contexts.value = [];
    meta.value = null;
    error.value = null;
    isComparing.value = false;
    isComplete.value = false;
    currentPhase.value = '';
    progress.value = 0;
    sessionId.value = '';
  }

  /**
   * Stable session id for a (fileA, fileB, timestamp) triple — must match
   * everywhere a session is created or resumed (startCompare / restoreFromDraft)
   * so the /report/:sessionId URL stays valid across reloads.
   */
  function computeSessionId(fileA: string, fileB: string, timestamp: number): string {
    return fnv1aHash(`${fileA}\u0000${fileB}\u0000${timestamp}`);
  }

  /**
   * Start a comparison between two files.
   *
   * The api.compareFiles() call is guaranteed to resolve within ~2 minutes
   * (backed by AbortSignal.timeout inside the browser network stack).  No
   * additional Promise bookkeeping is needed — we just await it.
   */
  async function startCompare(fileA: File, fileB: File, signal?: AbortSignal): Promise<void> {
    reset();
    isComparing.value = true;

    // Quick pre-flight: is the backend reachable?
    const healthy = await api.checkHealth();
    if (!healthy) {
      error.value = {
        error: true,
        severity: 'blocking',
        title: '后端未启动',
        // Rev. 5-17: point users at the one-click launcher instead of raw CLI.
        message: '无法连接到后端服务。请运行 start.bat 启动后端后重试。',
        detail: null,
      };
      isComparing.value = false;
      return;
    }

    const collectedChunks: { id: string; index: number; data: Segment[] }[] = [];
    let receivedMeta: CompareMeta | null = null;
    let streamError: ErrorEnvelope | null = null;
    // 方案 P5（边收边渲染）：首个 segments chunk 到达即构建一次上下文，
    // 使部分结果立即可用（流式中途出错时 ReportPage 也能渲染已收部分）；
    // done 后末尾的全量 buildContexts 会覆盖为完整列表。
    let previewBuilt = false;

    // This single await covers the ENTIRE lifecycle — upload, streaming,
    // and any error/timeout.  It always returns; it never hangs.
    await api.compareFiles(
      fileA,
      fileB,
      /* onChunk */
      (msg: StreamMessage) => {
        switch (msg.type) {
          case 'phase':
            currentPhase.value = msg.stage;
            progress.value = msg.progress;
            break;
          case 'meta':
            receivedMeta = {
              fileA: fileA.name,
              fileB: fileB.name,
              stats: msg.stats,
              timestamp: Date.now(),
              totalChunks: msg.totalChunks,
              scale: msg.scale,
            };
            // 方案 P5：meta 到达即生效（stats/scale 立即可用，不等全流程结束）
            meta.value = receivedMeta;
            // Rev. 5-3: session id available as soon as meta lands
            sessionId.value = computeSessionId(receivedMeta.fileA, receivedMeta.fileB, receivedMeta.timestamp);
            break;
          case 'segments':
            // 边收边 push（方案 P1）：不再累积 collectedSegments 后 flatMap，
            // 消除百万段内存峰值 ×2，首个 chunk 数据立即可用
            segments.value.push(...(msg.data as Segment[]));
            collectedChunks.push({ id: `seg-${msg.index}`, index: msg.index, data: msg.data as Segment[] });
            // 方案 P5：首个 chunk 到达即构建部分上下文（低风险提前渲染）
            if (!previewBuilt && meta.value) {
              previewBuilt = true;
              buildContexts();
            }
            break;
          /* 'done' is just consumed; no special handling needed */
        }
      },
      /* onError */
      (err: ErrorEnvelope | Error) => {
        if (err instanceof Error) {
          streamError = {
            error: true,
            severity: 'blocking',
            title: '传输错误',
            message: err.message,
            detail: null,
          };
        } else {
          streamError = err;
        }
      },
      signal,
    );

    isComparing.value = false;

    // If we have an error AND no data, report it and stay on the select page.
    if (streamError) {
      error.value = streamError;
      if (segments.value.length === 0) return;
    }

    if (receivedMeta) {
      meta.value = receivedMeta;
    }

    isComplete.value = !streamError;

    // Persist to local storage (fire-and-forget — best-effort).
    if (segments.value.length > 0 && receivedMeta) {
      storage.saveMeta(receivedMeta);
      // Rev. 5-8: clear the previous session's rows first so stale segments
      // can never leak into a resumed session after reload.
      // Rev. 三期: clearSegments 不阻塞对比主流程——链式保证 clear→save 顺序，
      // 但 await 会卡死 startCompare（IndexedDB 事务 promise 已修复，仍保持
      // 非阻塞设计，IndexedDB 失败不影响对比结果展示）。
      void storage
        .clearSegments()
        .then(() => storage.saveSegments(collectedChunks))
        .catch(() => { /* best-effort */ });
    }

    // Build sidebar change-context list after segments are assembled
    buildContexts();
  }

  /**
   * Restore a compare session from an edit-session draft (rev. edit-persistence/2).
   * Fills segments + meta directly so the Report page renders without a
   * re-run of the comparison.
   */
  function restoreFromDraft(
    segmentsData: Segment[],
    draft: { fileAName: string; fileBName: string; timestamp: number; stats?: CompareStats; totalChunks?: number },
  ): void {
    segments.value = segmentsData;
    meta.value = {
      fileA: draft.fileAName,
      fileB: draft.fileBName,
      stats: draft.stats ?? { total: 0, add: 0, del: 0, mod: 0 },
      timestamp: draft.timestamp,
      totalChunks: draft.totalChunks ?? 0,
    };
    isComparing.value = false;
    isComplete.value = true;
    error.value = null;
    // Rev. 5-3: derive the session id from the same triple so the resumed
    // URL (/report/:sessionId) matches what SelectPage pushes.
    sessionId.value = computeSessionId(draft.fileAName, draft.fileBName, draft.timestamp);
    // 方案 P2-1: 与 startCompare 保持一致——硬刷新后才能用 meta 重算 sessionId，
    // 否则恢复的草稿会话刷新后被踢回首页。
    storage.saveMeta(meta.value);
    buildContexts();
  }

  // ── 版本恢复（方案 P1-1c）──────────────────────────────────────

  /** 按真实字符数分级（mirror 后端 main.py _classify_scale）。 */
  function classifyScale(chars: number): ScaleLevel {
    if (chars <= 100_000) return 'S';
    if (chars <= 500_000) return 'M';
    if (chars <= 5_000_000) return 'L';
    return 'XL';
  }

  /**
   * 由两侧全文重建原始对比 segments（与后端 diff_engine.diff_texts 规则一致）。
   * 恢复版本时在本地重建，免重跑对比。
   */
  function buildSegmentsFromTexts(a: string, b: string): Segment[] {
    const raw = diffSafely(a, b);
    const segments: Segment[] = [];
    let ci = 0;
    let i = 0;
    while (i < raw.length) {
      const [op, text] = raw[i];
      if (op === 0) {
        segments.push({ text, operation: 'none', origin: 'original' });
        i++;
        continue;
      }
      if (op === 1) {
        if (i + 1 < raw.length && raw[i + 1][0] === -1) {
          ci++;
          segments.push({ text: raw[i + 1][1], operation: 'mod', origin: 'original', side: 'old', ci });
          segments.push({ text, operation: 'mod', origin: 'original', side: 'new', ci });
          i += 2;
          continue;
        }
        ci++;
        segments.push({ text, operation: 'add', origin: 'original', ci });
        i++;
        continue;
      }
      if (i + 1 < raw.length && raw[i + 1][0] === 1) {
        ci++;
        segments.push({ text, operation: 'mod', origin: 'original', side: 'old', ci });
        segments.push({ text: raw[i + 1][1], operation: 'mod', origin: 'original', side: 'new', ci });
        i += 2;
        continue;
      }
      ci++;
      segments.push({ text, operation: 'del', origin: 'original', ci });
      i++;
    }
    return segments;
  }

  /**
   * 把该版本的 A/B 全文变成新的对比会话（方案 P1-1c）。
   * 若在编辑模式先退出（自动保存草稿），重建 segments/meta 并持久化，
   * 硬刷新后可恢复。
   */
  async function restoreVersionSession(aText: string, bText: string, label: string): Promise<void> {
    const editorStore = useEditorStore();
    if (editorStore.isEditing) editorStore.exitEdit();
    reset();
    const segs = buildSegmentsFromTexts(aText, bText);
    const stats: CompareStats = { total: 0, add: 0, del: 0, mod: 0 };
    for (const s of segs) {
      if (s.operation === 'none') continue;
      // mod 对由 old 侧计一次（与后端 diff_texts stats 语义一致，mod-new 不重复计）
      if (s.operation === 'mod' && s.side === 'new') continue;
      stats.total++;
      stats[s.operation]++;
    }
    segments.value = segs;
    meta.value = {
      fileA: `${label} · A`,
      fileB: `${label} · B`,
      stats,
      timestamp: Date.now(),
      totalChunks: 1,
      scale: classifyScale(Math.max(aText.length, bText.length)),
    };
    isComplete.value = true;
    error.value = null;
    sessionId.value = computeSessionId(meta.value.fileA, meta.value.fileB, meta.value.timestamp);
    // 关键：与 P2-1 一致，硬刷新可恢复
    storage.saveMeta(meta.value);
    void storage.clearSegments().then(() => storage.saveSegments(
      segs.length ? [{ id: 'seg-0', index: 0, data: segs }] : [],
    )).catch(() => {});
    buildContexts();
  }

  function buildContexts(): void {
    const result: ChangeContext[] = [];
    let ci = 0;
    let lineA = 1;
    let lineB = 1;

    for (let i = 0; i < segments.value.length; i++) {
      const s = segments.value[i];
      if (s.operation === 'none') {
        const newlines = (s.text.match(/\n/g) || []).length;
        lineA += newlines;
        lineB += newlines;
        continue;
      }

      ci++;
      const type = s.operation === 'add' ? 'add' : s.operation === 'del' ? 'del' : 'mod';

      const posA = lineA;
      const posB = lineB;

      const newlines = (s.text.match(/\n/g) || []).length;
      if (s.operation === 'add') {
        lineB += newlines;
      } else if (s.operation === 'del') {
        lineA += newlines;
      } else {
        // mod — has old+new pair; advance both sides by the newlines in the "old" side for file A,
        // and by the newlines in the "new" side for file B.
        if (s.side === 'old') lineA += newlines;
        if (s.side === 'new') lineB += newlines;
      }

      // Capture surrounding text for context display
      const before = segments.value.slice(Math.max(0, i - 2), i).map((x) => x.text).join('').slice(-40);
      const after = segments.value.slice(i + 1, i + 3).map((x) => x.text).join('').slice(0, 40);

      result.push({
        index: asSegmentId(ci),
        total: stats.value.total,
        type,
        side: s.side,
        lineA: posA,
        lineB: posB,
        before,
        highlight: s.text,
        after,
      });
    }

    contexts.value = result;
  }

  return {
    segments, contexts, meta, error,
    isComparing, isComplete, currentPhase, progress,
    stats, fileAName, fileBName, sessionId, isLargeDoc,
    reset, startCompare, buildContexts, restoreFromDraft,
    restoreVersionSession, buildSegmentsFromTexts,
  };
});
