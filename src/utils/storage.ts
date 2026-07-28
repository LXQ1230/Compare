/**
 * LocalStorage + IndexedDB hybrid wrapper for persisting compare state.
 */

import type { Segment, CompareMeta, VersionEntry } from '@/types';
import { indexedDB } from './indexeddb';

const META_KEY = 'cmp_meta';
const AUTOSAVE_KEY = 'cmp_autosave';
const VERSION_KEY = 'cmp_versions';

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
};
