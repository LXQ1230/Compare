/**
 * Character-level edit classifier using google-diff-match-patch.
 *
 * Mirrors the backend diff_engine.py logic so the live editing preview
 * shows fine-grained add/del/mod segments — not a single monolithic
 * changed region.
 */

import type { Segment } from '@/types';
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
