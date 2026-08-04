/**
 * classifyEdit Web Worker（方案 L4：全量移后台 + P5 阶段二局部增量）。
 *
 * 主线程 300ms 防抖后把 (baseline, edited) 发到这里做字符级 diff，
 * UI 线程零阻塞。协议见 WorkerRequest/WorkerResponse（§12 方案文档）。
 *
 * 阶段二（P5 §4.4.5）：worker 内维护 lastEdited/lastSegments 会话状态，
 * 用公共前后缀定位编辑变化区间，只重算 ±INCR_WINDOW 窗口内的局部 diff
 * （返回 { incremental, localSegments }），窗口外 segments 复用——每次
 * 编辑的重算延迟从全量 ~1s 降至 <200ms。变化 >30% 或首次 → 回退全量。
 */

import type { Segment } from '@/types';
import { classifyIncremental, mergeSegments, type IncrSession } from '@/render/incrementalClassify';

export type WorkerRequest =
  | {
      type: 'classify';
      /** 单调递增请求号（主线程生成，用于错误定位） */
      requestId: number;
      /** 全局编辑版本号——旧结果由主线程按版本丢弃 */
      version: number;
      baseline: string;
      edited: string;
    }
  | { type: 'reset' };

export interface WorkerResponse {
  type: 'result' | 'error';
  requestId: number;
  version: number;
  dirty?: boolean;
  /** 全量路径：完整 segments（dirty=true 时非空） */
  segments?: Segment[];
  /** 增量路径：替换主线程缓存 [from..to) 的局部新段 */
  incremental?: { from: number; to: number };
  localSegments?: Segment[];
  message?: string;
}

// ── Worker 端增量会话状态（阶段二）────────────────────────────
let session: IncrSession | null = null;

function clearSession(): void {
  session = null;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (!req) return;
  // 重置会话：主线程清空/重建 worker 缓存时同步（否则增量路径基于旧状态错乱）
  if (req.type === 'reset') {
    clearSession();
    return;
  }
  if (req.type !== 'classify') return;
  try {
    const result = classifyIncremental(req.baseline, req.edited, session);

    // 更新会话状态（合并后的完整 segments 供下次增量）
    let nextSegments: Segment[] | null = null;
    if (result.segments !== null) {
      nextSegments = result.segments;
    } else if (result.localSegments) {
      nextSegments = mergeSegments(session!.lastSegments, result.from, result.to, result.localSegments);
    }
    // 防御：两类结果都缺失（不应发生）→ 空段，下次 classify 自动回退全量
    session = { lastEdited: req.edited, lastSegments: nextSegments ?? [] };

    const resp: WorkerResponse = {
      type: 'result',
      requestId: req.requestId,
      version: req.version,
      dirty: result.dirty,
    };
    if (result.segments !== null) {
      resp.segments = result.segments;
    } else if (result.localSegments) {
      resp.incremental = { from: result.from, to: result.to };
      resp.localSegments = result.localSegments;
    }
    (self as unknown as Worker).postMessage(resp);
  } catch (err) {
    clearSession(); // 状态可能已损坏，下次回退全量重建
    const resp: WorkerResponse = {
      type: 'error',
      requestId: req.requestId,
      version: req.version,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(resp);
  }
};
