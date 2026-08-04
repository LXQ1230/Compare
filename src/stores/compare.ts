/**
 * Compare store — manages diff segments, compare metadata, streaming state.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Segment, CompareMeta, CompareStats, ErrorEnvelope, StreamMessage, ChangeContext } from '@/types';
import { asSegmentId } from '@/types';
import { api } from '@/utils/api';
import { storage } from '@/utils/storage';
import { fnv1aHash } from '@/utils/hash';

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
        message: '无法连接到后端服务。请先启动后端： python -m uvicorn src_backend.main:app --host 127.0.0.1 --port 17890',
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
      await storage.clearSegments().catch(() => {});
      storage.saveSegments(collectedChunks).catch(() => { /* best-effort */ });
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
    stats, fileAName, fileBName, sessionId,
    reset, startCompare, buildContexts, restoreFromDraft,
  };
});
