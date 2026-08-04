/**
 * Integration test mirroring the ExportDialog edit-mode branch:
 * baseline → classifyEdit → mergeLayers → exporters.
 * Verifies the exported HTML/MD carry BOTH marker layers and the TXT
 * equivalent (buildDocText) is the applied final document.
 */

import { describe, expect, it } from 'vitest';
import { classifyEdit, buildDocText, normalizeLineEndings } from '../../render/editClassifier';
import { mergeLayers } from '../mergeLayers';
import { exportToHTML, exportToMD } from '../exporters';
import type { Segment } from '../../types';

const N = (text: string): Segment => ({ text, operation: 'none', origin: 'original' });
const ADD = (text: string): Segment => ({ text, operation: 'add', origin: 'original', ci: 1 });
const DEL = (text: string): Segment => ({ text, operation: 'del', origin: 'original', ci: 2 });
const MOD = (oldText: string, newText: string): Segment[] => [
  { text: oldText, operation: 'mod', origin: 'original', side: 'old', ci: 3 },
  { text: newText, operation: 'mod', origin: 'original', side: 'new', ci: 3 },
];

function mergedForExport(original: Segment[], edited: string): Segment[] {
  const baseline = normalizeLineEndings(buildDocText(original));
  const userResult = classifyEdit(baseline, normalizeLineEndings(edited));
  return mergeLayers(original, userResult.dirty ? userResult.segments : []);
}

describe('edit-mode export pipeline', () => {
  it('HTML contains original markers (untouched) and user markers (edited)', () => {
    const original = [
      N('如是我闻。'),
      ADD('一时佛在舍卫国。'),
      N('与大比丘众俱。'),
      ...MOD('千二百五十人俱', '万二千人俱'),
      N('。'),
    ];
    const edited = '如是我闻。一时佛在舍卫国。与大比丘众俱。万二千人俱。毕陵伽婆蹉。';
    const merged = mergedForExport(original, edited);
    const html = exportToHTML(merged, 'test');

    // final text intact (all changes applied)
    expect(buildDocText(merged)).toBe(edited);
    // original add marker survives (untouched)
    expect(html).toContain('seg-add');
    expect(html).toContain('一时佛在舍卫国');
    // user insert marked with user-add
    expect(html).toContain('seg-user-add');
    expect(html).toContain('毕陵伽婆蹉');
    // original mod untouched region keeps BOTH markers (old struck, new kept)
    expect(html).toContain('seg-mod-old');
    expect(html).toContain('千二百五十人俱');
    expect(html).toContain('seg-mod-new');
    expect(html).toContain('万二千人俱');
  });

  it('TXT (buildDocText) = applied final document; user deletions drop text', () => {
    const original = [N('甲'), ADD('乙'), N('丙'), DEL('丁'), N('戊')];
    const edited = '甲乙丙'; // user deletes 戊 from baseline 甲乙丙戊
    const merged = mergedForExport(original, edited);
    expect(buildDocText(merged)).toBe(edited);
    const txt = buildDocText(merged);
    expect(txt).not.toContain('丁'); // original del applied
    expect(txt).not.toContain('戊'); // user del applied
    expect(txt).toBe('甲乙丙');
  });

  it('MD export renders both marker kinds', () => {
    const original = [N('A'), DEL('-x'), N('B')];
    const edited = 'ABy'; // insert y at end
    const merged = mergedForExport(original, edited);
    const md = exportToMD(merged);
    expect(md).toContain('~~\\-x~~'); // original del (hyphen md-escaped)
    expect(md).toContain('++y++'); // user add
  });
});
