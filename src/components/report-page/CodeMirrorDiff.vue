<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount, nextTick } from "vue";
import { EditorView, Decoration, DecorationSet, WidgetType } from "@codemirror/view";
import { EditorState, StateEffect, StateEffectType, StateField, RangeSetBuilder, Compartment, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { defaultKeymap, historyKeymap, history, undoDepth } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { useCompareStore } from "../../stores/compare";
import { useEditorStore } from "../../stores/editor";
import { useSearchStore } from "../../stores/search";
import { classifyEdit, isPhantomSegment, buildDocText, normalizeLineEndings } from "../../render/editClassifier";
import { mergeSegments } from "../../render/incrementalClassify";
import { classifyInWorker, resetWorkerSession } from "../../utils/classifyWorker";
import { searchInSegments } from "../../utils/search";
import type { Segment } from "@/types";
import { asSegmentId, type SegmentId } from "@/types";

const compareStore = useCompareStore();
const editorStore = useEditorStore();
const searchStore = useSearchStore();

const containerRef = ref<HTMLDivElement | null>(null);
/** Second-stage confirmation before permanently discarding a draft (rev. 8-4). */
const confirmDiscard = ref(false);

/**
 * 方案 P2（单 CM 实例）：大文档（scale M/L）查看态也用 CM 只读渲染，
 * 与编辑态共享同一 EditorView；通过 Compartment 动态切换 editable。
 */
const editableCompartment = new Compartment();
const isViewCM = computed(
  () => !editorStore.isEditing
    && (compareStore.meta?.scale === "M" || compareStore.meta?.scale === "L"),
);

let view: EditorView | null = null;
let classifyTimer: ReturnType<typeof setTimeout> | null = null;
let baseline = "";            // fixed at editor creation — NEVER reassigned (rev. A2)
let diffSegmentsRef: Segment[] = []; // original diff segments, kept for diff-layer rebuilds (rev. A7)
// Rev. A11: pre-computed baseline-offset map for diffSegmentsRef. Each entry
// records where the segment's text sits in `baseline`; phantom segments
// (del/mod-old) are point-like (baseStart === baseEnd) because they take no
// baseline space. rebuildDiffLayer consults this map instead of walking
// diffSegmentsRef by length — fixing the phantom-length pollution bug.
interface DiffSegInfo {
  seg: Segment;
  baseStart: number;
  baseEnd: number;
  isPhantom: boolean;
}
let diffSegMap: DiffSegInfo[] = [];
let segOffsets: Array<{ ci: SegmentId; start: number; end: number }> = []; // ci → doc offset (rev. A8)
let cachedDocFingerprint = ""; // doc-text hash of the cached view (rev. C3 guard)
/** 编辑版本号（方案 L4）：每次 classify 递增，Worker 过期结果按此丢弃。 */
let editVersion = 0;
/** undo 历史上限（方案 P5/4-10）：超过后以当前 doc 重建 state（checkpoint 压缩）。
 * CM6 的 history() 无 maxDepth 参数，采用"超限即清空历史"策略——doc 不变，
 * 仅丢弃最旧的 undo 记录，防百万字文档 history ChangeSet 内存膨胀。 */
const MAX_UNDO_DEPTH = 500;
/** 压缩重建时的 state extensions（模块级保存，供 EditorState.create 复用）。 */
let editorExtensions: Extension[] = [];
/** editable 初始配置（只读查看态），压缩重建时按当前状态替换为对应配置。 */
let editableInitialExt: Extension = EditorView.editable.of(false);
/** 压缩重建后跳过下一次 docChanged 的 classify（doc 文本实际未变）。 */
let suppressClassifyNext = false;

// ── Effects ──────────────────────────────────────────────────
const setDiffDecos = StateEffect.define<DecorationSet>();
const setUserDecos = StateEffect.define<DecorationSet>();
const setSearchDecos = StateEffect.define<DecorationSet>();
const setBookmarkDecos = StateEffect.define<DecorationSet>();

// ── State fields: DecorationSet ─────────────────────────────────
function makeField(effect: StateEffectType<DecorationSet>) {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (val, tr) => {
      // CRITICAL: map stored decorations through the transaction's changes.
      // Without this, a large doc replacement (paste/fill) leaves the field
      // holding positions beyond the new doc length, and CM's RangeSet
      // comparison throws "Position N is out of range for changeset".
      val = val.map(tr.changes);
      for (const e of tr.effects) if (e.is(effect)) val = e.value;
      return val;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
const diffField = makeField(setDiffDecos);
const userField = makeField(setUserDecos);
const searchField = makeField(setSearchDecos);
const bookmarkField = makeField(setBookmarkDecos);

// ── Helpers ──────────────────────────────────────────────────
function markClass(s: Segment): string {
  if (s.origin === "user") {
    if (s.operation === "add") return "cm-user-add";
    if (s.operation === "del") return "cm-user-del";
    if (s.operation === "mod") return s.side === "old" ? "cm-user-mod-old" : "cm-user-mod-new";
    return "";
  }
  switch (s.operation) {
    case "add": return "cm-add";
    case "del": return "cm-del";
    case "mod": return s.side === "old" ? "cm-mod-old" : "cm-mod-new";
    default: return "";
  }
}

/** Widget showing deleted/mod-old text at its original position (rev. A5). */
class PhantomWidget extends WidgetType {
  constructor(readonly text: string, readonly cls: string) { super(); }
  eq(other: PhantomWidget) { return other.text === this.text && other.cls === this.cls; }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-phantom ${this.cls}`;
    // Keep on one line, cap length to avoid pathological layouts.
    const text = this.text.length > 1000 ? this.text.slice(0, 1000) + "…" : this.text;
    span.textContent = text.replace(/\n/g, "⏎");
    span.title = text;
    return span;
  }
}

/** Does this segment exist in the edited document (non-phantom)? */
function isDocSegment(s: Segment): boolean {
  return !isPhantomSegment(s);
}

/** Widget marking the last edit position (rev. edit-persistence). */
class BookmarkWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-bookmark";
    span.textContent = "\u{1F4CC}";  // 📌
    span.title = "上次编辑位置";
    return span;
  }
  eq() { return true; }
}

let bookmarkTimer: ReturnType<typeof setTimeout> | null = null;
/** True while a programmatic reset rewrites the doc — suppress draft persistence (rev. 8-4). */
let suppressSave = false;

/**
 * Apply bookmark decoration at the given offset. The marker is a jump hint,
 * not a permanent annotation — it auto-hides after 2s (rev. 8-4: user request).
 * Re-invoking resets the timer so a repeated jump keeps the hint visible.
 */
function applyBookmark(offset: number): void {
  const v = view;
  if (!v || offset < 0 || offset > v.state.doc.length) return;
  if (bookmarkTimer) clearTimeout(bookmarkTimer);
  const deco = Decoration.widget({ widget: new BookmarkWidget(), side: -1 });
  v.dispatch({
    effects: setBookmarkDecos.of(Decoration.set([deco.range(offset)])),
  });
  bookmarkTimer = setTimeout(() => {
    view?.dispatch({ effects: setBookmarkDecos.of(Decoration.none) });
    bookmarkTimer = null;
  }, 2000);
}

function buildDecoSet(segs: Segment[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let pos = 0;
  for (const s of segs) {
    const len = s.text.length;
    if (len === 0) continue;
    if (isPhantomSegment(s)) {
      // Phantom consumes no doc space in EITHER mode (rev. A3 — fixes
      // diff-mode marks landing on wrong offsets after a phantom segment).
      // Rev. B5: 保留查看模式的对比结果——两种模式都在原位置渲染 widget:
      // user 模式用用户色(cm-user-del/mod-old), diff 模式用原始差异色(cm-del/mod-old)。
      builder.add(pos, pos, Decoration.widget({ widget: new PhantomWidget(s.text, markClass(s)), side: -1 }));
      continue;
    }
    if (s.operation === "none") { pos += len; continue; }
    const cls = markClass(s);
    // Rev. E2: attach data-ci so the DOM carries the same anchor as the
    // ci→offset map used by __cmScrollToCi (editing-mode navigation).
    const attrs = s.ci != null ? { "data-ci": String(s.ci) } : undefined;
    if (cls) builder.add(pos, pos + len, Decoration.mark({ class: cls, attributes: attrs }));
    pos += len;
  }
  return builder.finish();
}

/**
 * Pre-compute the baseline-offset map for diffSegmentsRef (rev. A11).
 *
 * Walks the original diff segments once and records, for each segment, its
 * position in the baseline text. Non-phantom segments occupy [baseStart,
 * baseEnd) of the baseline; phantom segments (del/mod-old) occupy no baseline
 * space, so their range is a point (baseStart === baseEnd) — the position
 * where their widget should be inserted.
 */
function buildDiffSegMap(): void {
  diffSegMap = [];
  let basePos = 0;
  for (const seg of diffSegmentsRef) {
    const len = seg.text.length;
    if (len === 0) continue;
    if (isPhantomSegment(seg)) {
      diffSegMap.push({ seg, baseStart: basePos, baseEnd: basePos, isPhantom: true });
    } else {
      diffSegMap.push({ seg, baseStart: basePos, baseEnd: basePos + len, isPhantom: false });
      basePos += len;
    }
  }
}

/**
 * Rebuild the ORIGINAL diff layer over the CURRENT (edited) document.
 *
 * userSegs is a baseline↔edited diff. Instead of walking diffSegmentsRef by
 * length (which broke on phantom segments — their text is not part of the
 * baseline, so the lockstep cursor drifted), we consult the pre-computed
 * diffSegMap: each diff segment knows its [baseStart, baseEnd) in baseline
 * space, and 'none' user spans map 1:1 by baseline offset onto the edited
 * document. User-touched ranges (phantom/add/mod-new) stay blank in the diff
 * layer (rev. A7, A11).
 */
function rebuildDiffLayer(v: EditorView, userSegs: Segment[]): void {
  const builder = new RangeSetBuilder<Decoration>();
  let editedPos = 0;  // position in the edited document
  let basePos = 0;    // position in the baseline
  let di = 0;         // diffSegMap cursor (monotonic)

  for (const s of userSegs) {
    const len = s.text.length;
    if (len === 0) continue;

    if (isPhantomSegment(s)) {
      // User deleted baseline text [basePos, basePos+len]: consume that range
      // from the base cursor, render nothing. Entries at the range boundaries
      // belong to adjacent 'none' spans and are left for them.
      const delStart = basePos;
      const delEnd = basePos + len;
      while (di < diffSegMap.length) {
        const dm = diffSegMap[di];
        if (dm.baseEnd <= delStart) { di++; continue; }  // fully before deletion
        if (dm.baseStart >= delEnd) break;                // fully after deletion
        // Overlapping the deletion range: skip only entries fully inside it.
        if (dm.baseStart >= delStart && dm.baseEnd <= delEnd) { di++; continue; }
        break;  // partial overlap — next 'none' span handles the kept part
      }
      basePos += len;
      continue;
    }

    if (s.operation === "none") {
      // Untouched baseline span [segBaseStart, segBaseEnd) maps 1:1 onto the
      // edited document at [editStart, editStart + len).
      const segBaseStart = basePos;
      const segBaseEnd = basePos + len;
      const editStart = editedPos;

      while (di < diffSegMap.length) {
        const dm = diffSegMap[di];
        if (dm.baseEnd < segBaseStart) { di++; continue; }  // fully before span
        if (dm.baseStart > segBaseEnd) break;               // fully after span

        if (dm.isPhantom) {
          // Original del/mod-old: show as a widget at its (unchanged) position.
          const editOffset = editStart + (dm.baseStart - segBaseStart);
          builder.add(editOffset, editOffset, Decoration.widget({
            widget: new PhantomWidget(dm.seg.text, markClass(dm.seg)),
            side: -1,
          }));
          di++;
        } else if (dm.seg.operation !== "none") {
          // Original add/mod-new mark: clip to the overlap with this span.
          const overlapStart = Math.max(dm.baseStart, segBaseStart);
          const overlapEnd = Math.min(dm.baseEnd, segBaseEnd);
          if (overlapEnd > overlapStart) {
            const markStart = editStart + (overlapStart - segBaseStart);
            // Rev. E2: data-ci attribute mirrors the non-editing anchor (id="ci-N").
            const attrs = dm.seg.ci != null ? { "data-ci": String(dm.seg.ci) } : undefined;
            builder.add(markStart, markStart + (overlapEnd - overlapStart),
              Decoration.mark({ class: markClass(dm.seg), attributes: attrs }));
          }
          if (dm.baseEnd <= segBaseEnd) di++;
          else break;  // spans beyond this 'none' segment — keep for the next
        } else {
          // Unchanged original span — nothing to decorate.
          if (dm.baseEnd <= segBaseEnd) di++;
          else break;
        }
      }
      editedPos += len;
      basePos += len;
      continue;
    }

    // add / mod-new: user-inserted text, no baseline footprint.
    editedPos += len;
  }

  v.dispatch({ effects: setDiffDecos.of(builder.finish()) });
}

/** Initial diff layer — doc equals baseline at creation, place marks directly. */
function buildDiffLayerInitial(): void {
  const builder = new RangeSetBuilder<Decoration>();
  let pos = 0;
  for (const s of diffSegmentsRef) {
    const len = s.text.length;
    if (len === 0) continue;
    if (isPhantomSegment(s)) {
      // Rev. B5: 保留查看模式的对比结果——原始 del/mod-old 在原位以 widget 显示
      // (红底删除线 / 黄底删除线),与用户删除显示形式一致,不占文档位置。
      builder.add(pos, pos, Decoration.widget({ widget: new PhantomWidget(s.text, markClass(s)), side: -1 }));
      continue;
    }
    const cls = markClass(s);
    if (cls && s.operation !== "none") builder.add(pos, pos + len, Decoration.mark({ class: cls }));
    pos += len;
  }
  view?.dispatch({ effects: setDiffDecos.of(builder.finish()) });
}

/** Restore the full original diff layer over the untouched doc (rev. A4). */
function restoreDiffLayer(): void {
  buildDiffLayerInitial();
}

/**
 * Build search-match decorations over the CURRENT document.
 * Matches come from searchStore (computed against the EDITED segments —
 * see E1). searchInSegments reports segment-relative offsets, so we must
 * convert via the segment list: CM doc position = cumulative length of
 * preceding non-phantom segments + segment-relative offset.
 */
function buildSearchDecos(matches: { segmentIndex: number; textOffset: number; length: number }[]): DecorationSet {
  const segs = editorStore.getEditedSegments();
  // Cumulative doc offsets of each segment (phantom segments take no space).
  const docOffsets: number[] = [];
  let pos = 0;
  for (const s of segs) {
    docOffsets.push(pos);
    if (!isPhantomSegment(s)) pos += s.text.length;
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const m of matches) {
    if (m.segmentIndex < 0 || m.segmentIndex >= docOffsets.length) continue;
    const start = docOffsets[m.segmentIndex] + m.textOffset;
    const end = start + m.length;
    if (end > start) builder.add(start, end, Decoration.mark({ class: "cm-search-hl" }));
  }
  return builder.finish();
}

// ── Editor lifecycle ─────────────────────────────────────────

/**
 * 应用一次 classifyEdit 结果：更新 user 装饰 + diff 层 + store 缓存（方案 L4）。
 * 主线程与 Worker 结果统一走此函数，保证装饰逻辑单一来源。
 *
 * 方案 P5（阶段二）：支持增量结果——incremental+localSegments 时与
 * store 缓存合并（mergeSegments，内部去缝 + 全量重编号 ci），装饰层仍
 * 全量重建（buildDecoSet/rebuildDiffLayer 为 O(n) 遍历，百万段 ~20-40ms，
 * 相对增量 diff 收益可忽略，UI 无感）。
 */
function applyClassifyResult(
  userResult: {
    dirty: boolean;
    segments?: Segment[] | null;
    incremental?: { from: number; to: number } | null;
    localSegments?: Segment[] | null;
  },
  version: number,
): void {
  const v = view;
  if (!v) return;

  if (!userResult.dirty) {
    // Rev. A4: fully undone — restore the untouched original diff layer.
    v.dispatch({ effects: setUserDecos.of(Decoration.none) });
    restoreDiffLayer();
    editorStore.hasEdits = false;
    // 方案 P5：主线程缓存必须与 Worker session.lastSegments 保持一致——
    // 增量路径"改回原文"时 Worker 已更新为全 none 段，缓存也存合并结果
    // （而非空数组），否则下次增量合并会丢失窗口外段。
    if (userResult.incremental && userResult.localSegments) {
      const prev = editorStore.workerSegments ?? [];
      editorStore.setWorkerResult(version, mergeSegments(prev, userResult.incremental.from, userResult.incremental.to, userResult.localSegments));
    } else {
      editorStore.setWorkerResult(version, []);
    }
    return;
  }

  // 增量路径：合并 store 缓存为完整 segments（全量路径直接使用）
  let merged: Segment[];
  if (userResult.incremental && userResult.localSegments) {
    const prev = editorStore.workerSegments ?? [];
    merged = mergeSegments(prev, userResult.incremental.from, userResult.incremental.to, userResult.localSegments);
  } else {
    merged = userResult.segments ?? [];
  }

  v.dispatch({
    effects: setUserDecos.of(merged.length > 0 ? buildDecoSet(merged) : Decoration.none),
  });
  // Rev. A7: rebuild the diff layer with user-touched doc ranges excluded,
  // so the original colors stay blank underneath user edits.
  rebuildDiffLayer(v, merged);
  editorStore.hasEdits = true;
  // 方案 L4：store 缓存 worker 最新结果（getEditedSegments 不再全量重算）
  editorStore.setWorkerResult(version, merged);
}

/**
 * 方案 P5/4-10: checkpoint 压缩 undo 历史。
 * CM6 history() 无 maxDepth 配置，超过 MAX_UNDO_DEPTH 时以当前 doc 重建
 * EditorState（历史清空），doc/selection/装饰层保持不变——只丢弃最旧的
 * undo 记录，防百万字文档 history ChangeSet 内存膨胀。压缩后深度归零，
 * 不会频繁触发。doc 实际未变，故 compressHistory 全程 suppressSave +
 * suppressClassifyNext，避免误重建草稿或触发一次无意义的全量 classify。
 */
function compressHistory(): void {
  const v = view;
  if (!v || editorExtensions.length === 0) return;
  const docText = v.state.doc.toString();
  const anchor = v.state.selection.main.head;
  const scroll = v.scrollDOM.scrollTop;
  const userSegs = editorStore.getEditedSegments();
  // 重建时保持当前 editable 状态（editorExtensions 初始为只读配置）
  const editableExt = editableCompartment.of(EditorView.editable.of(!v.state.readOnly));
  const extensions = editorExtensions.map((e) => (e === editableInitialExt ? editableExt : e));
  suppressSave = true;
  suppressClassifyNext = true;
  const newState = EditorState.create({
    doc: docText,
    selection: { anchor },
    extensions,
  });
  v.setState(newState);
  // 重放装饰层（doc 未变，偏移一致）
  v.dispatch({
    effects: [
      setDiffDecos.of(buildDecoSet(diffSegmentsRef)),
      setUserDecos.of(userSegs.length > 0 ? buildDecoSet(userSegs) : Decoration.none),
      setSearchDecos.of(buildSearchDecos(searchStore.matches)),
    ],
  });
  v.scrollDOM.scrollTop = scroll;
  suppressSave = false;
}

/**
 * 语言扩展基于对比文档类型（rev. B4）。
 */
function languageExtensions(): Extension[] {
  const name = compareStore.fileAName.toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) return [markdown()];
  return [];
}

/**
 * Create the EditorView ONCE and cache it (rev. C3). Re-entering edit
 * mode reuses the same view/state, preserving undo history, selection
 * and scroll position. The container div is kept in the DOM via v-show
 * so the view never detaches between edit sessions.
 */
function ensureEditor() {
  if (view) return;
  const segs = editorStore.editSegments.length > 0
    ? editorStore.editSegments
    : compareStore.segments;
  baseline = normalizeLineEndings(buildDocText(segs));
  cachedDocFingerprint = baseline;
  // Rev. edit-persistence: when resuming a draft, the edited text differs
  // from the baseline — use it as the initial doc instead of clobbering it.
  const hasDraft = editorStore.hasEdits
    && editorStore.editText
    && editorStore.editText !== baseline;
  const initialDoc = hasDraft ? editorStore.editText : baseline;
  editorStore.editText = initialDoc;
  diffSegmentsRef = segs.map((s) => ({ ...s, text: normalizeLineEndings(s.text) }));
  buildDiffSegMap();  // rev. A11: pre-compute baseline offsets for diff-layer rebuilds

  // Rev. D1/6-5: synchronous flush — run classify immediately so export
  // reads content that is never behind the cursor (debounce bypassed).
  // 方案 L4：flush 保持主线程同步（导出需要即时结果），结果同步进 store 缓存。
  editorStore.registerFlush(() => {
    const v = view;
    if (!v) return;
    const fresh = v.state.doc.toString();
    if (!fresh) return;
    // Rev. 6-13: keep editText in sync even when the user undoes back to the
    // baseline — export must never read a stale edited text.
    editorStore.editText = fresh;
    if (fresh === baseline) {
      editorStore.hasEdits = false;
      v.dispatch({ effects: setUserDecos.of(Decoration.none) });
      restoreDiffLayer();
      editorStore.setWorkerResult(++editVersion, []);
      // 方案 P5：缓存已清空 → Worker 增量会话同步重置，防增量路径过期
      resetWorkerSession();
      return;
    }
    try {
      const version = ++editVersion;
      const userResult = classifyEdit(baseline, fresh);
      v.dispatch({
        effects: setUserDecos.of(
          userResult.dirty ? buildDecoSet(userResult.segments) : Decoration.none,
        ),
      });
      if (userResult.dirty) rebuildDiffLayer(v, userResult.segments);
      else restoreDiffLayer();
      editorStore.hasEdits = userResult.dirty;
      editorStore.setWorkerResult(version, userResult.dirty ? userResult.segments : []);
    } catch (e) {
      // Rev. A10: degrade to no user decorations instead of crashing.
      console.error("classifyEdit failed", e);
      v.dispatch({ effects: setUserDecos.of(Decoration.none) });
    }
  });

  // 方案 P5/4-10: extensions 保存到模块级，checkpoint 压缩重建 state 时复用
  editorExtensions = [
    diffField,
    userField,
    searchField,
    bookmarkField,
    keymap.of([...defaultKeymap, ...historyKeymap]), // rev. A1: undo/redo keybinds
    history(), // CRITICAL: history() extension enables undo — historyKeymap alone is a no-op
    // 方案 P2: 初始只读（查看态），进入编辑时 reconfigure 为可编辑
    editableInitialExt = editableCompartment.of(EditorView.editable.of(false)),
    EditorView.lineWrapping,
    ...languageExtensions(), // rev. B4: markdown syntax highlighting
    EditorView.updateListener.of((update) => {
        // Track cursor & scroll position on every update (rev. edit-persistence)
        // Skip persistence while a programmatic reset (discardDraft/resetToOriginal)
        // is rewriting the doc — otherwise the reset re-creates an empty draft.
        if (!suppressSave) {
          const pos = update.state.selection.main.head;
          const scroll = update.view.scrollDOM.scrollTop;
          editorStore.updateCursorAndScroll(pos, scroll);
        }

        if (!update.docChanged) return;
        // 方案 P5/4-10: checkpoint 压缩重建后的首次 update 跳过（doc 实际未变）
        if (suppressClassifyNext) {
          suppressClassifyNext = false;
          return;
        }
        // 方案 P5/4-10: undo 历史超限 → 压缩（以当前 doc 重建 state，清空历史）。
        // 只在编辑态检查（查看态不可编辑，undoDepth 恒 0）；压缩后深度归零不会频发。
        if (update.view.state.readOnly !== true) {
          try {
            if (undoDepth(update.state) > MAX_UNDO_DEPTH) compressHistory();
          } catch { /* history 扩展缺失时忽略 */ }
        }
        // Track last edit offset (rev. edit-persistence). Skipped during
        // programmatic resets — discardDraft already cleared it to -1.
        if (!suppressSave) {
          let lastTo = 0;
          update.changes.iterChangedRanges((fromA, toA) => { lastTo = toA; });
          editorStore.lastEditOffset = lastTo;
        }

        const current = update.state.doc.toString();
        if (!current) return;

        if (classifyTimer) clearTimeout(classifyTimer);
        classifyTimer = setTimeout(() => {
          const v = view;
          if (!v) return;
          const fresh = v.state.doc.toString();
          if (!fresh) return;
          // Rev. 6-13: keep editText in sync even when undo returns to baseline.
          editorStore.editText = fresh;
          if (fresh === baseline) {
            editorStore.hasEdits = false;
            v.dispatch({ effects: setUserDecos.of(Decoration.none) });
            restoreDiffLayer();
            editorStore.setWorkerResult(++editVersion, []);
            // 方案 P5：缓存已清空 → Worker 增量会话同步重置
            resetWorkerSession();
            return;
          }

          const version = ++editVersion;
          // 方案 L4：全量 classify 移入 Worker（UI 零阻塞）；Worker 不可用自动回主线程
          classifyInWorker(baseline, fresh, version, (resp) => {
            const vv = view;
            if (!vv) return;
            if (resp === null) {
              // 降级：Worker 不可用 → 主线程同步执行
              try {
                applyClassifyResult(classifyEdit(baseline, fresh), version);
              } catch (e) {
                console.error("classifyEdit failed", e);
                vv.dispatch({ effects: setUserDecos.of(Decoration.none) });
              }
              return;
            }
            // 版本号不匹配 → 过期结果，静默丢弃（防抖窗口内又有输入）
            if (resp.version !== version) return;
            if (resp.type === "error") {
              console.error("classify worker error", resp.message);
              try {
                applyClassifyResult(classifyEdit(baseline, fresh), version);
              } catch (e) {
                console.error("classifyEdit failed", e);
                vv.dispatch({ effects: setUserDecos.of(Decoration.none) });
              }
              return;
            }
            applyClassifyResult(
              {
                dirty: resp.dirty ?? false,
                segments: resp.segments ?? null,
                incremental: resp.incremental ?? null,
                localSegments: resp.localSegments ?? null,
              },
              resp.version,
            );
          });
        }, 300);
      }),
  ];

  const state = EditorState.create({
    doc: initialDoc || "",
    extensions: editorExtensions,
  });

  view = new EditorView({
    state,
    parent: containerRef.value!,
  });

  // Apply diff decorations after mount (no exclusion yet — user hasn't edited)
  view.dispatch({ effects: setDiffDecos.of(buildDecoSet(diffSegmentsRef)) });

  // If a draft was loaded, apply user decorations + restore cursor/scroll/bookmark
  if (editorStore.hasEdits && editorStore.editText && editorStore.editText !== baseline) {
    try {
      const userResult = classifyEdit(baseline, editorStore.editText);
      view.dispatch({
        effects: setUserDecos.of(
          userResult.dirty ? buildDecoSet(userResult.segments) : Decoration.none,
        ),
      });
      if (userResult.dirty) rebuildDiffLayer(view, userResult.segments);
      // 方案 L4：恢复草稿时初始化 store 缓存
      editorStore.setWorkerResult(++editVersion, userResult.dirty ? userResult.segments : []);
    } catch (e) {
      console.error("draft restore classifyEdit failed", e);
    }

    // Restore cursor position (clamp to doc length)
    const savedCursor = editorStore.cursorPos;
    if (savedCursor > 0 && savedCursor <= view.state.doc.length) {
      view.dispatch({
        selection: { anchor: savedCursor },
        effects: EditorView.scrollIntoView(savedCursor, { y: "center" }),
      });
    } else if (editorStore.scrollPos > 0) {
      view.scrollDOM.scrollTop = editorStore.scrollPos;
    }

    // Apply bookmark at last edit position
    if (editorStore.lastEditOffset >= 0) {
      applyBookmark(editorStore.lastEditOffset);
    }

    view.focus();
  }
}

// ci → doc-offset map for edit-mode navigation (rev. A8/E2)
function buildOffsetMap(): void {
  segOffsets = [];
  let pos = 0;
  let ci: SegmentId = asSegmentId(0);
  const segs = editorStore.editSegments.length > 0 ? editorStore.editSegments : compareStore.segments;
  for (const s of segs) {
    if (!isDocSegment(s)) continue;
    const len = s.text.length;
    if (s.ci != null) {
      ci = asSegmentId(s.ci);
      segOffsets.push({ ci, start: pos, end: pos + len });
    }
    pos += len;
  }
  // Fallback: if no ci available, index changed segments sequentially
  if (segOffsets.length === 0) {
    pos = 0; ci = asSegmentId(0);
    for (const s of segs) {
      if (!isDocSegment(s)) { pos += s.text.length; continue; }
      ci = asSegmentId(ci + 1);
      segOffsets.push({ ci, start: pos, end: pos + s.text.length });
      pos += s.text.length;
    }
  }
}

function scrollToCi(ci: SegmentId): void {
  const v = view;
  if (!v) return;
  const target = segOffsets.find((o) => o.ci === ci);
  if (!target) return;
  v.dispatch({
    selection: { anchor: target.start },
    effects: EditorView.scrollIntoView(target.start, { y: "center" }),
  });
  v.focus();
}

/** Jump to the last edit position (rev. edit-persistence). */
function scrollToLastEdit(): void {
  const v = view;
  const offset = editorStore.lastEditOffset;
  if (!v || offset < 0) return;
  const clamped = Math.min(offset, v.state.doc.length);
  v.dispatch({
    selection: { anchor: clamped },
    effects: EditorView.scrollIntoView(clamped, { y: "center" }),
  });
  applyBookmark(clamped);
  v.focus();
}

// Expose navigation to the page (Sidebar / J-K shortcuts, rev. E3)
function exposeNavigation(): void {
  const el = containerRef.value?.closest(".report-main") ?? null;
  if (!el) return;
  const ns = el as HTMLElement & {
    __cmScrollToCi?: (ci: SegmentId) => void;
    __cmScrollToLastEdit?: () => void;
  };
  ns.__cmScrollToCi = scrollToCi;
  ns.__cmScrollToLastEdit = scrollToLastEdit;
}

watch(
  [() => editorStore.isEditing, isViewCM] as const,
  async ([editing, viewCM]) => {
    await nextTick();
    // 方案 P2: 编辑态或大文档查看态都需要 CM 实例；都不需要时保持现状（不创建）
    const wantCM = editing || viewCM;
    if (!wantCM) {
      syncSearchDecos();
      return;
    }
    const segs = editorStore.editSegments.length > 0
      ? editorStore.editSegments
      : compareStore.segments;
    const freshBaseline = normalizeLineEndings(buildDocText(segs));
    // Rev. C3 guard: a NEW comparison produces different baseline text.
    // The cached view cannot be reused (its doc/history belong to the old
    // document), so tear it down and rebuild from scratch.
    if (view && freshBaseline !== cachedDocFingerprint) {
      view.destroy();
      view = null;
    }
    ensureEditor();
    buildOffsetMap();
    exposeNavigation();
    // 方案 P5：进入编辑态（含草稿恢复）重置 Worker 增量会话——
    // store 缓存可能由主线程直接设置（草稿恢复/还原），Worker 端
    // lastSegments 与之不同步，强制下次 classify 走全量重建，保证一致。
    if (editing) resetWorkerSession();
    // 方案 P2: 查看态 ↔ 编辑态通过 Compartment 切换 editable（单 CM 实例）
    const v = view;
    if (v) {
      v.dispatch({
        effects: editableCompartment.reconfigure(EditorView.editable.of(!!editing)),
      });
      if (editing) v.focus();
    }
    // Rev. A9: show search highlights inside the editor if a search is active
    syncSearchDecos();
  },
  // Rev. edit-persistence/2: resuming from the Select page sets isEditing
  // BEFORE this component mounts — without immediate, the editor never builds.
  { immediate: true },
);

// Rev. C2: "还原" clears user decorations in the editor — the store bumps
// resetToken and we drop the user layer + rebuild the untouched diff layer.
watch(
  () => editorStore.resetToken,
  async () => {
    if (!editorStore.isEditing || !view) return;
    await nextTick();
    const v = view;
    // Rev. 8-4: suppress draft persistence across ALL programmatic dispatches
    // in this reset (deco clears + doc rewrite) — any one of them would
    // otherwise schedule a save that re-creates an empty draft.
    suppressSave = true;
    v.dispatch({ effects: setUserDecos.of(Decoration.none) });
    restoreDiffLayer();
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: baseline },
    });
    suppressSave = false;
    // 方案 P5：还原后 store 缓存已清空，Worker 增量会话同步重置
    resetWorkerSession();
  },
);

// ── Search highlight layer (rev. A9/6-10) ────────────────────
// Search matches are computed over the current doc; since CM offsets are
// JS string offsets, we can overlay them directly as marks. Search runs on
// the EDITED segments (see E1) so this stays in sync with the doc.
function syncSearchDecos(): void {
  const v = view;
  if (!v || !editorStore.isEditing) return;
  const matches = searchStore.matches;
  v.dispatch({ effects: setSearchDecos.of(buildSearchDecos(matches)) });
}

// Watch search state changes while editing (rev. A9)
watch(
  () => [searchStore.matches, editorStore.isEditing] as const,
  () => { syncSearchDecos(); },
);

onBeforeUnmount(() => {
  if (classifyTimer) clearTimeout(classifyTimer);
  if (bookmarkTimer) clearTimeout(bookmarkTimer);
  view?.destroy();
  view = null;
  // Clean up the exposed navigation hooks
  const el = containerRef.value?.closest(".report-main") ?? null;
  if (el) {
    const ns = el as HTMLElement & {
      __cmScrollToCi?: unknown;
      __cmScrollToLastEdit?: unknown;
    };
    delete ns.__cmScrollToCi;
    delete ns.__cmScrollToLastEdit;
  }
});
</script>

<template>
  <div v-show="editorStore.isEditing || isViewCM" class="cm-diff-wrapper">
    <h4 class="pane-title">
      {{ editorStore.isEditing ? '编辑模式' : '对比视图（大文档）' }}
      <span class="hint">琥珀=新增 紫=删除 绿/红/黄=原始差异</span>
      <span class="font-ctrl">
        <button class="font-btn" @click="editorStore.adjustFontSize(-1)" title="缩小字体">A−</button>
        <span class="font-size-label">{{ editorStore.fontSize }}px</span>
        <button class="font-btn" @click="editorStore.adjustFontSize(1)" title="放大字体">A+</button>
      </span>
    </h4>
    <div ref="containerRef" class="cm-container" :style="{ '--editor-font-size': editorStore.fontSize + 'px' }" />

    <!-- Draft recovery modal (rev. edit-persistence) -->
    <div v-if="editorStore.hasPendingDraft" class="draft-modal-overlay" @click.prevent>
      <div class="draft-modal">
        <template v-if="!confirmDiscard">
          <h3 class="draft-title">检测到上次编辑未完成</h3>
          <p class="draft-files">
            {{ editorStore.pendingDraft?.fileAName }}
            &harr;
            {{ editorStore.pendingDraft?.fileBName }}
          </p>
          <p class="draft-progress">
            已处理 {{ editorStore.processedCis.length }} 处变更，
            {{ compareStore.stats.total - editorStore.processedCis.length }} 处待处理
          </p>
          <div class="draft-actions">
            <button class="draft-btn draft-btn-primary" @click="editorStore.acceptDraft()">
              继续编辑
            </button>
            <button class="draft-btn draft-btn-secondary" @click="confirmDiscard = true">
              从头开始
            </button>
          </div>
        </template>
        <!-- Second-stage confirmation: discarding is irreversible (rev. 8-4) -->
        <template v-else>
          <h3 class="draft-title">确定从头开始？</h3>
          <p class="draft-progress">上次的编辑草稿将被永久删除，此操作不可撤销。</p>
          <div class="draft-actions">
            <button class="draft-btn draft-btn-primary" @click="editorStore.discardDraft()">
              确定删除
            </button>
            <button class="draft-btn draft-btn-secondary" @click="confirmDiscard = false">
              取消
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cm-diff-wrapper {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}
.pane-title {
  font-size: 12px; font-weight: 600; padding: 6px 12px;
  background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border);
  flex-shrink: 0; display: flex; align-items: center; gap: 8px;
}
.pane-title .hint {
  font-weight: 400; color: var(--color-text-secondary); font-size: 11px;
}
.font-ctrl {
  margin-left: auto; display: flex; align-items: center; gap: 4px;
}
.font-btn {
  width: 24px; height: 24px; padding: 0; border: 1px solid var(--color-border);
  border-radius: 4px; background: var(--color-bg); cursor: pointer;
  font-size: 12px; line-height: 1; color: var(--color-text);
  display: flex; align-items: center; justify-content: center;
}
.font-btn:hover { background: var(--color-bg-hover); }
.font-size-label {
  font-size: 11px; color: var(--color-text-secondary); min-width: 32px; text-align: center;
}
.cm-container {
  flex: 1; overflow: auto; padding: 8px 16px;
  font-family: var(--font-mono); font-size: var(--editor-font-size, 16px);
}
</style>

<style>
/* Global — CodeMirror renders outside scoped styles */
.cm-container .cm-editor { height: 100%; }
.cm-container .cm-editor .cm-content {
  font-family: var(--font-mono); font-size: var(--editor-font-size, 16px);
  line-height: 1.6; padding: 8px 0;
}
.cm-container .cm-editor .cm-gutters { display: none; }

/* Original diff colors */
.cm-add { background: var(--color-add-bg); color: var(--color-add-text); }
.cm-del { background: var(--color-del-bg); color: var(--color-del-text); text-decoration: line-through; }
.cm-mod-old { background: var(--color-mod-old-bg); color: var(--color-mod-old-text); text-decoration: line-through; }
.cm-mod-new { background: var(--color-mod-new-bg); color: var(--color-mod-new-text); }

/* User edit colors — applied as the TOP decoration, so they win */
.cm-user-add { background: var(--color-user-add-bg); color: var(--color-user-add-text); text-decoration: none; font-weight: 400; }
.cm-user-del { background: var(--color-user-del-bg); color: var(--color-user-del-text); text-decoration: line-through; font-weight: 400; }
.cm-user-mod-old { background: var(--color-user-mod-old-bg); color: var(--color-user-mod-old-text); text-decoration: line-through; font-weight: 400; outline: 1px dashed #d4a72c; }
.cm-user-mod-new { background: var(--color-user-mod-new-bg); color: var(--color-user-mod-new-text); text-decoration: none; font-weight: 600; outline: 1px solid #d4a72c; }

/* Phantom widget (deleted/mod-old text shown at its original spot) */
.cm-phantom {
  text-decoration: line-through;
  font-weight: 400;
  border-radius: 3px;
  padding: 0 2px;
  margin: 0 1px;
}
.cm-phantom.cm-user-del { background: var(--color-user-del-bg); color: var(--color-user-del-text); }
.cm-phantom.cm-user-mod-old { background: var(--color-user-mod-old-bg); color: var(--color-user-mod-old-text); outline: 1px dashed #d4a72c; }
.cm-phantom.cm-del { background: var(--color-del-bg); color: var(--color-del-text); }
.cm-phantom.cm-mod-old { background: var(--color-mod-old-bg); color: var(--color-mod-old-text); }

/* Search highlight inside the editor (rev. A9) */
.cm-search-hl {
  background: var(--color-search-highlight);
  outline: 1px solid var(--color-focus-border);
}

/* Bookmark — last edit position marker (rev. edit-persistence) */
.cm-bookmark {
  display: inline-block;
  font-size: 14px;
  line-height: 1;
  vertical-align: middle;
  opacity: 0.7;
  animation: cm-bookmark-pulse 2s ease-in-out infinite;
}
@keyframes cm-bookmark-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.9; }
}

/* Draft recovery modal (rev. edit-persistence) */
.draft-modal-overlay {
  position: absolute; inset: 0; z-index: 100;
  background: rgba(0, 0, 0, 0.3);
  display: flex; align-items: center; justify-content: center;
}
.draft-modal {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 20px 24px;
  max-width: 420px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.draft-title {
  font-size: 15px; font-weight: 600; margin: 0 0 12px;
  color: var(--color-text);
}
.draft-files {
  font-size: 13px; font-family: var(--font-mono);
  color: var(--color-text-secondary); margin: 0 0 8px;
  word-break: break-all;
}
.draft-progress {
  font-size: 12px; color: var(--color-text-secondary); margin: 0 0 16px;
}
.draft-actions {
  display: flex; gap: 8px; justify-content: flex-end;
}
.draft-btn {
  padding: 6px 16px; font-size: 13px; border: 1px solid var(--color-border);
  border-radius: 6px; cursor: pointer; background: var(--color-bg);
  color: var(--color-text);
}
.draft-btn:hover { background: var(--color-bg-hover); }
.draft-btn-primary {
  background: var(--color-focus-border); color: #fff; border-color: var(--color-focus-border);
}
.draft-btn-primary:hover { opacity: 0.9; background: var(--color-focus-border); }
</style>
