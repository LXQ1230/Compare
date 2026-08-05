/**
 * API client for Compare backend services.
 *
 * All requests go through the Vite dev proxy (/api → backend:17890).
 *
 * DESIGN PRINCIPLE: Every fetch() MUST settle (resolve or reject) within a
 * bounded time.  This module uses AbortSignal.timeout() — a browser-native
 * mechanism that lives inside the fetch engine, not on the JS setTimeout
 * timer — so it cannot be stalled by a busy event loop or a hung proxy.
 */

import type { ErrorEnvelope, StreamMessage, CompareStats, StyleRange } from '@/types';

const BASE = '/api';

/** How long we wait for a single health-check ping. */
const HEALTH_TIMEOUT_MS = 5_000;

/** Upper bound for the entire compare flow (upload + stream). */
const COMPARE_TIMEOUT_MS = 120_000;

/** Default timeout for autosave/version endpoints (rev. F3 — they were bare fetch()). */
const API_TIMEOUT_MS = 10_000;

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * fetch() with a HARD deadline supplied via AbortSignal.timeout().
 *
 * AbortSignal.timeout() is implemented inside the browser's network stack,
 * NOT on the JS event loop.  Even if the main thread is jammed the network
 * layer will still abort the request, so this guarantee is stronger than
 * `setTimeout(() => ctrl.abort(), …)`.
 */
function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit & { timeoutMs: number },
): Promise<Response> {
  const { timeoutMs, ...rest } = init;
  // Compose the caller's signal (if any) with our own hard timeout.
  const signal = rest.signal
    ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  return fetch(input, { ...rest, signal });
}

/**
 * Race `promise` against a timer that settles with `fallback` after `ms`.
 *
 * This is the SECOND layer of defense — if for any reason AbortSignal.timeout
 * fails (extremely unlikely in a modern runtime), this plain-JS race will
 * still cut off the caller at `ms`.
 */
function raceWithTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ── public API ─────────────────────────────────────────────────────────────

export const api = {
  /**
   * Check whether the backend is reachable.
   *
   * Returns `false` after HEALTH_TIMEOUT_MS if the backend is down OR
   * the proxy hangs — guaranteed to settle.
   */
  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${BASE}/health`, {
        method: 'GET',
        timeoutMs: HEALTH_TIMEOUT_MS,
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  /**
   * Upload two files and stream the NDJSON diff result.
   *
   * GUARANTEES (enforced by fetchWithTimeout + raceWithTimeout):
   *  1. If the backend is down or the proxy hangs → resolves within COMPARE_TIMEOUT_MS.
   *  2. If the NDJSON stream stalls mid-flight → resolves within COMPARE_TIMEOUT_MS.
   *  3. Callers can optionally pass an AbortSignal for earlier cancellation.
   */
  async compareFiles(
    fileA: File,
    fileB: File,
    onChunk: (msg: StreamMessage) => void,
    onError: (err: ErrorEnvelope | Error) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const form = new FormData();
    form.append('fileA', fileA);
    form.append('fileB', fileB);

    const worker = (async (): Promise<void> => {
      let response: Response;
      try {
        response = await fetchWithTimeout(`${BASE}/compare`, {
          method: 'POST',
          body: form,
          signal,
          timeoutMs: COMPARE_TIMEOUT_MS,
        });
      } catch (e: unknown) {
        // fetch() failure — network down, timeout, abort, proxy hang, etc.
        if (e instanceof DOMException && e.name === 'AbortError') {
          return; // silent — caller already knows via their signal
        }
        onError(new Error(e instanceof Error ? e.message : 'Network request failed'));
        return;
      }

      if (!response.ok) {
        try {
          onError((await response.json()) as ErrorEnvelope);
        } catch {
          onError(new Error(`Server returned ${response.status}`));
        }
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (value) {
            buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split('\n');
            buffer = done ? '' : (lines.pop() ?? '');
            for (const line of lines) {
              const t = line.trim();
              if (t) {
                try {
                  onChunk(JSON.parse(t) as StreamMessage);
                } catch {
                  /* malformed NDJSON line — skip */
                }
              }
            }
          }
          if (done) break;
        }
        // Process final chunk
        const tail = buffer.trim();
        if (tail) {
          try {
            onChunk(JSON.parse(tail) as StreamMessage);
          } catch {
            /* skip */
          }
        }
      } catch (e: unknown) {
        // reader.read() can throw on abort or stream error
        if (e instanceof DOMException && e.name === 'AbortError') {
          return;
        }
        onError(e instanceof Error ? e : new Error(String(e)));
      }
    })();

    // Second defense: if the inner worker never settles (shouldn't
    // happen because AbortSignal.timeout is in play, but this guards
    // against unforeseen runtime bugs), cut off after the timeout.
    await raceWithTimeout(worker, COMPARE_TIMEOUT_MS + 5_000, undefined);
  },

  // ── autosave / versions (rev. F3: all through fetchWithTimeout) ──────────

  async autosave(payload: {
    action: 'save' | 'load' | 'delete';
    key: string;
    text?: string;
    html?: string;
    time?: number;
    cursor_pos?: number;
    scroll_pos?: number;
    last_edit_offset?: number;
    processed_cis?: number[];
    file_a_name?: string;
    file_b_name?: string;
    stats?: CompareStats;
    total_chunks?: number;
    baseline_style?: StyleRange[];
  }): Promise<Record<string, unknown>> {
    const res = await fetchWithTimeout(`${BASE}/autosave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: API_TIMEOUT_MS,
    });
    if (!res.ok) throw new Error(`Autosave failed: ${res.status}`);
    return res.json() as Promise<Record<string, unknown>>;
  },

  async   versionSave(payload: {
    label: string;
    file_a_content: string;
    file_b_content: string;
    stats: Record<string, number>;
    style_a?: StyleRange[];
    style_b?: StyleRange[];
    doc_meta?: Record<string, unknown>;
  }): Promise<{ status: string; id: string }> {
    const res = await fetchWithTimeout(`${BASE}/versions/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: API_TIMEOUT_MS,
    });
    if (!res.ok) throw new Error(`Version save failed: ${res.status}`);
    return res.json() as Promise<{ status: string; id: string }>;
  },

  async versionList(): Promise<{ status: string; versions: Record<string, unknown>[] }> {
    const res = await fetchWithTimeout(`${BASE}/versions/list`, {
      method: 'GET',
      timeoutMs: API_TIMEOUT_MS,
    });
    if (!res.ok) throw new Error(`Version list failed: ${res.status}`);
    return res.json() as Promise<{ status: string; versions: Record<string, unknown>[] }>;
  },

  async versionRestore(id: string): Promise<{ status: string; version: Record<string, unknown> }> {
    const res = await fetchWithTimeout(`${BASE}/versions/restore/${id}`, {
      method: 'POST',
      timeoutMs: API_TIMEOUT_MS,
    });
    if (!res.ok) throw new Error(`Version restore failed: ${res.status}`);
    return res.json() as Promise<{ status: string; version: Record<string, unknown> }>;
  },
};
