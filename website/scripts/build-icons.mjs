/**
 * Renders the home-screen icons from the brand mark.
 *
 * The favicon is the mark's *small* optical variant — heavier strokes, no finial — because it has
 * to survive a browser tab. A home-screen icon is the opposite problem, so these use the **full**
 * variant, geometry copied from src/components/Logo.astro (itself 1:1 with the app's Logo.tsx).
 *
 * Two shapes, because they are cropped differently:
 *   - `icon-*.png`  — the mark on paper, rounded corners drawn in, for anywhere the platform
 *                     shows the image as-is.
 *   - `maskable-*.png` — the same mark on a full-bleed gold field, drawn inside the safe circle
 *                     (40% radius) that Android is entitled to crop to. A maskable icon that
 *                     ignores that safe zone loses its minarets to a circle mask.
 *
 * Run by hand with `bun run icons` when the mark changes; the output is committed.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

const PAPER = '#ece1c5';
const GOLD = '#8a6420';
const CREAM = '#f3e7c8';

/** The mark, full optical variant, in a 64-unit box. */
const mark = (color) => `
  <g fill="none" stroke="${color}" stroke-linecap="round">
    <path d="M18 42A14 14 0 0 1 46 42" stroke-width="3.4"/>
    <path d="M32 26v-5" stroke-width="2.6"/>
    <path d="M10.5 42V29M53.5 42V29" stroke-width="3.4"/>
    <path d="M7 46h50" stroke-width="3.4"/>
  </g>
  <circle cx="32" cy="18" r="2.6" fill="${color}"/>
  <circle cx="10.5" cy="25" r="2.6" fill="${color}"/>
  <circle cx="53.5" cy="25" r="2.6" fill="${color}"/>`;

/** Gold mark on paper, with the rounded square drawn in. */
const plain = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="${PAPER}"/>
  ${mark(GOLD)}
</svg>`;

/**
 * Cream mark on gold, full bleed. The mark is scaled to 62% and centred so every part of it sits
 * inside the circle Android may crop to, which is 80% of the width.
 */
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${GOLD}"/>
  <g transform="translate(32 32) scale(0.62) translate(-32 -32)">
    ${mark(CREAM)}
  </g>
</svg>`;

const jobs = [
  ['icon-192.png', plain, 192],
  ['icon-512.png', plain, 512],
  ['maskable-192.png', maskable, 192],
  ['maskable-512.png', maskable, 512],
  // iOS ignores the manifest's icons and reads this one; it also composites onto its own rounded
  // rect, so the artwork must not carry transparent corners.
  ['apple-touch-icon.png', plain, 180],
];

for (const [name, svg, size] of jobs) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(OUT, name), png);
  console.log(`${name}: ${(png.length / 1024).toFixed(1)} KB`);
}
