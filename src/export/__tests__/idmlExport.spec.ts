/**
 * IDML 导出链路测试（设计方案 §6.7 方案 A + §5.7.1 U+2029 转换）。
 *
 * - mergeLayers fast path：style 保留
 * - mergeLayers emitRange：text 切片后 style 区间同步裁剪
 * - mergeLayers user 段：继承前邻样式（编辑在割注内 → 新字成割注）
 * - exportToTXT/MD：U+2029 → \n；exportToHTML：竖排容器
 */

import { describe, it, expect } from 'vitest';
import { mergeLayers } from '@/export/mergeLayers';
import { exportToTXT, exportToMD, exportToHTML } from '@/export/exporters';
import { PARA_SEP } from '@/render/segmentRenderer';
import type { Segment, StyleRange } from '@/types';

function seg(
  text: string,
  op: Segment['operation'],
  side?: 'old' | 'new',
  style?: StyleRange[],
  ci?: number,
): Segment {
  return { text, operation: op, origin: 'original', side, style, ci };
}

describe('mergeLayers IDML 样式（§6.7 方案 A）', () => {
  it('fast path：无用户编辑 → style 原样保留', () => {
    const original: Segment[] = [
      seg('佛說', 'none', undefined, [{ start: 0, end: 2, font: 'FangSong' }]),
      seg('阿彌陀', 'none', undefined, [{ start: 0, end: 3, font: 'SourceHanSerifCN', warichu: true, warichuSize: 40 }]),
    ]
    const merged = mergeLayers(original, [])
    expect(merged[0].style?.[0]?.font).toBe('FangSong')
    expect(merged[1].style?.[0]?.warichu).toBe(true)
  })

  it('emitRange：text 切片后 style 同步裁剪', () => {
    const original: Segment[] = [
      seg('佛說阿彌陀經', 'none', undefined, [
        { start: 0, end: 2, font: 'FangSong' },
        { start: 2, end: 5, font: 'SourceHanSerifCN', warichu: true, warichuSize: 40 },
        { start: 5, end: 7, font: 'FangSong' },
      ]),
    ]
    // user 编辑切掉中间（模拟用户删除"阿彌"后重新插入）
    const user: Segment[] = [
      seg('佛說', 'none'),
      seg('阿彌', 'del', undefined, undefined, 1),
      seg('阿彌', 'add', undefined, undefined, 2),
      seg('陀經', 'none'),
    ]
    const merged = mergeLayers(original, user)
    // 未编辑区（none 段）的 style 被裁剪到切片范围
    const first = merged.find((s) => s.operation === 'none' && s.text === '佛說')
    const last = merged.find((s) => s.operation === 'none' && s.text === '陀經')
    expect(first?.style?.[0]?.start).toBe(0)
    expect(first?.style?.[0]?.end).toBe(2)
    // '陀經' 跨原样式边界（割注尾 + 正文首）→ 切片出 2 个区间
    expect(last?.style).toHaveLength(2)
    expect(last?.style?.[0]?.warichu).toBe(true)      // 段内 [0,1) 割注
    expect(last?.style?.[1]?.font).toBe('FangSong')   // 段内 [1,2) 正文
    expect(last?.style?.[1]?.start).toBe(1)
    expect(last?.style?.[1]?.end).toBe(2)
  })

  it('user 段继承前邻样式（编辑在割注内 → 新字成割注）', () => {
    const original: Segment[] = [
      seg('佛說阿彌陀經', 'none', undefined, [
        { start: 0, end: 2, font: 'FangSong' },
        { start: 2, end: 5, font: 'SourceHanSerifCN', warichu: true, warichuSize: 40 },
        { start: 5, end: 7, font: 'FangSong' },
      ]),
    ]
    // 用户在割注"阿彌陀"后插入新字
    const user: Segment[] = [
      seg('佛說阿彌陀', 'none'),
      seg('觀音', 'add', undefined, undefined, 1),
      seg('經', 'none'),
    ]
    const merged = mergeLayers(original, user)
    const added = merged.find((s) => s.operation === 'add')
    expect(added?.style).toBeDefined()
    // 继承前邻（割注段末尾）样式：warichu 标记延续，偏移重置为整段
    const st = added!.style![0]
    expect(st.warichu).toBe(true)
    expect(st.start).toBe(0)
    expect(st.end).toBe(added!.text.length)
  })

  it('非 IDML：user 段无继承（lastStyleProps 恒 null）', () => {
    const original: Segment[] = [seg('hello world', 'none')]
    const user: Segment[] = [
      seg('hello', 'none'),
      seg(' there', 'add', undefined, undefined, 1),
      seg(' world', 'none'),
    ]
    const merged = mergeLayers(original, user)
    const added = merged.find((s) => s.operation === 'add' && s.text === ' there')
    expect(added?.style).toBeUndefined()
  })
})

describe('导出 U+2029 转换（§5.7.1）', () => {
  const segs: Segment[] = [
    seg(`第一段${PARA_SEP}第二段`, 'none'),
    seg(`第三段${PARA_SEP}第四段`, 'add', undefined, undefined, 1),
  ]

  it('TXT：U+2029 → \\n', () => {
    const txt = exportToTXT(segs)
    expect(txt).toContain('第一段\n第二段')
    expect(txt).not.toContain(PARA_SEP)
  })

  it('MD：U+2029 → \\n（标记保留）', () => {
    const md = exportToMD(segs)
    expect(md).toContain('++第三段\n第四段++')
    expect(md).not.toContain(PARA_SEP)
  })

  it('HTML：U+2029 → br.para-break（§6.5）', () => {
    const html = exportToHTML(segs)
    expect(html).toContain('<br class="para-break">')
    expect(html).not.toContain(PARA_SEP)
  })

  it('HTML：IDML docMeta → 竖排容器', () => {
    const html = exportToHTML(segs, 't', { vertical: true, leadingRatio: 1.536 })
    expect(html).toContain('writing-mode:vertical-rl')
    expect(html).toContain('line-height:1.536')
  })
})
