/**
 * Compare store — manages diff segments, compare metadata, streaming state.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Segment, CompareMeta, CompareStats, ErrorEnvelope, StreamMessage, ChangeContext } from '@/types';
import { api } from '@/utils/api';
import { storage } from '@/utils/storage';

export const useCompareStore = defineStore('compare', () => {
  const segments = ref<Segment[]>([]);
  const contexts = ref<ChangeContext[]>([]);
  const meta = ref<CompareMeta | null>(null);
  const error = ref<ErrorEnvelope | null>(null);
  const isComparing = ref(false);
  const isComplete = ref(false);
  const currentPhase = ref('');
  const progress = ref(0);

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

    const collectedSegments: { index: number; data: Segment[] }[] = [];
    let receivedMeta: CompareMeta | null = null;
    let streamError: ErrorEnvelope | null = null;

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
            };
            break;
          case 'segments':
            collectedSegments.push({ index: msg.index, data: msg.data as Segment[] });
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
      if (collectedSegments.length === 0) return;
    }

    // Assemble results.
    collectedSegments.sort((a, b) => a.index - b.index);
    segments.value = collectedSegments.flatMap((c) => c.data);

    if (receivedMeta) {
      meta.value = receivedMeta;
    }

    isComplete.value = !streamError;

    // Persist to local storage (fire-and-forget — best-effort).
    if (segments.value.length > 0 && receivedMeta) {
      storage.saveMeta(receivedMeta);
      const chunks = collectedSegments.map((c) => ({
        id: `seg-${c.index}`,
        index: c.index,
        data: c.data,
      }));
      storage.saveSegments(chunks).catch(() => { /* best-effort */ });
    }
  }

  function buildContexts(): void {
    const result: ChangeContext[] = [];
    let ci = 0;
    let lineA = 1;
    let lineB = 1;

    for (let i = 0; i < segments.value.length; i++) {
      const s = segments.value[i];
      if (s.operation === 'none') {
        // Advance both line counters equally through unchanged text
        const newlines = (s.text.match(/\n/g) || []).length;
        lineA += newlines;
        lineB += newlines;
        continue;
      }

      ci++;
      const type = s.operation === 'add' ? 'add' : s.operation === 'del' ? 'del' : 'mod';

      // Record position BEFORE advancing — this is where the change occurs
      const posA = lineA;
      const posB = lineB;

      // Advance line counters according to operation type
      const newlines = (s.text.match(/\n/g) || []).length;
      if (s.operation === 'del' || (s.operation === 'mod' && s.side === 'old')) {
        lineA += newlines;
      } else if (s.operation === 'add' || (s.operation === 'mod' && s.side === 'new')) {
        lineB += newlines;
      }

      // Capture surrounding text for context display
      const before = segments.value.slice(Math.max(0, i - 2), i).map((x) => x.text).join('').slice(-40);
      const after = segments.value.slice(i + 1, i + 3).map((x) => x.text).join('').slice(0, 40);

      result.push({
        index: ci,
        total: stats.value.total,
        type,
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
    stats, fileAName, fileBName,
    reset, startCompare, buildContexts,
  };
});
