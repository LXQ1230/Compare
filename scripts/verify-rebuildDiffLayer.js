/**
 * 逻辑验证脚本 — 模拟 rebuildDiffLayer 新算法（映射表 + 查表）
 *
 * 使用真实的 diff-match-patch 生成 userSegs（与 classifyEdit 相同逻辑），
 * 验证 rebuildDiffLayer 新算法的位置计算正确性。
 *
 * 场景：用户删除 baseline 中的 "樂欲聞"
 * 预期：
 *   1. "願" phantom widget 保留在 "唯然世尊。" 末尾
 *   2. "。" phantom widget 保留在 "\n佛告..." 开头
 *   3. "樂欲聞" 无原始装饰（被用户删除覆盖）
 *   4. 后续段完全对齐
 */
import { diff_match_patch } from "diff-match-patch";

// ── Segment 模拟 ──
function seg(text, operation, side, origin, ci) {
  return { text, operation, side, origin, ci };
}
function isPhantomSegment(s) {
  return s.operation === 'del' || (s.operation === 'mod' && s.side === 'old');
}
function buildDocText(segs) {
  return segs.filter((s) => !isPhantomSegment(s)).map((s) => s.text).join("");
}

// ── 真实的 classifyEdit 逻辑（从 editClassifier.ts 移植）──
function classifyEdit(baseline, edited) {
  if (baseline === edited) return { dirty: false, segments: [] };
  const dmp = new diff_match_patch();
  dmp.Diff_Timeout = 0;
  const rawDiffs = dmp.diff_main(baseline, edited);
  dmp.diff_cleanupSemantic(rawDiffs);
  const segments = [];
  let ci = 0;
  let i = 0;
  while (i < rawDiffs.length) {
    const [op, text] = rawDiffs[i];
    if (op === 0) { segments.push({ text, operation: 'none', origin: 'user' }); i++; continue; }
    if (op === 1) {
      if (i + 1 < rawDiffs.length && rawDiffs[i + 1][0] === -1) {
        const addText = text, delText = rawDiffs[i + 1][1];
        ci++;
        segments.push({ text: delText, operation: 'mod', origin: 'user', side: 'old', ci });
        segments.push({ text: addText, operation: 'mod', origin: 'user', side: 'new', ci });
        i += 2; continue;
      }
      ci++;
      segments.push({ text, operation: 'add', origin: 'user', ci });
      i++; continue;
    }
    if (i + 1 < rawDiffs.length && rawDiffs[i + 1][0] === 1) {
      const delText = text, addText = rawDiffs[i + 1][1];
      ci++;
      segments.push({ text: delText, operation: 'mod', origin: 'user', side: 'old', ci });
      segments.push({ text: addText, operation: 'mod', origin: 'user', side: 'new', ci });
      i += 2; continue;
    }
    ci++;
    segments.push({ text, operation: 'del', origin: 'user', ci });
    i++;
  }
  return { dirty: true, segments };
}

// ── 基于真实文件差异构造 diffSegmentsRef ──
// 原始(275导出.txt) 第一段:  如是我聞。一時。佛在舎衞國祇樹給孤獨園。...唯然世尊。願樂欲聞。
// 修改(275导出修改.txt) 第一段: 如是我聞一時。佛。在舎衞國祇國樹給孤獨園與大比丘衆千二百五十俱。...唯然世尊。樂欲聞
// 简化关注区域，保留真实差异结构
const originalText = "如是我聞。一時。佛在舎衞國祇樹給孤獨園。唯然世尊。願樂欲聞。\n佛告湏菩提。諸菩薩摩訶薩應如是降伏其心。";
const modifiedText = "如是我聞一時。佛。在舎衞國祇國樹給孤獨園唯然世尊。樂欲聞\n佛告湏菩提。諸菩薩摩訶薩應如是降伏其心。";

// 用 diff-match-patch 生成原始 diff segments（与后端 diff_engine 相似但简化）
// 实际后端会产生 Segment 数组；这里用真实的 dmp 模拟结构
function buildSegmentsFromDiff(original, modified) {
  const dmp = new diff_match_patch();
  dmp.Diff_Timeout = 0;
  const raw = dmp.diff_main(original, modified);
  dmp.diff_cleanupSemantic(raw);
  const segs = [];
  let ci = 0;
  let i = 0;
  while (i < raw.length) {
    const [op, text] = raw[i];
    if (op === 0) { segs.push(seg(text, "none")); i++; continue; }
    if (op === 1) {
      if (i + 1 < raw.length && raw[i + 1][0] === -1) {
        const addText = text, delText = raw[i + 1][1];
        ci++;
        segs.push(seg(delText, "mod", "old", undefined, ci));
        segs.push(seg(addText, "mod", "new", undefined, ci));
        i += 2; continue;
      }
      ci++;
      segs.push(seg(text, "add", undefined, undefined, ci));
      i++; continue;
    }
    if (i + 1 < raw.length && raw[i + 1][0] === 1) {
      const delText = text, addText = raw[i + 1][1];
      ci++;
      segs.push(seg(delText, "mod", "old", undefined, ci));
      segs.push(seg(addText, "mod", "new", undefined, ci));
      i += 2; continue;
    }
    ci++;
    segs.push(seg(text, "del", undefined, undefined, ci));
    i++;
  }
  return segs;
}

const diffSegmentsRef = buildSegmentsFromDiff(originalText, modifiedText);

console.log("=== diffSegmentsRef (原始差异段) ===");
for (const s of diffSegmentsRef) {
  console.log(`  [${s.operation}${s.side ? "-" + s.side : ""}] "${s.text}"`);
}

// ── buildDiffSegMap ──
function buildDiffSegMap() {
  const map = [];
  let basePos = 0;
  for (const s of diffSegmentsRef) {
    const len = s.text.length;
    if (len === 0) continue;
    if (isPhantomSegment(s)) {
      map.push({ seg: s, baseStart: basePos, baseEnd: basePos, isPhantom: true });
    } else {
      map.push({ seg: s, baseStart: basePos, baseEnd: basePos + len, isPhantom: false });
      basePos += len;
    }
  }
  return map;
}

const diffSegMap = buildDiffSegMap();
const baseline = buildDocText(diffSegmentsRef);

console.log("");
console.log("=== baseline (剔除 phantom) ===");
console.log(JSON.stringify(baseline));

// 用户删除 "樂欲聞"
const edited = baseline.replace("樂欲聞", "");
console.log("=== edited (用户删除樂欲聞) ===");
console.log(JSON.stringify(edited));

// 真实 classifyEdit
const userResult = classifyEdit(baseline, edited);
console.log("");
console.log("=== userSegs (真实 classifyEdit 输出) ===");
for (const s of userResult.segments) {
  console.log(`  [${s.operation}${s.side ? "-" + s.side : ""}] "${s.text}"`);
}

// 验证 userSegs 的 none 拼接 === baseline 剔除 del 后文本
const userNoneCheck = userResult.segments.filter((s) => !isPhantomSegment(s)).map((s) => s.text).join("");
console.log("");
console.log("=== 一致性检查 ===");
console.log("userSegs none 拼接 === edited ?", userNoneCheck === edited);

// ── 新算法 rebuildDiffLayer ──
function rebuildDiffLayer(userSegs) {
  const marks = [];
  let editedPos = 0;
  let basePos = 0;
  let di = 0;

  for (const s of userSegs) {
    const len = s.text.length;
    if (len === 0) continue;

    if (isPhantomSegment(s)) {
      const delStart = basePos;
      const delEnd = basePos + len;
      while (di < diffSegMap.length) {
        const dm = diffSegMap[di];
        if (dm.baseEnd <= delStart) { di++; continue; }
        if (dm.baseStart >= delEnd) break;
        if (dm.baseStart >= delStart && dm.baseEnd <= delEnd) { di++; continue; }
        break;
      }
      basePos += len;
      continue;
    }

    if (s.operation === "none") {
      const segBaseStart = basePos;
      const segBaseEnd = basePos + len;
      const editStart = editedPos;

      while (di < diffSegMap.length) {
        const dm = diffSegMap[di];
        if (dm.baseEnd < segBaseStart) { di++; continue; }
        if (dm.baseStart > segBaseEnd) break;

        if (dm.isPhantom) {
          const editOffset = editStart + (dm.baseStart - segBaseStart);
          marks.push({ from: editOffset, to: editOffset, widget: dm.seg.text, cls: "phantom-" + dm.seg.operation + (dm.seg.side || "") });
          di++;
        } else if (dm.seg.operation !== "none") {
          const overlapStart = Math.max(dm.baseStart, segBaseStart);
          const overlapEnd = Math.min(dm.baseEnd, segBaseEnd);
          if (overlapEnd > overlapStart) {
            const markStart = editStart + (overlapStart - segBaseStart);
            const clipped = dm.seg.text.slice(overlapStart - dm.baseStart, overlapEnd - dm.baseStart);
            marks.push({ from: markStart, to: markStart + (overlapEnd - overlapStart), mark: clipped, cls: "mark-" + dm.seg.operation + (dm.seg.side || "") });
          }
          if (dm.baseEnd <= segBaseEnd) di++;
          else break;
        } else {
          if (dm.baseEnd <= segBaseEnd) di++;
          else break;
        }
      }
      editedPos += len;
      basePos += len;
      continue;
    }

    editedPos += len;
  }

  return marks;
}

const result = rebuildDiffLayer(userResult.segments);

console.log("");
console.log("=== 重建后的装饰（新算法）===");
for (const m of result) {
  const loc = m.widget ? `@${m.from}` : `[${m.from},${m.to}]`;
  console.log(`  ${loc.padEnd(12)} ${(m.widget ? "WIDGET " + m.widget : "MARK   " + JSON.stringify(m.mark)).padEnd(20)} ${m.cls}`);
}

// ── 旧算法（修复前，保留原逻辑）对比 ──
function rebuildDiffLayerOLD(v, userSegs) {
  const marks = [];
  let editedPos = 0;
  let bi = 0;
  let bOff = 0;
  for (const s of userSegs) {
    const len = s.text.length;
    if (len === 0) continue;
    if (isPhantomSegment(s)) {
      let need = len;
      while (need > 0 && bi < diffSegmentsRef.length) {
        const bs = diffSegmentsRef[bi];
        const avail = bs.text.length - bOff;
        if (avail <= 0) { bi++; bOff = 0; continue; }
        const take = Math.min(need, avail);
        need -= take;
        bOff += take;
        if (bOff >= bs.text.length) { bi++; bOff = 0; }
      }
      continue;
    }
    if (s.operation === "none") {
      const spanStart = editedPos;
      let need = len;
      let placed = 0;
      while (need > 0 && bi < diffSegmentsRef.length) {
        const bs = diffSegmentsRef[bi];
        const avail = bs.text.length - bOff;
        if (avail <= 0) { bi++; bOff = 0; continue; }
        const take = Math.min(need, avail);
        if (isPhantomSegment(bs)) {
          marks.push({ from: spanStart + placed, to: spanStart + placed, widget: bs.text, cls: "phantom-" + bs.operation + (bs.side || "") });
        } else if (bs.operation !== "none") {
          const clipped = bs.text.slice(0, take);
          marks.push({ from: spanStart + placed, to: spanStart + placed + take, mark: clipped, cls: "mark-" + bs.operation + (bs.side || "") });
        }
        placed += take;
        need -= take;
        bOff += take;
        if (bOff >= bs.text.length) { bi++; bOff = 0; }
      }
      editedPos = spanStart + len;
      continue;
    }
    editedPos += len;
  }
  return marks;
}

const resultOLD = rebuildDiffLayerOLD(null, userResult.segments);
console.log("");
console.log("=== 重建后的装饰（旧算法，修复前）===");
for (const m of resultOLD) {
  const loc = m.widget ? `@${m.from}` : `[${m.from},${m.to}]`;
  console.log(`  ${loc.padEnd(12)} ${(m.widget ? "WIDGET " + m.widget : "MARK   " + JSON.stringify(m.mark)).padEnd(20)} ${m.cls}`);
}

const 願OLD = resultOLD.find((m) => m.widget === "願");
const 句号OLD = resultOLD.filter((m) => m.widget === "。");
const 目標句号OLD = 句号OLD.find((m) => m.widget === "。");
console.log("");
console.log("=== 旧算法问题复现 ===");
console.log("願 widget 保留:", !!願OLD, 願OLD ? `(位置 ${願OLD.from})` : "→ 被错误吃掉，丢失");
console.log("。 widget 位置:", 句号OLD.map((m) => m.from).join(",") || "无", "→ 数量/位置异常");
console.log("樂欲聞 无 mark:", !resultOLD.find((m) => m.mark && m.mark.includes("樂欲聞")));

// ── 断言 ──
console.log("");
console.log("=== 断言 ===");
let pass = true;

// 目标 phantom: "願" 在 "唯然世尊。" 末尾；"。" 在 "\n" 前
const 願Widgets = result.filter((m) => m.widget === "願");
const 句号Widgets = result.filter((m) => m.widget === "。");
const 願 = 願Widgets.find((m) => m.cls === "phantom-del");  // "願" 是 del
// "。" widget 有多个（"如是我聞"后 / "樹給孤獨園"后 / "樂欲聞"后），
// 目標是位置与 願 相同的那个（"樂欲聞" 后的 "。"）
const 目標句号 = 句号Widgets.find((m) => 願 && m.from >= 願.from && m !== 句号Widgets.find((x) => x.from < 願.from));

const 唯然世尊End = edited.indexOf("佛告"); // edited 中 "唯然世尊。\n" → \n 在 "佛告" 前 1 位
// 唯然世尊。 结束 = 位置 24（edited 中）
const 期望位置 = baseline.indexOf("樂欲聞"); // baseline 中 "樂欲聞" 起始 = 24

console.log("1. 願 phantom widget 位置:", 願 ? 願.from : "缺失", `(期望 ${期望位置})`);
if (!願 || 願.from !== 期望位置) pass = false;
console.log("2. 目標 。 phantom widget 位置:", 目標句号 ? 目標句号.from : "缺失", `(期望 ${期望位置})`);
if (!目標句号 || 目標句号.from !== 期望位置) pass = false;

const 樂欲聞Mark = result.find((m) => m.mark && m.mark.includes("樂欲聞"));
console.log("3. 樂欲聞 无原始 mark:", !樂欲聞Mark);
if (樂欲聞Mark) pass = false;

const 國Mark = result.find((m) => m.mark === "國" && m.cls === "mark-add");
console.log("4. 國 add mark 存在:", !!國Mark, 國Mark ? `(位置 ${國Mark.from})` : "");
if (!國Mark) pass = false;

// 5. 排序单调性：所有 from 非递减
let sorted = true;
for (let i = 1; i < result.length; i++) {
  if (result[i].from < result[i - 1].from) { sorted = false; break; }
}
console.log("5. from 单调非递减:", sorted);
if (!sorted) pass = false;

console.log("");
console.log(pass ? "✅ 全部断言通过 — 新算法正确" : "❌ 有断言失败");
