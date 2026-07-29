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

  async function startCompare(fileA: File, fileB: File, signal?: AbortSignal): Promise<void> {
    reset();
    isComparing.value = true;

    // Pre-check: verify the backend is reachable before posting large payloads
    const healthy = await api.checkHealth();
    if (!healthy) {
      error.value = {
        error: true,
        severity: 'blocking',
        title: '后端未启动',
        message: '无法连接到后端服务。请先运行 "python -m uvicorn src_backend.main:app --host 127.0.0.1 --port 17890" 或执行 start.bat。',
        detail: null,
      };
      isComparing.value = false;
      return;
    }

    const collectedSegments: { index: number; data: Segment[] }[] = [];
    let receivedMeta: CompareMeta | null = null;
    let streamError: boolean = false;

    try {
      await api.compareFiles(
        fileA,
        fileB,
        (msg: StreamMessage) => {
          switch (msg.type) {
            case 'phase':
              currentPhase.value = msg.stage;
              progress.value = msg.progress;
              break;
            case 'meta': {
              receivedMeta = {
                fileA: fileA.name,
                fileB: fileB.name,
                stats: msg.stats,
                timestamp: Date.now(),
                totalChunks: msg.totalChunks,
              };
              break;
            }
            case 'segments':
              collectedSegments.push({ index: msg.index, data: msg.data as Segment[] });
              break;
            case 'done':
              break;
          }
        },
        (err: ErrorEnvelope | Error) => {
          streamError = true;
          if (err instanceof Error) {
            error.value = {
              error: true,
              severity: 'blocking',
              title: '连接错误',
              message: err.message,
              detail: null,
            };
          } else {
            error.value = err;
          }
        },
        signal,
      );
    } catch (e: unknown) {
      error.value = {
        error: true,
        severity: 'blocking',
        title: '网络错误',
        message: e instanceof Error ? e.message : '请求超时或无法连接到服务。',
        detail: null,
      };
      isComparing.value = false;
      return;
    }

    // If the callback reported an error, bail out — don't navigate to report page
    if (streamError && !segments.value.length) {
      isComparing.value = false;
      return;
    }

    collectedSegments.sort((a, b) => a.index - b.index);
    segments.value = collectedSegments.flatMap((c) => c.data);

    if (receivedMeta) {
      meta.value = receivedMeta;
    }

    isComplete.value = true;
    isComparing.value = false;

    if (segments.value.length > 0 && receivedMeta) {
      storage.saveMeta(receivedMeta);
      const chunks = collectedSegments.map((c) => ({
        id: `seg-${c.index}`,
        index: c.index,
        data: c.data,
      }));
      await storage.saveSegments(chunks);
    }
  }

  function buildContexts(): void {
    const result: ChangeContext[] = [];
    let ci = 0;

    for (let i = 0; i < segments.value.length; i++) {
      const s = segments.value[i];
      if (s.operation === 'none') continue;

      ci++;
      const type = s.operation === 'add' ? 'add' : s.operation === 'del' ? 'del' : 'mod';
      const before = segments.value.slice(Math.max(0, i - 1), i).map((x) => x.text).join('');
      const after = segments.value.slice(i + 1, i + 2).map((x) => x.text).join('');

      result.push({ index: ci, total: stats.value.total, type, before, highlight: s.text, after });
    }

    contexts.value = result;
  }

  return { segments, contexts, meta, error, isComparing, isComplete, currentPhase, progress, stats, fileAName, fileBName, reset, startCompare, buildContexts };
});
