/**
 * Paged wheel scrolling for the read-only views (rev. 2026-08-05).
 *
 * 需求（用户确认）：查看模式滚轮翻页。
 *  - 横排：滚轮每格翻一屏（smooth，页 = 可视高度的 PAGE_RATIO）
 *  - 竖排 IDML（writing-mode: vertical-rl）：内容横向排布、滚动条在水平方向，
 *    滚轮纵向输入原生无效 → 映射到阅读方向（scrollLeft）并按页翻
 *  - SplitView 双栏：scrollRatioSync 按比例联动（左右内容长度不同，用比例不用像素）
 *
 * 手感保护：
 *  - 鼠标滚轮一格 deltaY≈100px（≥ NOTCH_MIN）→ 直接翻一页，满足"每格一屏"
 *  - 触控板/高分辨率滚轮为连续小 delta（< NOTCH_MIN）→ 累积满一页才翻，保留连续感
 *  - deltaX 不劫持（触控板横滑 / Shift+滚轮留给浏览器原生横向滚动）
 */

export type ScrollAxis = 'x' | 'y';

/** 鼠标滚轮一格的 deltaY 判定阈值：超过视为"一格 = 一页" */
export const NOTCH_MIN = 30;
/** 每页滚动比例（可视尺寸的倍数）：0.85 = 翻 85%，留 15% 上下文 */
export const PAGE_RATIO = 0.85;

/** WheelEvent.deltaMode 换算：0=px / 1=行(×16) / 2=页(×可视尺寸) */
export function normalizeDelta(raw: number, mode: number, refSize: number): number {
  return raw * (mode === 1 ? 16 : mode === 2 ? refSize : 1);
}

export interface PagedState {
  /** 小 delta 的未翻页累积量 */
  acc: number;
}

/**
 * 纯状态归约：输入一次 wheel 的原始 deltaY，输出本次应翻页数 + 下一个状态。
 *  - |delta| ≥ notchMin（鼠标一格 / 触控板快速滑动）→ 按实际距离翻页，
 *    至少 ±1 页（满足"每格一屏"），超过一屏按 round 翻多页；累积清零
 *  - 小 delta（触控板慢速）→ 累积，每满 pageSize 翻一页，余量保留
 */
export function reduceWheel(
  state: PagedState,
  rawDelta: number,
  mode: number,
  pageSize: number,
  notchMin: number = NOTCH_MIN,
): { pages: number; next: PagedState } {
  const delta = normalizeDelta(rawDelta, mode, pageSize);
  const nextAcc = state.acc + delta;
  if (Math.abs(delta) >= notchMin) {
    const pages = Math.max(1, Math.round(Math.abs(delta) / pageSize)) * Math.sign(delta);
    return { pages, next: { acc: 0 } };
  }
  const pages = Math.trunc(nextAcc / pageSize);
  if (pages !== 0) return { pages, next: { acc: nextAcc - pages * pageSize } };
  return { pages: 0, next: { acc: nextAcc } };
}

function scrollPos(el: HTMLElement, axis: ScrollAxis): number {
  return axis === 'x' ? el.scrollLeft : el.scrollTop;
}

function scrollRange(el: HTMLElement, axis: ScrollAxis): number {
  const total = axis === 'x' ? el.scrollWidth : el.scrollHeight;
  const client = axis === 'x' ? el.clientWidth : el.clientHeight;
  return Math.max(0, total - client);
}

function setScrollPos(el: HTMLElement, axis: ScrollAxis, v: number): void {
  if (axis === 'x') el.scrollLeft = v;
  else el.scrollTop = v;
}

export function scrollByPage(
  el: HTMLElement,
  axis: ScrollAxis,
  pages: number,
  pageSize: number,
): void {
  const delta = pages * pageSize;
  if (axis === 'x') el.scrollBy({ left: delta, behavior: 'smooth' });
  else el.scrollBy({ top: delta, behavior: 'smooth' });
}

export interface PagedWheelOptions {
  axis: ScrollAxis;
  pageRatio?: number;
  notchMin?: number;
}

/**
 * 挂载滚轮翻页。返回清理函数（组件卸载时调用）。
 * 对 deltaY≠0 的事件统一 preventDefault 接管（横排需阻止原生双重滚动；
 * 竖排原生本就无效），再按 reduceWheel 结果 smooth 翻页。
 */
export function setupPagedWheel(el: HTMLElement, opts: PagedWheelOptions): () => void {
  const axis = opts.axis;
  const pageRatio = opts.pageRatio ?? PAGE_RATIO;
  const notchMin = opts.notchMin ?? NOTCH_MIN;
  let state: PagedState = { acc: 0 };

  const onWheel = (e: WheelEvent): void => {
    // 纯横向输入（触控板横滑 / Shift+滚轮）留给原生
    if (e.deltaX !== 0 && e.deltaY === 0) return;
    const refSize = axis === 'x' ? el.clientWidth : el.clientHeight;
    const pageSize = refSize * pageRatio;
    const { pages, next } = reduceWheel(state, e.deltaY, e.deltaMode, pageSize, notchMin);
    state = next;
    if (pages === 0) return;
    e.preventDefault();
    scrollByPage(el, axis, pages, pageSize);
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  return () => el.removeEventListener('wheel', onWheel);
}

/** scroll 位置静止多久视为滚动结束（动画/拖动结束后才对齐另一栏） */
export const SYNC_DEBOUNCE_MS = 120;

/** 单向对齐：把 dst 滚动位置同步到 src 的比例位置（内容长度不同，用比例） */
function syncTo(src: HTMLElement, dst: HTMLElement, axis: ScrollAxis): void {
  const rangeS = scrollRange(src, axis);
  const rangeD = scrollRange(dst, axis);
  if (rangeS <= 0 || rangeD <= 0) return;
  const target = (scrollPos(src, axis) / rangeS) * rangeD;
  if (Math.abs(scrollPos(dst, axis) - target) > 2) setScrollPos(dst, axis, target);
}

/**
 * 双栏滚动比例同步（split 视图）。左右内容长度不同 → 用滚动比例而非像素。
 * 单向源追踪：记录最后滚动的栏（source），等它静止 SYNC_DEBOUNCE_MS 后把另一栏
 * 对齐到它的比例。smooth 翻页动画期间每帧派发 scroll 事件持续重置计时 → 动画
 * 全程不被瞬间赋值打断；被对齐栏的 scroll 事件会把它设为新 source，但此时双方
 * 已一致（差值 ≤2 跳过）→ 天然无循环（rev. 2026-08-05 e2e 实测驱动迭代）。
 */
export function syncScrollRatio(
  a: HTMLElement,
  b: HTMLElement,
  axis: ScrollAxis,
): { cleanup: () => void; syncNow: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let source: 'a' | 'b' | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (source === 'a') syncTo(a, b, axis);
      else if (source === 'b') syncTo(b, a, axis);
    }, SYNC_DEBOUNCE_MS);
  };
  const onA = (): void => { source = 'a'; schedule(); };
  const onB = (): void => { source = 'b'; schedule(); };
  a.addEventListener('scroll', onA, { passive: true });
  b.addEventListener('scroll', onB, { passive: true });
  return {
    cleanup: () => {
      if (timer) clearTimeout(timer);
      a.removeEventListener('scroll', onA);
      b.removeEventListener('scroll', onB);
    },
    syncNow: () => {
      if (source === 'a') syncTo(a, b, axis);
      else if (source === 'b') syncTo(b, a, axis);
    },
  };
}
