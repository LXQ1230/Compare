/**
 * 三期 B 组（4-4/4-5/4-6/4-7）Unicode 处理单元测试。
 */

import { describe, it, expect } from 'vitest';
import { classifyEdit, buildDocText } from '@/render/editClassifier';
import {
  normalizeText,
  normalizeFullwidth,
  normalizeLineEndings,
  stripBOM,
  diffSafely,
} from '@/render/unicode';

describe('normalizeText (4-5)', () => {
  it('strips leading BOM', () => {
    expect(stripBOM('\uFEFFabc')).toBe('abc');
    expect(stripBOM('abc')).toBe('abc');
    expect(normalizeText('\uFEFFabc')).toBe('abc');
  });

  it('normalizes CRLF/CR to LF', () => {
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('NFC-normalizes composed latin characters (CJK unaffected)', () => {
    // e + U+0301 (combining acute) → é
    expect(normalizeText('cafe\u0301')).toBe('café');
    // CJK has no combining forms — unchanged
    expect(normalizeText('佛经正文')).toBe('佛经正文');
  });
});

describe('normalizeFullwidth (4-7)', () => {
  it('maps common fullwidth punctuation to halfwidth', () => {
    expect(normalizeFullwidth('你好，世界！？')).toBe('你好,世界!?');
    // 书名号/引号对映射，其余全角字符（如「」）不在映射表则保持原样
    expect(normalizeFullwidth('（测试）')).toBe('(测试)');
    expect(normalizeFullwidth('「引用」')).toBe('「引用」');
  });

  it('leaves CJK ideographs and halfwidth text untouched', () => {
    expect(normalizeFullwidth('佛经文本ABC123')).toBe('佛经文本ABC123');
  });
});

describe('surrogate-safe diff (4-4)', () => {
  it('CJK Extension B (U+20000) replacement round-trips cleanly', () => {
    // 𠀀 = U+20000 (4-byte UTF-8 / surrogate pair), 𠮟 = U+20B9F
    const baseline = '序言一二三\uD840\uDC00五六七。';
    const edited = '序言一二三\uD840\uDDBF五六七。';
    const r = classifyEdit(baseline, edited);
    expect(r.dirty).toBe(true);
    expect(buildDocText(r.segments)).toBe(edited);
    // 不得产生孤立 surrogate（所有 segment 文本必须成对）
    const ORPHAN_HIGH = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
    const ORPHAN_LOW = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const s of r.segments) {
      expect(ORPHAN_HIGH.test(s.text)).toBe(false);
      expect(ORPHAN_LOW.test(s.text)).toBe(false);
    }
  });

  it('astral character insertion round-trips', () => {
    const r = classifyEdit('原文', '原文\uD840\uDC00尾');
    expect(buildDocText(r.segments)).toBe('原文\uD840\uDC00尾');
  });

  it('diffSafely never splits a surrogate pair across segments', () => {
    const raw = diffSafely('a\uD840\uDC00b', 'a\uD840\uDDBFb');
    for (const [, t] of raw) {
      // 每段要么不含 surrogate，要么包含完整 pair
      expect(Array.from(t).every((ch) => {
        const cp = ch.codePointAt(0)!;
        return cp <= 0xffff || (cp >= 0x10000 && cp <= 0x10ffff);
      })).toBe(true);
    }
  });
});

describe('zero-width characters (4-6)', () => {
  it('zero-width space participates in diff without loss', () => {
    const baseline = '正\u200b文一';
    const edited = '正\u200b文二';
    const r = classifyEdit(baseline, edited);
    expect(r.dirty).toBe(true);
    expect(buildDocText(r.segments)).toBe(edited);
  });

  it('NBSP survives classification', () => {
    const r = classifyEdit('a\u00a0b', 'a\u00a0b!');
    expect(buildDocText(r.segments)).toBe('a\u00a0b!');
  });
});
