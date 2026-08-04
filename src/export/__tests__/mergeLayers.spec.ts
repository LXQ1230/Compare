/**
 * Unit tests for mergeLayers — the export-time merge of the original
 * comparison layer with the user edit layer.
 *
 * Core invariant tested throughout: concatenating non-phantom segments of
 * the merged list yields exactly the applied final document (editor text).
 */

import { describe, expect, it } from 'vitest';
import { classifyEdit, buildDocText, normalizeLineEndings } from '../../render/editClassifier';
import { mergeLayers } from '../mergeLayers';
import type { Segment } from '../../types';

const N = (text: string): Segment => ({ text, operation: 'none', origin: 'original' });
const ADD = (text: string): Segment => ({ text, operation: 'add', origin: 'original', ci: 1 });
const DEL = (text: string): Segment => ({ text, operation: 'del', origin: 'original', ci: 2 });
const MOD = (oldText: string, newText: string): Segment[] => [
  { text: oldText, operation: 'mod', origin: 'original', side: 'old', ci: 3 },
  { text: newText, operation: 'mod', origin: 'original', side: 'new', ci: 3 },
];

/** Compute user segments exactly like the editor does. */
function userSegs(baseline: string, edited: string): Segment[] {
  return classifyEdit(
    normalizeLineEndings(baseline),
    normalizeLineEndings(edited),
  ).segments;
}

describe('mergeLayers', () => {
  it('no user edits → original layer preserved (normalized + renumbered)', () => {
    const original = [N('AB'), ADD('+X'), N('CD'), DEL('-Y'), N('EF')];
    const merged = mergeLayers(original, []);

    expect(merged).toHaveLength(original.length);
    expect(buildDocText(merged)).toBe('AB+XCDEF');
    // markers survive
    expect(merged[1]).toMatchObject({ operation: 'add', origin: 'original' });
    expect(merged[3]).toMatchObject({ operation: 'del', origin: 'original' });
    // change indexes renumbered & unique
    const cis = merged.filter((s) => s.ci != null).map((s) => s.ci);
    expect(new Set(cis).size).toBe(cis.length);
  });

  it('user deletes an original add region → user-del only, original marker hidden', () => {
    const original = [N('AB'), ADD('+X'), N('CD'), N('EF')];
    const baseline = buildDocText(original); // AB+XCDEF
    const edited = 'ABCDEF';
    const user = userSegs(baseline, edited);

    const merged = mergeLayers(original, user);
    expect(buildDocText(merged)).toBe(edited);

    const delSegs = merged.filter((s) => s.operation === 'del');
    expect(delSegs).toHaveLength(1);
    expect(delSegs[0]).toMatchObject({ origin: 'user', text: '+X' });
    // original add no longer present
    expect(merged.some((s) => s.operation === 'add')).toBe(false);
  });

  it('user modifies text → user-mod-old/new pair, original marker hidden', () => {
    const original = [N('AA'), ...MOD('X', 'Y'), N('BB')];
    const baseline = buildDocText(original); // AAYBB
    const edited = 'AAZBB';
    const user = userSegs(baseline, edited);

    const merged = mergeLayers(original, user);
    expect(buildDocText(merged)).toBe(edited);

    const mods = merged.filter((s) => s.operation === 'mod' && s.origin === 'user');
    expect(mods).toHaveLength(2);
    expect(mods[0]).toMatchObject({ side: 'old', text: 'Y' });
    expect(mods[1]).toMatchObject({ side: 'new', text: 'Z' });
    expect(merged.some((s) => s.operation === 'mod' && s.origin === 'original')).toBe(false);
  });

  it('user inserts text → user-add appears at the right spot', () => {
    const original = [N('AB'), N('CD')];
    const baseline = 'ABCD';
    const edited = 'ABXCD';
    const user = userSegs(baseline, edited);

    const merged = mergeLayers(original, user);
    expect(buildDocText(merged)).toBe(edited);

    const adds = merged.filter((s) => s.operation === 'add');
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({ origin: 'user', text: 'X' });
  });

  it('untouched regions keep original del phantom; covered ones hide it', () => {
    const original = [N('AB'), DEL('-Y'), N('CD')];
    const baseline = 'ABCD';

    // Case 1: user only edits elsewhere — original del phantom survives.
    let edited = 'ABXCD';
    let merged = mergeLayers(original, userSegs(baseline, edited));
    expect(merged.some((s) => s.operation === 'del' && s.origin === 'original')).toBe(true);
    expect(buildDocText(merged)).toBe(edited);

    // Case 2: user deletes the region right after the phantom anchor — hidden.
    edited = 'A';
    merged = mergeLayers(original, userSegs(baseline, edited));
    expect(merged.some((s) => s.operation === 'del' && s.origin === 'original')).toBe(false);
    expect(buildDocText(merged)).toBe(edited);
  });

  it('coarse original segment split by a user edit renders both parts', () => {
    // One original "none" segment spanning "ABCD"; user deletes "BC" inside it.
    const original = [N('ABCD')];
    const baseline = 'ABCD';
    const edited = 'AD';
    const user = userSegs(baseline, edited);

    const merged = mergeLayers(original, user);
    expect(buildDocText(merged)).toBe(edited);

    const texts = merged.map((s) => s.text).join('|');
    // untouched 'A' and 'D' from the original segment + user del 'BC'
    expect(texts).toBe('A|BC|D');
    expect(merged[0]).toMatchObject({ origin: 'original', operation: 'none' });
    expect(merged[1]).toMatchObject({ origin: 'user', operation: 'del' });
    expect(merged[2]).toMatchObject({ origin: 'original', operation: 'none' });
  });

  it('user deletes the whole document → only user-del remains', () => {
    const original = [N('AB'), ADD('+X'), N('CD')];
    const baseline = 'AB+XCD';
    const edited = '';
    const user = userSegs(baseline, edited);

    const merged = mergeLayers(original, user);
    expect(buildDocText(merged)).toBe('');

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ origin: 'user', operation: 'del', text: 'AB+XCD' });
  });

  it('mixed scenario: original add kept, user insert + delete applied', () => {
    const original = [
      N('如是我闻。'),
      ADD('一时佛在舍卫国。'),
      N('与大比丘众俱。'),
    ];
    const baseline = buildDocText(original);
    const edited = '如是我闻。一时佛在舍卫国。与大比丘众俱。更无余众。';
    const user = userSegs(baseline, edited);

    const merged = mergeLayers(original, user);
    expect(buildDocText(merged)).toBe(edited);

    // original add survives (untouched)
    expect(merged.some((s) => s.operation === 'add' && s.origin === 'original')).toBe(true);
    // user inserted text marked
    const userAdd = merged.find((s) => s.operation === 'add' && s.origin === 'user');
    expect(userAdd?.text).toBe('更无余众。');
  });

  it('change indexes are unique across both layers', () => {
    const original = [N('AB'), ADD('+X'), N('CD'), ...MOD('E', 'F'), N('GH')];
    const baseline = buildDocText(original);
    const edited = 'AB+XCDZGH'; // modify F→Z
    const user = userSegs(baseline, edited);

    const merged = mergeLayers(original, user);
    const cis = merged.filter((s) => s.ci != null).map((s) => s.ci as number);
    expect(cis.length).toBeGreaterThan(0);
    expect(new Set(cis).size).toBe(cis.length);
    expect(buildDocText(merged)).toBe(edited);
  });
});
