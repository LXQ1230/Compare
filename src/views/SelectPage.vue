<script setup lang="ts">
import { useRouter } from 'vue-router';
import { ref } from 'vue';
import DropZone from '../components/select-page/DropZone.vue';
import { useCompareStore } from '../stores/compare';

const router = useRouter();
const compareStore = useCompareStore();

const fileA = ref<File | null>(null);
const fileB = ref<File | null>(null);
const error = ref('');
const isStarting = ref(false);

const inputA = ref<HTMLInputElement | null>(null);
const inputB = ref<HTMLInputElement | null>(null);

function handleFiles(files: File[]) {
  error.value = '';
  if (files.length >= 1) fileA.value = files[0];
  if (files.length >= 2) fileB.value = files[1];
}

function handleFileAChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.[0]) fileA.value = input.files[0];
  error.value = '';
}

function handleFileBChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.[0]) fileB.value = input.files[0];
  error.value = '';
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

    <button class="start-btn" :disabled="!fileA || !fileB || isStarting" @click="startCompare">
      {{ isStarting ? '对比中...' : '开始对比' }}
    </button>

    <p class="hint">支持格式：txt · docx · md</p>
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
.start-btn {
  margin-top: 12px; padding: 12px 48px; font-size: 16px; font-weight: 600;
  background: var(--color-focus-border); color: #fff; border: none;
  border-radius: 8px; cursor: pointer;
}
.start-btn:disabled { opacity: 0.4; cursor: default; }
.hint { color: var(--color-text-secondary); font-size: 14px; margin-top: 8px; }
.hidden-input { display: none; }
</style>
