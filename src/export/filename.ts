/**
 * Export filename construction.
 *
 * Two naming schemes, one per export mode:
 *   view mode: "{A}_vs_{B}_对比报告_{YYYYMMDD-HHmm}.{ext}"
 *   edit mode: "{A}_vs_{B}_编辑后文档_{YYYYMMDD-HHmm}.{ext}"
 *
 * Source names are sanitized: extension stripped, Windows-invalid chars
 * replaced, leading/trailing space & dot removed, capped per-name length.
 */

export type ExportMode = 'view' | 'edit';

export interface BuildExportFilenameOptions {
  fileAName: string;
  fileBName: string;
  mode: ExportMode;
  formatId: string; // 'txt' | 'html' | 'md'
  /** Injectable clock for tests; defaults to now. */
  now?: Date;
  /** Per source-name length cap (code points), default 40. */
  maxNameLen?: number;
}

/** Windows filename-invalid characters plus control chars. */
const INVALID_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

const MODE_LABEL: Record<ExportMode, string> = {
  view: '对比报告',
  edit: '编辑后文档',
};

const DEFAULT_A = '文件A';
const DEFAULT_B = '文件B';

/** Remove a trailing extension (e.g. ".txt", ".docx"). Dotfiles kept intact. */
function stripExtension(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  return base === '' ? name : base;
}

/**
 * Sanitize a source file name for embedding into the export filename:
 * strip extension, replace invalid chars, trim edge spaces/dots, cap length.
 * May return an empty string (caller supplies a fallback).
 */
function sanitizeSourceName(name: string, maxLen: number): string {
  const cleaned = stripExtension(name)
    .replace(INVALID_CHARS, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .trim();
  if (!cleaned) return '';
  return Array.from(cleaned).slice(0, maxLen).join('');
}

/** Local-time "YYYYMMDD-HHmm" stamp. */
export function formatTimestamp(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

export function buildExportFilename(opts: BuildExportFilenameOptions): string {
  const {
    fileAName,
    fileBName,
    mode,
    formatId,
    now = new Date(),
    maxNameLen = 40,
  } = opts;
  const a = sanitizeSourceName(fileAName, maxNameLen) || DEFAULT_A;
  const b = sanitizeSourceName(fileBName, maxNameLen) || DEFAULT_B;
  return `${a}_vs_${b}_${MODE_LABEL[mode]}_${formatTimestamp(now)}.${formatId}`;
}

/**
 * Sanitize a user-typed export filename: replace invalid chars, trim edge
 * spaces/dots. Keeps the extension when present. Falls back when empty.
 */
export function sanitizeExportFilename(name: string, fallback: string): string {
  const cleaned = name.replace(INVALID_CHARS, '_').replace(/^[\s.]+|[\s.]+$/g, '').trim();
  return cleaned || fallback;
}
