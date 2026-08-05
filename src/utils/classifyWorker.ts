/**
 * classifyEdit Worker 管理器（方案 L4 阶段一）。
 *
 * - 单 in-flight：同一时刻只发一个 classify 请求（主线程 300ms 防抖保证）
 * - 版本号丢弃：worker 返回时若 version 已过期，由调用方丢弃
 * - 三层降级（§12.4）：
 *   1. `new Worker()` 抛异常 → worker = null，调用方回主线程 classifyEdit
 *   2. worker onerror / 连续 error → workerBroken=true 永久回退主线程
 *   3. version 不匹配 → 静默丢弃（防抖窗口内又有输入）
 */

import type { WorkerRequest, WorkerResponse } from '@/workers/classify.worker';

export type ClassifyCallback = (resp: WorkerResponse | null) => void;

let worker: Worker | null = null;
let workerBroken = false;
let errorStreak = 0;
let pendingCb: ClassifyCallback | null = null;
let requestSeq = 0;

function ensureWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(
      new URL('../workers/classify.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const resp = e.data;
      const cb = pendingCb;
      pendingCb = null;
      if (resp.type === 'result') {
        errorStreak = 0;
        cb?.(resp);
      } else {
        // error 或非 result：计数，超过阈值永久降级
        errorStreak++;
        if (errorStreak >= 2) {
          workerBroken = true;
          worker?.terminate();
          worker = null;
        }
        cb?.(resp);
      }
    };
    worker.onerror = () => {
      workerBroken = true;
      worker?.terminate();
      worker = null;
      // 方案 P3-7: 通知调用方走主线程降级——此前静默丢失一次 pending 结果，
      // 用户最后一次编辑的装饰层会一直缺失直到下一次编辑触发。
      const cb = pendingCb;
      pendingCb = null;
      cb?.(null);
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

/**
 * 在 Worker 中执行 classifyEdit。
 * 返回 false 表示 Worker 不可用（已降级），调用方应回主线程执行；
 * 返回 true 表示已投递，结果通过 callback 异步返回（version 过期由调用方丢弃）。
 */
export function classifyInWorker(
  baseline: string,
  edited: string,
  version: number,
  cb: ClassifyCallback,
): boolean {
  const w = ensureWorker();
  if (!w) {
    cb(null);
    return false;
  }
  pendingCb = cb;
  const req: WorkerRequest = {
    type: 'classify',
    requestId: ++requestSeq,
    version,
    baseline,
    edited,
  };
  w.postMessage(req);
  return true;
}

/**
 * 重置 Worker 端增量会话（方案 P5）。
 * 主线程清空/重建 workerSegments 缓存时必须调用，否则 Worker 的
 * lastEdited/lastSegments 停留在旧状态，增量路径会基于过期基线错乱。
 * Worker 未创建时为空操作（session 本就为空）。
 */
export function resetWorkerSession(): void {
  const w = ensureWorker();
  if (!w) return;
  w.postMessage({ type: 'reset' } satisfies WorkerRequest);
}

/** 测试/卸载用：强制标记 Worker 不可用（走降级路径）。 */
export function forceWorkerBroken(): void {
  workerBroken = true;
  worker?.terminate();
  worker = null;
}

/** 重置（测试用）。 */
export function resetWorkerManager(): void {
  workerBroken = false;
  worker = null;
  pendingCb = null;
  errorStreak = 0;
}
