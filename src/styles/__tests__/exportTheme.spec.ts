/**
 * Rev. 3-7 regression tests for the shared export theme.
 *  - embedCss must be self-consistent (every var() referenced is declared in :root).
 *  - key color values are pinned against src/styles/variables.css — a drift
 *    between the in-app theme and the exported-HTML theme fails here.
 */

import { describe, it, expect } from 'vitest';
import { embedCss, themeVars } from '@/styles/exportTheme';

/** Key colors that MUST match variables.css (in-app theme). */
const PINNED_VARS: Record<string, string> = {
  '--color-bg': '#ffffff',
  '--color-text': '#1a1a1a',
  '--color-add-bg': '#c6f0d0',
  '--color-add-text': '#0b5e2e',
  '--color-del-bg': '#ffd6d2',
  '--color-del-text': '#842020',
  '--color-mod-old-bg': '#ffe8ad',
  '--color-mod-old-text': '#6e5100',
  '--color-mod-new-bg': '#ffe9a6',
  '--color-mod-new-text': '#7a5400',
  '--color-user-add-bg': '#ffe3a0',
  '--color-user-add-text': '#5c4700',
  '--color-user-del-bg': '#e3c9ff',
  '--color-user-del-text': '#3f1a7e',
  '--color-user-mod-old-bg': '#ffdf9e',
  '--color-user-mod-old-text': '#6b4000',
  '--color-user-mod-new-bg': '#ffdf9e',
  '--color-user-mod-new-text': '#6b4000',
  '--color-user-restored-bg': '#c6f0d0',
  '--color-user-restored-text': '#0b5e2e',
  '--color-search-highlight': '#fff9c4',
  '--color-search-focus': '#fff3cd',
  '--color-focus-border': '#0969da',
  '--color-border': '#d0d7de',
  '--font-mono': 'Cascadia Code,Fira Code,Consolas,monospace',
  '--font-size-base': '15px',
};

describe('exportTheme (rev. 3-7)', () => {
  it('declares every referenced var() inside :root (self-consistent)', () => {
    const declared = new Set(Object.keys(themeVars));
    const used = new Set([...embedCss.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    for (const v of used) {
      expect(declared.has(v), `var(${v}) referenced but never declared`).toBe(true);
    }
  });

  it('pins key color values to variables.css (anti-drift contract)', () => {
    for (const [k, v] of Object.entries(PINNED_VARS)) {
      expect(themeVars[k], `${k} drifted from variables.css`).toBe(v);
    }
  });

  it('embeds all .seg-* rules used by the renderer', () => {
    for (const cls of [
      '.seg-add', '.seg-del', '.seg-mod-old', '.seg-mod-new',
      '.seg-user-add', '.seg-user-del', '.seg-user-mod-old', '.seg-user-mod-new', '.seg-none',
    ]) {
      expect(embedCss, `missing rule ${cls}`).toContain(cls);
    }
  });
});
