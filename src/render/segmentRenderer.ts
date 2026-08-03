/**
 * Renders diff segments to HTML with CSS classes for each operation type.
 * All user content is HTML-escaped before insertion.
 *
 * Each non-"none" segment with a change index wraps in a <mark> with
 * data-ci and id so the sidebar change-list can scroll to it directly.
 *
 * When `searchMatches` is provided, matched substrings are wrapped in
 * `<mark class="seg-search-hl">` tags inside the segment text.
 */

import type { SearchMatch } from '../utils/search';
import type { Segment } from '@/types';


function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function segmentClass(s: Segment): string {
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

/** Escape and inject <mark class="seg-search-hl"> for highlight ranges. */
function escWithHighlights(
  text: string,
  ranges: Array<{ start: number; end: number }>,
): string {
  let out = '';
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) out += esc(text.slice(pos, r.start));
    out += `<mark class="seg-search-hl">${esc(text.slice(r.start, r.end))}</mark>`;
    pos = r.end;
  }
  if (pos < text.length) out += esc(text.slice(pos));
  return out;
}

/**
 * Build a Map<segmentIndex, merged highlight ranges> from SearchMatch[].
 * Overlapping/adjacent ranges are merged so nested <mark> tags are avoided.
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
    const merged: typeof ranges = [];
    for (const r of ranges) {
      const prev = merged[merged.length - 1];
      if (prev && r.start <= prev.end) {
        prev.end = Math.max(prev.end, r.end);
      } else {
        merged.push({ start: r.start, end: r.end });
      }
    }
    ranges.length = 0;
    ranges.push(...merged);
  }
  return bySegment;
}

export function renderSegmentsToHTML(
  segments: Segment[],
  searchMatches?: SearchMatch[],
): string {
  const hl = searchMatches ? buildHighlightMap(searchMatches) : new Map();
  const parts: string[] = [];
  for (let si = 0; si < segments.length; si++) {
    const s = segments[si];
    const ranges = hl.get(si);
    const html = ranges?.length
      ? escWithHighlights(s.text, ranges)
      : esc(s.text);
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
