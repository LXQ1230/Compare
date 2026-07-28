<script setup lang="ts">
</script>

<template>
  <div class="select-page">
    <h1 class="app-title">文档对比工具</h1>
    <p class="app-desc">上传两个文件，进行字符级精确对比</p>
    <p class="hint">支持格式：txt · docx · md</p>
  </div>
</template>

<style scoped>
.select-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 8px;
  padding: 24px;
}
.app-title { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
.app-desc { color: var(--color-text-secondary); font-size: 15px; margin-bottom: 32px; }
.hint { color: var(--color-text-secondary); font-size: 14px; }
</style>
