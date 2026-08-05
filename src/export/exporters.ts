/**
 * Export diff results to TXT, HTML, and Markdown formats.
 *
 * IDML：段落分隔符 U+2029 在 TXT/MD 导出时转为换行（方案 §5.7.1）；
 * HTML 导出由 renderSegmentsToHTML 转为 <br class="para-break">（§6.5）。
 */

import type { DocMeta, Segment } from '@/types';
import { getDocContainerStyle, renderSegmentsToHTML, segmentsToText } from '@/render/segmentRenderer';
import { embedCss as EMBED_CSS } from '@/styles/exportTheme';

/** IDML 段落分隔符 → 换行（§5.7.1：TXT/MD 导出统一转换）。 */
const PARA_SEP = '\u2029';

export function exportToTXT(segments: Segment[]): string {
  return segmentsToText(segments).replaceAll(PARA_SEP, '\n');
}

export function exportToHTML(
  segments: Segment[],
  title = 'Compare Report',
  docMeta?: DocMeta | null,
): string {
  // IDML：容器套竖排/行高样式（§6.4）；非 IDML docMeta 为空 → 无包裹样式
  const body = docMeta
    ? `<div style="${getDocContainerStyle(docMeta)}">${renderSegmentsToHTML(segments, undefined, { vertical: docMeta.vertical === true })}</div>`
    : renderSegmentsToHTML(segments);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeAttr(title)}</title>
<style>${EMBED_CSS}</style>
</head>
<body>${body}</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function exportToMD(segments: Segment[]): string {
  const mdEscape = (s: string): string =>
    s.replace(/([\\*_{}\[\]()#+\-.!|~`])/g, '\\$1');
  // Rev. F2: strip HTML tags BEFORE markdown escaping. `mdEscape` does not
  // escape `<`/`>`, so a raw `<script>` in the document would survive into
  // the exported .md and execute when opened in a markdown viewer that
  // renders embedded HTML.
  const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, '');
  const parts: string[] = [];
  for (const s of segments) {
    // IDML：段落分隔符转换行（§5.7.1）
    const text = stripHtml(s.text).replaceAll(PARA_SEP, '\n');
    if (s.operation === 'add') parts.push(`++${mdEscape(text)}++`);
    else if (s.operation === 'del') parts.push(`~~${mdEscape(text)}~~`);
    else if (s.operation === 'mod') parts.push(`**${mdEscape(text)}**`);
    else parts.push(mdEscape(text));
  }
  return parts.join('');
}

export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
