import { describe, it, expect } from 'vitest';
import { renderSegmentsToHTML, segmentsToText } from '@/render/segmentRenderer';
import { renderSplitColumns } from '@/render/splitRenderer';
import { searchInSegments } from '@/utils/search';
import { exportToTXT, exportToHTML, exportToMD } from '@/export/exporters';
import type { Segment } from '@/types';

function seg(
  text: string,
  operation: Segment['operation'],
  side?: 'old' | 'new',
  ci?: number,
  origin: Segment['origin'] = 'original',
): Segment {
  return { text, operation, origin, side, ci };
}

describe('segmentRenderer', () => {
  it('escapes HTML in segment text', () => {
    const html = renderSegmentsToHTML([seg('<script>alert(1)</script>', 'none')]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('maps operation to CSS class', () => {
    expect(renderSegmentsToHTML([seg('added', 'add')])).toContain('seg-add');
    expect(renderSegmentsToHTML([seg('removed', 'del')])).toContain('seg-del');
    expect(renderSegmentsToHTML([seg('old', 'mod', 'old')])).toContain('seg-mod-old');
    expect(renderSegmentsToHTML([seg('new', 'mod', 'new')])).toContain('seg-mod-new');
  });

  it('maps user-origin segments', () => {
    expect(renderSegmentsToHTML([seg('x', 'add', undefined, undefined, 'user')])).toContain('seg-user-add');
    expect(renderSegmentsToHTML([seg('x', 'del', undefined, undefined, 'user')])).toContain('seg-user-del');
  });

  it('segmentsToText joins all text', () => {
    expect(segmentsToText([seg('hello ', 'none'), seg('world', 'add')])).toBe('hello world');
  });

  it('segmentClass for none returns seg-none', () => {
    const html = renderSegmentsToHTML([seg('plain text', 'none')]);
    expect(html).toContain('seg-none');
  });
});

describe('splitRenderer', () => {
  it('splits add/del into separate columns', () => {
    const { left, right } = renderSplitColumns([
      seg('original', 'none'),
      seg('added', 'add'),
      seg('deleted', 'del'),
    ]);
    expect(left).toContain('seg-none');
    expect(right).toContain('seg-none');
    expect(right).toContain('seg-add');
    expect(left).not.toContain('seg-add');
    expect(left).toContain('seg-del');
    expect(right).not.toContain('seg-del');
  });

  it('handles mod old/new placement', () => {
    const { left, right } = renderSplitColumns([
      seg('was this', 'mod', 'old'),
      seg('is this', 'mod', 'new'),
    ]);
    expect(left).toContain('seg-mod-old');
    expect(right).toContain('seg-mod-new');
    expect(left).not.toContain('seg-mod-new');
    expect(right).not.toContain('seg-mod-old');
  });

  it('returns empty when given empty segments', () => {
    const { left, right } = renderSplitColumns([]);
    expect(left).toBe('');
    expect(right).toBe('');
  });
});

describe('search', () => {
  const segments: Segment[] = [
    seg('hello world', 'none'),
    seg('abc test xyz', 'add'),
  ];

  it('finds matches case-insensitive by default', () => {
    const r = searchInSegments(segments, 'hello', { caseSensitive: false, wholeWord: false, useRegex: false });
    expect(r).toHaveLength(1);
    expect(r[0].segmentIndex).toBe(0);
  });

  it('respects case sensitivity', () => {
    expect(searchInSegments(segments, 'ABC', { caseSensitive: true, wholeWord: false, useRegex: false })).toHaveLength(0);
  });

  it('supports whole word matching', () => {
    expect(searchInSegments(segments, 'test', { caseSensitive: false, wholeWord: true, useRegex: false })).toHaveLength(1);
  });

  it('supports regex mode', () => {
    expect(searchInSegments(segments, 'h.*o', { caseSensitive: false, wholeWord: false, useRegex: true })).toHaveLength(1);
  });

  it('returns empty for empty query', () => {
    expect(searchInSegments(segments, '', { caseSensitive: false, wholeWord: false, useRegex: false })).toHaveLength(0);
  });

  it('handles invalid regex gracefully', () => {
    expect(searchInSegments(segments, '[invalid', { caseSensitive: false, wholeWord: false, useRegex: true })).toHaveLength(0);
  });
});

describe('exporters', () => {
  const segments: Segment[] = [
    seg('normal ', 'none'),
    seg('added', 'add'),
    seg(' ', 'none'),
    seg('deleted', 'del'),
    seg(' ', 'none'),
    seg('changed', 'mod', 'new'),
  ];

  it('exportToTXT returns plain text', () => {
    expect(exportToTXT(segments)).toBe('normal added deleted changed');
  });

  it('exportToHTML contains DOCTYPE and markup', () => {
    const html = exportToHTML(segments);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<ins>');
    expect(html).toContain('<del>');
    expect(html).toContain('<mark>');
  });

  it('exportToMD uses markdown notation', () => {
    const md = exportToMD(segments);
    expect(md).toContain('++added++');
    expect(md).toContain('~~deleted~~');
    expect(md).toContain('**changed**');
  });

  it('exportToHTML escapes HTML in segment text', () => {
    const html = exportToHTML([seg('<b>bold</b>', 'none')]);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });
});
