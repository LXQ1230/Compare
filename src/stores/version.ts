/**
 * Version store — manages version history list and operations.
 * 版本按 session_key 分组（fileAName+fileBName+baseline hash），每组独立。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { VersionEntry, StyleRange } from '@/types';
import { api } from '@/utils/api';
import { storage } from '@/utils/storage';
import { fnv1aHash } from '@/utils/hash';
import { buildDocText, normalizeLineEndings } from '@/render/editClassifier';
import { useCompareStore } from './compare';

export const useVersionStore = defineStore('version', () => {
  const versions = ref<VersionEntry[]>([]);
  const isSaving = ref(false);
  const error = ref<string | null>(null);

  /** 计算当前对比会话的 session_key（与草稿 key 一致）。 */
  function computeSessionKey(): string {
    const compareStore = useCompareStore();
    const baseline = normalizeLineEndings(buildDocText(compareStore.segments));
    const raw = compareStore.fileAName + "\0" + compareStore.fileBName + "\0" + baseline;
    return fnv1aHash(raw);
  }

  async function loadVersions(): Promise<void> {
    const sessionKey = computeSessionKey();
    try {
      const result = await api.versionList(sessionKey);
      versions.value = (result.versions as unknown as VersionEntry[]) ?? [];
    } catch {
      // 回退 localStorage 旧索引（无分组）
      versions.value = storage.loadVersions();
    }
  }

  async function saveVersion(label: string, fileAContent: string, fileBContent: string, stats: Record<string, number>, styleA?: StyleRange[], styleB?: StyleRange[], docMeta?: Record<string, unknown>): Promise<string | null> {
    isSaving.value = true;
    error.value = null;
    try {
      const sessionKey = computeSessionKey();
      const result = await api.versionSave({ label, file_a_content: fileAContent, file_b_content: fileBContent, stats, style_a: styleA, style_b: styleB, doc_meta: docMeta, session_key: sessionKey });
      const entry: VersionEntry = { id: result.id, label, time: Date.now() };
      versions.value.unshift(entry);
      return result.id;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '保存版本失败';
      return null;
    } finally {
      isSaving.value = false;
    }
  }

  async function restoreVersion(id: string): Promise<Record<string, unknown> | null> {
    error.value = null;
    try {
      const result = await api.versionRestore(id);
      return result.version;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '恢复版本失败';
      return null;
    }
  }

  return { versions, isSaving, error, loadVersions, saveVersion, restoreVersion, computeSessionKey };
});
