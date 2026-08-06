/**
 * Shared theme tokens for EXPORTED HTML (rev. 3-7).
 *
 * Single source of truth for the CSS variables embedded into exported HTML.
 * Must stay in sync with src/styles/variables.css (in-app theme) — the sync
 * is enforced by the snapshot test in exportTheme.spec.ts, which pins the
 * key color values against variables.css.
 *
 * Rule strings (.seg-*) are behavioural, kept here as constants; the values
 * they reference come from `themeVars`.
 */

export const themeVars: Record<string, string> = {
  '--color-bg': '#ffffff',
  '--color-bg-secondary': '#f5f5f5',
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
  // 三期 A 组：恢复段（用户改回原文）
  '--color-user-restored-bg': '#c6f0d0',
  '--color-user-restored-text': '#0b5e2e',
  '--color-search-highlight': '#fff9c4',
  '--color-search-focus': '#fff3cd',
  '--color-focus-border': '#0969da',
  '--color-border': '#d0d7de',
  '--font-mono': 'Cascadia Code,Fira Code,Consolas,monospace',
  '--font-sans': '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
  '--font-size-base': '15px',
};

const rootCss = `:root{${Object.entries(themeVars).map(([k, v]) => `${k}:${v}`).join(';')}}`;

const baseRules = [
  '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
  'body{padding:16px;font-family:var(--font-mono);font-size:var(--font-size-base);',
  'line-height:1.6;white-space:pre-wrap;word-break:break-all;',
  'color:var(--color-text);background:var(--color-bg)}',
];

const segRules = [
  '.seg-add{background:var(--color-add-bg);color:var(--color-add-text)}',
  '.seg-del{background:var(--color-del-bg);color:var(--color-del-text);text-decoration:line-through}',
  '.seg-mod-old{background:var(--color-mod-old-bg);color:var(--color-mod-old-text);text-decoration:line-through}',
  '.seg-mod-new{background:var(--color-mod-new-bg);color:var(--color-mod-new-text)}',
  '.seg-user-add{background:var(--color-user-add-bg);color:var(--color-user-add-text)}',
  '.seg-user-del{background:var(--color-user-del-bg);color:var(--color-user-del-text);text-decoration:line-through}',
  '.seg-user-mod-old{background:var(--color-user-mod-old-bg);color:var(--color-user-mod-old-text);text-decoration:line-through}',
  '.seg-user-mod-new{background:var(--color-user-mod-new-bg);color:var(--color-user-mod-new-text);font-weight:600}',
  '.seg-user-restored{background:var(--color-user-restored-bg);color:var(--color-user-restored-text)}',
  '.seg-none{background:transparent;color:var(--color-text)}',
  '.ci-flash{animation:ci-flash-anim 0.6s ease-out 2}',
  '@keyframes ci-flash-anim{0%,100%{box-shadow:none}50%{box-shadow:0 0 0 4px var(--color-focus-border)}}',
];

/** Complete stylesheet embedded in exported HTML. */
export const embedCss = [rootCss, ...baseRules, ...segRules].join('');
