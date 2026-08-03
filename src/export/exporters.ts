/**
 * Export diff results to TXT, HTML, and Markdown formats.
 */

import type { Segment } from '@/types';
import { renderSegmentsToHTML, segmentsToText } from '@/render/segmentRenderer';

export function exportToTXT(segments: Segment[]): string {
  return segmentsToText(segments);
}

/** CSS embedded in exported HTML — mirrors src/styles/variables.css + main.css. */
const EMBED_CSS = [
  ':root {',
  '--color-bg:#ffffff;--color-bg-secondary:#f5f5f5;--color-text:#1a1a1a;',
  '--color-add-bg:#e6ffec;--color-add-text:#116329;',
  '--color-del-bg:#ffebe9;--color-del-text:#922323;',
  '--color-mod-old-bg:#fff8e1;--color-mod-old-text:#946b00;',
  '--color-mod-new-bg:#fffde7;--color-mod-new-text:#f5a300;',
  '--color-user-add-bg:#fff3cd;--color-user-add-text:#856404;',
  '--color-user-del-bg:#f3e8ff;--color-user-del-text:#6b21a8;',
  '--color-user-mod-old-bg:#fef3c7;--color-user-mod-old-text:#946b00;',
  '--color-user-mod-new-bg:#fef3c7;--color-user-mod-new-text:#946b00;',
  '--color-search-highlight:#fff9c4;--color-search-focus:#fff3cd;',
  '--color-focus-border:#0969da;--color-border:#d0d7de;',
  '--font-mono:Cascadia Code,Fira Code,Consolas,monospace;',
  '--font-sans:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;',
  '--font-size-base:15px;',
  '}',
  '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
  'body{padding:16px;font-family:var(--font-mono);font-size:var(--font-size-base);',
  'line-height:1.6;white-space:pre-wrap;word-break:break-all;',
  'color:var(--color-text);background:var(--color-bg)}',
  '.seg-add{background:var(--color-add-bg);color:var(--color-add-text)}',
  '.seg-del{background:var(--color-del-bg);color:var(--color-del-text);text-decoration:line-through}',
  '.seg-mod-old{background:var(--color-mod-old-bg);color:var(--color-mod-old-text);text-decoration:line-through}',
  '.seg-mod-new{background:var(--color-mod-new-bg);color:var(--color-mod-new-text)}',
  '.seg-user-add{background:var(--color-user-add-bg);color:var(--color-user-add-text)}',
  '.seg-user-del{background:var(--color-user-del-bg);color:var(--color-user-del-text);text-decoration:line-through}',
  '.seg-user-mod-old{background:var(--color-user-mod-old-bg);color:var(--color-user-mod-old-text);text-decoration:line-through}',
  '.seg-user-mod-new{background:var(--color-user-mod-new-bg);color:var(--color-user-mod-new-text);font-weight:600}',
  '.seg-none{background:transparent;color:var(--color-text)}',
  '.ci-flash{animation:ci-flash-anim 0.6s ease-out 2}',
  '@keyframes ci-flash-anim{0%,100%{box-shadow:none}50%{box-shadow:0 0 0 4px var(--color-focus-border)}}',
].join('');

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
