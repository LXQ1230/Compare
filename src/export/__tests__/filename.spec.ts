/**
 * Unit tests for export filename construction (src/export/filename.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  buildExportFilename,
  formatTimestamp,
  sanitizeExportFilename,
} from '../filename';

const NOW = new Date(2026, 7, 5, 10, 4); // 2026-08-05 10:04

function build(overrides: Partial<Parameters<typeof buildExportFilename>[0]> = {}) {
  return buildExportFilename({
    fileAName: '金刚经.txt',
    fileBName: '地藏经.docx',
    mode: 'view',
    formatId: 'html',
    now: NOW,
    ...overrides,
  });
}

describe('buildExportFilename', () => {
  it('view mode: {A}_vs_{B}_对比报告_{ts}.{ext}', () => {
    expect(build()).toBe('金刚经_vs_地藏经_对比报告_20260805-1004.html');
  });

  it('edit mode: {A}_vs_{B}_编辑后文档_{ts}.{ext}', () => {
    expect(build({ mode: 'edit', formatId: 'txt' })).toBe(
      '金刚经_vs_地藏经_编辑后文档_20260805-1004.txt',
    );
  });

  it('strips source extensions (including multi-dot names)', () => {
    expect(build({ fileAName: '金刚经.v2.txt', fileBName: 'a.b.docx' })).toBe(
      '金刚经.v2_vs_a.b_对比报告_20260805-1004.html',
    );
  });

  it('replaces Windows-invalid chars with underscore', () => {
    expect(build({ fileAName: 'a/b\\c:d*e?f"g<h>i|j.txt' })).toBe(
      'a_b_c_d_e_f_g_h_i_j_vs_地藏经_对比报告_20260805-1004.html',
    );
  });

  it('trims leading/trailing space and dot from source names', () => {
    expect(build({ fileAName: '  金刚经.  ', fileBName: '..地藏经..' })).toBe(
      '金刚经_vs_地藏经_对比报告_20260805-1004.html',
    );
  });

  it('caps each source name at maxNameLen code points', () => {
    const long = '经'.repeat(50);
    expect(build({ fileAName: `${long}.txt`, maxNameLen: 10 })).toBe(
      `${'经'.repeat(10)}_vs_地藏经_对比报告_20260805-1004.html`,
    );
  });

  it('falls back to placeholders when a name sanitizes to empty', () => {
    // '...' is a Windows-invalid pure-dot name; trims away entirely.
    expect(build({ fileAName: '...', fileBName: '   ' })).toBe(
      '文件A_vs_文件B_对比报告_20260805-1004.html',
    );
  });

  it('surrogate pairs are preserved (not split) when truncating', () => {
    // '😀😀😀😀😀' = 5 surrogate pairs
    expect(build({ fileAName: '😀😀😀😀😀.txt', maxNameLen: 3 })).toBe(
      '😀😀😀_vs_地藏经_对比报告_20260805-1004.html',
    );
  });
});

describe('formatTimestamp', () => {
  it('formats local time as YYYYMMDD-HHmm with zero padding', () => {
    expect(formatTimestamp(new Date(2026, 0, 2, 3, 4))).toBe('20260102-0304');
  });
});

describe('sanitizeExportFilename (user input)', () => {
  it('keeps extension and replaces invalid chars', () => {
    expect(sanitizeExportFilename('我的<报告>.txt', 'fallback')).toBe('我的_报告_.txt');
  });

  it('trims edge spaces and dots', () => {
    expect(sanitizeExportFilename('  报告.txt.  ', 'fallback')).toBe('报告.txt');
  });

  it('falls back when empty or whitespace-only', () => {
    expect(sanitizeExportFilename('   ', '默认名.txt')).toBe('默认名.txt');
    expect(sanitizeExportFilename('', '默认名.txt')).toBe('默认名.txt');
  });
});
