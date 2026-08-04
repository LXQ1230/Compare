<script setup lang="ts">
import { useRouter } from 'vue-router';
import { ref, onMounted } from 'vue';
import DropZone from '../components/select-page/DropZone.vue';
import { useCompareStore } from '../stores/compare';
import { useEditorStore } from '../stores/editor';
import { storage } from '../utils/storage';
import { indexedDB } from '../utils/indexeddb';
import { buildDocText, normalizeLineEndings } from '../render/editClassifier';
import { api } from '../utils/api';
import type { EditSessionDraft, Segment, CompareStats } from '../types';

const router = useRouter();
const compareStore = useCompareStore();
const editorStore = useEditorStore();

const fileA = ref<File | null>(null);
const fileB = ref<File | null>(null);
const error = ref('');
const isStarting = ref(false);
const drafts = ref<EditSessionDraft[]>([]);

const inputA = ref<HTMLInputElement | null>(null);
const inputB = ref<HTMLInputElement | null>(null);

// ── 超大文件预检（方案 L0）───────────────────────────────────────
// 后端上限：COMPARE_MAX_BYTES = 15MB（≈500 万字）；前端按文件大小粗估（保守 2 字节/字）
const MAX_BYTES = 15 * 1024 * 1024;
const sizeWarnings = ref<{ a: string; b: string }>({ a: '', b: '' });

function checkSize(f: File | null): string {
  if (!f) return '';
  if (f.size > MAX_BYTES) return 'error';
  const chars = f.size / 2;
  if (chars > 500_000) return 'warn';
  return '';
}

function refreshSizeWarnings(): void {
  sizeWarnings.value = {
    a: checkSize(fileA.value),
    b: checkSize(fileB.value),
  };
}

// Load resume-able drafts from localStorage index summaries (rev. edit-persistence/2 + 方案 L5/P4)
function loadDrafts(): void {
  drafts.value = storage.listEditDrafts().filter((d) => d.hasEdits);
}
onMounted(loadDrafts);

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Resume a draft (方案 L5/P4): 摘要草稿（localStorage）→ IndexedDB 完整草稿
 * （editText/定位字段）+ IndexedDB segments（免重跑对比）→ 后端 autosave 兜底。
 * baseline 由 segments 重建（IndexedDB 草稿不再存冗余 baseline）。
 */
async function resumeDraft(draft: EditSessionDraft): Promise<void> {
  isStarting.value = true;
  error.value = '';
  try {
    // 1. IndexedDB 完整草稿（方案 L5：正文主体在 IndexedDB drafts store）
    let full = await storage.loadEditDraft(draft.key);
    // 2. IndexedDB segments（免重跑对比）
    let segs: Segment[] = [];
    try {
      const rows = await indexedDB.getAll('segments');
      segs = rows
        .sort((a, b) => a.index - b.index)
        .flatMap((r) => r.data as Segment[]);
    } catch {
      // ignore — fall back to backend
    }
    // 3. 缺失时回退后端 autosave（跨设备；方案 L5/P5：后端只有 editText/定位字段，
    //    segments/baseline 均需本地 IndexedDB 提供——segments 缺失则无法恢复对比数据）
    if (!full || !full.editText) {
      const remote = await api.autosave({ action: 'load', key: draft.key });
      const rd = (remote?.data ?? {}) as Record<string, unknown>;
      const remoteText = (rd['text'] as string) ?? '';
      if (remoteText) {
        full = {
          ...(full ?? {}),
          ...draft,
          editText: remoteText,
          baseline: '',
          cursorPos: (rd['cursor_pos'] as number) ?? 0,
          scrollPos: (rd['scroll_pos'] as number) ?? 0,
          lastEditOffset: (rd['last_edit_offset'] as number) ?? -1,
          processedCis: (rd['processed_cis'] as number[]) ?? draft.processedCis,
          timestamp: (rd['time'] as number) ?? draft.timestamp,
        } as EditSessionDraft;
      }
    }
    if (!full || !full.editText) {
      error.value = '无法恢复该草稿（正文缺失），请重新上传文件对比';
      return;
    }
    if (segs.length === 0) {
      error.value = '无法恢复该草稿（对比数据缺失），请重新上传文件对比';
      return;
    }
    // 方案 L5：IndexedDB 草稿不含 baseline → 由 segments 重建
    if (!full.baseline) {
      full = { ...full, baseline: normalizeLineEndings(buildDocText(segs)) };
    }
    compareStore.restoreFromDraft(segs, full);
    editorStore.resumeFromDraft(full);
    router.push('/report');
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '恢复草稿失败';
  } finally {
    isStarting.value = false;
  }
}

function removeDraft(key: string, e: Event): void {
  e.stopPropagation();
  storage.clearEditDraft(key).catch(() => {});
  api.autosave({ action: 'delete', key }).catch(() => {});
  loadDrafts();
}

function handleFiles(files: File[]) {
  error.value = '';
  if (files.length >= 1) fileA.value = files[0];
  if (files.length >= 2) fileB.value = files[1];
  refreshSizeWarnings();
}

function handleFileAChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.[0]) fileA.value = input.files[0];
  error.value = '';
  refreshSizeWarnings();
}

function handleFileBChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.[0]) fileB.value = input.files[0];
  error.value = '';
  refreshSizeWarnings();
}

function openFileA() { inputA.value?.click(); }
function openFileB() { inputB.value?.click(); }

function swapFiles() {
  const tmp = fileA.value;
  fileA.value = fileB.value;
  fileB.value = tmp;
}

async function startCompare() {
  if (!fileA.value || !fileB.value) {
    error.value = '请选择两个文件';
    return;
  }
  // 超大文件阻止（方案 L0/XL）
  if (fileA.value.size > MAX_BYTES || fileB.value.size > MAX_BYTES) {
    error.value = '文件超过 15MB（约 500 万字）上限，请拆分后对比';
    return;
  }
  isStarting.value = true;
  try {
    await compareStore.startCompare(fileA.value, fileB.value);
    router.push('/report');
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '对比失败';
  } finally {
    isStarting.value = false;
  }
}
</script>

<template>
  <div class="select-page">
    <h1 class="app-title">文档对比工具</h1>
    <p class="app-desc">上传两个文件，进行字符级精确对比</p>

    <DropZone @files="handleFiles" />

    <!-- Hidden individual file inputs -->
    <input ref="inputA" type="file" accept=".txt,.docx,.md" class="hidden-input" @change="handleFileAChange" />
    <input ref="inputB" type="file" accept=".txt,.docx,.md" class="hidden-input" @change="handleFileBChange" />

    <div v-if="fileA || fileB" class="file-cards">
      <div class="file-card" :class="{ filled: fileA }">
        <span class="card-label">文件 A（原始）</span>
        <span class="card-name">{{ fileA?.name ?? '未选择' }}</span>
        <div class="card-actions">
          <button class="card-pick-btn" @click="openFileA">{{ fileA ? '更换文件' : '选择文件 A' }}</button>
          <button v-if="fileA" class="card-remove" @click="fileA = null">×</button>
        </div>
      </div>
      <button class="swap-btn" title="交换文件" @click="swapFiles" :disabled="!fileA || !fileB">⇄</button>
      <div class="file-card" :class="{ filled: fileB }">
        <span class="card-label">文件 B（修改）</span>
        <span class="card-name">{{ fileB?.name ?? '未选择' }}</span>
        <div class="card-actions">
          <button class="card-pick-btn" @click="openFileB">{{ fileB ? '更换文件' : '选择文件 B' }}</button>
          <button v-if="fileB" class="card-remove" @click="fileB = null">×</button>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <!-- 超大文件提示（方案 L0） -->
    <div v-if="sizeWarnings.a === 'warn' || sizeWarnings.b === 'warn'" class="size-warn">
      ⚠️ 大文档（>50 万字）：对比与编辑可能较慢，请耐心等待
    </div>
    <div v-if="sizeWarnings.a === 'error' || sizeWarnings.b === 'error'" class="size-error">
      ⛔ 文件超过 15MB（约 500 万字）上限，无法对比
    </div>

    <button class="start-btn" :disabled="!fileA || !fileB || isStarting" @click="startCompare">
      {{ isStarting ? `对比中… ${compareStore.progress}%（已发现 ${compareStore.stats.total} 处差异）` : '开始对比' }}
    </button>

    <p class="hint">支持格式：txt · docx · md</p>

    <!-- Unfinished edit drafts (rev. edit-persistence/2) -->
    <div v-if="drafts.length > 0" class="draft-list">
      <h3 class="draft-heading">未完成的编辑</h3>
      <div v-for="draft in drafts" :key="draft.key" class="draft-item" @click="resumeDraft(draft)">
        <div class="draft-info">
          <span class="draft-files">{{ draft.fileAName }} ↔ {{ draft.fileBName }}</span>
          <span class="draft-meta">
            {{ draft.processedCis.length }} 处已处理 · {{ formatTime(draft.timestamp) }}
          </span>
        </div>
        <button class="draft-resume-btn">继续编辑</button>
        <button class="draft-remove" title="删除草稿" @click="removeDraft(draft.key, $event)">×</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.select-page {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; min-height: 100vh; gap: 16px; padding: 24px;
}
.app-title { font-size: 28px; font-weight: 700; }
.app-desc { color: var(--color-text-secondary); font-size: 15px; }
.file-cards { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
.file-card {
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 16px; border: 2px dashed var(--color-border);
  border-radius: 8px; min-width: 220px; background: var(--color-bg-secondary);
}
.file-card.filled { border-color: var(--color-focus-border); background: var(--color-focus-bg); }
.card-label { font-size: 12px; color: var(--color-text-secondary); }
.card-name { font-size: 14px; font-weight: 600; word-break: break-all; }
.card-actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.card-pick-btn {
  font-size: 12px; padding: 2px 8px; background: var(--color-bg); color: var(--color-focus-border);
  border: 1px solid var(--color-focus-border); border-radius: 4px; cursor: pointer;
}
.card-pick-btn:hover { background: var(--color-focus-bg); }
.card-remove {
  background: none; border: none; cursor: pointer; font-size: 18px;
  color: var(--color-danger); padding: 0 4px; margin-left: auto;
}
.swap-btn {
  font-size: 24px; background: none; border: 1px solid var(--color-border);
  border-radius: 50%; width: 40px; height: 40px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.swap-btn:disabled { opacity: 0.3; cursor: default; }
.error-msg { color: var(--color-danger); font-size: 13px; }
.size-warn { color: #b7791f; font-size: 13px; }
.size-error { color: var(--color-danger); font-size: 13px; font-weight: 600; }
.start-btn {
  margin-top: 12px; padding: 12px 48px; font-size: 16px; font-weight: 600;
  background: var(--color-focus-border); color: #fff; border: none;
  border-radius: 8px; cursor: pointer;
}
.start-btn:disabled { opacity: 0.4; cursor: default; }
.hint { color: var(--color-text-secondary); font-size: 14px; margin-top: 8px; }
.hidden-input { display: none; }

/* ── unfinished edit drafts (rev. edit-persistence/2) ─────────── */
.draft-list {
  width: min(640px, 90vw); margin-top: 24px;
  border-top: 1px solid var(--color-border); padding-top: 16px;
}
.draft-heading { font-size: 14px; font-weight: 600; margin: 0 0 10px; color: var(--color-text); }
.draft-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; margin-bottom: 8px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border); border-radius: 8px;
  cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.draft-item:hover { border-color: var(--color-focus-border); background: var(--color-focus-bg); }
.draft-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.draft-files {
  font-size: 13px; font-weight: 600; color: var(--color-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.draft-meta { font-size: 11px; color: var(--color-text-secondary); }
.draft-resume-btn {
  flex-shrink: 0; font-size: 12px; padding: 4px 12px;
  background: var(--color-focus-border); color: #fff;
  border: none; border-radius: 4px; cursor: pointer;
}
.draft-resume-btn:hover { opacity: 0.9; }
.draft-remove {
  flex-shrink: 0; background: none; border: none; cursor: pointer;
  font-size: 16px; color: var(--color-danger); padding: 0 4px;
}
</style>
