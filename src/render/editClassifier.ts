/**
 * Character-level edit classifier using google-diff-match-patch.
 *
 * Mirrors the backend diff_engine.py logic so the live editing preview
 * shows fine-grained add/del/mod segments — not a single monolithic
 * changed region.
 */

import type { Segment, StyleRange } from '@/types';
import { diffSafely, normalizeText } from './unicode';

export interface EditResult {
  /** True when the edited text differs from the baseline at all. */
  dirty: boolean;
  /** Replacement segments for the entire document. */
  segments: Segment[];
}

/** A segment that exists only in the baseline (del / mod-old) — absent from the new document. */
export function isPhantomSegment(s: Segment): boolean {
  return s.operation === 'del' || (s.operation === 'mod' && s.side === 'old');
}

/** Build the new-document text: concatenate segments, dropping phantom ones. */
export function buildDocText(segs: Segment[]): string {
  return segs.filter((s) => !isPhantomSegment(s)).map((s) => s.text).join('');
}

/**
 * 从原始 diff segments 重建原版 A 文本（A = none + del + mod-old 按序拼接）。
 * 与 restoreDetector.ts 原实现同逻辑，统一在此导出（方案 P1-1b）。
 */
export function buildOriginalText(segs: Segment[]): string {
  return segs
    .filter((s) => s.operation === 'none' || s.operation === 'del' || (s.operation === 'mod' && s.side === 'old'))
    .map((s) => s.text)
    .join('');
}

/**
 * 计算每个 segment 在编辑文档（doc）中的起始偏移（方案 P2-2/P2-4）。
 * phantom 段（del/mod-old）不占 doc 空间——与 buildSearchDecos 的累计逻辑
 * 完全一致，是搜索高亮与跳转共用的唯一偏移基准。
 */
export function docOffsetsOf(segs: Segment[]): number[] {
  const offsets: number[] = [];
  let pos = 0;
  for (const s of segs) {
    offsets.push(pos);
    if (!isPhantomSegment(s)) pos += s.text.length;
  }
  return offsets;
}

/**
 * 从原始 diff segments 提取「编辑基线」（= B 侧文本）的全文偏移样式区间
 * （方案 §6.6 链路 2：draft.baselineStyle，随 baseline 同生命周期存储）。
 * 遍历参与 doc 的段（非 phantom），把段内 style 偏移平移到全文偏移。
 * 非 IDML（无 style）返回空数组——草稿体积零开销。
 */
export function buildBaselineStyles(segs: Segment[]): StyleRange[] {
  const out: StyleRange[] = [];
  let pos = 0;
  for (const s of segs) {
    if (!isPhantomSegment(s)) {
      if (s.style && s.style.length > 0) {
        for (const sp of s.style) {
          out.push({ ...sp, start: pos + sp.start, end: pos + sp.end });
        }
      }
      pos += s.text.length;
    }
  }
  return out;
}

/**
 * 从原始 diff segments 提取指定侧的全文偏移样式区间（方案 §6.6 链路 1：
 * 版本历史的 styleA/styleB）。A 侧段 = none/del/mod-old（buildOriginalText）；
 * B 侧段 = none/add/mod-new（buildDocText）。非 IDML 返回空数组。
 */
export function buildSideStyles(segs: Segment[], side: 'a' | 'b'): StyleRange[] {
  const out: StyleRange[] = [];
  let pos = 0;
  for (const s of segs) {
    const takeA = s.operation === 'none' || s.operation === 'del'
      || (s.operation === 'mod' && s.side === 'old');
    const takeB = s.operation === 'none' || s.operation === 'add'
      || (s.operation === 'mod' && s.side === 'new');
    if (side === 'a' ? takeA : takeB) {
      if (s.style && s.style.length > 0) {
        for (const sp of s.style) {
          out.push({ ...sp, start: pos + sp.start, end: pos + sp.end });
        }
      }
      pos += s.text.length;
    }
  }
  return out;
}

/**
 * 兼容导出：完整规范化（BOM + LF + NFC）——三期 B 组（4-5）统一走 unicode.ts。
 * 语义较旧 normalizeLineEndings 更全，供初始化路径（enterEdit/ensureEditor）使用。
 */
export { normalizeLineEndings, normalizeText } from './unicode';

/**
 * Diff `baseline` against `edited` at character level and produce
 * user-origin segments suitable for `renderSegmentsToHTML`.
 *
 * Rev. 4-4: diff 走 diffSafely（surrogate 保护）。输入即输出——不做运行时
 * NFC/全角归一（初始化已统一，见 unicode.ts 一致性约定）。
 */
export function classifyEdit(baseline: string, edited: string): EditResult {
  if (baseline === edited) {
    return { dirty: false, segments: [] };
  }

  const rawDiffs = diffSafely(baseline, edited);

  const segments: Segment[] = [];
  let ci = 0;
  let i = 0;

  while (i < rawDiffs.length) {
    const [op, text] = rawDiffs[i];

    if (op === 0) {
      // EQUAL
      segments.push({ text, operation: 'none', origin: 'user' });
      i++;
      continue;
    }

    if (op === 1) {
      // INSERT — may pair with a following DELETE as a mod
      if (i + 1 < rawDiffs.length && rawDiffs[i + 1][0] === -1) {
        const addText = text;
        const delText = rawDiffs[i + 1][1];
        ci++;
        segments.push({
          text: delText, operation: 'mod', origin: 'user',
          side: 'old', ci,
        });
        segments.push({
          text: addText, operation: 'mod', origin: 'user',
          side: 'new', ci,
        });
        i += 2;
        continue;
      }
      ci++;
      segments.push({ text, operation: 'add', origin: 'user', ci });
      i++;
      continue;
    }

    // DELETE (op === -1)
    if (i + 1 < rawDiffs.length && rawDiffs[i + 1][0] === 1) {
      const delText = text;
      const addText = rawDiffs[i + 1][1];
      ci++;
      segments.push({
        text: delText, operation: 'mod', origin: 'user',
        side: 'old', ci,
      });
      segments.push({
        text: addText, operation: 'mod', origin: 'user',
        side: 'new', ci,
      });
      i += 2;
      continue;
    }
    ci++;
    segments.push({ text, operation: 'del', origin: 'user', ci });
    i++;
    continue;
  }

  return { dirty: true, segments };
}
