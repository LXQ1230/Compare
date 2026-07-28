/**
 * Version store — manages version history list and operations.
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { VersionEntry } from '@/types';
import { api } from '@/utils/api';
import { storage } from '@/utils/storage';

export const useVersionStore = defineStore('version', () => {
  const versions = ref<VersionEntry[]>([]);
  const isSaving = ref(false);
  const error = ref<string | null>(null);

  async function loadVersions(): Promise<void> {
    try {
      const result = await api.versionList();
      versions.value = (result.versions as unknown as VersionEntry[]) ?? [];
    } catch {
      versions.value = storage.loadVersions();
    }
  }

  async function saveVersion(label: string, fileAContent: string, fileBContent: string, stats: Record<string, number>): Promise<string | null> {
    isSaving.value = true;
    error.value = null;
    try {
      const result = await api.versionSave({ label, file_a_content: fileAContent, file_b_content: fileBContent, stats });
      const entry: VersionEntry = { id: result.id, label, time: Date.now() };
      versions.value.unshift(entry);
      storage.saveVersions(versions.value);
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

  return { versions, isSaving, error, loadVersions, saveVersion, restoreVersion };
});
