# rebuildDiffLayer 长度锁步错位 — 修复方案

## 一、问题概述

### 1.1 现象

用户在编辑模式下删除文本时，出现两个问题：
1. **文本顺序错乱**：删除 `願樂欲聞。` 后，文本显示为 `樂欲聞願`（乱序）
2. **字符丢失**：`。` 消失

### 1.2 复现条件

- 原始文件末尾：`...唯然世尊。願樂欲聞。`
- 修改文件末尾：`...唯然世尊。樂欲聞`
- 原始 diff 产生三个段：
  - `del("願")` — phantom（不在 baseline 中）
  - `none("樂欲聞")` — 非 phantom（在 baseline 中）
  - `del("。")` — phantom（不在 baseline 中）
- 用户在编辑模式下删除 `願樂欲聞。`（实际只能删除 baseline 中的 `樂欲聞`）

### 1.3 影响范围

- **触发条件**：任何原始 diff 含 phantom 段（del/mod-old），且用户编辑覆盖了 phantom 附近的文本
- **影响**：phantom 段的 `text.length` 被错误计入 baseline 消费预算，导致 `rebuildDiffLayer` 游标错位，后续所有 diff 装饰位置错误

---

## 二、根因分析

### 2.1 错误代码

`src/components/report-page/CodeMirrorDiff.vue` L121-178，`rebuildDiffLayer` 函数。

### 2.2 核心错误

`rebuildDiffLayer` 用 **baseline 长度（`need = s.text.length`）** 去消费 `diffSegmentsRef`，但 `diffSegmentsRef` 包含 phantom 段（del/mod-old），其文本不在 baseline 中。

两个致命点：

#### 致命点 1：phantom 分支（L131-144）— "吃掉"原始 phantom widget

```typescript
if (isPhantomSegment(s)) {
  let need = len;  // len = baseline 中被删的字符数
  while (need > 0 && bi < diffSegmentsRef.length) {
    const bs = diffSegmentsRef[bi];
    const avail = bs.text.length - bOff;
    const take = Math.min(need, avail);
    need -= take;      // ← 如果 bs 是 phantom，need 被错误递减
    bOff += take;
    ...
  }
  continue;  // ← 不输出任何装饰
}
```

phantom `bs`（如 `del("願")`）的文本不在 baseline 中，却被当作 baseline 文本消费，导致 `need` 提前归零，后续段错位。phantom 分支不输出任何装饰，所以原始 phantom widget 被错误"吃掉"。

#### 致命点 2：none 分支（L146-171）— 残留偏移导致全局错位

```typescript
if (s.operation === "none") {
  let need = len;
  let placed = 0;
  while (need > 0 && bi < diffSegmentsRef.length) {
    const bs = diffSegmentsRef[bi];
    const avail = bs.text.length - bOff;
    const take = Math.min(need, avail);
    if (isPhantomSegment(bs)) {
      // phantom 段：放置 widget
      builder.add(spanStart + placed, spanStart + placed, ...);
      // ← 不推进 placed，不递减 need，但推进 bOff/bi
    } else {
      placed += take;
      need -= take;
      bOff += take;
    }
    if (bOff >= bs.text.length) { bi++; bOff = 0; }
  }
}
```

phantom `bs` 不推进 `placed`/`need`，但推进 `bOff`/`bi`。当 `bOff` 残留在某个段中间（如 `none("樂欲聞")` 只消费 2/3）就跳到下一个 `userSeg`，后续所有段对齐全部错位。

#### 致命点 3：val.map(tr.changes) 在防抖窗口内产生临时乱序

`makeField` 的 `val.map(tr.changes)`（L41）在 300ms 防抖窗口内，将旧 DecorationSet 的 widget 位置映射到删除后的新位置。由于上述重建错误，临时态的 widget 映射产生视觉乱序。

### 2.3 执行追踪（用户删除 `樂欲聞` 场景）

```
diffSegmentsRef:  [..., none("唯然世尊。"), del("願"), none("樂欲聞"), del("。"), none("\n佛告...")]

userSegs:         [..., none("唯然世尊。"), del("樂欲聞"), none("\n佛告...")]
```

处理 `del("樂欲聞")`（phantom 分支，need=3）：

| 步骤 | bi 指向 | bs 类型 | take | need 变化 | 问题 |
|---|---|---|---|---|---|
| 1 | del("願") | phantom | 1 | 3→2 | "願" 不在 baseline 中，不应消耗 need |
| 2 | none("樂欲聞") | non-phantom | 2 | 2→0 | 只消费 2/3 字符，bOff=2（残留） |

处理下一个 `none("\n佛告...")` 时，bi/bOff 处于错误状态（停在 "樂欲聞" 中间 bOff=2），后续全部错位：
- "聞"(1字符) 被当作 none 消费（不输出）
- `del("。")` widget 落在错误位置
- 后续所有段继续错位

**结果**："願" widget 丢失，"。" widget 乱位 → 视觉乱序。

---

## 三、修复策略

### 3.1 核心思路

**抛弃"用 baseline 长度消费 diffSegmentsRef"的锁步策略**，改为 **预计算映射表 + 直接查表**。

关键洞察：`diffSegmentsRef` 中每个段在 baseline 中的偏移是固定的、已知的。baseline 是从 `diffSegmentsRef` 中剔除 phantom 后拼接的，所以 phantom 段的 `baseStart === baseEnd`（不占 baseline 空间）。

### 3.2 数据结构

```typescript
interface DiffSegInfo {
  seg: Segment;        // 原始段引用
  baseStart: number;   // 该段在 baseline 中的起始偏移
  baseEnd: number;     // 该段在 baseline 中的结束偏移（phantom: baseEnd === baseStart）
  isPhantom: boolean;
}
```

### 3.3 预计算函数

```typescript
function buildDiffSegMap(): void {
  diffSegMap = [];
  let basePos = 0;
  for (const seg of diffSegmentsRef) {
    const len = seg.text.length;
    if (len === 0) continue;
    if (isPhantomSegment(seg)) {
      // phantom 段不占 baseline 空间，baseStart === baseEnd = 当前 basePos
      diffSegMap.push({ seg, baseStart: basePos, baseEnd: basePos, isPhantom: true });
    } else {
      diffSegMap.push({ seg, baseStart: basePos, baseEnd: basePos + len, isPhantom: false });
      basePos += len;
    }
  }
}
```

**调用点**：`ensureEditor()` 中设置 `diffSegmentsRef` 后立即调用。

---

## 四、rebuildDiffLayer 重写

### 4.1 完整代码

```typescript
function rebuildDiffLayer(v: EditorView, userSegs: Segment[]): void {
  const builder = new RangeSetBuilder<Decoration>();
  let editedPos = 0;  // 编辑后文档中的当前位置
  let basePos = 0;    // baseline 中的当前位置
  let di = 0;         // diffSegMap 游标（单调递增）

  for (const s of userSegs) {
    const len = s.text.length;
    if (len === 0) continue;

    if (isPhantomSegment(s)) {
      // ── 用户删除了 baseline [basePos, basePos+len] ──
      const delEnd = basePos + len;
      while (di < diffSegMap.length) {
        const dm = diffSegMap[di];
        if (dm.baseEnd <= basePos) { di++; continue; }   // 在删除范围之前
        if (dm.baseStart >= delEnd) break;                 // 在删除范围之后
        // 完全在删除范围内 → 跳过
        if (dm.baseStart >= basePos && dm.baseEnd <= delEnd) { di++; continue; }
        // 部分重叠 → 留给下个 none 段处理（只标注未删除部分）
        break;
      }
      basePos += len;
      continue;
    }

    if (s.operation === "none") {
      // ── 未改动区 [basePos, basePos+len] → [editedPos, editedPos+len] ──
      const segBaseStart = basePos;
      const segBaseEnd = basePos + len;
      const editStart = editedPos;

      while (di < diffSegMap.length) {
        const dm = diffSegMap[di];

        // 在当前段之前 → 跳过
        if (dm.baseEnd < segBaseStart) { di++; continue; }
        // 在当前段之后 → 停止
        if (dm.baseStart > segBaseEnd) break;

        // 与 [segBaseStart, segBaseEnd] 有重叠
        if (dm.isPhantom) {
          // phantom widget：放在对应的编辑后文档位置
          const editOffset = editStart + (dm.baseStart - segBaseStart);
          builder.add(editOffset, editOffset,
            Decoration.widget({ widget: new PhantomWidget(dm.seg.text, markClass(dm.seg)), side: -1 }));
          di++;
        } else if (dm.seg.operation !== "none") {
          // 原始 add/mod-new mark：放在重叠区间
          const overlapStart = Math.max(dm.baseStart, segBaseStart);
          const overlapEnd = Math.min(dm.baseEnd, segBaseEnd);
          if (overlapEnd > overlapStart) {
            const markStart = editStart + (overlapStart - segBaseStart);
            const attrs = dm.seg.ci != null ? { "data-ci": String(dm.seg.ci) } : undefined;
            builder.add(markStart, markStart + (overlapEnd - overlapStart),
              Decoration.mark({ class: markClass(dm.seg), attributes: attrs }));
          }
          if (dm.baseEnd <= segBaseEnd) di++;
          else break;  // 跨越当前段，留给下一个 none
        } else {
          // none 段：无装饰
          if (dm.baseEnd <= segBaseEnd) di++;
          else break;
        }
      }
      editedPos += len;
      basePos += len;
      continue;
    }

    // add / mod-new：用户插入文本，不影响 baseline 偏移
    editedPos += len;
  }

  v.dispatch({ effects: setDiffDecos.of(builder.finish()) });
}
```

### 4.2 执行追踪验证（用户删除 `樂欲聞`）

```
diffSegMap:
  dm0: none("唯然世尊。"),  base=[0, 5],   non-phantom
  dm1: del("願"),           base=[5, 5],   phantom     ← 边界 phantom
  dm2: none("樂欲聞"),      base=[5, 8],   non-phantom
  dm3: del("。"),           base=[8, 8],   phantom     ← 边界 phantom
  dm4: none("\n佛告..."),   base=[8, 8+L], non-phantom

userSegs:
  ..., none("唯然世尊。"), del("樂欲聞"), none("\n佛告...") ...
```

| 步骤 | userSeg | 操作 | di 指向 | 结果 |
|---|---|---|---|---|
| 1 | none("唯然世尊。") len=5 | none 分支 [0,5]→[E,E+5] | dm0→dm1→dm2(break) | dm0: none, 无装饰, di→1. dm1: phantom "願" → widget@(E+5), di→2. dm2: baseStart(5) > segBaseEnd(5)? No, but operation="none" and baseEnd(8) > segBaseEnd(5) → break. |
| 2 | del("樂欲聞") len=3 | phantom 分支, skip [5,8] | dm2→dm3(break) | dm2: fully within [5,8] → di→3. dm3: baseStart(8) >= delEnd(8) → break. |
| 3 | none("\n佛告...") len=L | none 分支 [8,8+L]→[E+5,E+5+L] | dm3→dm4→... | dm3: phantom "。" → widget@(E+5), di→4. dm4: none, 无装饰, di→5. ... |

**最终结果**：
- "願" widget 在 E+5（"唯然世尊。"末尾）✓
- "。" widget 在 E+5（"\n佛告..."开头）✓
- "樂欲聞" 无原始装饰（被用户删除覆盖）✓
- 后续段完全对齐 ✓

---

## 五、边界情况处理

### 5.1 边界 phantom 归属规则

| phantom 位置 | 处理者 | 原因 |
|---|---|---|
| P === segBaseEnd（某 none 段末尾） | 该 none 段的 flushNone | `baseStart(P) > segBaseEnd(P)` → false，进入处理 |
| P === segBaseStart（某 none 段开头） | 该 none 段的 flushNone | `baseEnd(P) < segBaseStart(P)` → false，进入处理 |
| P 严格在 user-del 范围内 | user-del 分支跳过 | 用户删除了周围的 baseline 文本 |
| P === user-del 范围边界 | 相邻 none 段 | user-del 用 `>=` 判断"之后" |

**关键：`<` 和 `>` 的选择确保边界 phantom 恰好被一个 none 段处理。**

### 5.2 其他边界情况

1. **文档开头的 phantom**：`baseStart=baseEnd=0`，第一个 `none` 段的 `flushNone(0, len, 0)` 处理它。✓

2. **文档末尾的 phantom**：`baseStart=baseEnd=baseline.length`，最后一个 `none` 段处理。如果用户删到文档末尾（user-del 到末尾），phantom 在 `delEnd` 边界 → 不被处理（正确，用户删除了一切）。✓

3. **连续 phantom**（如 `del("A"), del("B")`）：两个 `DiffSegInfo` 有相同的 `baseStart=baseEnd`，`flushNone` 依次处理，两个 widget 叠加在同一位置。✓

4. **diff 段跨越 user-del 边界**：一个非 phantom 段部分在 `none` 区、部分在 user-del 区。`flushNone` 只标注 `none` 部分的重叠区间，然后 break。user-del 分支遇到它时（部分重叠）也 break，留给下一个 `none`。但下个 `none` 的 `flushNone` 会用 `Math.max/Math.min` 裁剪到自己的范围。✓

---

## 六、RangeSetBuilder 排序安全性

CodeMirror 的 `RangeSetBuilder` 要求 `add()` 的 `from` 值单调非递减。

验证：
- **none 段内**：`editOffset = editStart + (dm.baseStart - segBaseStart)`，`dm.baseStart` 单调递增 → `editOffset` 单调递增 ✓
- **跨 none 段**：`editedPos` 递增 → `editStart` 递增 ✓
- **user-del 段**：无 `add()` 调用 ✓
- **add/mod-new 段**：无 `add()` 调用 ✓

---

## 七、性能分析

- `buildDiffSegMap()`：O(N)，N = diffSegmentsRef 长度，只在 `ensureEditor` 时执行一次
- `rebuildDiffLayer()`：O(N + M)，N = diffSegMap 长度，M = userSegs 长度，`di` 单调递增不回溯
- 与原算法相同的时间复杂度，无性能退化

---

## 八、实施计划

### 8.1 需要修改的文件

| 文件 | 修改内容 |
|---|---|
| `src/components/report-page/CodeMirrorDiff.vue` | 1. 新增 `DiffSegInfo` 接口和 `diffSegMap` 变量 |
| | 2. 新增 `buildDiffSegMap()` 函数 |
| | 3. 在 `ensureEditor()` 中调用 `buildDiffSegMap()` |
| | 4. 重写 `rebuildDiffLayer()` 函数 |

### 8.2 不需要修改的文件

- `editClassifier.ts`（classifyEdit 逻辑正确）
- `buildDiffLayerInitial()`（初始化逻辑正确，pos 只计非 phantom）
- `buildDecoSet()`（用户装饰构建逻辑正确）
- `restoreDiffLayer()`（调用 `buildDiffLayerInitial()`，正确）

### 8.3 实施步骤

1. **新增 `DiffSegInfo` 接口和 `diffSegMap` 变量**
   - 位置：`CodeMirrorDiff.vue` 顶部，`diffSegmentsRef` 声明附近
   - 代码：

   ```typescript
   interface DiffSegInfo {
     seg: Segment;
     baseStart: number;
     baseEnd: number;
     isPhantom: boolean;
   }
   let diffSegMap: DiffSegInfo[] = [];
   ```

2. **新增 `buildDiffSegMap()` 函数**
   - 位置：`CodeMirrorDiff.vue`，`rebuildDiffLayer` 之前
   - 代码：见第三节 3.3

3. **在 `ensureEditor()` 中调用 `buildDiffSegMap()`**
   - 位置：`ensureEditor()` 中 `diffSegmentsRef = segs.map(...)` 之后
   - 新增一行：`buildDiffSegMap();`

4. **重写 `rebuildDiffLayer()` 函数**
   - 位置：替换 `CodeMirrorDiff.vue` L121-178
   - 代码：见第四节 4.1

### 8.4 验证计划

1. **构建验证**：`npm run build` 无 TypeScript 错误
2. **功能验证**：
   - 加载 `275导出.txt` 和 `275导出修改.txt`
   - 进入编辑模式
   - 删除 `願樂欲聞。`（实际删除 baseline 中的 `樂欲聞`）
   - 验证："願" widget 保留在正确位置，"。" widget 保留在正确位置，无乱序
3. **回归验证**：
   - 用户未编辑时，原始 diff 装饰正常显示
   - 用户编辑后，原始 diff 装饰正确重建
   - 用户完全删除某段后，相关 phantom widget 正确消失
   - 用户撤销（undo）后，装饰恢复到初始状态
