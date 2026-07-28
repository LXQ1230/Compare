/**
 * Renders diff segments to HTML with CSS classes for each operation type.
 * All user content is HTML-escaped before insertion.
 */

import type { Segment } from '@/types';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function segmentClass(s: Segment): string {
  if (s.origin === 'user') {
    return s.operation === 'add' ? 'seg-user-add' : 'seg-user-del';
  }
  switch (s.operation) {
    case 'add': return 'seg-add';
    case 'del': return 'seg-del';
    case 'mod': return s.side === 'old' ? 'seg-mod-old' : 'seg-mod-new';
    default: return 'seg-none';
  }
}

export function renderSegmentsToHTML(segments: Segment[]): string {
  const parts: string[] = [];
  for (const s of segments) {
    parts.push(`<span class="${segmentClass(s)}">${esc(s.text)}</span>`);
  }
  return parts.join('');
}

export function segmentsToText(segments: Segment[]): string {
  return segments.map((s) => s.text).join('');
}
