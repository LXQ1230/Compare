<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick } from "vue";
import { EditorView, Decoration, DecorationSet, WidgetType } from "@codemirror/view";
import { EditorState, StateEffect, StateEffectType, StateField, RangeSetBuilder, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { defaultKeymap, historyKeymap, history } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { useCompareStore } from "../../stores/compare";
import { useEditorStore } from "../../stores/editor";
import { useSearchStore } from "../../stores/search";
import { classifyEdit, isPhantomSegment, buildDocText } from "../../render/editClassifier";
import { searchInSegments } from "../../utils/search";
import type { Segment } from "@/types";

const compareStore = useCompareStore();
const editorStore = useEditorStore();
const searchStore = useSearchStore();

const containerRef = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
let classifyTimer: ReturnType<typeof setTimeout> | null = null;
let baseline = "";            // fixed at editor creation — NEVER reassigned (rev. A2)
let diffSegmentsRef: Segment[] = []; // original diff segments, kept for diff-layer rebuilds (rev. A7)
let segOffsets: Array<{ ci: number; start: number; end: number }> = []; // ci → doc offset (rev. A8)
let cachedDocFingerprint = ""; // doc-text hash of the cached view (rev. C3 guard)

// ── Effects ──────────────────────────────────────────────────
const setDiffDecos = StateEffect.define<DecorationSet>();
const setUserDecos = StateEffect.define<DecorationSet>();
const setSearchDecos = StateEffect.define<DecorationSet>();

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
 * Rebuild the ORIGINAL diff layer over the CURRENT (edited) document.
 *
 * userSegs is a baseline↔edited diff; 'none' runs map 1:1 by length onto
 * baseline text.  We walk both streams in lockstep and place original
 * change marks only on untouched text — user-touched ranges stay blank in
 * the diff layer (rev. A7).  Called after every successful classify.
 */
function rebuildDiffLayer(v: EditorView, userSegs: Segment[]): void {
  const builder = new RangeSetBuilder<Decoration>();
  let editedPos = 0;
  let bi = 0;
  let bOff = 0;

  for (const s of userSegs) {
    const len = s.text.length;
    if (len === 0) continue;

    if (isPhantomSegment(s)) {
      // Baseline-only text (deleted): consume the base cursor, render nothing.
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
      // Baseline span maps 1:1 to the doc span.
      const spanStart = editedPos;
      let need = len;
      let placed = 0;
      while (need > 0 && bi < diffSegmentsRef.length) {
        const bs = diffSegmentsRef[bi];
        const avail = bs.text.length - bOff;
        if (avail <= 0) { bi++; bOff = 0; continue; }
        const take = Math.min(need, avail);
        if (isPhantomSegment(bs)) {
          // Rev. B5: 未触碰区的原始 del/mod-old 在原位以 widget 显示(与进入时一致)
          builder.add(spanStart + placed, spanStart + placed, Decoration.widget({ widget: new PhantomWidget(bs.text, markClass(bs)), side: -1 }));
        } else if (bs.operation !== "none") {
          // Rev. E2: data-ci attribute mirrors the non-editing anchor (id="ci-N").
          const attrs = bs.ci != null ? { "data-ci": String(bs.ci) } : undefined;
          builder.add(spanStart + placed, spanStart + placed + take, Decoration.mark({ class: markClass(bs), attributes: attrs }));
        }
        placed += take;
        need -= take;
        bOff += take;
        if (bOff >= bs.text.length) { bi++; bOff = 0; }
      }
      editedPos = spanStart + len;
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
/** Language extensions based on the compared document's type (rev. B4). */
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
  baseline = buildDocText(segs);
  cachedDocFingerprint = baseline;
  editorStore.editText = baseline;
  diffSegmentsRef = segs;

  // Rev. D1/6-5: synchronous flush — run classify immediately so export
  // reads content that is never behind the cursor (debounce bypassed).
  editorStore.registerFlush(() => {
    const v = view;
    if (!v) return;
    const fresh = v.state.doc.toString();
    if (!fresh || fresh === baseline) return;
    try {
      const userResult = classifyEdit(baseline, fresh);
      v.dispatch({
        effects: setUserDecos.of(
          userResult.dirty ? buildDecoSet(userResult.segments) : Decoration.none,
        ),
      });
      if (userResult.dirty) rebuildDiffLayer(v, userResult.segments);
      else restoreDiffLayer();
      editorStore.editText = fresh;
      editorStore.hasEdits = userResult.dirty;
    } catch (e) {
      // Rev. A10: degrade to no user decorations instead of crashing.
      console.error("classifyEdit failed", e);
      v.dispatch({ effects: setUserDecos.of(Decoration.none) });
    }
  });

  const state = EditorState.create({
    doc: baseline || "",
    extensions: [
      diffField,
      userField,
      searchField,
      keymap.of([...defaultKeymap, ...historyKeymap]), // rev. A1: undo/redo keybinds
      history(), // CRITICAL: history() extension enables undo — historyKeymap alone is a no-op
      EditorView.editable.of(true),
      EditorView.lineWrapping,
      ...languageExtensions(), // rev. B4: markdown syntax highlighting
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const current = update.state.doc.toString();
        if (!current || current === baseline) return;

        if (classifyTimer) clearTimeout(classifyTimer);
        classifyTimer = setTimeout(() => {
          const v = view;
          if (!v) return;
          const fresh = v.state.doc.toString();
          if (!fresh || fresh === baseline) return;

          try {
            // Fixed-baseline reclassification (rev. A2): undo naturally reverts
            // because we never move the baseline.
            const userResult = classifyEdit(baseline, fresh);
            v.dispatch({
              effects: setUserDecos.of(
                userResult.dirty ? buildDecoSet(userResult.segments) : Decoration.none,
              ),
            });
            if (userResult.dirty) {
              // Rev. A7: rebuild the diff layer with user-touched doc ranges excluded,
              // so the original colors stay blank underneath user edits.
              rebuildDiffLayer(v, userResult.segments);
            } else {
              // Rev. A4: fully undone — restore the untouched original diff layer.
              restoreDiffLayer();
            }

            editorStore.editText = fresh;
            editorStore.hasEdits = userResult.dirty;
          } catch (e) {
            // Rev. A10: degrade to no user decorations instead of crashing.
            console.error("classifyEdit failed", e);
            v.dispatch({ effects: setUserDecos.of(Decoration.none) });
          }
        }, 300);
      }),
    ],
  });

  view = new EditorView({
    state,
    parent: containerRef.value!,
  });

  // Apply diff decorations after mount (no exclusion yet — user hasn't edited)
  view.dispatch({ effects: setDiffDecos.of(buildDecoSet(diffSegmentsRef)) });
}

// ci → doc-offset map for edit-mode navigation (rev. A8/E2)
function buildOffsetMap(): void {
  segOffsets = [];
  let pos = 0;
  let ci = 0;
  const segs = editorStore.editSegments.length > 0 ? editorStore.editSegments : compareStore.segments;
  for (const s of segs) {
    if (!isDocSegment(s)) continue;
    const len = s.text.length;
    if (s.ci != null) {
      ci = s.ci;
      segOffsets.push({ ci, start: pos, end: pos + len });
    }
    pos += len;
  }
  // Fallback: if no ci available, index changed segments sequentially
  if (segOffsets.length === 0) {
    pos = 0; ci = 0;
    for (const s of segs) {
      if (!isDocSegment(s)) { pos += s.text.length; continue; }
      ci++;
      segOffsets.push({ ci, start: pos, end: pos + s.text.length });
      pos += s.text.length;
    }
  }
}

function scrollToCi(ci: number): void {
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

// Expose navigation to the page (Sidebar / J-K shortcuts, rev. E3)
function exposeNavigation(): void {
  const el = containerRef.value?.closest(".report-main") ?? null;
  if (!el) return;
  const ns = el as HTMLElement & { __cmScrollToCi?: (ci: number) => void };
  ns.__cmScrollToCi = scrollToCi;
}

watch(
  () => editorStore.isEditing,
  async (editing) => {
    await nextTick();
    if (!editing) {
      syncSearchDecos();
      return;
    }
    const segs = editorStore.editSegments.length > 0
      ? editorStore.editSegments
      : compareStore.segments;
    const freshBaseline = buildDocText(segs);
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
    // Rev. A9: show search highlights inside the editor if a search is active
    syncSearchDecos();
  },
);

// Rev. C2: "还原" clears user decorations in the editor — the store bumps
// resetToken and we drop the user layer + rebuild the untouched diff layer.
watch(
  () => editorStore.resetToken,
  async () => {
    if (!editorStore.isEditing || !view) return;
    await nextTick();
    const v = view;
    v.dispatch({ effects: setUserDecos.of(Decoration.none) });
    restoreDiffLayer();
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: baseline },
    });
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
  view?.destroy();
  view = null;
  // Clean up the exposed navigation hook
  const el = containerRef.value?.closest(".report-main") ?? null;
  if (el) delete (el as HTMLElement & { __cmScrollToCi?: unknown }).__cmScrollToCi;
});
</script>

<template>
  <div v-show="editorStore.isEditing" class="cm-diff-wrapper">
    <h4 class="pane-title">
      编辑模式
      <span class="hint">琥珀=新增 紫=删除 绿/红/黄=原始差异</span>
    </h4>
    <div ref="containerRef" class="cm-container" />
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
.cm-container {
  flex: 1; overflow: auto; padding: 8px 16px;
  font-family: var(--font-mono); font-size: var(--font-size-base);
}
</style>

<style>
/* Global — CodeMirror renders outside scoped styles */
.cm-container .cm-editor { height: 100%; }
.cm-container .cm-editor .cm-content {
  font-family: var(--font-mono); font-size: var(--font-size-base);
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
</style>
