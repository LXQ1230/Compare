export type DiffOpType = '=' | '+' | '-'

export interface DiffOp {
  type: DiffOpType
  text: string
}

export type SegmentOp = 'add' | 'del' | 'mod' | 'none'

export type SegmentOrigin = 'original' | 'user'

export interface Segment {
  text: string
  operation: SegmentOp
  origin: SegmentOrigin
  side?: 'old' | 'new'
  ci?: number
}

export interface ChangeContext {
  index: number
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
}

export interface CompareStats {
  total: number
  add: number
  del: number
  mod: number
}

export type StreamMessage =
  | { type: 'phase'; stage: string; detail: string; progress: number }
  | { type: 'meta'; stats: CompareStats; totalChunks: number }
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
