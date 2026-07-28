/**
 * Export diff results to TXT, HTML, and Markdown formats.
 */

import type { Segment } from '@/types';
import { segmentsToText } from '@/render/segmentRenderer';

export function exportToTXT(segments: Segment[]): string {
  return segmentsToText(segments);
}

export function exportToHTML(segments: Segment[], title = 'Compare Report'): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let body = '';
  for (const s of segments) {
    const text = esc(s.text);
    if (s.operation === 'add') body += `<ins>${text}</ins>`;
    else if (s.operation === 'del') body += `<del>${text}</del>`;
    else if (s.operation === 'mod') body += `<mark>${text}</mark>`;
    else body += text;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><pre>${body}</pre></body></html>`;
}

export function exportToMD(segments: Segment[]): string {
  const parts: string[] = [];
  for (const s of segments) {
    if (s.operation === 'add') parts.push(`++${s.text}++`);
    else if (s.operation === 'del') parts.push(`~~${s.text}~~`);
    else if (s.operation === 'mod') parts.push(`**${s.text}**`);
    else parts.push(s.text);
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
