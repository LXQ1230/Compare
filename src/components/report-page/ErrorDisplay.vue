<script setup lang="ts">
import type { ErrorEnvelope } from '../../types';

defineProps<{ error: ErrorEnvelope | null }>();
defineEmits<{ dismiss: [] }>();
</script>

<template>
  <div v-if="error" class="error-banner" :class="`error-${error.severity}`">
    <span class="error-title">{{ error.title }}</span>
    <span class="error-msg">{{ error.message }}</span>
    <button class="error-dismiss" @click="$emit('dismiss')">✕</button>
  </div>
</template>

<style scoped>
.error-banner {
  display: flex; align-items: center; gap: 12px; padding: 8px 16px;
  font-size: 13px; flex-shrink: 0;
}
.error-blocking { background: var(--color-del-bg); color: var(--color-del-text); }
.error-warning { background: var(--color-user-add-bg); color: var(--color-user-add-text); }
.error-info { background: var(--color-focus-bg); color: var(--color-focus-border); }
.error-title { font-weight: 600; }
.error-msg { flex: 1; }
.error-dismiss { background: none; border: none; cursor: pointer; font-size: 14px; margin-left: auto; }
</style>
