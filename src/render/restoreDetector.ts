/**
 * 恢复检测器（三期 A 组，D3 决策：以独立纯函数模块替代完整 diff3）。
 *
 * 语义：用户把「修改版 B」的某处改回「原版 A」的内容 → 该修改段标记为
 * `origin: 'restored'`（视觉绿色，Sidebar/Toolbar 计数）。
 *
 * 关键洞察：
 *  1. A 原文可从原始 diff segments 重建：A = none + del + mod-old（按序拼接）。
 *  2. 「已恢复」的判定条件是 C[pos] == A[pos]，与 B 无关——不需要 merge3。
 *  3. 只检测用户修改段（通常几十处），成本 O(修改总量)，与文档规模解耦。
 *
 * 数据结构：BToAMap 把「B 文本偏移区间」映射到「A 对应内容」：
 *  - spans: B 中非空区间 [bStart, bEnd) → aText（none 段 = 自身；add 段 = ''；
 *    mod-new 段 = 配对 mod-old 文本）
 *  - points: B 中零宽位置的 A 内容（独立 del 的锚点，用于检测「用户补回被删内容」）
 *
 * 判定规则（遍历 user segments 累积 B 偏移）：
 *  - mod 对（B:X → C:Y）：查 spans 得 aText，Y == aText → restored
 *  - del（用户删 B:X）：X 处 aText == ''（B 的新增）→ restored（删掉即恢复原文）
 *  - add（用户插入 Y）：插入点 aText 非空且 Y == aText → restored（补回被删内容）
 */

import type { Segment } from '@/types';

/**
 * 从原始 diff segments 重建原版 A 文本（A = none + del + mod-old）。
 * 统一实现移至 editClassifier.ts（方案 P1-1b），此处 re-export 保持引用兼容。
 */
export { buildOriginalText } from './editClassifier';

export interface RestoreSpan {
  bStart: number;
  bEnd: number;
  aText: string;
}

export interface BToAMap {
  spans: RestoreSpan[];
  points: Map<number, string>;
}

/**
 * 构建「B 偏移 → A 内容」映射。输入必须是与 classifyEdit 的 baseline
 * 同源（同变换）的原始段——CodeMirrorDiff 使用 normalizeText 后的
 * diffSegmentsRef；全角归一半开时跳过检测（见 CodeMirrorDiff 注释）。
 */
export function buildBToAMap(originalSegs: Segment[]): BToAMap {
  const spans: RestoreSpan[] = [];
  const points = new Map<number, string>();
  let bPos = 0;
  let pendingOld: string | null = null;

  for (const s of originalSegs) {
    const len = s.text.length;
    switch (s.operation) {
      case 'none':
        spans.push({ bStart: bPos, bEnd: bPos + len, aText: s.text });
        bPos += len;
        break;
      case 'add':
        // B 新增内容在 A 中不存在（空）；其起点若紧邻独立 del，则对应 del 文本
        spans.push({ bStart: bPos, bEnd: bPos + len, aText: '' });
        bPos += len;
        break;
      case 'del':
        // A 有 B 无：零宽锚点 = del 前 B 偏移（用户在 C 中补回时的插入点）
        points.set(bPos, s.text);
        break;
      case 'mod':
        if (s.side === 'old') {
          pendingOld = s.text;
        } else {
          // B 中 mod-new 区间对应 A 的 mod-old 文本
          spans.push({ bStart: bPos, bEnd: bPos + len, aText: pendingOld ?? '' });
          bPos += len;
          pendingOld = null;
        }
        break;
      default:
        break;
    }
  }
  return { spans, points };
}

export interface RestoreResult {
  /** 检测后的 segments（origin 可能被标记为 'restored'），浅拷贝新数组。 */
  segs: Segment[];
  restoredCount: number;
}

/** 对用户编辑 segments 执行恢复检测（输入输出都是 user 层 segments）。 */
export function detectRestores(userSegs: Segment[], bToA: BToAMap): RestoreResult {
  if (userSegs.length === 0) return { segs: userSegs, restoredCount: 0 };

  const segs = userSegs.map((s) => ({ ...s }));
  const { spans, points } = bToA;

  const lookup = (bStart: number, bEnd: number): string => {
    // 零宽（add 插入点）：独立 del 锚点优先；否则取相交 span 的 aText
    if (bStart === bEnd) {
      const p = points.get(bStart);
      if (p !== undefined) return p;
    }
    // 非零宽（mod-old / del）：拼接所有与 [bStart, bEnd) 相交 span 的 aText。
    // spans 连续覆盖 B 全文，相交拼接 = A 对应区间内容。DMP 可能把相邻
    // 修改合并成一个 mod 段（跨多个 span）——拼接后整段比较；若用户只
    // 部分恢复，整段不匹配则保持 user（粒度限制，见 detectRestores 注释）。
    let out = '';
    for (const sp of spans) {
      if (sp.bEnd <= bStart) continue;
      if (sp.bStart >= bEnd) break;
      out += sp.aText;
    }
    return out;
  };

  let bPos = 0;
  let restoredCount = 0;

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const len = s.text.length;
    if (s.operation === 'none') {
      bPos += len;
      continue;
    }
    if (s.operation === 'mod') {
      if (s.side === 'old') {
        const aText = lookup(bPos, bPos + len);
        const nxt = segs[i + 1];
        if (nxt && nxt.operation === 'mod' && nxt.side === 'new' && nxt.text === aText) {
          s.origin = 'restored';
          nxt.origin = 'restored';
          restoredCount++;
          i++; // 配对段已处理，不推进 bPos（mod-new 不占 B）
        }
        bPos += len;
      }
      continue;
    }
    if (s.operation === 'del') {
      const aText = lookup(bPos, bPos + len);
      if (aText === '') {
        s.origin = 'restored';
        restoredCount++;
      }
      bPos += len;
      continue;
    }
    if (s.operation === 'add') {
      const aText = lookup(bPos, bPos);
      if (aText !== '' && s.text === aText) {
        s.origin = 'restored';
        restoredCount++;
      }
      // add 不推进 bPos（B 中无此区间）
      continue;
    }
  }

  return { segs, restoredCount };
}
