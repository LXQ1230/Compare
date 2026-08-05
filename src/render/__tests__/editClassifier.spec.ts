import { describe, it, expect } from 'vitest';
import { classifyEdit, isPhantomSegment, buildDocText, normalizeLineEndings, docOffsetsOf } from '@/render/editClassifier';
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

  it('CRLF baseline vs LF editor doc produces NO phantom CR deletions (root cause regression)', () => {
    // Root-cause regression (rev. F2): a Windows CRLF baseline must NOT
    // produce per-character '\r' deletions when the editor doc has no '\r'.
    // CodeMirror 6 splits on /\r\n?|\n/ (DefaultSplit), so '\r' never
    // survives into the document. The fix normalizes the baseline at the
    // editor boundary (normalizeLineEndings) before classifyEdit runs.
    const rawBaseline = '第一行内容\r\n第二行内容\r\n第三行内容';
    const baseline = normalizeLineEndings(rawBaseline);
    expect(baseline).toBe('第一行内容\n第二行内容\n第三行内容');
    const edited = '第一行内容\n第二行内容\n第三行内容\n末尾追加';
    const r = classifyEdit(baseline, edited);
    expect(r.dirty).toBe(true);
    // Every non-phantom segment must be CR-free — no phantom '\r' deletions.
    for (const s of r.segments) {
      if (!isPhantomSegment(s)) expect(s.text).not.toContain('\r');
    }
    // Reconstructed doc must match the editor doc exactly.
    expect(buildDocText(r.segments)).toBe(edited);
    // There should be exactly ONE real add (the appended line), not 3 phantom CR dels.
    // The add may legitimately include the preceding '\n' (baseline didn't end
    // with a newline), but must not contain '\r'.
    const adds = r.segments.filter((s) => s.operation === 'add');
    expect(adds).toHaveLength(1);
    expect(adds[0].text).not.toContain('\r');
    expect(adds[0].text).toContain('末尾追加');
  });

  it('normalizeLineEndings converts CRLF and CR to LF', () => {
    expect(normalizeLineEndings('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
    expect(normalizeLineEndings('a\r\nb')).toBe('a\nb');
    expect(normalizeLineEndings('a\rb')).toBe('a\nb');
    expect(normalizeLineEndings('a\nb')).toBe('a\nb'); // already LF — unchanged
    expect(normalizeLineEndings('')).toBe('');
  });

  it('CR-only baseline lines normalize: CRLF and LF forms classify identically', () => {
    const crlf = classifyEdit('a\r\nb', 'a\nb!');
    const lf = classifyEdit('a\nb', 'a\nb!');
    expect(buildDocText(crlf.segments)).toBe(buildDocText(lf.segments));
    expect(crlf.segments.filter((s) => s.operation === 'add')).toHaveLength(1);
    expect(lf.segments.filter((s) => s.operation === 'add')).toHaveLength(1);
  });
});

describe('segmentRenderer esc (rev. F1)', () => {  it('escapes single quotes', () => {
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

describe('docOffsetsOf (方案 P2-2/P2-4: 编辑态跳转共用偏移基准)', () => {
  it('phantom 段（del/mod-old）不占 doc 空间', () => {
    const segs: Segment[] = [
      seg('abc', 'none'),
      seg('X', 'del', undefined, 1),
      seg('def', 'none'),
      seg('old', 'mod', 'old', 2),
      seg('new', 'mod', 'new', 2),
      seg('ghi', 'none'),
    ];
    // del 与 mod-old 都是 phantom：偏移跳过其文本长度
    expect(docOffsetsOf(segs)).toEqual([0, 3, 3, 6, 6, 9]);
  });

  it('add 段正常占位（新插入文本在 doc 中真实存在）', () => {
    const segs: Segment[] = [
      seg('abc', 'none'),
      seg('insert', 'add', undefined, 1),
      seg('def', 'none'),
    ];
    expect(docOffsetsOf(segs)).toEqual([0, 3, 9]);
  });

  it('与 buildSearchDecos 累计逻辑一致（buildDocText 重建验证）', () => {
    // 任一段序列：docOffsetsOf 最后一个偏移 + 末段长度 = buildDocText 长度
    const segs: Segment[] = [
      seg('甲', 'none'),
      seg('乙', 'del', undefined, 1),
      seg('丙', 'mod', 'old', 2),
      seg('丁', 'mod', 'new', 2),
      seg('戊', 'add', undefined, 3),
      seg('己', 'none'),
    ];
    const offsets = docOffsetsOf(segs);
    const doc = buildDocText(segs);
    const last = segs[segs.length - 1];
    expect(offsets[segs.length - 1] + last.text.length).toBe(doc.length);
    // 单调不减且互不重叠
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
    }
  });
});
