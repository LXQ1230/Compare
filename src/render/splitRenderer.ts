/**
 * Splits segments into left (old) and right (new) columns for SplitView.
 */

import type { Segment } from '@/types';

export interface SplitResult {
  left: string;
  right: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderSplitColumns(segments: Segment[]): SplitResult {
  const leftParts: string[] = [];
  const rightParts: string[] = [];

  for (const s of segments) {
    const escText = esc(s.text);
    switch (s.operation) {
      case 'none':
        leftParts.push(`<span class="seg-none">${escText}</span>`);
        rightParts.push(`<span class="seg-none">${escText}</span>`);
        break;
      case 'add':
        leftParts.push('');
        rightParts.push(`<span class="seg-add">${escText}</span>`);
        break;
      case 'del':
        leftParts.push(`<span class="seg-del">${escText}</span>`);
        rightParts.push('');
        break;
      case 'mod':
        if (s.side === 'old') {
          leftParts.push(`<span class="seg-mod-old">${escText}</span>`);
          rightParts.push('');
        } else {
          leftParts.push('');
          rightParts.push(`<span class="seg-mod-new">${escText}</span>`);
        }
        break;
    }
  }

  return { left: leftParts.join(''), right: rightParts.join('') };
}
