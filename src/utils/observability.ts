/**
 * Lightweight observability funnel (rev. 5-20).
 *
 * All application errors funnel through here. By default events go to the
 * console; when an endpoint is configured (VITE_OBS_ENDPOINT build-time env
 * or window.__OBS_ENDPOINT__ runtime override), they are POSTed there
 * fire-and-forget — no Sentry dependency, no blocking.
 */

const ENDPOINT: string =
  (import.meta.env.VITE_OBS_ENDPOINT as string | undefined) ??
  (window as unknown as { __OBS_ENDPOINT__?: string }).__OBS_ENDPOINT__ ??
  '';

interface ObsPayload {
  type: 'error' | 'event';
  time: number;
  name?: string;
  context?: string;
  message?: string;
  stack?: string;
  [key: string]: unknown;
}

function send(payload: ObsPayload): void {
  if (!ENDPOINT) return;
  // keepalive so the report survives page unload (pagehide/close).
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    /* fire-and-forget — never block the app on telemetry */
  });
}

export function reportError(error: unknown, context = ''): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[obs:error] ${context ? context + ' — ' : ''}${message}`);
  send({ type: 'error', time: Date.now(), context, message, stack });
}

export function reportEvent(name: string, data?: Record<string, unknown>): void {
  if (!ENDPOINT) return;
  send({ type: 'event', time: Date.now(), name, ...data });
}
