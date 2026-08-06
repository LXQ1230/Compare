/**
 * Renders diff segments to HTML with CSS classes for each operation type.
 * All user content is HTML-escaped before insertion.
 *
 * Each non-"none" segment with a change index wraps in a <mark> with
 * data-ci and id so the sidebar change-list can scroll to it directly.
 *
 * When `searchMatches` is provided, matched substrings are wrapped in
 * `<mark class="seg-search-hl">` tags inside the segment text.
 *
 * IDML 排版级呈现（方案 docs/IDML支持设计方案-2026-08-05.md）：
 *  - Segment.style（StyleRange[]，可选）→ 字符级 font/size/bold/color/baselineShift
 *  - Warichu 割注（§6.3）→ 双列小字折行（列容量 COL_CAPACITY_DEFAULT=7，锚点校准）
 *  - U+2029 段落分隔符（§6.5）→ <br class="para-break">（竖排=另起一列/横排=换行）
 *  - 竖排容器样式由 getDocContainerStyle() 提供（视图层应用，§6.4）
 *  - 非 IDML（无 style / 无 docMeta）→ 行为与原先完全一致（零开销）
 */

import type { SearchMatch } from '../utils/search';
import type { DocMeta, Segment, StyleRange } from '@/types';

/** 段落分隔符（后端 idml_parser.PARA_SEP，方案 §5.7.1） */
export const PARA_SEP = '\u2029'

/** 割注列容量兜底常量（§6.3：页5=7 字锚点；页6=5 受行高约束，本期效果级近似） */
export const COL_CAPACITY_DEFAULT = 7

export interface RenderOptions {
  /** 竖排文档（IDML StoryOrientation="Vertical"，§6.4） */
  vertical?: boolean
}

function esc(s: string): string {
  // Rev. F1: escape single quotes, C0 control chars (except \n and \t which
  // are meaningful in pre-wrap HTML), and zero-width/invisible Unicode ranges
  // so they can never break out of attribute contexts.
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (c) => `&#${c.charCodeAt(0)};`)
    .replace(/[\u2000-\u200f]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function segmentClass(s: Segment): string {
  // 三期 A 组：恢复段统一绿色（已回到原文）
  if (s.origin === 'restored') return 'seg-user-restored';
  if (s.origin === 'user') {
    if (s.operation === 'add') return 'seg-user-add';
    if (s.operation === 'del') return 'seg-user-del';
    if (s.operation === 'mod') return s.side === 'old' ? 'seg-user-mod-old' : 'seg-user-mod-new';
    return 'seg-none';
  }
  switch (s.operation) {
    case 'add':
      return 'seg-add';
    case 'del':
      return 'seg-del';
    case 'mod':
      return s.side === 'old' ? 'seg-mod-old' : 'seg-mod-new';
    default:
      return 'seg-none';
  }
}

/**
 * Escape and inject <mark class="seg-search-hl" data-offset="N"> for highlight ranges.
 * data-offset carries the match's textOffset within the segment, so search
 * navigation can locate the exact <mark> without fragile cumulative-offset
 * arithmetic. Multiple matches in one segment produce multiple <mark> elements
 * (no merging) — this is safe because matches from regex search are
 * non-overlapping by construction (exec advances lastIndex past each match).
 */
function escWithHighlights(
  text: string,
  ranges: Array<{ start: number; end: number }>,
): string {
  let out = '';
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) out += esc(text.slice(pos, r.start));
    out += `<mark class="seg-search-hl" data-offset="${r.start}">${esc(text.slice(r.start, r.end))}</mark>`;
    pos = r.end;
  }
  if (pos < text.length) out += esc(text.slice(pos));
  return out;
}

/**
 * Build a Map<segmentIndex, highlight ranges> from SearchMatch[].
 * Ranges are sorted by start offset but NOT merged — each range keeps its
 * original start so the rendered <mark data-offset="N"> can be located
 * by the search navigation logic. Overlapping ranges are extremely rare
 * (only from zero-width regex like `a*`); if they occur, the browser
 * renders nested marks, which is visually harmless.
 */
function buildHighlightMap(
  matches: SearchMatch[],
): Map<number, Array<{ start: number; end: number }>> {
  const bySegment = new Map<number, Array<{ start: number; end: number }>>();
  for (const m of matches) {
    const ranges = bySegment.get(m.segmentIndex) ?? [];
    ranges.push({ start: m.textOffset, end: m.textOffset + m.length });
    bySegment.set(m.segmentIndex, ranges);
  }
  for (const ranges of bySegment.values()) {
    ranges.sort((a, b) => a.start - b.start);
  }
  return bySegment;
}

// ── IDML 排版渲染（方案 §6.1/§6.3/§6.5）──────────────────────────

/** 标点字符集（与 unicode.ts PUNCT_CHARS / 后端 _PUNCT_CHARS 对齐）。 */
const PUNCT_RE = /[。！？；：，、…—～「」『』（）《》〈〉【】〔〕｛｝·,.;:!?…~"'()\[\]{}]/;

function isPunctChar(ch: string): boolean {
  return PUNCT_RE.test(ch);
}

/** U+2029 → 段落级换行标记（§6.5：不依赖 white-space:pre-wrap 默认行为）。 */
function paraBreaks(text: string): string {
  return text.split(PARA_SEP).join('<br class="para-break">');
}

/**
 * 样式边界标点剥离（2026-08-05 竖排重叠根因修复，§6.1 增补）：
 *
 * 实证：竖排（vertical-rl）+ 小字号下，Chrome 对「位于元素边界」的 U+3002（。）等
 * 标点的行高 advance 计算错误（≈4px，正常 1em），导致标点与后字重叠 12px
 * （275 文件 183/191 处）。标点位于裸文本节点（无 style span 包裹）时正常。
 *
 * 规则：对「无特殊样式」的 style 区间（仅 font 或全默认），把头部/尾部标点
 * 移出区间（渲染为裸文本），消除「标点在 span 边界」的触发条件。
 * 保留区间：warichu（双列折行是整体排版单元）、bold/color/sizePt/baselineShift
 * （标点携带真实语义样式，如校勘红/悬挂，不可丢弃——真实 IDML 中此类标点极少，
 * 潜在重叠量小）。
 */
function resolveStyleBoundaries(text: string, style: StyleRange[]): StyleRange[] {
  if (!style || style.length === 0) return style;
  // sp.color 不计入 hasSpecialStyle：IDML 校勘标注色（如 #D90000 句号）
  // 不输出为行内 color，使 diff 高亮色（seg-del/seg-mod-old 等）优先。
  const hasSpecialStyle = (sp: StyleRange): boolean =>
    !!(sp.bold || sp.sizePt || sp.baselineShift || sp.warichu);
  const out: StyleRange[] = [];
  for (const sp of style) {
    if (hasSpecialStyle(sp)) {
      out.push(sp);
      continue;
    }
    let s = sp.start;
    let e = sp.end;
    while (s < e && isPunctChar(text[s])) s++;
    while (e > s && isPunctChar(text[e - 1])) e--;
    if (e > s) out.push({ ...sp, start: s, end: e });
  }
  return out;
}

/** 字符样式 → CSS（§6.1；baselineShift -9.2 → top:9.2pt 悬挂）。
 *  sp.color 不输出：IDML 校勘标注色（如 #D90000）不应覆盖 diff 高亮色。 */
function styleCss(sp: StyleRange): string {
  const parts: string[] = [];
  if (sp.font) parts.push(`font-family:'${sp.font}',serif`);
  if (sp.sizePt) parts.push(`font-size:${sp.sizePt}pt`);
  if (sp.bold) parts.push('font-weight:700');
  if (sp.baselineShift) parts.push(`position:relative;top:${-sp.baselineShift}pt`);
  return parts.join(';');
}

/**
 * Warichu 割注折行（§6.3，实证驱动）：
 * 割注字号 = sizePt × warichuSize/100；每列容量 floor(行高/割注字号)，
 * 本期用兜底常量 7（页5=7 锚点），页6=5 的差异留待更多 PDF 样例校准。
 * 竖排：右列 + 左列一组；溢出开新列组（跨行续排）。横排：列转横向行上下叠放。
 */
function renderWarichu(
  text: string,
  sizePt: number,
  warichuSize: number,
  vertical: boolean,
): string {
  const fs = sizePt * warichuSize / 100
  const colCap = COL_CAPACITY_DEFAULT
  // 割注内段落边界（罕见）：分段折行，段间段落标记
  const groups: string[] = []
  const paras = text.split(PARA_SEP)
  paras.forEach((para, pi) => {
    if (pi > 0) groups.push('<br class="para-break">')
    let rest = para
    while (rest.length > 0) {
      const col1 = rest.slice(0, colCap)
      const col2 = rest.slice(colCap, colCap * 2)
      groups.push(
        `<span class="warichu-pair"><span class="warichu-col">${esc(col1)}</span>` +
        (col2 ? `<span class="warichu-col">${esc(col2)}</span>` : '') +
        '</span>',
      )
      rest = rest.slice(colCap * 2)
    }
  })
  return `<span class="warichu${vertical ? ' warichu-vertical' : ' warichu-horizontal'}" style="font-size:${fs}pt">${groups.join('')}</span>`
}

/**
 * 渲染一段带样式的文本（style 区间切分 + Warichu + 搜索高亮 + 段落标记）。
 * ranges 为 segment 全文偏移的搜索高亮；style 为 segment 内偏移（§4.2）。
 */
export function renderStyledText(
  text: string,
  style: StyleRange[] | undefined,
  ranges: Array<{ start: number; end: number }> | undefined,
  vertical: boolean,
): string {
  if (!style || style.length === 0) {
    // 非 IDML 或样式全默认：原逻辑 + 段落标记
    const html = ranges?.length ? escWithHighlights(text, ranges) : esc(text)
    return paraBreaks(html)
  }

  // 2026-08-05：竖排标点重叠根因修复——标点不留在普通 style span 边界
  const styleAdj = resolveStyleBoundaries(text, style)

  const out: string[] = []
  let pos = 0
  const emit = (sp: StyleRange | null, s: number, e: number) => {
    if (e <= s) return
    const segText = text.slice(s, e)
    // 搜索高亮裁剪到本段（相对偏移）
    const subRanges = ranges
      ? ranges
          .filter((r) => r.start < e && r.end > s)
          .map((r) => ({ start: Math.max(r.start, s) - s, end: Math.min(r.end, e) - s }))
      : undefined
    let inner = paraBreaks(
      subRanges?.length ? escWithHighlights(segText, subRanges) : esc(segText),
    )
    if (sp?.warichu) {
      inner = renderWarichu(segText, sp.sizePt ?? 28, sp.warichuSize ?? 40, vertical)
    } else if (sp) {
      const css = styleCss(sp)
      inner = `<span style="${css}">${inner}</span>`
    }
    out.push(inner)
  }

  for (const sp of styleAdj) {
    if (sp.start > pos) emit(null, pos, sp.start)
    emit(sp, sp.start, sp.end)
    pos = sp.end
  }
  if (pos < text.length) emit(null, pos, text.length)
  return out.join('')
}

export function renderSegmentsToHTML(
  segments: Segment[],
  searchMatches?: SearchMatch[],
  opts?: RenderOptions,
): string {
  const hl = searchMatches ? buildHighlightMap(searchMatches) : new Map();
  const vertical = opts?.vertical ?? false
  const parts: string[] = [];
  for (let si = 0; si < segments.length; si++) {
    const s = segments[si];
    const ranges = hl.get(si);
    const html = renderStyledText(s.text, s.style, ranges, vertical);
    if (s.operation === 'none' || s.ci == null) {
      parts.push(`<span class="${segmentClass(s)}">${html}</span>`);
    } else {
      parts.push(
        `<mark class="${segmentClass(s)}" data-ci="${s.ci}" id="ci-${s.ci}">${html}</mark>`,
      );
    }
  }
  return parts.join('');
}

export function segmentsToText(segments: Segment[]): string {
  return segments.map((s) => s.text).join('');
}

/**
 * 文档级排版容器样式（§6.4/§5.3）——由视图层应用到对比容器：
 *   - 竖排：writing-mode: vertical-rl（StoryDirection=LeftToRightDirection）
 *   - 行高：line-height = Leading 系数（43/28≈1.536）
 *   - 正文字号：IDML 默认 PointSize=28pt（§5.2 瘦身省略 → 容器级兜底；
 *     2026-08-05：15px 小字号会触发 Chrome 竖排标点 advance bug，且偏离原排版）
 * 非 IDML 返回空串（不影响现有样式）。
 */
export function getDocContainerStyle(meta: DocMeta | null | undefined): string {
  // 空对象视为无 meta（非 IDML）：不注入任何容器样式
  if (!meta || Object.keys(meta).length === 0) return ''
  const parts: string[] = []
  if (meta.vertical) parts.push('writing-mode:vertical-rl')
  if (meta.leadingRatio) parts.push(`line-height:${meta.leadingRatio}`)
  parts.push('font-size:28pt')
  return parts.join(';')
}
