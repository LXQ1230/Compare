export type DiffOpType = '=' | '+' | '-'

/**
 * 变更序号（change-index）—— branded number（rev. 5-6）。
 * Segment.ci / ChangeContext.index 与 total / lineA / lineB 等普通数字
 * 语义不同（都是 number），branded type 在编译期防止混淆
 * （如把 stats.total 当 index 传给跳转通道）。
 * 存储与反序列化边界（IndexedDB / 后端 JSON）仍是 number，构造时用 asSegmentId()。
 */
export type SegmentId = number & { readonly __brand: 'segment-id' }

export function asSegmentId(n: number): SegmentId {
  return n as SegmentId
}

export interface DiffOp {
  type: DiffOpType
  text: string
}

export type SegmentOp = 'add' | 'del' | 'mod' | 'none'

/**
 * 段来源（三期 A 组恢复检测器新增 'restored'）：
 * - original: 后端对比产生的原始差异
 * - user: 用户在编辑模式产生的修改
 * - restored: 用户把 B 的内容改回原文 A（detectRestores 判定），视觉用绿色
 */
export type SegmentOrigin = 'original' | 'user' | 'restored'

/** 文档规模分级（方案 L0）：S≤10万 / M≤50万 / L≤500万 / XL>500万 */
export type ScaleLevel = 'S' | 'M' | 'L' | 'XL'

export interface Segment {
  text: string
  operation: SegmentOp
  origin: SegmentOrigin
  side?: 'old' | 'new'
  ci?: number
}

export interface ChangeContext {
  index: SegmentId
  total: number
  type: 'add' | 'del' | 'mod'
  /** For mod segments, which side of the pair. */
  side?: 'old' | 'new'
  lineA: number
  lineB: number
  /** 变更位置前的文本片段（用于上下文展示） */
  before: string
  /** 变更文本本身 */
  highlight: string
  /** 变更位置后的文本片段（用于上下文展示） */
  after: string
}

export interface CompareMeta {
  fileA: string
  fileB: string
  stats: CompareStats
  timestamp: number
  totalChunks: number
  /** 文档规模分级（方案 L0），后端按真实字符数计算 */
  scale?: ScaleLevel
}

export interface CompareStats {
  total: number
  add: number
  del: number
  mod: number
}

/** 编辑态统计（三期 A 组）：在 CompareStats 之上增加 restored 计数。 */
export interface EditedStats extends CompareStats {
  restored: number
}

export type StreamMessage =
  | { type: 'phase'; stage: string; detail: string; progress: number }
  | { type: 'meta'; stats: CompareStats; totalChunks: number; scale?: ScaleLevel }
  | { type: 'segments'; index: number; data: Segment[] }
  | { type: 'done' }

export interface ErrorEnvelope {
  error: true
  severity: 'blocking' | 'warning' | 'info'
  title: string
  message: string
  detail: string | null
}

export type ViewMode = 'unified' | 'split'

export interface VersionEntry {
  id: string
  label: string
  time: number
}

export interface Patch {
  diffs: DiffOp[]
  start1: number
  start2: number
  length1: number
  length2: number
}

export interface EditSessionDraft {
  /** sha256(fileAName+fileAContent+fileBName+fileBContent)[:16] */
  key: string
  /** 编辑后的完整文本 */
  editText: string
  /** 进入编辑时的基线（用于恢复时校验） */
  baseline: string
  hasEdits: boolean
  /** CodeMirror 光标 anchor offset */
  cursorPos: number
  /** 滚动偏移（像素） */
  scrollPos: number
  /** 最后一次编辑位置 offset，-1 表示无 */
  lastEditOffset: number
  /** 已处理 ci 集合 */
  processedCis: number[]
  /** 用于恢复提示显示 */
  fileAName: string
  fileBName: string
  /** Date.now() */
  timestamp: number
  /** 完整对比 segments（第二期：首页点击恢复用，可能因 localStorage 容量被剥离，以后端为准） */
  segments?: Segment[]
  /** 对比统计（恢复 meta 用） */
  stats?: CompareStats
  /** 对比 chunk 数 */
  totalChunks?: number
}
