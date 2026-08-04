/**
 * Export diff results to TXT, HTML, and Markdown formats.
 */

import type { Segment } from '@/types';
import { renderSegmentsToHTML, segmentsToText } from '@/render/segmentRenderer';
import { embedCss as EMBED_CSS } from '@/styles/exportTheme';

export function exportToTXT(segments: Segment[]): string {
  return segmentsToText(segments);
}

export function exportToHTML(segments: Segment[], title = 'Compare Report'): string {
  const body = renderSegmentsToHTML(segments);
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
    const text = stripHtml(s.text);
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
