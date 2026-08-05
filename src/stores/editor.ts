import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { Segment, ChangeContext, EditSessionDraft } from "@/types";
import { asSegmentId } from "@/types";
import { useCompareStore } from "./compare";
import { buildDocText, normalizeLineEndings } from "@/render/editClassifier";
import { normalizeText, normalizeFullwidth } from "@/render/unicode";
import { storage } from "@/utils/storage";
import { api } from "@/utils/api";
import { fnv1aHash } from "@/utils/hash";

function cloneSegments(src: Segment[]): Segment[] {
  return src.map((s) => ({ ...s }));
}

export const useEditorStore = defineStore("editor", () => {
  const isEditing = ref(false);
  const editSegments = ref<Segment[]>([]);
  const editText = ref("");
  const hasEdits = ref(false);

  // ── Worker 分类结果缓存（方案 L4）────────────────────────────
  // getEditedSegments/editedStats/editedContexts 改读此缓存，
  // 消除"渲染一次 = 全量 classifyEdit 一次"的高频重算。
  const workerSegments = ref<Segment[] | null>(null);
  const workerVersion = ref(0);
  /** 最近一次成功 classify 的编辑文本快照（方案 B：saveDraft 新鲜度校验） */
  const workerEditedText = ref("");

  /**
   * 由 CodeMirrorDiff 在每次 classify（Worker 或主线程）完成后写入。
   * editedText 参数记录该结果对应的编辑文本（默认取当前 editText——
   * 调用方均先写 editText 再调本函数），saveDraft 据此判断缓存是否可复用。
   */
  function setWorkerResult(version: number, segments: Segment[], editedText = editText.value): void {
    workerVersion.value = version;
    workerSegments.value = segments;
    workerEditedText.value = editedText;
  }

  /** 本次会话待用的草稿 userSegments（方案 B：恢复免重算，由 resumeDraft/enterEdit 带入） */
  const draftUserSegments = ref<Segment[] | null>(null);

  // ── Edit session persistence state (rev. edit-persistence) ───────
  const cursorPos = ref(0);
  const scrollPos = ref(0);
  const lastEditOffset = ref(-1);
  const processedCis = ref<number[]>([]);
  const draftKey = ref("");
  const hasPendingDraft = ref(false);
  const pendingDraft = ref<EditSessionDraft | null>(null);

  /** Editor font size in pixels — persisted to localStorage (range 12–24, default 16). */
  const fontSize = ref<number>(
    Number(localStorage.getItem("editor-font-size")) || 16,
  );

  function setFontSize(px: number): void {
    const clamped = Math.max(12, Math.min(24, Math.round(px)));
    fontSize.value = clamped;
    localStorage.setItem("editor-font-size", String(clamped));
  }

  function adjustFontSize(delta: number): void {
    setFontSize(fontSize.value + delta);
  }

  // ── Unicode 偏好（三期 B 组）──────────────────────────────────
  // showInvisibleChars: CM 中可视化零宽/NBSP/控制字符（4-6）
  // fullwidthHalfwidth: 全角标点→半角，仅进入编辑模式时对基线/初始 doc 生效（4-7）
  const showInvisibleChars = ref(localStorage.getItem("cmp-invisible") === "1");
  const fullwidthHalfwidth = ref(localStorage.getItem("cmp-fullwidth") === "1");

  function setShowInvisibleChars(v: boolean): void {
    showInvisibleChars.value = v;
    localStorage.setItem("cmp-invisible", v ? "1" : "0");
  }

  function setFullwidthHalfwidth(v: boolean): void {
    fullwidthHalfwidth.value = v;
    localStorage.setItem("cmp-fullwidth", v ? "1" : "0");
  }

  /**
   * 三期 B 组（4-5/4-7）初始化统一变换：BOM+LF+NFC（必做）+ 可选全角→半角。
   * 仅用于「进入编辑模式时的基线/初始 doc」——classifyEdit 运行期输入即输出，
   * 避免 segments 与 doc 长度不一致导致装饰偏移错位（见 unicode.ts 一致性约定）。
   */
  function applyNormalizations(text: string): string {
    const t = normalizeText(text);
    return fullwidthHalfwidth.value ? normalizeFullwidth(t) : t;
  }

  /** Monotonic token — bumped by resetToOriginal so CodeMirrorDiff can clear user decorations (rev. C2). */
  const resetToken = ref(0);

  /**
   * Synchronous flush callback registered by CodeMirrorDiff (rev. D1/6-5).
   * Export needs to read `editText` fresh even while the debounced classify
   * is still pending, so the flush must run synchronously — a watched token
   * would be async and arrive too late.
   */
  let flushFn: (() => void) | null = null;

  function registerFlush(fn: () => void): void {
    flushFn = fn;
  }

  function flushEditsSync(): void {
    flushFn?.();
  }

  /** Baseline fixed at enterEdit time — NEVER reassigned (rev. 6-2). */
  const originalBaseline = ref("");

  const compareStore = useCompareStore();

  // ── Draft key computation ────────────────────────────────────────
  // Uses fileAName + fileBName + baseline text hash. Same pair of files
  // produces same segments → same baseline → same key. Different file
  // content produces different segments → different key. This is as
  // precise as content-hashing the raw files, without needing to store
  // the raw file content in the compare store.
  function computeDraftKey(): string {
    const baseline = normalizeLineEndings(buildDocText(compareStore.segments));
    const raw = compareStore.fileAName + "\0" + compareStore.fileBName + "\0" + baseline;
    return fnv1aHash(raw);
  }

  // ── Debounced save ──────────────────────────────────────────────
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveDraft(), 2000);
  }

  function saveDraft(): void {
    if (!isEditing.value || !draftKey.value) return;
    // Rev. 8-4 + 方案 P3-8: skip persisting a no-op draft (content back at
    // baseline with no edits, or emptied) — this stops a programmatic reset
    // (discardDraft/resetToOriginal) or undo-to-baseline from re-creating an
    // empty draft in storage.
    if (!hasEdits.value && (editText.value === originalBaseline.value || editText.value === '')) return;
    // 方案 B：仅缓存"与当前 editText 配套"的 classify 结果（workerEditedText 快照
    // 与 editText 逐字节一致才可复用）；worker 未算完/缓存落后 → 不存 userSegments，
    // 恢复时回退 worker 异步重算。保存路径永不阻塞。
    const cacheSegs = workerSegments.value;
    const cacheFresh = cacheSegs !== null
      && workerEditedText.value === editText.value
      && cacheSegs.length > 0;
    const draft: EditSessionDraft = {
      key: draftKey.value,
      editText: editText.value,
      baseline: originalBaseline.value,
      hasEdits: hasEdits.value,
      cursorPos: cursorPos.value,
      scrollPos: scrollPos.value,
      lastEditOffset: lastEditOffset.value,
      processedCis: processedCis.value,
      fileAName: compareStore.fileAName,
      fileBName: compareStore.fileBName,
      timestamp: Date.now(),
      // Rev. edit-persistence/2: carry the segments so the Select page can
      // resume the session without re-running the comparison.
      // （方案 L5/P4：storage.saveEditDraft 会去掉 segments/baseline 冗余存储，
      //  这里保留字段是为了后端 autosave 全量兜底）
      segments: compareStore.segments,
      stats: { ...compareStore.stats },
      totalChunks: compareStore.meta?.totalChunks ?? 0,
      // 方案 B：恢复免重算 DMP diff（仅存配套结果；IndexedDB 主体，不入 localStorage/后端）
      userSegments: cacheFresh ? cacheSegs : undefined,
    };
    // 方案 L5/P5：IndexedDB 主体 + localStorage 摘要（异步 fire-and-forget）
    storage.saveEditDraft(draft).catch(() => { /* best-effort */ });
    // Backend — async, fire-and-forget (cross-device backup; segments/baseline
    // 已瘦身去掉——segments 在 IndexedDB、baseline 由 segments 重建，见方案 L5 §4.5)
    api.autosave({
      action: "save", key: draft.key,
      text: draft.editText, time: draft.timestamp,
      cursor_pos: draft.cursorPos,
      scroll_pos: draft.scrollPos,
      last_edit_offset: draft.lastEditOffset,
      processed_cis: draft.processedCis,
      file_a_name: draft.fileAName,
      file_b_name: draft.fileBName,
      stats: draft.stats,
      total_chunks: draft.totalChunks,
    }).catch(() => { /* silent fallback — IndexedDB/localStorage still has it */ });
  }

  // ── enterEdit: load draft if available ──────────────────────────
  async function enterEdit(): Promise<void> {
    draftKey.value = computeDraftKey();

    // 1. Try IndexedDB first (方案 L5/P4: 草稿主体)
    let draft: EditSessionDraft | null = await storage.loadEditDraft(draftKey.value);
    // 方案 L5：IndexedDB 草稿不含 baseline，用本地重建（key 相同 → 同对比）
    // 三期 B 组：初始化统一变换（BOM+LF+NFC，可选全角→半角）
    const localBaseline = applyNormalizations(buildDocText(compareStore.segments));
    if (draft) draft = { ...draft, baseline: localBaseline };

    // 2. Try backend (cross-device backup; backend wins if newer)
    try {
      const remote = await api.autosave({ action: "load", key: draftKey.value });
      if (remote?.data && (remote.data as Record<string, unknown>).text) {
        const rd = remote.data as Record<string, unknown>;
        const remoteTime = (rd["time"] as number) ?? 0;
        if (!draft || remoteTime > draft.timestamp) {
          draft = {
            key: draftKey.value,
            editText: (rd["text"] as string) ?? "",
            // 方案 L5/P5：后端已不存 baseline（可重建冗余），统一用本地重建值
            baseline: localBaseline,
            hasEdits: true,
            cursorPos: (rd["cursor_pos"] as number) ?? 0,
            scrollPos: (rd["scroll_pos"] as number) ?? 0,
            lastEditOffset: (rd["last_edit_offset"] as number) ?? -1,
            processedCis: (rd["processed_cis"] as number[]) ?? [],
            fileAName: (rd["file_a_name"] as string) ?? compareStore.fileAName,
            fileBName: (rd["file_b_name"] as string) ?? compareStore.fileBName,
            timestamp: remoteTime,
          };
        }
      }
    } catch {
      // Backend unavailable — IndexedDB draft (if any) is sufficient
    }

    if (draft && draft.editText && draft.editText !== draft.baseline) {
      // Draft exists with real edits — set pending flag for UI confirmation
      hasPendingDraft.value = true;
      pendingDraft.value = draft;
      // 方案 B：携带草稿缓存的 userSegments（恢复免重算；undefined=旧草稿回退 worker）
      draftUserSegments.value = draft.userSegments ?? null;
      // Pre-load draft data into editor state
      editSegments.value = cloneSegments(compareStore.segments);
      editText.value = draft.editText;
      originalBaseline.value = draft.baseline || localBaseline;
      hasEdits.value = true;
      cursorPos.value = draft.cursorPos ?? 0;
      scrollPos.value = draft.scrollPos ?? 0;
      lastEditOffset.value = draft.lastEditOffset ?? -1;
      processedCis.value = draft.processedCis ?? [];
      // 方案 L4：草稿内容由 CodeMirrorDiff 恢复时初始化 worker 缓存
      workerSegments.value = null;
    } else {
      // No draft — fresh edit session
      draftUserSegments.value = null;
      editSegments.value = cloneSegments(compareStore.segments);
      // 三期 B 组：初始 doc 与 baseline 同变换（保证一致性）
      editText.value = applyNormalizations(buildDocText(editSegments.value));
      originalBaseline.value = applyNormalizations(buildDocText(compareStore.segments));
      workerSegments.value = null;
    }
    isEditing.value = true;
  }

  /** User chose to discard the draft and start fresh. */
  function discardDraft(): void {
    hasPendingDraft.value = false;
    pendingDraft.value = null;
    draftUserSegments.value = null;
    editSegments.value = cloneSegments(compareStore.segments);
    editText.value = applyNormalizations(buildDocText(editSegments.value));
    originalBaseline.value = applyNormalizations(buildDocText(compareStore.segments));
    hasEdits.value = false;
    cursorPos.value = 0;
    scrollPos.value = 0;
    lastEditOffset.value = -1;
    processedCis.value = [];
    // 方案 L4：重置后无编辑，清空 worker 缓存
    workerSegments.value = null;
    // Rev. 8-4: bump resetToken so CodeMirrorDiff's watcher resets the editor
    // doc to the original baseline — otherwise the draft text stays in view.
    resetToken.value++;
    // Clear the draft from both stores
    if (draftKey.value) {
      storage.clearEditDraft(draftKey.value).catch(() => {});
      api.autosave({ action: "delete", key: draftKey.value }).catch(() => {});
    }
  }

  /** User accepted the draft — just clear the pending flag. */
  function acceptDraft(): void {
    hasPendingDraft.value = false;
  }

  /**
   * Resume an edit session directly from the Select page (rev. edit-persistence/2).
   * The user already chose to continue, so no pending-draft modal is shown —
   * the editor loads the draft content immediately.
   */
  function resumeFromDraft(draft: EditSessionDraft): void {
    draftKey.value = draft.key;
    editSegments.value = cloneSegments(draft.segments && draft.segments.length > 0
      ? draft.segments
      : compareStore.segments);
    // 草稿 editText 是保存时的原文（已是本会话变换后），不重变换；
    // 仅当 baseline 缺失时按当前偏好重建（三期 B 组）。
    editText.value = draft.editText;
    originalBaseline.value = draft.baseline || applyNormalizations(buildDocText(editSegments.value));
    hasEdits.value = draft.hasEdits;
    cursorPos.value = draft.cursorPos ?? 0;
    scrollPos.value = draft.scrollPos ?? 0;
    lastEditOffset.value = draft.lastEditOffset ?? -1;
    processedCis.value = draft.processedCis ?? [];
    // 方案 B：携带草稿缓存的 userSegments（恢复免重算；undefined=旧草稿回退 worker）
    draftUserSegments.value = draft.userSegments ?? null;
    hasPendingDraft.value = false;
    pendingDraft.value = null;
    isEditing.value = true;
  }

  function exitEdit(): void {
    saveDraft();
    isEditing.value = false;
  }

  function resetToOriginal(): void {
    editSegments.value = cloneSegments(compareStore.segments);
    editText.value = "";
    hasEdits.value = false;
    cursorPos.value = 0;
    scrollPos.value = 0;
    lastEditOffset.value = -1;
    processedCis.value = [];
    workerSegments.value = null;
    draftUserSegments.value = null;
    resetToken.value++;
  }

  /** Called by CodeMirrorDiff updateListener — record cursor & scroll. */
  function updateCursorAndScroll(pos: number, scroll: number): void {
    cursorPos.value = pos;
    scrollPos.value = scroll;
    scheduleSave();
  }

  /** Mark a change-item (ci) as processed. */
  function markProcessed(ci: number): void {
    if (!processedCis.value.includes(ci)) {
      processedCis.value.push(ci);
      scheduleSave();
    }
  }

  /** Classify current edits against the FIXED baseline (rev. A2). */
  function getEditedSegments(): Segment[] {
    // 方案 L4：返回 Worker 最新结果缓存（不再每次全量 classifyEdit）。
    // 未编辑/降级场景下缓存为空数组或 null → 调用方按空处理。
    return workerSegments.value ?? [];
  }

  const editedStats = computed(() => {
    let total = 0, add = 0, del = 0, mod = 0, restored = 0;
    for (const s of getEditedSegments()) {
      total++;
      if (s.origin === "restored") restored++;
      if (s.operation === "add") add++;
      else if (s.operation === "del") del++;
      else if (s.operation === "mod") mod++;
    }
    return { total, add, del, mod, restored };
  });

  /** Sidebar change contexts rebuilt from the edited segments. */
  const editedContexts = computed<ChangeContext[]>(() => {
    const segs = getEditedSegments();
    const result: ChangeContext[] = [];
    let ci = 0;
    for (const s of segs) {
      if (s.operation === "none") continue;
      ci++;
      const type = s.operation === "add" ? "add" : s.operation === "del" ? "del" : "mod";
      result.push({ index: asSegmentId(ci), total: editedStats.value.total, type, side: s.side, lineA: 0, lineB: 0, before: "", highlight: s.text, after: "" });
    }
    return result;
  });

  return {
    isEditing, editSegments, editText, hasEdits, originalBaseline, resetToken,
    fontSize, setFontSize, adjustFontSize,
    showInvisibleChars, setShowInvisibleChars,
    fullwidthHalfwidth, setFullwidthHalfwidth,
    cursorPos, scrollPos, lastEditOffset, processedCis,
    draftKey, hasPendingDraft, pendingDraft,
    workerSegments, workerVersion, setWorkerResult, draftUserSegments,
    registerFlush, flushEditsSync,
    enterEdit, exitEdit, resetToOriginal, discardDraft, acceptDraft,
    resumeFromDraft,
    saveDraft, scheduleSave, updateCursorAndScroll, markProcessed,
    getEditedSegments, editedStats, editedContexts,
  };
});
