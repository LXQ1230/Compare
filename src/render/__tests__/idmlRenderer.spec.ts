/**
 * IDML 排版级渲染单测（设计方案 §9 测试策略 4/5）。
 *
 * 覆盖：Warichu 割注折行（§6.3）、样式映射（§6.1）、竖排容器（§6.4）、
 * 段落分隔 U+2029（§6.5）、非 IDML 零影响（§4.2）。
 */

import { describe, it, expect } from 'vitest';
import {
  COL_CAPACITY_DEFAULT,
  PARA_SEP,
  getDocContainerStyle,
  renderSegmentsToHTML,
} from '@/render/segmentRenderer';
import { renderSplitColumns } from '@/render/splitRenderer';
import type { Segment, StyleRange } from '@/types';

function seg(text: string, style?: StyleRange[]): Segment {
  return { text, operation: 'none', origin: 'original', style };
}

describe('Warichu 折行（§6.3）', () => {
  it('24 字割注 → 2 组双列（7+7 / 7+3，COL_CAPACITY_DEFAULT=7）', () => {
    const text = '諸羅漢名本或用梵語或用華語今止酌列五尊者以例其余'
    const s = seg(text, [{
      start: 0, end: text.length, font: 'SourceHanSerifCN',
      sizePt: 28, warichu: true, warichuSize: 40,
    }])
    const html = renderSegmentsToHTML([s])
    // 24 字 → 每组 14 字 → 2 组（页5 实证 7+7；页6 的 5+5 受行高约束，为已知校准项）
    const pairs = html.match(/<span class="warichu-pair">/g)
    expect(pairs).toHaveLength(2)
    // 列内容切分：第一组 7+7，第二组 7+3（兜底容量 7）
    const cols = html.match(/<span class="warichu-col">([^<]*)<\/span>/g)!
    expect(cols[0]).toContain('諸羅漢名本或用')
    expect(cols[1]).toContain('梵語或用華語今')
    expect(cols[2]).toContain('止酌列五尊者以')
    expect(cols[3]).toContain('例其余')
  })

  it('割注字号 = sizePt × warichuSize/100（28×40% = 11.2pt）', () => {
    const text = '源'
    const s = seg(text, [{
      start: 0, end: 1, font: 'SourceHanSerifCN',
      sizePt: 28, warichu: true, warichuSize: 40,
    }])
    const html = renderSegmentsToHTML([s])
    expect(html).toContain('font-size:11.2pt')
    // 割注内容不含普通文本 span（避免嵌套样式覆盖字号）
    expect(html).not.toContain('font-size:28pt')
  })

  it('竖排标记 warichu-vertical / 横排 warichu-horizontal', () => {
    const text = '阿彌陀'
    const st = [{
      start: 0, end: 3, font: 'SourceHanSerifCN',
      sizePt: 28, warichu: true, warichuSize: 40,
    }] as StyleRange[]
    const v = renderSegmentsToHTML([seg(text, st)], undefined, { vertical: true })
    expect(v).toContain('warichu warichu-vertical')
    const h = renderSegmentsToHTML([seg(text, st)], undefined, { vertical: false })
    expect(h).toContain('warichu warichu-horizontal')
  })

  it('割注内段落分隔（罕见）：分段折行 + 段落标记', () => {
    const text = `阿彌陀${PARA_SEP}觀音`
    const s = seg(text, [{
      start: 0, end: text.length, font: 'SourceHanSerifCN',
      sizePt: 28, warichu: true, warichuSize: 40,
    }])
    const html = renderSegmentsToHTML([s])
    expect(html).toContain('class="para-break"')
  })
})

describe('字符样式映射（§6.1）', () => {
  it('font/size/bold/baselineShift → CSS（color 不输出，2026-08-06）', () => {
    const s = seg('AB', [{
      start: 0, end: 1,
      font: 'FangSong', sizePt: 20, bold: true, color: '#C00000',
    }])
    const html = renderSegmentsToHTML([s])
    expect(html).toContain("font-family:'FangSong',serif")
    expect(html).toContain('font-size:20pt')
    expect(html).toContain('font-weight:700')
    // color 不输出为行内 CSS——IDML 校勘色不覆盖 diff 高亮色
    expect(html).not.toContain('color:#C00000')
  })

  it('baselineShift -9.2 → top:9.2pt（悬挂句号，§6.1）', () => {
    const s = seg('。', [{
      start: 0, end: 1, baselineShift: -9.2,
    }])
    const html = renderSegmentsToHTML([s])
    expect(html).toContain('top:9.2pt')
  })

  it('style 区间切分：段内偏移正确', () => {
    const s = seg('佛說阿彌陀經', [
      { start: 0, end: 2, font: 'FangSong' },
      { start: 2, end: 5, font: 'SourceHanSerifCN', warichu: true, warichuSize: 40 },
      { start: 5, end: 6, font: 'FangSong' },
    ])
    const html = renderSegmentsToHTML([s])
    // 割注区间 [2,5) 只包含"阿彌陀"
    expect(html).toContain('warichu-col">阿彌陀<')
    expect(html).toContain("font-family:'FangSong',serif")
  })
})

describe('段落分隔 U+2029（§6.5）', () => {
  it('U+2029 → br.para-break', () => {
    const s = seg(`第一段${PARA_SEP}第二段`)
    const html = renderSegmentsToHTML([s])
    expect(html).toContain('<br class="para-break">')
    expect(html).not.toContain(PARA_SEP)
  })
})

describe('非 IDML 零影响（§4.2）', () => {
  it('无 style 段：不产生额外样式 span，输出与原逻辑一致', () => {
    const s = seg('普通文本')
    const html = renderSegmentsToHTML([s])
    expect(html).toBe('<span class="seg-none">普通文本</span>')
  })

  it('无 docMeta：getDocContainerStyle 返回空串', () => {
    expect(getDocContainerStyle(undefined)).toBe('')
    expect(getDocContainerStyle(null)).toBe('')
    expect(getDocContainerStyle({})).toBe('')
  })
})

describe('样式边界标点剥离（2026-08-05 竖排重叠修复）', () => {
  it('普通 style span 尾部标点移出（裸文本，不留在 span 边界）', () => {
    const s = seg('如是我聞。', [{ start: 0, end: 5, font: 'SourceHanSerifCN' }])
    const html = renderSegmentsToHTML([s])
    expect(html).toContain("font-family:'SourceHanSerifCN',serif\">如是我聞</span>。")
  })

  it('纯标点 span（无特殊样式）→ 整段丢弃为裸文本', () => {
    const s = seg('。', [{ start: 0, end: 1, font: 'SourceHanSerifCN' }])
    const html = renderSegmentsToHTML([s])
    expect(html).not.toContain('font-family')
    expect(html).toContain('>。</span>')
  })

  it('style 切分在标点处：标点不留在任一 span 边界', () => {
    // 佛(0)說(1)阿(2)彌(3)陀(4)經(5)。(6)
    const s = seg('佛說阿彌陀經。', [
      { start: 0, end: 2, font: 'FangSong' },
      { start: 2, end: 6, font: 'SourceHanSerifCN', warichu: true, warichuSize: 40 },
      { start: 6, end: 7, font: 'FangSong' }, // 纯标点 span → 剥离
    ])
    const html = renderSegmentsToHTML([s])
    expect(html).toContain("font-family:'FangSong',serif\">佛說</span>")
    expect(html).toContain('warichu-col">阿彌陀經<')
    expect(html).toContain('>。</span>')
  })

  it('warichu span 不参与剥离（双列折行是整体排版单元）', () => {
    const text = '此八字。依漢吳二譯增'
    const s = seg(text, [{
      start: 0, end: text.length, font: 'SourceHanSerifCN',
      warichu: true, warichuSize: 40,
    }])
    const html = renderSegmentsToHTML([s])
    expect(html).toContain('warichu-col')
  })

  it('baselineShift 标点 span 保留（悬挂句号样式不丢）', () => {
    const s = seg('。', [{ start: 0, end: 1, baselineShift: -9.2 }])
    const html = renderSegmentsToHTML([s])
    expect(html).toContain('top:9.2pt')
  })

  it('color 标点 span 不输出行内 color（2026-08-06：diff 高亮优先）', () => {
    const s = seg('。', [{ start: 0, end: 1, color: '#C00000' }])
    const html = renderSegmentsToHTML([s])
    // color 不再输出为行内 CSS，diff 高亮色（seg-none 等）优先
    expect(html).not.toContain('color:#C00000')
    expect(html).toContain('seg-none')
  })
})

describe('竖排容器样式（§6.4）', () => {
  it('vertical + leadingRatio → writing-mode + line-height', () => {
    const css = getDocContainerStyle({ vertical: true, leadingRatio: 1.536 })
    expect(css).toContain('writing-mode:vertical-rl')
    expect(css).toContain('line-height:1.536')
  })

  it('IDML 容器注入正文字号 28pt（2026-08-05：15px 触发竖排标点 bug）', () => {
    const css = getDocContainerStyle({ vertical: true, leadingRatio: 1.536 })
    expect(css).toContain('font-size:28pt')
    // 横排 IDML 同样注入（meta 存在即 IDML）
    const h = getDocContainerStyle({ vertical: false, leadingRatio: 1.5 })
    expect(h).toContain('font-size:28pt')
  })
})

describe('SplitView 侧列渲染（§6.1）', () => {
  it('left 取 A 侧文本，right 取 B 侧文本，样式双侧保留', () => {
    const styleA = [{ start: 0, end: 3, font: 'FangSong' }] as StyleRange[]
    const segments: Segment[] = [
      { text: '佛說', operation: 'none', origin: 'original', style: [{ start: 0, end: 2, font: 'FangSong' }] },
      { text: '四', operation: 'mod', origin: 'original', side: 'old', ci: 1, style: styleA },
      { text: '五', operation: 'mod', origin: 'original', side: 'new', ci: 1, style: [{ start: 0, end: 1, font: 'SourceHanSerifCN', bold: true }] },
    ]
    const { left, right } = renderSplitColumns(segments)
    expect(left).toContain('佛說')
    expect(left).toContain('四')
    expect(right).toContain('佛說')
    expect(right).toContain('五')
    expect(right).toContain('font-weight:700')
  })
})
