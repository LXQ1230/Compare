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
    <!-- 搜索结果列表 -->
    <div v-if="searchStore.matches.length > 0" class="search-results">
      <div
        v-for="(m, idx) in searchStore.matches.slice(0, 50)"
        :key="idx"
        class="result-item"
        :class="{ active: idx === searchStore.activeMatchIndex }"
        @click="searchStore.jumpTo(idx)"
        @mouseenter="searchStore.jumpTo(idx)"
      >
        <span class="result-idx">{{ idx + 1 }}</span>
        <span class="result-preview">{{ m.preview }}</span>
      </div>
      <div v-if="searchStore.matches.length > 50" class="result-more">
        … 共 {{ searchStore.matches.length }} 条结果，仅显示前 50 条
      </div>
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
/* ── 搜索结果列表 ── */
.search-results {
  margin-top: 6px; max-height: 240px; overflow-y: auto;
  border-top: 1px solid var(--color-border); padding-top: 4px;
}
.result-item {
  display: flex; align-items: flex-start; gap: 8px; padding: 4px 8px;
  border-radius: 4px; cursor: pointer; font-size: 13px;
  transition: background 0.1s;
}
.result-item:hover, .result-item.active {
  background: var(--color-focus-bg);
}
.result-item.active {
  border-left: 3px solid var(--color-focus-border);
}
.result-idx {
  flex-shrink: 0; min-width: 24px; font-size: 11px;
  color: var(--color-text-secondary); text-align: right; padding-top: 1px;
}
.result-preview {
  color: var(--color-text); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; flex: 1;
}
.result-more {
  font-size: 11px; color: var(--color-text-secondary);
  text-align: center; padding: 4px 0;
}
</style>
