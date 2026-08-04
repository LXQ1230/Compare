/**
 * 增量分类核心（方案 P5 / L4 阶段二 §4.4.5，兼三期 4-11）。
 *
 * 全量 classifyEdit 是 O(n·m) 级 DMP，百万字每次编辑 ~1s；增量路径只重算
 * "变化区间"附近（±INCR_WINDOW 窗口），窗口外 segments 原样复用，使每次
 * 编辑的重算延迟降至 <200ms。
 *
 * 正确性依据（§4.4.5）：
 * - 窗口边界取在"公共前后缀"内（本次编辑未触碰的区域），该区域 baseline 与
 *   edited 的关系未变，原 segments 仍成立；
 * - 窗口内局部 DMP 在受限区间内等价于全量 diff 在该区间的结果；
 * - 撤销/重做：输入仍是完整 (baseline, edited)，与 A2 固定基线语义一致。
 *
 * 熔断：变化占比 >30%（或首次 / lastEdited 为空）→ 回退全量 classify。
 */

import { diff_match_patch } from 'diff-match-patch';
import type { Segment } from '@/types';
import { isPhantomSegment } from './editClassifier';

/** 熔断阈值：变化字符数 / 最大长度 > 此比例则回退全量 */
export const INCR_CHANGE_RATIO = 0.3;
/** 窗口扩展字符数（变化区间前后各取这么多未变文本参与局部重算） */
export const INCR_WINDOW = 5000;

/** Worker 内维护的增量会话状态。 */
export interface IncrSession {
  lastEdited: string;
  lastSegments: Segment[];
}

export interface ClassifyIncrementalResult {
  /** edited 与 baseline 是否有差异（增量路径也如实计算） */
  dirty: boolean;
  /** 全量路径：完整 segments（增量路径为 null） */
  segments: Segment[] | null;
  /** 增量路径：替换 lastSegments[from..to) 的局部新段（全量路径为 null） */
  localSegments: Segment[] | null;
  from: number;
  to: number;
}

/** 与 classifyEdit 完全一致的分类逻辑（DMP rawDiff → user segments）。 */
function classifyCore(baseline: string, edited: string): Segment[] {
  const dmp = new diff_match_patch();
  dmp.Diff_Timeout = 0;
  const rawDiffs = dmp.diff_main(baseline, edited);
  dmp.diff_cleanupSemantic(rawDiffs);

  const segments: Segment[] = [];
  let ci = 0;
  let i = 0;
  while (i < rawDiffs.length) {
    const [op, text] = rawDiffs[i];
    if (op === 0) {
      segments.push({ text, operation: 'none', origin: 'user' });
      i++;
      continue;
    }
    if (op === 1) {
      if (i + 1 < rawDiffs.length && rawDiffs[i + 1][0] === -1) {
        const addText = text;
        const delText = rawDiffs[i + 1][1];
        ci++;
        segments.push({ text: delText, operation: 'mod', origin: 'user', side: 'old', ci });
        segments.push({ text: addText, operation: 'mod', origin: 'user', side: 'new', ci });
        i += 2;
        continue;
      }
      ci++;
      segments.push({ text, operation: 'add', origin: 'user', ci });
      i++;
      continue;
    }
    if (i + 1 < rawDiffs.length && rawDiffs[i + 1][0] === 1) {
      const delText = text;
      const addText = rawDiffs[i + 1][1];
      ci++;
      segments.push({ text: delText, operation: 'mod', origin: 'user', side: 'old', ci });
      segments.push({ text: addText, operation: 'mod', origin: 'user', side: 'new', ci });
      i += 2;
      continue;
    }
    ci++;
    segments.push({ text, operation: 'del', origin: 'user', ci });
    i++;
  }
  return segments;
}

/** 合并相邻同类型段（operation/side/origin 相同），消除 DMP 边界缝。
 * 不比较 ci——合并后由 renumberCi 统一重编号（增量边界段的 ci 本就不同）。 */
export function mergeAdjacent(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (
      last
      && last.operation === s.operation
      && last.side === s.side
      && last.origin === s.origin
    ) {
      last.text += s.text;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/**
 * 重编号 ci（全局递增）。mod 的 old/new 共享同一 ci（与 classifyCore 一致）。
 * 注意：Sidebar/processedCis 依赖 ci 连续性——合并后必须全量重编号，
 * 该遍历为 O(n)，百万段 ~10-30ms，在 Worker 内执行不阻塞 UI。
 */
export function renumberCi(segs: Segment[]): Segment[] {
  let ci = 0;
  for (const s of segs) {
    if (s.operation === 'none') {
      s.ci = undefined;
      continue;
    }
    if (s.operation === 'mod' && s.side === 'new') {
      // 沿用前一段（mod-old）刚分配的 ci
      if (ci === 0) ci = 1; // 防御：异常开头
      s.ci = ci;
      continue;
    }
    ci++;
    s.ci = ci;
  }
  return segs;
}

/**
 * 合并增量结果：prev[0..from) + local + prev[to..end)，去缝后重编号 ci。
 * 主线程（store 缓存 / 装饰）与 Worker（lastSegments 状态）共用此函数。
 */
export function mergeSegments(
  prev: Segment[],
  from: number,
  to: number,
  local: Segment[],
): Segment[] {
  const merged = [...prev.slice(0, from), ...local, ...prev.slice(to)];
  return renumberCi(mergeAdjacent(merged));
}

/**
 * 增量分类入口。
 *
 * @param session 上次分类后的会话状态；null（首次）时走全量路径。
 * @returns segments（全量路径）或 localSegments+from/to（增量路径）。
 */
export function classifyIncremental(
  baseline: string,
  edited: string,
  session: IncrSession | null,
): ClassifyIncrementalResult {
  const fallback = (): ClassifyIncrementalResult => {
    const segs = classifyCore(baseline, edited);
    return {
      dirty: segs.length > 0,
      segments: segs,
      localSegments: null,
      from: 0,
      to: 0,
    };
  };

  if (!session || !session.lastEdited || session.lastSegments.length === 0) {
    return fallback();
  }

  const last = session.lastEdited;
  const lastSegs = session.lastSegments;
  const maxLen = Math.max(last.length, edited.length);

  // 1. 公共前后缀定位变化区间
  const n = Math.min(last.length, edited.length);
  let s = 0;
  while (s < n && last.charCodeAt(s) === edited.charCodeAt(s)) s++;
  let e1 = last.length;   // lastEdited 侧变化区终点
  let e2 = edited.length; // edited 侧变化区终点
  while (e1 > s && e2 > s && last.charCodeAt(e1 - 1) === edited.charCodeAt(e2 - 1)) {
    e1--;
    e2--;
  }

  const changed = Math.max(e1 - s, e2 - s);
  if (changed === 0) {
    // 文本未变（防御；正常流程不会到达）
    return {
      dirty: lastSegs.some((x) => x.operation !== 'none'),
      segments: lastSegs,
      localSegments: null,
      from: 0,
      to: 0,
    };
  }
  // 熔断：变化过大 → 全量
  if (maxLen > 0 && changed / maxLen > INCR_CHANGE_RATIO) {
    return fallback();
  }

  // 2. 构建 lastSegments 的 doc/base 偏移索引（O(n)，Worker 内不阻塞 UI）
  //    doc 坐标（lastEdited）：none/add/mod-new 占位；del/mod-old(phantom) 不占
  //    base 坐标（baseline）：none/del/mod-old 占位；add/mod-new 不占
  const cnt = lastSegs.length;
  const docStart = new Array<number>(cnt);
  const docEnd = new Array<number>(cnt);
  const baseStart = new Array<number>(cnt);
  const baseEnd = new Array<number>(cnt);
  let dp = 0;
  let bp = 0;
  for (let k = 0; k < cnt; k++) {
    const seg = lastSegs[k];
    const len = seg.text.length;
    docStart[k] = dp;
    docEnd[k] = dp + len;
    baseStart[k] = bp;
    baseEnd[k] = bp + len;
    const phantom = isPhantomSegment(seg);
    const noBase = seg.operation === 'add' || (seg.operation === 'mod' && seg.side === 'new');
    if (!phantom) dp += len; // doc 占位
    if (!noBase) bp += len;  // baseline 占位
  }

  // 3. 定位覆盖变化区间的段范围并扩展窗口（边界必须落在未变区域）
  //    窗口起点：第一个 docEnd > s 的段（往前扩展至 docStart <= s - INCR_WINDOW 且 < s）
  //    窗口终点：最后一个 docStart < e1 的段（往后扩展至 docEnd >= e1 + INCR_WINDOW 且 > e1）
  let i = 0;
  while (i < cnt && docEnd[i] <= s) i++;
  if (i >= cnt) i = cnt - 1;
  while (i > 0 && docStart[i] > s - INCR_WINDOW) i--;
  while (i > 0 && docStart[i] >= s) i--; // 确保起点在公共前缀内（docStart < s）

  let j = cnt - 1;
  while (j >= 0 && docStart[j] >= e1) j--;
  if (j < 0) j = 0;
  while (j < cnt - 1 && docEnd[j] < e1 + INCR_WINDOW) j++;
  while (j < cnt - 1 && docEnd[j] <= e1) j++; // 确保终点在公共后缀内（docEnd > e1）

  if (i > j) {
    // 防御：窗口退化（不应发生）→ 全量
    return fallback();
  }

  // 4. 窗口文本切片
  const weStart = docStart[i];                       // edited 坐标（公共前缀区，== docStart[i]）
  const weEnd = e2 + (docEnd[j] - e1);               // edited 坐标（公共后缀区换算）
  const bwStart = baseStart[i];
  const bwEnd = baseEnd[j];
  // 边界钳制（防御越界）
  const baseWin = baseline.slice(Math.max(0, bwStart), Math.min(baseline.length, bwEnd));
  const editWin = edited.slice(Math.max(0, weStart), Math.min(edited.length, weEnd));

  // 5. 窗口内局部 DMP
  const dmp = new diff_match_patch();
  dmp.Diff_Timeout = 0;
  const rawDiffs = dmp.diff_main(baseWin, editWin);
  dmp.diff_cleanupSemantic(rawDiffs);

  // 局部段转 user segments（ci 本地编号，合并时由 renumberCi 统一重编号）
  const local: Segment[] = [];
  let k = 0;
  while (k < rawDiffs.length) {
    const [op, text] = rawDiffs[k];
    if (op === 0) {
      local.push({ text, operation: 'none', origin: 'user' });
      k++;
      continue;
    }
    if (op === 1) {
      if (k + 1 < rawDiffs.length && rawDiffs[k + 1][0] === -1) {
        const addText = text;
        const delText = rawDiffs[k + 1][1];
        local.push({ text: delText, operation: 'mod', origin: 'user', side: 'old', ci: 1 });
        local.push({ text: addText, operation: 'mod', origin: 'user', side: 'new', ci: 1 });
        k += 2;
        continue;
      }
      local.push({ text, operation: 'add', origin: 'user', ci: 1 });
      k++;
      continue;
    }
    if (k + 1 < rawDiffs.length && rawDiffs[k + 1][0] === 1) {
      const delText = text;
      const addText = rawDiffs[k + 1][1];
      local.push({ text: delText, operation: 'mod', origin: 'user', side: 'old', ci: 1 });
      local.push({ text: addText, operation: 'mod', origin: 'user', side: 'new', ci: 1 });
      k += 2;
      continue;
    }
    local.push({ text, operation: 'del', origin: 'user', ci: 1 });
    k++;
  }

  const dirty = local.some((x) => x.operation !== 'none');
  return { dirty, segments: null, localSegments: local, from: i, to: j + 1 };
}
