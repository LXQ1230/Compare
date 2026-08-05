/**
 * IDML 版本历史样式回填测试（设计方案 §6.6 链路 1）。
 *
 * 核心不变量：buildSegmentsFromTexts(a, b, styleA, styleB) 重建的 segments
 * 样式合并后 == 原始 styleA/styleB（与后端 diff_engine 同语义的游标映射）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useCompareStore } from '@/stores/compare';
import { buildSideStyles } from '@/render/editClassifier';
import type { Segment, StyleRange } from '@/types';

beforeEach(() => {
  setActivePinia(createPinia());
});

function seg(
  text: string,
  op: Segment['operation'],
  side?: 'old' | 'new',
  style?: StyleRange[],
  ci?: number,
): Segment {
  return { text, operation: op, origin: 'original', side, style, ci };
}

const _STYLE_KEYS = ['font', 'sizePt', 'bold', 'color', 'warichu', 'warichuSize', 'baselineShift'] as const;

function _styleOf(d: StyleRange): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of _STYLE_KEYS) {
    if (d[k] != null) out[k] = d[k];
  }
  return out;
}

function _asList(spans: StyleRange[]) {
  return spans.map((sp) => ({ start: sp.start, end: sp.end, style: _styleOf(sp) }));
}

function _mergeAdjacent(spans: StyleRange[]) {
  const out: Array<{ start: number; end: number; style: Record<string, unknown> }> = [];
  for (const sp of spans) {
    const style = _styleOf(sp);
    const prev = out[out.length - 1];
    if (prev && prev.end === sp.start && JSON.stringify(prev.style) === JSON.stringify(style)) {
      prev.end = sp.end;
    } else {
      out.push({ start: sp.start, end: sp.end, style });
    }
  }
  return out;
}

/** 从重建 segments 重构指定侧全文偏移样式（取该侧段，平移段内偏移）。 */
function rebuildSideStyles(segs: Segment[], side: 'a' | 'b'): StyleRange[] {
  const out: StyleRange[] = [];
  let pos = 0;
  for (const s of segs) {
    const takeA = s.operation === 'none' || s.operation === 'del' || (s.operation === 'mod' && s.side === 'old');
    const takeB = s.operation === 'none' || s.operation === 'add' || (s.operation === 'mod' && s.side === 'new');
    if (side === 'a' ? takeA : takeB) {
      if (s.style?.length) {
        for (const sp of s.style) {
          out.push({ ...sp, start: pos + sp.start, end: pos + sp.end });
        }
      }
      pos += s.text.length;
    }
  }
  return out;
}

describe('buildSegmentsFromTexts 版本样式回填（§6.6 链路 1）', () => {
  it('无 style：行为与旧版一致（零开销）', () => {
    const store = useCompareStore();
    const segs = store.buildSegmentsFromTexts('ABCD', 'ABXCD');
    expect(segs.every((s) => s.style === undefined)).toBe(true);
    expect(segs.some((s) => s.operation !== 'none')).toBe(true);
  });

  it('回填后合并等价：重建样式 == 原始 styleA/styleB', () => {
    const store = useCompareStore();
    const a = '佛說阿彌陀經。'   // 7 字符
    const b = '佛說阿彌。陀經。' // 8 字符
    const styleA: StyleRange[] = [
      { start: 0, end: 2, font: 'FangSong' },
      { start: 2, end: 5, font: 'SourceHanSerifCN', warichu: true, warichuSize: 40 },
      { start: 5, end: 7, font: 'FangSong' },
    ]
    const styleB: StyleRange[] = [
      { start: 0, end: 2, font: 'FangSong' },
      { start: 2, end: 6, font: 'SourceHanSerifCN', warichu: true, warichuSize: 40 },
      { start: 6, end: 8, font: 'FangSong' },
    ]
    const segs = store.buildSegmentsFromTexts(a, b, styleA, styleB)
    // 文本重构
    const rebuildA = segs.filter((s) => s.operation === 'none' || s.operation === 'del' || (s.operation === 'mod' && s.side === 'old')).map((s) => s.text).join('')
    const rebuildB = segs.filter((s) => s.operation === 'none' || s.operation === 'add' || (s.operation === 'mod' && s.side === 'new')).map((s) => s.text).join('')
    expect(rebuildA).toBe(a)
    expect(rebuildB).toBe(b)
    // 样式合并等价
    expect(_mergeAdjacent(rebuildSideStyles(segs, 'a'))).toEqual(_mergeAdjacent(styleA))
    expect(_mergeAdjacent(rebuildSideStyles(segs, 'b'))).toEqual(_mergeAdjacent(styleB))
  })

  it('buildSideStyles 提取与 buildSegmentsFromTexts 回填互为逆操作', () => {
    const store = useCompareStore();
    // 模拟后端附着后的 segments（none 段 A 侧样式；add/mod-new B 侧）
    const segments: Segment[] = [
      seg('佛說', 'none', undefined, [{ start: 0, end: 2, font: 'FangSong' }]),
      seg('阿彌陀', 'none', undefined, [{ start: 0, end: 3, font: 'SourceHanSerifCN', warichu: true, warichuSize: 40 }]),
      seg('四', 'mod', 'old', [{ start: 0, end: 1, font: 'FangSong' }], 1),
      seg('五', 'mod', 'new', [{ start: 0, end: 1, font: 'FangSong', bold: true }], 1),
      seg('經。', 'none', undefined, [{ start: 0, end: 2, font: 'FangSong' }]),
    ]
    const aText = segments.filter((s) => s.operation === 'none' || s.operation === 'del' || (s.operation === 'mod' && s.side === 'old')).map((s) => s.text).join('')
    const bText = segments.filter((s) => s.operation === 'none' || s.operation === 'add' || (s.operation === 'mod' && s.side === 'new')).map((s) => s.text).join('')
    const styleA = buildSideStyles(segments, 'a')
    const styleB = buildSideStyles(segments, 'b')
    // 重建后样式与提取的一致（合并等价）
    const rebuilt = store.buildSegmentsFromTexts(aText, bText, styleA, styleB)
    expect(_mergeAdjacent(rebuildSideStyles(rebuilt, 'a'))).toEqual(_mergeAdjacent(styleA))
    expect(_mergeAdjacent(rebuildSideStyles(rebuilt, 'b'))).toEqual(_mergeAdjacent(styleB))
  })
})
