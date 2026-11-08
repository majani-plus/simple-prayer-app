/**
 * CSS custom properties derived from the app's own design tokens, so the site can never drift
 * from the palette the app ships (docs/DECISIONS.md D50). Both themes are emitted; the page
 * follows prefers-color-scheme.
 *
 * `tokens.generated.ts` is written from `src/theme/tokens.ts` by scripts/generate-tokens.ts on
 * every build — the coupling crosses the repo boundary at build time rather than at bundle time,
 * because Vite cannot transform a file outside this project without tripping over the app's
 * tsconfig on a CI host that installs only this directory.
 */
import { nightPaper, paperLight, type Palette } from './tokens.generated';

/**
 * The paper-grain tile from DESIGN.md / the design reference's `.paper` and `.dark` classes:
 * feTurbulence noise, re-inked per theme. Light is 0.75/0.09 with ruled lines; dark (night paper)
 * is slightly finer and fainter — 0.8/0.06 — and carries no ruled lines, matching the reference.
 */
function paperNoise(ink: string, baseFrequency: number, alpha: number): string {
  const rgb = ink
    .replace('#', '')
    .match(/../g)!
    .map((h) => (parseInt(h, 16) / 255).toFixed(3));
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${baseFrequency}' numOctaves='2' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 ${rgb[0]} 0 0 0 0 ${rgb[1]} 0 0 0 0 ${rgb[2]} 0 0 0 ${alpha} 0'/></filter>` +
    `<rect width='240' height='240' filter='url(#n)'/></svg>`;
  // Fully percent-encoded: Safari refuses raw `<`/space/quote characters inside a data: URI in
  // CSS url(), which silently killed the grain layer and left only the ruled lines ("scan lines").
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function vars(p: Palette, noise: string, ruleInk: string): string {
  return `
  --bg: ${p.bg};
  --card-quiet: ${p.cardQuiet};
  --card: ${p.card};
  --card-bright: ${p.cardBright};
  --card-elevated: ${p.cardElevated};
  --ink: ${p.ink};
  --ink-strong: ${p.inkStrong};
  --header: ${p.header};
  --muted: ${p.muted};
  --faint: ${p.faint};
  --soft: ${p.soft};
  --accent: ${p.accent};
  --accent-deep: ${p.accentDeep};
  --diamond: ${p.diamond};
  --late: ${p.late};
  --missed: ${p.missed};
  --unlogged: ${p.unlogged};
  --seal-fg: ${p.sealFg};
  --scrim: ${p.scrim};
  --border-strong: ${p.borderStrong};
  --border-mid: ${p.borderMid};
  --border-faint: ${p.borderFaint};
  --hairline: ${p.hairline};
  --aligned: ${p.aligned};
  --aligned-fg: ${p.alignedFg};
  --shadow-gold: ${p.shadowGold};
  --paper-noise: ${noise};
  --paper-rule: ${ruleInk};
  `;
}

/**
 * The dark block is guarded with :root:not([data-theme="light"]) and repeated for
 * [data-theme="dark"], so an explicit choice (if the host ever stamps one) wins over the
 * system preference in both directions.
 */
const lightNoise = paperNoise(paperLight.textureInk, 0.75, 0.09);
const darkNoise = paperNoise(nightPaper.textureInk, 0.8, 0.06);
const lightVars = vars(paperLight, lightNoise, 'rgba(122,96,44,.025)');
const darkVars = vars(nightPaper, darkNoise, 'transparent');

export const themeCss = `
:root { ${lightVars} color-scheme: light; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { ${darkVars} color-scheme: dark; }
}
:root[data-theme="dark"] { ${darkVars} color-scheme: dark; }

/* A section deliberately set in night paper in BOTH themes — the dark theme is a selling point,
   so the landing page shows it even to light-mode visitors. */
.night-scope { ${darkVars} color-scheme: dark; }
`;
