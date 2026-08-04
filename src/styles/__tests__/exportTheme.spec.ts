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
  '--color-add-bg': '#e6ffec',
  '--color-add-text': '#116329',
  '--color-del-bg': '#ffebe9',
  '--color-del-text': '#922323',
  '--color-mod-old-bg': '#fff8e1',
  '--color-mod-old-text': '#946b00',
  '--color-mod-new-bg': '#fffde7',
  '--color-mod-new-text': '#f5a300',
  '--color-user-add-bg': '#fff3cd',
  '--color-user-add-text': '#856404',
  '--color-user-del-bg': '#f3e8ff',
  '--color-user-del-text': '#6b21a8',
  '--color-user-mod-old-bg': '#fef3c7',
  '--color-user-mod-old-text': '#946b00',
  '--color-user-mod-new-bg': '#fef3c7',
  '--color-user-mod-new-text': '#946b00',
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
