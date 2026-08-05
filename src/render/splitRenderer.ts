/**
 * Splits segments into left (old) and right (new) columns for SplitView.
 *
 * IDML 排版级呈现（方案 §6.1/§6.3/§6.5）：
 *  - left 列取 A 侧样式（none/del/mod-old 段 style 为 A 侧附着）
 *  - right 列取段 style（none 段为 A 侧——§6.1 归属规则；add/mod-new 为 B 侧）
 *  - Warichu 割注双列折行 / U+2029 段落标记 / 竖排结构
 */

import type { Segment } from '@/types';
import { renderStyledText, type RenderOptions } from './segmentRenderer';

export interface SplitResult {
  left: string;
  right: string;
}

export function renderSplitColumns(segments: Segment[], opts?: RenderOptions): SplitResult {
  const leftParts: string[] = [];
  const rightParts: string[] = [];
  const vertical = opts?.vertical ?? false;

  for (const s of segments) {
    const take = {
      left: s.operation === 'none' || s.operation === 'del' ||
        (s.operation === 'mod' && s.side === 'old'),
      right: s.operation === 'none' || s.operation === 'add' ||
        (s.operation === 'mod' && s.side === 'new'),
    };
    const leftHtml = take.left
      ? `<span class="${segClass(s)}">${renderStyledText(s.text, s.style, undefined, vertical)}</span>`
      : '';
    const rightHtml = take.right
      ? `<span class="${segClass(s)}">${renderStyledText(s.text, s.style, undefined, vertical)}</span>`
      : '';
    leftParts.push(leftHtml);
    rightParts.push(rightHtml);
  }

  return { left: leftParts.join(''), right: rightParts.join('') };
}

function segClass(s: Segment): string {
  if (s.origin === 'user') {
    if (s.operation === 'add') return 'seg-user-add';
    if (s.operation === 'del') return 'seg-user-del';
    if (s.operation === 'mod') return s.side === 'old' ? 'seg-user-mod-old' : 'seg-user-mod-new';
    return 'seg-none';
  }
  switch (s.operation) {
    case 'add': return 'seg-add';
    case 'del': return 'seg-del';
    case 'mod': return s.side === 'old' ? 'seg-mod-old' : 'seg-mod-new';
    default: return 'seg-none';
  }
}
