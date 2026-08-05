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
  resolvePunctSubstring,
  resolvePunctAlignment,
  resolveWhitespace,
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

describe('方案 P2-8: astral 占位符耗尽回退', () => {
  it('6401 个不同非 BMP 字符 diff 不抛错、文本完整不损坏', () => {
    // 私有区 U+E000–U+F8FF 共 6400 个码位——构造 6401 个不同 astral 字符
    // 触发溢出 → diffSafely 回退无保护 DMP（粒度变粗但文本不损坏）。
    const cps: number[] = [];
    let cp = 0x1f300; // emoji 区起点（0x1f300 之后无代理区，全部有效）
    while (cps.length < 6401) {
      cps.push(cp);
      cp++;
      if (cp > 0x10ffff) break;
    }
    const chars = cps.map((c) => String.fromCodePoint(c));
    const baseline = chars.join('');
    const edited = baseline + '尾部新增文本';
    const r = classifyEdit(baseline, edited);
    // 回退路径仍给出 dirty 结果，且重建 doc 与输入完全一致
    expect(r.dirty).toBe(true);
    expect(buildDocText(r.segments)).toBe(edited);
  });

  it('恰好 6400 个不同 astral 字符仍走占位符路径（不溢出）', () => {
    const cps: number[] = [];
    let cp = 0x1f300;
    while (cps.length < 6400) {
      cps.push(cp);
      cp++;
    }
    const chars = cps.map((c) => String.fromCodePoint(c));
    const baseline = chars.join('');
    const edited = baseline + '尾';
    const r = classifyEdit(baseline, edited);
    expect(r.dirty).toBe(true);
    expect(buildDocText(r.segments)).toBe(edited);
  });
});

describe('标点移动优先（2026-08-04 用户实测）', () => {
  it('舎衛國。在 → 舎衛。國在：显示为移动句号而非移动實词', () => {
    // DMP 对相邻「實词+标点」交换有两种等价解释；必须选「移动标点」：
    // add '。' + none '國' + del '。'，'國' 无任何标记。
    const raw = diffSafely('佛逰舎衛國。在勝林', '佛逰舎衛。國在勝林');
    expect(raw).toContainEqual([1, '。']);
    expect(raw).toContainEqual([0, '國']);
    expect(raw).toContainEqual([-1, '。']);
    // 不得把'國'标成删除/新增
    expect(raw).not.toContainEqual([-1, '國']);
    expect(raw).not.toContainEqual([1, '國']);
  });

  it('重写后 A/B 两侧重构文本不变（数学等价）', () => {
    const a = '我聞如是。一時。佛逰舎衛國。在勝林給孤獨園。';
    const b = '我聞如是。一時。佛逰舎衛。國在勝林給孤獨園。';
    const r = classifyEdit(a, b);
    expect(buildDocText(r.segments)).toBe(b);
    // A 侧重建 = 原文
    const rebuiltA = r.segments
      .filter((s) => s.operation === 'none' || s.operation === 'del' || (s.operation === 'mod' && s.side === 'old'))
      .map((s) => s.text).join('');
    expect(rebuiltA).toBe(a);
  });

  it('远距离同文 del/add 不重写（独立操作）', () => {
    const a = '甲X乙' + '中'.repeat(500) + '丙';
    const b = '甲乙' + '中'.repeat(500) + '丙X';
    const raw = diffSafely(a, b);
    expect(raw).toContainEqual([-1, 'X']);
    expect(raw).toContainEqual([1, 'X']);
  });
});

describe('标点包裹优先 L2（2026-08-05 用户实测）', () => {
  it('我聞如是 → 我。聞。如是：显示为加标点而非替换实词', () => {
    // DMP 输出 del '聞' + add '。聞。'；必须重写为 add '。' + '聞' + add '。'。
    const raw = diffSafely('我聞如是', '我。聞。如是');
    expect(raw).toContainEqual([1, '。']);
    expect(raw).toContainEqual([0, '聞']);
    // '聞' 不得被标成删除/替换
    expect(raw).not.toContainEqual([-1, '聞']);
    expect(raw).not.toContainEqual([1, '。聞。']);
  });

  it('对称删除：我。聞。如是 → 我聞如是', () => {
    const raw = diffSafely('我。聞。如是', '我聞如是');
    expect(raw).toContainEqual([-1, '。']);
    expect(raw).toContainEqual([0, '聞']);
    expect(raw).not.toContainEqual([-1, '。聞。']);
  });

  it('真替换（含汉字）不重写：聞 → 。見聞。', () => {
    const raw = diffSafely('聞', '。見聞。');
    expect(raw).toContainEqual([-1, '聞']);
    expect(raw).toContainEqual([1, '。見聞。']);
  });

  it('规则函数直测：del X + add(P+X+Q) → add P + X + add Q', () => {
    const raw: [number, string][] = [[-1, '聞'], [1, '。聞。']];
    expect(resolvePunctSubstring(raw)).toEqual([[1, '。'], [0, '聞'], [1, '。']]);
    const raw2: [number, string][] = [[-1, '。聞。'], [1, '聞']];
    expect(resolvePunctSubstring(raw2)).toEqual([[-1, '。'], [0, '聞'], [-1, '。']]);
  });
});

describe('编辑态标点插入场景（2026-08-05）', () => {
  it('用户在「聞」前后输入「。」：聞 保持 none，两侧标点为 add', () => {
    // 模拟编辑会话：baseline=原版，用户编辑后文本=加标点版
    const r = classifyEdit(
      '我聞如是。一時。佛逰舎衛國。在勝林給孤獨園。',
      '我。聞。如是。一時。佛逰舎衛。國在勝林給孤獨園。',
    );
    expect(buildDocText(r.segments)).toBe('我。聞。如是。一時。佛逰舎衛。國在勝林給孤獨園。');
    // 不得有任何「聞」被标成修改（mod old=聞 或 mod new=。聞。）
    expect(r.segments.filter((s) => s.operation === 'mod' && (s.text === '聞' || s.text === '。聞。'))).toHaveLength(0);
    expect(r.segments.filter((s) => s.operation === 'mod' && s.side === 'new')).toHaveLength(0);
    // 标点移动场景（舎衛國。在 → 舎衛。國在）仍正确：'國' 不动 + del '。'
    expect(r.segments).toContainEqual(expect.objectContaining({ operation: 'none', text: '國' }));
    expect(r.segments.filter((s) => s.operation === 'del')).toHaveLength(1);
  });
});

describe('空白归因 W（2026-08-05 用户实测）', () => {
  it('问题1：标题后的全角空格→句号，显示「一」后新增「。」', () => {
    const raw = diffSafely('中阿含經卷第一\u3000\u3000\n東晉孝武', '中阿含經卷第一。\n東晉孝武');
    expect(raw).toContainEqual([1, '。']);
    expect(raw).toContainEqual([0, '中阿含經卷第一']);
    expect(raw).not.toContainEqual([-1, '\u3000\u3000']);
    expect(raw.filter(([op]) => op === -1)).toHaveLength(0);
  });

  it('问题2：行尾回车→句号，无回车删除标记', () => {
    const raw = diffSafely('譯道祖筆受\n中阿含七法品第一有十經', '譯。道祖筆受。中阿含七法品第一有十經');
    expect(raw).toContainEqual([1, '。']);
    expect(raw).toContainEqual([0, '道祖筆受']);
    expect(raw).not.toContainEqual([-1, '\n']);
  });

  it('问题3：空格分隔标题词→各词后加句号，实词全部不动', () => {
    const raw = diffSafely(
      '善法晝度樹\u3000城水木積喻\u3000善人徃世福\u3000日車漏盡七\u3000\n中阿含',
      '善法。晝度樹。城。水。木積。喻善人。徃世。福日車。漏盡。七。中阿含',
    );
    for (const w of ['善法', '晝度樹', '城', '水', '木積', '喻善人', '徃世', '福日車', '漏盡', '七']) {
      expect(raw).toContainEqual([0, w]);
    }
    expect(raw.filter(([op]) => op === -1)).toHaveLength(0);  // 无任何删除标记
    expect(raw.filter(([op]) => op === 1)).toHaveLength(10);  // 10 个新增句号
  });

  it('规则直测：del 纯空白 + add 纯标点 → add 标点；孤立 del 空白 → 隐藏', () => {
    expect(resolveWhitespace([[-1, '\n'], [1, '。']])).toEqual([[1, '。']]);
    expect(resolveWhitespace([[0, '福'], [-1, '\u3000'], [0, '日車']])).toEqual([[0, '福'], [0, '日車']]);
    expect(resolveWhitespace([[-1, '水'], [0, '甲']])).toEqual([[-1, '水'], [0, '甲']]);
  });
});

describe('实词对齐兜底 L3', () => {
  it('标点换位：del 丙。 + add 。丙 → add 。 + 丙 + del 。', () => {
    const raw: [number, string][] = [[-1, '丙。'], [1, '。丙']];
    expect(resolvePunctAlignment(raw)).toEqual([[1, '。'], [0, '丙'], [-1, '。']]);
  });

  it('标点在实词中间：del 聞。見 + add 聞見 → 聞 + del 。 + 見', () => {
    const raw: [number, string][] = [[-1, '聞。見'], [1, '聞見']];
    expect(resolvePunctAlignment(raw)).toEqual([[0, '聞'], [-1, '。'], [0, '見']]);
  });

  it('实词不同（真替换）→ 原样返回', () => {
    const raw: [number, string][] = [[-1, '聞'], [1, '見']];
    expect(resolvePunctAlignment(raw)).toEqual(raw);
  });

  it('两侧全标点（无实词可对齐）→ 原样返回', () => {
    const raw: [number, string][] = [[-1, '。'], [1, '，']];
    expect(resolvePunctAlignment(raw)).toEqual(raw);
  });

  it('首操作与前一 add 相邻 → 放弃重写（防合成 mod）', () => {
    const raw: [number, string][] = [[1, 'Z'], [-1, '。丙'], [1, '丙。']];
    expect(resolvePunctAlignment(raw)).toEqual(raw);
  });

  it('端到端：我聞。 → 我。聞（聞 不动）', () => {
    const raw = diffSafely('我聞。', '我。聞');
    expect(raw).toContainEqual([0, '聞']);
    expect(raw).toContainEqual([-1, '。']);
    expect(raw).toContainEqual([1, '。']);
  });
});
