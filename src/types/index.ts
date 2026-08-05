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

/**
 * 字符级样式区间（方案 §4.2，IDML 专属，可选字段）。
 * start/end 为相对所属 segment.text 的字符偏移（含/不含）。
 * 非 IDML 文件无此字段——零解析、零体积开销。
 */
export interface StyleRange {
  start: number
  end: number
  /** 映射后的 CSS font-family（font_map.py 三级映射） */
  font?: string
  /** 字号 pt（正文默认 28 省略） */
  sizePt?: number
  /** FontStyle Heavy/Bold → bold */
  bold?: boolean
  /** FillColor 映射（Registration→#C00000，CMYK→hex） */
  color?: string
  /** 割注（Warichu 双排小字）标记 */
  warichu?: boolean
  /** 割注百分比（40/60），字号 = sizePt × warichuSize/100 */
  warichuSize?: number
  /** 悬挂等基线偏移 pt（BaselineShift） */
  baselineShift?: number
}

export interface Segment {
  text: string
  operation: SegmentOp
  origin: SegmentOrigin
  side?: 'old' | 'new'
  ci?: number
  /** 仅 IDML 文件携带；样式区间（相对本段文本偏移） */
  style?: StyleRange[]
}

/**
 * 文档级排版元数据（方案 §5.3，随 NDJSON meta 行传输）。
 * IDML：竖排/行高系数/首行缩进/字体告警；非 IDML 不传输。
 */
export interface DocMeta {
  /** 竖排（StoryOrientation="Vertical"） */
  vertical?: boolean
  /** 行高系数（Leading/PointSize，如 43/28≈1.536） */
  leadingRatio?: number
  /** 首行缩进 pt（FirstLineIndent） */
  firstLineIndent?: number
  /** 不可用字体回退告警 */
  fontsUnavailable?: string[]
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
  /** IDML 排版元数据（方案 §5.3；非 IDML 无此字段） */
  docMeta?: DocMeta
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
  | { type: 'meta'; stats: CompareStats; totalChunks: number; scale?: ScaleLevel; docMeta?: DocMeta }
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
  /** FNV-1a 32 位 hash(fileAName+fileBName+baseline 文本)（方案 P3-10 注释修正） */
  key: string
  /** 编辑后的完整文本 */
  editText: string
  /** 进入编辑时的基线（用于恢复时校验） */
  baseline: string
  /**
   * 基线文本的 B 侧样式（方案 §6.6 链路 2：随 baseline 同生命周期存储）。
   * IDML 会话恢复编辑态 styleDeco 时使用；非 IDML 无此字段。
   */
  baselineStyle?: StyleRange[]
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
  /**
   * 用户编辑分类结果（方案 B：恢复免重算 DMP diff）。
   * 保存时缓存"与 editText 配套"的 workerSegments；undefined=缓存未就绪/旧草稿，
   * 恢复时回退 worker 异步重算。仅存 IndexedDB（体积 ~2-5MB，严禁入 localStorage/后端）。
   */
  userSegments?: Segment[]
}
