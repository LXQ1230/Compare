<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useVersionStore } from '../../stores/version';
import { useCompareStore } from '../../stores/compare';
import { buildDocText, buildOriginalText } from '../../render/editClassifier';
import type { VersionEntry } from '../../types';

const router = useRouter();
const versionStore = useVersionStore();
const compareStore = useCompareStore();

const emit = defineEmits<{ close: [] }>();

/** 保存当前对比会话（A 原文 vs B 修改版全文）为版本（方案 P1-1b）。 */
async function onSave() {
  const label = prompt('版本标签（可选）：') ?? '';
  const key = label || `v${new Date().toLocaleString()}`;
  const saved = await versionStore.saveVersion(
    key,
    buildOriginalText(compareStore.segments), // A 侧原文
    buildDocText(compareStore.segments),      // B 侧修改版全文（过滤 phantom）
    { ...compareStore.stats },
  );
  if (saved) {
    // 提示保存成功（后端 id 已入列表，无需刷新）
    window.alert(`版本「${key}」已保存。`);
  }
}

/** 恢复 = 把该版本的 A/B 全文变成新的对比会话（方案 P1-1c）。 */
async function onRestore(v: VersionEntry): Promise<void> {
  const res = await versionStore.restoreVersion(v.id);
  if (res) {
    const cmp = useCompareStore();
    await cmp.restoreVersionSession(
      res.file_a_content as string,
      res.file_b_content as string,
      v.label,
    );
    router.push(`/report/${cmp.sessionId}`);
    emit('close');
  } else {
    window.alert('恢复版本失败，请检查后端服务。');
  }
}
</script>

<template>
  <div class="version-overlay" @click.self="$emit('close')">
    <div class="version-dialog">
      <h3 class="dialog-title">版本历史</h3>
      <div v-if="versionStore.versions.length === 0" class="empty">暂无保存的版本。</div>
      <div v-for="v in versionStore.versions" :key="v.id" class="version-row">
        <span class="version-label">{{ v.label }}</span>
        <span class="version-time">{{ new Date(v.time).toLocaleString() }}</span>
        <button class="version-restore" @click="onRestore(v)">恢复</button>
      </div>
      <div class="dialog-actions">
        <button class="action-btn" @click="onSave()">保存当前版本</button>
        <button class="action-btn cancel" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.version-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.3);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.version-dialog {
  background: var(--color-bg); border-radius: 12px; padding: 24px;
  width: 400px; max-height: 60vh; overflow-y: auto;
}
.dialog-title { font-size: 18px; margin-bottom: 12px; }
.version-row {
  display: flex; align-items: center; gap: 8px; padding: 6px 0;
  border-bottom: 1px solid var(--color-border); font-size: 14px;
}
.version-label { font-weight: 600; }
.version-time { color: var(--color-text-secondary); font-size: 12px; flex: 1; }
.version-restore {
  padding: 4px 10px; border: 1px solid var(--color-focus-border); border-radius: 4px;
  font-size: 12px; cursor: pointer; background: var(--color-focus-bg);
}
.dialog-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
.action-btn {
  padding: 8px 20px; border: 1px solid var(--color-border); border-radius: 6px;
  background: var(--color-bg); cursor: pointer; font-size: 14px;
}
.action-btn.cancel { color: var(--color-text-secondary); }
.empty { color: var(--color-text-secondary); font-size: 14px; text-align: center; padding: 24px 0; }
</style>
