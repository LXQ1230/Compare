import { describe, it, expect } from 'vitest';
import { classifyEdit, isPhantomSegment, buildDocText } from '@/render/editClassifier';
import { renderSegmentsToHTML } from '@/render/segmentRenderer';
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

describe('classifyEdit', () => {
  it('returns dirty=false when texts are equal', () => {
    const r = classifyEdit('hello world', 'hello world');
    expect(r.dirty).toBe(false);
    expect(r.segments).toEqual([]);
  });

  it('classifies a single-character edit as add', () => {
    const r = classifyEdit('hello', 'hello!');
    expect(r.dirty).toBe(true);
    expect(r.segments).toContainEqual(seg('!', 'add', undefined, expect.any(Number), 'user'));
  });

  it('classifies deletion as del', () => {
    const r = classifyEdit('hello', 'hell');
    expect(r.dirty).toBe(true);
    expect(r.segments.some((s) => s.operation === 'del')).toBe(true);
  });

  it('classifies replacement as a mod pair (old+new, same ci)', () => {
    const r = classifyEdit('abc', 'xyz');
    const mods = r.segments.filter((s) => s.operation === 'mod');
    expect(mods).toHaveLength(2);
    expect(mods[0].side).toBe('old');
    expect(mods[1].side).toBe('new');
    expect(mods[0].ci).toBe(mods[1].ci);
  });

  it('CJK continuous input produces no character loss (round-trips)', () => {
    const baseline = '这是一个中文文档';
    const edited = '这是一个中文文档，包含连续输入的中文字符测试';
    const r = classifyEdit(baseline, edited);
    expect(r.dirty).toBe(true);
    // New-document text reconstructed from segments must equal the edited text.
    const rebuilt = buildDocText(r.segments);
    expect(rebuilt).toBe(edited);
  });

  it('surrogate pairs survive classification intact', () => {
    // U+1F600 (😀) is a surrogate pair in UTF-16.
    const baseline = 'face 😀 end';
    const edited = 'face 😀😀 end';
    const r = classifyEdit(baseline, edited);
    expect(r.dirty).toBe(true);
    expect(buildDocText(r.segments)).toBe(edited);
  });

  it('undo-to-baseline returns dirty=false (fixed-baseline regression)', () => {
    // Simulates: edit A→X, undo (back to baseline), then edit A→Y.
    // With a FIXED baseline, classifying (baseline, Y) must be correct
    // and never conflated with the undone X state.
    const baseline = 'AAA';
    const undone = classifyEdit(baseline, 'AAA'); // undo → back to baseline
    expect(undone.dirty).toBe(false);

    const after = classifyEdit(baseline, 'AAY');
    expect(after.dirty).toBe(true);
    const rebuilt = buildDocText(after.segments);
    expect(rebuilt).toBe('AAY');
  });

  it('handles empty baseline', () => {
    const r = classifyEdit('', 'abc');
    expect(r.dirty).toBe(true);
    expect(buildDocText(r.segments)).toBe('abc');
  });

  it('segments from classifyEdit never contain phantom text in doc text', () => {
    const r = classifyEdit('old text', 'new text!');
    for (const s of r.segments) {
      expect(isPhantomSegment(s)).toBe(
        s.operation === 'del' || (s.operation === 'mod' && s.side === 'old'),
      );
    }
    // buildDocText drops phantom segments
    const nonPhantom = r.segments.filter((s) => !isPhantomSegment(s));
    expect(buildDocText(r.segments)).toBe(nonPhantom.map((s) => s.text).join(''));
  });
});

describe('segmentRenderer esc (rev. F1)', () => {
  it('escapes single quotes', () => {
    expect(renderSegmentsToHTML([seg("it's", 'none')])).toContain('&#39;');
  });

  it('escapes C0 control characters as numeric entities', () => {
    const nullChar = String.fromCharCode(0);
    const html = renderSegmentsToHTML([seg(`a${nullChar}b`, 'none')]);
    expect(html).toContain('&#0;');
  });

  it('escapes zero-width characters as numeric entities', () => {
    const zwsp = String.fromCharCode(0x200b);
    const html = renderSegmentsToHTML([seg(`a${zwsp}b`, 'none')]);
    expect(html).toContain('&#8203;');
  });

  it('keeps newlines intact for pre-wrap rendering', () => {
    expect(renderSegmentsToHTML([seg('line1\nline2', 'none')])).toContain('line1\nline2');
  });
});
