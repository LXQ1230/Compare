/**
 * 三期 A 组（恢复检测器）单元测试。
 * 场景覆盖：改回原文(mod) / 删掉 B 新增(del) / 补回被删内容(add) /
 * 部分恢复 / 恢复后再修改 / 未触碰段保持 user / 无修改空输入。
 */

import { describe, it, expect } from 'vitest';
import type { Segment } from '@/types';
import { classifyEdit } from '@/render/editClassifier';
import {
  buildOriginalText,
  buildBToAMap,
  detectRestores,
} from '@/render/restoreDetector';

const N = (text: string): Segment => ({ text, operation: 'none', origin: 'original' });
const ADD = (text: string): Segment => ({ text, operation: 'add', origin: 'original', ci: 1 });
const DEL = (text: string): Segment => ({ text, operation: 'del', origin: 'original', ci: 2 });
const MOD = (oldText: string, newText: string): Segment[] => [
  { text: oldText, operation: 'mod', origin: 'original', side: 'old', ci: 3 },
  { text: newText, operation: 'mod', origin: 'original', side: 'new', ci: 3 },
];

/** 组装流程：原始 diff + 用户编辑 → classifyEdit → detectRestores。 */
function flow(original: Segment[], edited: string) {
  const baseline = original.filter((s) => !(s.operation === 'del') && !(s.operation === 'mod' && s.side === 'old'))
    .map((s) => s.text).join('');
  const user = classifyEdit(baseline, edited);
  const map = buildBToAMap(original);
  const result = user.dirty ? detectRestores(user.segments, map) : { segs: [], restoredCount: 0 };
  return { baseline, user, result };
}

describe('buildOriginalText', () => {
  it('reconstructs A from diff segments (none+del+mod-old)', () => {
    const segs = [N('甲'), ADD('乙'), N('丙'), DEL('丁'), ...MOD('戊', '己'), N('庚')];
    expect(buildOriginalText(segs)).toBe('甲丙丁戊庚');
  });
});

describe('detectRestores (三期 A 组)', () => {
  it('mod 对：用户把 B 的修改改回原文 → restored', () => {
    // A: 甲X丙   B: 甲Y丙（mod X→Y）  用户改回 X
    const original = [N('甲'), ...MOD('X', 'Y'), N('丙')];
    const { result } = flow(original, '甲X丙');
    expect(result.restoredCount).toBe(1);
    const mods = result.segs.filter((s) => s.operation === 'mod');
    expect(mods).toHaveLength(2);
    expect(mods.every((s) => s.origin === 'restored')).toBe(true);
  });

  it('del：用户删掉 B 的新增内容 → restored', () => {
    // A: 甲丙   B: 甲X丙（add X）  用户删掉 X → 恢复原文
    const original = [N('甲'), ADD('X'), N('丙')];
    const { result } = flow(original, '甲丙');
    expect(result.restoredCount).toBe(1);
    const del = result.segs.find((s) => s.operation === 'del');
    expect(del?.origin).toBe('restored');
  });

  it('add：用户补回被 B 删除的内容 → restored', () => {
    // A: 甲乙丙   B: 甲丙（del 乙）  用户重新输入乙 → 恢复原文
    const original = [N('甲'), DEL('乙'), N('丙')];
    const { result } = flow(original, '甲乙丙');
    expect(result.restoredCount).toBe(1);
    const add = result.segs.find((s) => s.operation === 'add' && s.text === '乙');
    expect(add?.origin).toBe('restored');
  });

  it('恢复后再修改 → 不再标记 restored', () => {
    // A: 甲X丙  B: 甲Y丙  用户先改回 X（restored），再改成 Z
    const original = [N('甲'), ...MOD('X', 'Y'), N('丙')];
    const { result } = flow(original, '甲Z丙');
    expect(result.restoredCount).toBe(0);
    const mods = result.segs.filter((s) => s.operation === 'mod');
    expect(mods.every((s) => s.origin === 'user')).toBe(true);
  });

  it('完全恢复多处：DMP 合并段整体等于 A 对应内容 → restored', () => {
    const original = [N('甲'), ...MOD('X', 'Y'), N('乙'), ...MOD('P', 'Q'), N('丙')];
    // 两处都改回原文（X 和 P），DMP 可能合并为一个大 mod 段
    const { result } = flow(original, '甲X乙P丙');
    expect(result.restoredCount).toBeGreaterThan(0);
    const mods = result.segs.filter((s) => s.operation === 'mod');
    expect(mods.length).toBeGreaterThan(0);
    expect(mods.every((s) => s.origin === 'restored')).toBe(true);
  });

  it('部分恢复（DMP 合并段）：整段不匹配则保持 user（粒度限制）', () => {
    const original = [N('甲'), ...MOD('X', 'Y'), N('乙'), ...MOD('P', 'Q'), N('丙')];
    // 只恢复第一处 X、第二处改成 R——DMP 合并成一段 "Y乙Q"→"X乙R"，
    // 段级比较 ≠ A("X乙P")，保持 user（粒度限制；精确部分恢复需 diff3 级拆分）
    const { result } = flow(original, '甲X乙R丙');
    expect(result.restoredCount).toBe(0);
    const mods = result.segs.filter((s) => s.operation === 'mod');
    expect(mods.every((s) => s.origin === 'user')).toBe(true);
  });

  it('未触碰段（none）保持原样，不参与检测', () => {
    const original = [N('甲'), ...MOD('X', 'Y'), N('丙')];
    const { result } = flow(original, '甲Y丙');
    expect(result.restoredCount).toBe(0);
    const none = result.segs.filter((s) => s.operation === 'none');
    expect(none.every((s) => s.origin === 'user')).toBe(true);
  });

  it('空输入：无修改 → restoredCount 0', () => {
    const original = [N('甲'), ...MOD('X', 'Y'), N('丙')];
    const baseline = original.filter((s) => s.operation !== 'del' && !(s.operation === 'mod' && s.side === 'old'))
      .map((s) => s.text).join('');
    const user = classifyEdit(baseline, baseline);
    expect(user.dirty).toBe(false);
    const map = buildBToAMap(original);
    expect(detectRestores([], map).restoredCount).toBe(0);
  });
});
