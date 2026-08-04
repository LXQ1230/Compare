/**
 * 增量 vs 全量性能基准（方案 P5 §14.3）。
 *
 * 语料：内存生成 ~30 万字（行号唯一语料，模拟真实大文档）。
 * 实测（2026-08-04）：JS DMP 全量对"单处小编辑"极快（8→8 约 1.4ms、
 * 200→200 约 5.7ms、2000→2000 约 59ms）；分散大修改（20 处≈10%）约
 * 777ms。增量路径对单处/连续编辑提供更低延迟，分散大改触发 >30% 熔断
 * 回全量（Worker 后台执行，UI 不阻塞）。
 *
 * 断言（宽松，CI 可跑）：
 *  1. 全量 classifyEdit（30 万字）< 5s
 *  2. 增量 10 次局部编辑，平均单步 < 200ms
 *  3. 语义等价：增量合并结果与全量结果的 doc 文本（编辑后）一致、
 *     phantom（被删/改-旧值）文本一致——DMP 对局部/全局输入的段粒度
 *     划分天然不同，故不做逐段断言。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { classifyEdit, buildDocText, isPhantomSegment } from '../editClassifier';
import { classifyIncremental, mergeSegments, type IncrSession } from '../incrementalClassify';

let baseline = '';
let edits: string[] = [];

beforeAll(() => {
  // 内存生成 ~30 万字：10000 行 × ~40 字符，行内容带唯一编号（防 DMP 重复优化）
  const lines: string[] = [];
  for (let k = 0; k < 10_000; k++) {
    lines.push(`第${k}行〔${k}〕：` + '汉'.repeat(28) + '\n');
  }
  baseline = lines.join('');
  // 10 次局部编辑：在文档不同位置插入 marker（模拟真实编辑节奏）
  const positions = [
    100, 30_000, 60_000, 120_000, 200_000,
    15_000, 80_000, 150_000, 230_000, 300_000,
  ] as const;
  let cur = baseline;
  for (const [idx, pos] of positions.entries()) {
    const p = Math.min(pos, cur.length - 1);
    cur = cur.slice(0, p) + `〔编辑${idx}〕` + cur.slice(p, p + 8) + cur.slice(p + 8);
    edits.push(cur);
  }
});

describe('增量分类性能基准（30 万字）', () => {
  it('全量 classifyEdit 单次耗时 < 5s', () => {
    const t0 = performance.now();
    const r = classifyEdit(baseline, edits[edits.length - 1]);
    const ms = performance.now() - t0;
    console.log(`[bench] 全量 classify（30 万字）: ${ms.toFixed(0)}ms, segments=${r.segments.length}`);
    expect(r.dirty).toBe(true);
    expect(ms).toBeLessThan(5000);
  }, 20_000);

  it('增量 10 次局部编辑平均单步 < 200ms', () => {
    // 全量基准（记录日志用，不做对比断言——单处小编辑全量本就很快）
    const t0 = performance.now();
    classifyEdit(baseline, edits[edits.length - 1]);
    const fullMs = performance.now() - t0;

    // 增量序列
    let session: IncrSession | null = null;
    let cache: ReturnType<typeof mergeSegments> = [];
    const stepMs: number[] = [];
    let t = performance.now();
    for (const edited of edits) {
      const r = classifyIncremental(baseline, edited, session);
      if (r.segments !== null) {
        cache = r.segments;
        session = { lastEdited: edited, lastSegments: r.segments };
      } else {
        cache = mergeSegments(cache, r.from, r.to, r.localSegments!);
        session = { lastEdited: edited, lastSegments: cache };
      }
      stepMs.push(performance.now() - t);
      t = performance.now();
    }
    const incrTotal = stepMs.reduce((a, b) => a + b, 0);
    const avg = incrTotal / stepMs.length;
    console.log(`[bench] 增量 10 步: 总计=${incrTotal.toFixed(1)}ms 平均=${avg.toFixed(1)}ms (全量=${fullMs.toFixed(0)}ms)`);

    expect(avg).toBeLessThan(200);
  }, 20_000);

  it('增量最终结果与全量语义等价（doc 文本 + phantom 文本一致）', () => {
    let session: IncrSession | null = null;
    let cache: ReturnType<typeof mergeSegments> = [];
    for (const edited of edits) {
      const r = classifyIncremental(baseline, edited, session);
      if (r.segments !== null) {
        cache = r.segments;
        session = { lastEdited: edited, lastSegments: r.segments };
      } else {
        cache = mergeSegments(cache, r.from, r.to, r.localSegments!);
        session = { lastEdited: edited, lastSegments: cache };
      }
    }
    const full = classifyEdit(baseline, edits[edits.length - 1]);
    // 编辑后文档文本一致（不含 phantom）
    expect(buildDocText(cache)).toBe(buildDocText(full.segments));
    // 被删/被改-旧值内容一致（phantom 文本序列；过滤空文本段——
    // DMP 对纯插入可能产生 text='' 的 mod-old 空段，全量路径也存在）
    const phantomA = cache.filter((s) => isPhantomSegment(s) && s.text.length > 0).map((s) => s.text).join('\u0000');
    const phantomB = full.segments.filter((s) => isPhantomSegment(s) && s.text.length > 0).map((s) => s.text).join('\u0000');
    expect(phantomA).toBe(phantomB);
    // 变更计数一致（add/del/mod 总数；忽略空文本段——DMP 可能产生
    // text='' 的空 del/空 mod-old，全量路径既有的无害残留）
    const count = (arr: typeof cache) => arr.reduce((acc, s) => {
      if (s.operation !== 'none' && s.text.length > 0) acc[s.operation === 'mod' ? 'mod' : s.operation]++;
      return acc;
    }, { add: 0, del: 0, mod: 0 });
    expect(count(cache)).toEqual(count(full.segments));
  }, 20_000);
});
