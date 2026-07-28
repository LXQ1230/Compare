<script setup lang="ts">
import { useSearchStore } from '../../stores/search';

const searchStore = useSearchStore();
</script>

<template>
  <div v-if="searchStore.isOpen" class="search-bar">
    <div class="search-row">
      <input
        v-model="searchStore.query"
        class="search-input"
        placeholder="搜索..."
        @input="searchStore.search()"
        @keydown.enter="searchStore.next()"
      />
      <span class="search-count">{{ searchStore.currentPosition }}</span>
      <button class="search-nav-btn" @click="searchStore.prev()" title="上一个">▲</button>
      <button class="search-nav-btn" @click="searchStore.next()" title="下一个">▼</button>
    </div>
    <div class="search-options">
      <label class="search-opt">
        <input type="checkbox" :checked="searchStore.options.caseSensitive" @change="searchStore.toggleCaseSensitive()" /> Aa
      </label>
      <label class="search-opt">
        <input type="checkbox" :checked="searchStore.options.wholeWord" @change="searchStore.toggleWholeWord()" /> ab
      </label>
      <label class="search-opt">
        <input type="checkbox" :checked="searchStore.options.useRegex" @change="searchStore.toggleRegex()" /> .*
      </label>
      <button class="search-close" @click="searchStore.close()">✕</button>
    </div>
  </div>
</template>

<style scoped>
.search-bar {
  padding: 8px 16px; border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary); flex-shrink: 0;
}
.search-row { display: flex; align-items: center; gap: 8px; }
.search-input {
  flex: 1; padding: 6px 10px; border: 1px solid var(--color-border);
  border-radius: 6px; font-size: 14px; outline: none;
}
.search-input:focus { border-color: var(--color-focus-border); }
.search-count { font-size: 12px; color: var(--color-text-secondary); min-width: 30px; }
.search-nav-btn {
  padding: 4px 8px; border: 1px solid var(--color-border); border-radius: 4px;
  background: var(--color-bg); cursor: pointer; font-size: 12px;
}
.search-nav-btn:hover { background: var(--color-bg-hover); }
.search-options { display: flex; gap: 12px; margin-top: 6px; align-items: center; }
.search-opt { font-size: 12px; display: flex; align-items: center; gap: 3px; cursor: pointer; }
.search-close {
  margin-left: auto; background: none; border: none; cursor: pointer;
  font-size: 16px; color: var(--color-text-secondary);
}
</style>
