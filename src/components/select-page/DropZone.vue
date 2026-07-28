<script setup lang="ts">
defineEmits<{
  files: [files: File[]]
}>();
</script>

<template>
  <div
    class="drop-zone"
    @dragover.prevent
    @dragenter.prevent
    @drop.prevent="(e: DragEvent) => {
      const dt = e.dataTransfer;
      if (dt?.files) $emit('files', Array.from(dt.files));
    }"
  >
    <input
      type="file"
      multiple
      class="drop-input"
      @change="(e: Event) => {
        const input = e.target as HTMLInputElement;
        if (input.files) $emit('files', Array.from(input.files));
      }"
    />
    <p class="drop-text">拖拽文件到此处，或点击选择</p>
    <p class="drop-sub">支持 .txt / .docx / .md 格式</p>
  </div>
</template>

<style scoped>
.drop-zone {
  width: 100%; max-width: 480px; border: 2px dashed var(--color-border);
  border-radius: 12px; padding: 40px 24px; text-align: center;
  cursor: pointer; position: relative; transition: border-color 0.2s;
}
.drop-zone:hover { border-color: var(--color-focus-border); }
.drop-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.drop-text { font-size: 16px; color: var(--color-text); margin-bottom: 4px; }
.drop-sub { font-size: 13px; color: var(--color-text-secondary); }
</style>
