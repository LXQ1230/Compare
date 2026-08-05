/**
 * 方案 P2-6: 压缩 undo 历史后 classify 不被跳过（组件级回归测试）。
 *
 * 回归场景：compressHistory() 置 suppressClassifyNext=true 后 v.setState()，
 * 其同步 update docChanged=false → updateListener 提前 return、标志未被消费；
 * 若压缩后不显式清标志，下一次真实编辑会被 585 行误吞（classify 不触发）。
 *
 * 测试方法：
 * 1. mount CodeMirrorDiff 并进入编辑态（view 实例经 EditorView.findFromDOM 获取）
 * 2. 连续 dispatch 编辑直到 undoDepth > MAX_UNDO_DEPTH → compressHistory 触发（深度归零）
 * 3. 压缩后的第一个真实编辑 dispatch → 等待防抖 → 断言 classify 结果写入 store
 *    （修复前 workerVersion 不变 → 测试失败，回归有效）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { EditorView } from '@codemirror/view';
import { undoDepth } from '@codemirror/commands';
import CodeMirrorDiff from '../CodeMirrorDiff.vue';
import { useCompareStore } from '../../../stores/compare';
import { useEditorStore } from '../../../stores/editor';
import { resetWorkerManager } from '../../../utils/classifyWorker';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('compressHistory → 后续编辑仍触发 classify (方案 P2-6)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetWorkerManager();
    // jsdom 无 ResizeObserver —— CM6 构造依赖它做测量，stub 掉
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RO);
  });

  it('压缩重建后第一次真实编辑触发 classify（workerVersion 递增）', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const cmp = useCompareStore();
    cmp.segments = [{ text: 'base content', operation: 'none', origin: 'original' }];
    cmp.meta = {
      fileA: 'a.txt', fileB: 'b.txt',
      stats: { total: 0, add: 0, del: 0, mod: 0 },
      timestamp: Date.now(), totalChunks: 1, scale: 'S',
    };
    const editor = useEditorStore();
    editor.editSegments = [...cmp.segments];
    editor.editText = 'base content';
    editor.originalBaseline = 'base content';

    const wrapper = mount(CodeMirrorDiff, {
      global: { plugins: [pinia] },
      attachTo: document.body, // mount 默认 detached——CM DOM 需在 document 内才能 query
    });
    // 进入编辑态 → watch(immediate) 创建 CM 实例
    editor.isEditing = true;
    await flushPromises();
    await nextTick();
    await sleep(100); // 允许 CM 挂载与装饰派发

    const contentEl = document.querySelector('.cm-content') as HTMLElement | null;
    expect(contentEl).not.toBeNull();
    const view = EditorView.findFromDOM(contentEl!);
    expect(view).not.toBeNull();
    const v = view!;

    // ── 1. 连续编辑直至触发压缩（undoDepth > 500 → 重建 state 归零）──
    // 注意：history({ minDepth: 500 }) 下 undoDepth 可越过 500；为避免相邻
    // 编辑被合并为一个 undo 组，交替在开头/结尾插入以打断分组。
    let compressed = false;
    for (let i = 0; i < 1200 && !compressed; i++) {
      const at = i % 2 === 0 ? 0 : v.state.doc.length;
      v.dispatch({ changes: { from: at, insert: i % 2 === 0 ? 'x' : 'y' } });
      if (i > 0 && undoDepth(v.state) === 0) compressed = true; // 压缩后历史清空
    }
    expect(compressed).toBe(true);

    // ── 2. 压缩后的第一个真实编辑——必须触发 classify ──
    // 先等前一次编辑的 classify 定时器（300ms）跑完——否则该定时器的 fresh
    // 读取会兜住"被跳过的编辑"（修复前 bug 的观测盲区）。
    await sleep(400);
    const before = editor.workerVersion;
    v.dispatch({ changes: { from: v.state.doc.length, insert: 'TAIL' } });
    await sleep(400); // 300ms 防抖窗口

    expect(editor.workerVersion).toBeGreaterThan(before);
    // 且编辑结果已缓存（classify 产物可被导出/搜索消费）
    expect(editor.getEditedSegments().length).toBeGreaterThan(0);

    wrapper.unmount();
  }, 20_000);
});
