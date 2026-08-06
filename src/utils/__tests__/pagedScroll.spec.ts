/**
 * Rev. 2026-08-05: unit tests for the paged-wheel reducer (pure logic).
 * DOM binding (setupPagedWheel/syncScrollRatio) is exercised via integration
 * — the reducer contract is what guarantees "mouse notch = one page" and
 * "trackpad small deltas accumulate smoothly".
 */

import { describe, it, expect } from 'vitest';
import { normalizeDelta, reduceWheel, NOTCH_MIN, PAGE_RATIO } from '@/utils/pagedScroll';

describe('normalizeDelta (deltaMode 换算)', () => {
  it('mode 0 = 像素，原样返回', () => {
    expect(normalizeDelta(100, 0, 800)).toBe(100);
    expect(normalizeDelta(-100, 0, 800)).toBe(-100);
  });

  it('mode 1 = 行，×16（Firefox 默认）', () => {
    expect(normalizeDelta(3, 1, 800)).toBe(48);
    expect(normalizeDelta(-3, 1, 800)).toBe(-48);
  });

  it('mode 2 = 页，×可视尺寸', () => {
    expect(normalizeDelta(1, 2, 800)).toBe(800);
    expect(normalizeDelta(-1, 2, 600)).toBe(-600);
  });
});

describe('reduceWheel (翻页归约)', () => {
  const pageSize = 800 * PAGE_RATIO; // 680

  it('鼠标一格（|delta| ≥ NOTCH_MIN）→ 翻 ±1 页，累积清零', () => {
    const s0 = { acc: 0 };
    const r1 = reduceWheel(s0, 100, 0, pageSize);
    expect(r1.pages).toBe(1);
    expect(r1.next.acc).toBe(0);
    const r2 = reduceWheel(s0, -100, 0, pageSize);
    expect(r2.pages).toBe(-1);
    expect(r2.next.acc).toBe(0);
  });

  it('鼠标一格即使未到一屏也整页翻（用户诉求：每格=一屏）', () => {
    const r = reduceWheel({ acc: 0 }, 60, 0, pageSize); // 60 < 680
    expect(r.pages).toBe(1); // ≥ NOTCH_MIN → 一格一页
  });

  it('触控板小 delta（< NOTCH_MIN）累积，满一屏才翻，余量保留', () => {
    let state = { acc: 0 };
    const step = 25; // 每次 25px，680/25 = 27.2 次满一屏
    for (let i = 0; i < 27; i++) {
      const r = reduceWheel(state, step, 0, pageSize);
      expect(r.pages).toBe(0);
      state = r.next;
    }
    expect(state.acc).toBe(27 * 25); // 675
    const r28 = reduceWheel(state, step, 0, pageSize); // 700 ≥ 680
    expect(r28.pages).toBe(1);
    expect(r28.next.acc).toBe(700 - 680); // 20 余量
  });

  it('触控板快速滑动一次可翻多页（delta 超过两屏）', () => {
    const r = reduceWheel({ acc: 0 }, 1500, 0, pageSize); // 1500 ≥ 680×2
    expect(r.pages).toBe(2);
    expect(r.next.acc).toBe(0);
  });

  it('大 delta 接近一屏时翻一页（round 语义）', () => {
    const r = reduceWheel({ acc: 0 }, 650, 0, pageSize); // 650/680 ≈ 0.96
    expect(r.pages).toBe(1);
  });

  it('反向滚动同样成立（负数）', () => {
    const r = reduceWheel({ acc: 0 }, -1500, 0, pageSize);
    expect(r.pages).toBe(-2);
  });

  it('大 delta 与已有累积互不污染：大 delta 直接把累积清零', () => {
    const r = reduceWheel({ acc: 500 }, 100, 0, pageSize);
    expect(r.pages).toBe(1);
    expect(r.next.acc).toBe(0); // 不把 500 累积进去
  });

  it('自订 notchMin 生效（可调阈值）', () => {
    const r = reduceWheel({ acc: 0 }, 25, 0, pageSize, 20);
    expect(r.pages).toBe(1); // 25 ≥ 20 → 一格一页
  });
});
