/**
 * 临时基准：JS DMP 全量 classify vs 增量，不同差异规模（30 万字语料）。
 * 目的：验证方案文档"100 万字每次编辑全量 ~1s"假设，决定增量策略。
 */
import fs from 'node:fs';
import path from 'node:path';
import { diff_match_patch } from 'diff-match-patch';

const baseline = fs.readFileSync(path.join(process.cwd(), 'fixtures/large/megaA.txt'), 'utf-8');
const N = baseline.length;

function classify(b, e) {
  const dmp = new diff_match_patch();
  dmp.Diff_Timeout = 0;
  const raw = dmp.diff_main(b, e);
  dmp.diff_cleanupSemantic(raw);
  return raw;
}

function timeit(label, fn) {
  const t0 = performance.now();
  const r = fn();
  const ms = performance.now() - t0;
  console.log(`${label}: ${ms.toFixed(2)}ms`);
  return { ms, r };
}

// 编辑生成器：在 pos 处把 [pos, pos+len) 替换为新文本
function makeEdit(pos, len, insert, on) {
  const p = Math.min(pos, on.length);
  const safeLen = Math.min(len, on.length - p);
  return on.slice(0, p) + insert + on.slice(p + safeLen);
}

console.log(`语料长度: ${N} 字符`);

// 场景 A：单处小编辑（8→8）
{
  const e = makeEdit(150000, 8, 'X'.repeat(8), baseline);
  const t = timeit('全量 单处 8→8', () => classify(baseline, e));
  console.log(`  rawDiffs=${t.r.length}`);
}
// 场景 B：单处 200 字符改写
{
  const e = makeEdit(150000, 200, 'Y'.repeat(200), baseline);
  timeit('全量 单处 200→200', () => classify(baseline, e));
}
// 场景 C：单处 2000 字符改写
{
  const e = makeEdit(150000, 2000, 'Z'.repeat(2000), baseline);
  timeit('全量 单处 2000→2000', () => classify(baseline, e));
}
// 场景 D：5% 字符修改（分散 20 处，每处 ~750 字符）
{
  let e = baseline;
  for (let k = 0; k < 20; k++) {
    const pos = Math.floor((k + 0.5) * N / 20);
    e = makeEdit(pos, 750, 'W'.repeat(750), e);
  }
  timeit('全量 20 处×750 (≈5%)', () => classify(baseline, e));
}
// 场景 E：10% 字符修改
{
  let e = baseline;
  for (let k = 0; k < 20; k++) {
    const pos = Math.floor((k + 0.5) * N / 20);
    e = makeEdit(pos, 1500, 'V'.repeat(1500), e);
  }
  timeit('全量 20 处×1500 (≈10%)', () => classify(baseline, e));
}
// 场景 F：结构性变化（插入 1000 行新内容）
{
  const block = ('插入行' + '字'.repeat(50) + '\n').repeat(1000);
  const e = baseline.slice(0, N / 2) + block + baseline.slice(N / 2);
  timeit('全量 中部插 5 万字', () => classify(baseline, e));
}
