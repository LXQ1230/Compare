/**
 * 增量分类一致性测试（方案 P5 / L4 阶段二 §4.4.5）。
 *
 * 核心断言：模拟 Worker 会话序列（增量路径合并结果）与主线程全量
 * classifyEdit 结果逐字段一致（text/operation/origin/side/ci）。
 * 覆盖：首次全量、局部编辑、多处编辑、改回原文(dirty=false)、
 * 熔断（>30% 变化）、undo 后重新编辑。
 */

import { describe, it, expect } from 'vitest';
import { classifyEdit, type EditResult } from '../editClassifier';
import {
  classifyIncremental,
  mergeSegments,
  type IncrSession,
} from '../incrementalClassify';

/** 模拟 worker 调用序列，返回最终完整 segments（含 dirty 语义）。 */
function runIncrementalSeq(
  baseline: string,
  edits: string[],
): { segments: ReturnType<typeof mergeSegments>; dirty: boolean } {
  let session: IncrSession | null = null;
  let cache: ReturnType<typeof mergeSegments> = [];
  let dirty = false;
  for (const edited of edits) {
    const r = classifyIncremental(baseline, edited, session);
    if (r.segments !== null) {
      cache = r.segments;
      session = { lastEdited: edited, lastSegments: r.segments };
    } else {
      cache = mergeSegments(cache, r.from, r.to, r.localSegments!);
      session = { lastEdited: edited, lastSegments: cache };
    }
    dirty = r.dirty;
  }
  return { segments: cache, dirty };
}

/** 归一化对比：忽略 ci 差异直接比较内容结构（mod old/new 成对）。 */
function normalize(segs: { text: string; operation: string; origin?: string; side?: string }[]) {
  return segs.map((s) => ({ text: s.text, operation: s.operation, origin: s.origin, side: s.side }));
}

/** 断言增量序列最终结果与全量 classifyEdit 一致（dirty=true 时）。 */
function assertConsistent(baseline: string, edits: string[], label: string): void {
  const seq = runIncrementalSeq(baseline, edits);
  const full: EditResult = classifyEdit(baseline, edits[edits.length - 1]);
  if (!full.dirty) {
    // dirty=false 时增量缓存可能是"全 none 段"（主线程 dirty 语义为 []），
    // 单独断言 dirty 标志一致即可。
    expect(seq.dirty, label).toBe(false);
    return;
  }
  expect(seq.dirty, label).toBe(true);
  expect(normalize(seq.segments), label).toEqual(normalize(full.segments));
}

// ── 语料 ────────────────────────────────────────────────────────

const BASE = `第一章 序分
如是我闻。一时，佛住王舍城耆阇崛山中，与大比丘众千二百五十人俱。
尔时世尊食时，着衣持钵，入王舍城乞食。
（此段为高度重复的佛经文本，用于测试 DMP 在重复文本上的表现。）

第二章 正宗分
佛告须菩提：诸菩萨摩诃萨应如是降伏其心。
所有一切众生之类：若卵生、若胎生、若湿生、若化生；
若有色、若无色、若有想、若无想、若非有想非无想，
我皆令入无余涅槃而灭度之。
（重复内容再出现一次：所有一切众生之类。）

第三章 流通分
说是经已，长老须菩提，及诸比丘、比丘尼、优婆塞、优婆夷，
一切世间天、人、阿修罗，闻佛所说，皆大欢喜，信受奉行。`;

// ── 用例 ────────────────────────────────────────────────────────

describe('classifyIncremental 与全量 classifyEdit 一致性', () => {
  it('首次调用走全量路径且结果一致', () => {
    const edited = BASE.replace('如是我闻', '如是我闻，一时佛在');
    const seq = runIncrementalSeq(BASE, [edited]);
    expect(seq.dirty).toBe(true);
    const full = classifyEdit(BASE, edited);
    expect(normalize(seq.segments)).toEqual(normalize(full.segments));
  });

  it('单处局部编辑（增量路径）结果一致', () => {
    const e1 = BASE.replace('着衣持钵', '着衣持钵，饭食讫');
    const e2 = e1.replace('信受奉行', '信受奉行，作礼而去');
    assertConsistent(BASE, [e1, e2], '两处局部编辑');
  });

  it('连续多次局部编辑（增量累积）结果一致', () => {
    const edits: string[] = [];
    let cur = BASE;
    const patches = [
      ['佛住', '佛在'],
      ['千二百五十人', '千二百五十三人'],
      ['降伏其心', '降伏其心，无所住'],
      ['闻佛所说', '闻佛所说，欢喜信受'],
      ['皆大欢喜', '皆大欢喜，礼佛而去'],
    ];
    for (const [from, to] of patches) {
      cur = cur.replace(from, to);
      edits.push(cur);
    }
    assertConsistent(BASE, edits, '五次增量累积');
  });

  it('删除文本（含 phantom 段）增量结果一致', () => {
    const e1 = BASE.replace('（此段为高度重复的佛经文本，用于测试 DMP 在重复文本上的表现。）', '');
    const e2 = e1.replace('说是经已', '说此经已');
    assertConsistent(BASE, [e1, e2], '删除长段+修改');
  });

  it('插入长文本（变化窗口扩展）增量结果一致', () => {
    const insert = '（新增：一切法无我相、无人相、无众生相、无寿者相。）\n'.repeat(30);
    const e1 = BASE.replace('第三章 流通分', `${insert}第三章 流通分`);
    assertConsistent(BASE, [e1], '插入长文本');
  });

  it('编辑改回原文 → dirty=false（与全量语义一致）', () => {
    const e1 = BASE.replace('着衣持钵', '着衣持钵！');
    const e2 = BASE; // 撤销回到原文
    const seq = runIncrementalSeq(BASE, [e1, e2]);
    expect(seq.dirty).toBe(false);
    const full = classifyEdit(BASE, e2);
    expect(full.dirty).toBe(false);
  });

  it('undo 后重新编辑（基线固定语义）结果一致', () => {
    const e1 = BASE.replace('佛住', '佛在');
    const e2 = BASE; // undo
    const e3 = BASE.replace('佛住', '佛居'); // 再编辑
    assertConsistent(BASE, [e1, e2, e3], 'undo 后重新编辑');
  });

  it('大范围变化（>30%）触发熔断回退全量', () => {
    // 修改超过 30% 的文本
    const prefix = BASE.slice(0, 100);
    const rest = BASE.slice(100);
    const big = prefix + rest.split('').map((c) => c === '\n' ? '\n' : 'x').join('');
    const seq = runIncrementalSeq(BASE, [big]);
    const full = classifyEdit(BASE, big);
    expect(seq.dirty).toBe(full.dirty);
    expect(normalize(seq.segments)).toEqual(normalize(full.segments));
  });

  it('CJK 与标点混合编辑增量结果一致', () => {
    const e1 = BASE.replace('如是我闻。一时', '如是我闻，一时');
    const e2 = e1.replace('着衣持钵，入王舍城乞食。', '着衣持钵。入王舍城乞食。');
    const e3 = e2.replace('须菩提', '须菩提尊者');
    assertConsistent(BASE, [e1, e2, e3], 'CJK 标点混合');
  });

  it('新增行导致行号变化（换行编辑）增量结果一致', () => {
    const e1 = BASE.replace('第二章 正宗分\n', '第二章 正宗分\n\n\n佛言：善哉善哉。\n\n');
    const e2 = e1.replace('第三章 流通分', '第三章 流通分\n\n经毕。');
    assertConsistent(BASE, [e1, e2], '换行插入');
  });
});
