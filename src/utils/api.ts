/**
 * API client for Compare backend services.
 *
 * All requests go through the Vite dev proxy (/api → backend:17890).
 */

import type { ErrorEnvelope, StreamMessage } from '@/types';

const BASE = '/api';

export const api = {
  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/health`);
      return res.ok;
    } catch {
      return false;
    }
  },

  compareFiles(
    fileA: File,
    fileB: File,
    onChunk: (msg: StreamMessage) => void,
    onError: (err: ErrorEnvelope | Error) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const form = new FormData();
      form.append('fileA', fileA);
      form.append('fileB', fileB);

      fetch(`${BASE}/compare`, { method: 'POST', body: form, signal })
        .then(async (response) => {
          if (!response.ok) {
            try {
              onError((await response.json()) as ErrorEnvelope);
              resolve();
              return;
            } catch {
              onError(new Error(`HTTP ${response.status}`));
              resolve();
              return;
            }
          }

          const reader = response.body?.getReader();
          if (!reader) { resolve(); return; }

          const decoder = new TextDecoder();
          let buffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                const t = line.trim();
                if (t) {
                  try { onChunk(JSON.parse(t) as StreamMessage); } catch { /* skip */ }
                }
              }
            }
            const tail = buffer.trim();
            if (tail) {
              try { onChunk(JSON.parse(tail) as StreamMessage); } catch { /* skip */ }
            }
          } catch (e: unknown) {
            if (e instanceof DOMException && e.name === 'AbortError') { resolve(); return; }
            onError(e instanceof Error ? e : new Error(String(e)));
          }
          resolve();
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') { resolve(); return; }
          reject(e);
        });
    });
  },

  async autosave(payload: {
    action: 'save' | 'load' | 'delete';
    key: string;
    text?: string;
    html?: string;
    time?: number;
  }): Promise<Record<string, unknown>> {
    const res = await fetch(`${BASE}/autosave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Autosave failed: ${res.status}`);
    return res.json() as Promise<Record<string, unknown>>;
  },

  async versionSave(payload: {
    label: string;
    file_a_content: string;
    file_b_content: string;
    stats: Record<string, number>;
  }): Promise<{ status: string; id: string }> {
    const res = await fetch(`${BASE}/versions/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Version save failed: ${res.status}`);
    return res.json() as Promise<{ status: string; id: string }>;
  },

  async versionList(): Promise<{ status: string; versions: Record<string, unknown>[] }> {
    const res = await fetch(`${BASE}/versions/list`);
    if (!res.ok) throw new Error(`Version list failed: ${res.status}`);
    return res.json() as Promise<{ status: string; versions: Record<string, unknown>[] }>;
  },

  async versionRestore(id: string): Promise<{ status: string; version: Record<string, unknown> }> {
    const res = await fetch(`${BASE}/versions/restore/${id}`, { method: 'POST' });
    if (!res.ok) throw new Error(`Version restore failed: ${res.status}`);
    return res.json() as Promise<{ status: string; version: Record<string, unknown> }>;
  },
};
