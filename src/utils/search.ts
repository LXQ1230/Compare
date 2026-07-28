/**
 * Client-side search over diff segments.
 */

import type { Segment } from '@/types';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

export interface SearchMatch {
  segmentIndex: number;
  textOffset: number;
  length: number;
  preview: string;
}

export function searchInSegments(
  segments: Segment[],
  query: string,
  options: SearchOptions,
): SearchMatch[] {
  if (!query) return [];

  const matches: SearchMatch[] = [];
  let pattern: RegExp;

  try {
    let source = options.useRegex ? query : escapeRegex(query);
    if (options.wholeWord) {
      source = `\\b${source}\\b`;
    }
    pattern = new RegExp(source, options.caseSensitive ? 'g' : 'gi');
  } catch {
    return [];
  }

  for (let i = 0; i < segments.length; i++) {
    const text = segments[i].text;
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(text)) !== null) {
      const start = match.index;
      const len = match[0].length;
      const ctxBefore = Math.max(0, start - 20);
      const ctxAfter = Math.min(text.length, start + len + 20);
      matches.push({
        segmentIndex: i,
        textOffset: start,
        length: len,
        preview: text.slice(ctxBefore, ctxAfter),
      });
      if (len === 0) pattern.lastIndex = start + 1;
    }
  }

  return matches;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
