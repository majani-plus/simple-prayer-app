/**
 * Builds the press-kit downloads linked from /press into public/press/files/ (gitignored).
 *
 * Nothing here is a new picture. The logos are the mark's own SVGs (website/press/logos, drawn from
 * the geometry in src/components/Logo.tsx), the icon is the app's shipped icon, and the screenshots
 * are the audited captures and store screens already in the repo (docs/screenshots,
 * docs/store-screens). Generating the zips at build time keeps tens of megabytes of duplicates out
 * of git, and means a re-captured screenshot reaches the press kit on the next deploy by itself.
 *
 * Every file stays under Cloudflare Pages' 25 MiB limit; the script fails the build if one does not.
 * Zip entries carry a fixed date, so an unchanged input gives a byte-identical zip.
 *
 * Run automatically by `bun run build` and `bun run dev`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { zipSync, type Zippable } from 'fflate';
import { press } from '../src/press';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SITE = join(HERE, '..');
const REPO = join(SITE, '..');
const OUT = join(SITE, 'public', 'press', 'files');
const LOGOS = join(SITE, 'press', 'logos');
const MAX_BYTES = 25 * 1024 * 1024;
const MTIME = new Date('2026-11-08T00:00:00Z');

mkdirSync(OUT, { recursive: true });

const pngs = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [];

const jpeg = (file: string) => sharp(file).flatten({ background: '#ece1c5' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();

async function screenshots(lang: string): Promise<Zippable> {
  const z: Zippable = {};
  const store = join(REPO, 'docs', 'store-screens', lang);
  for (const f of pngs(store)) {
    if (f.includes('-play')) continue; // the Play-only duplicate of the watch slide
    z[`store-screens/${f.replace('.png', '.jpg')}`] = new Uint8Array(await jpeg(join(store, f)));
  }
  for (const theme of ['light', 'dark']) {
    const dir = join(REPO, 'docs', 'screenshots', lang, theme, '6.5');
    for (const f of pngs(dir)) z[`plain/${theme}/${f.replace('.png', '.jpg')}`] = new Uint8Array(await jpeg(join(dir, f)));
  }
  const watch = join(REPO, 'docs', 'screenshots', lang, 'watch', 'today.png');
  if (existsSync(watch)) z['plain/apple-watch-today.png'] = readFileSync(watch);
  if (lang === 'en') {
    const wear = join(REPO, 'docs', 'screenshots', 'en', 'wear', 'today.png');
    if (existsSync(wear)) z['plain/wear-os-today.png'] = readFileSync(wear);
    const ipad = join(store, 'ipad');
    for (const f of pngs(ipad)) z[`store-screens/ipad/${f.replace('.png', '.jpg')}`] = new Uint8Array(await jpeg(join(ipad, f)));
  }
  z['README.txt'] = text(
    `Simple Prayer screenshots (${lang})\n\n` +
      'store-screens: the App Store and Google Play images, with their captions.\n' +
      'plain: the app itself, in the light (paper) and dark (night paper) themes, with no captions.\n\n' +
      'You may use these in articles, reviews and lists about Simple Prayer. Please do not change\n' +
      'what the screens show. Credit: Majani Plus.\n'
  );
  return z;
}

async function logos(): Promise<Zippable> {
  const z: Zippable = {};
  for (const f of readdirSync(LOGOS).filter((f) => f.endsWith('.svg')).sort()) {
    const svg = readFileSync(join(LOGOS, f));
    z[`svg/${f}`] = new Uint8Array(svg);
    const name = f.replace('.svg', '');
    if (name === 'app-icon') continue; // the shipped PNG below is the raster of record
    const img = name.startsWith('mark')
      ? sharp(svg, { density: 1200 }).resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      : sharp(svg, { density: 900 }).resize({ width: 2400 });
    z[`png/${name}.png`] = new Uint8Array(await img.png().toBuffer());
  }
  z['png/app-icon-1024.png'] = readFileSync(join(REPO, 'assets', 'images', 'icon.png'));
  z['README.txt'] = text(
    'Simple Prayer logos\n\n' +
      'mark-gold: on light backgrounds. mark-cream: on dark or gold backgrounds. mark-ink: one-colour print.\n' +
      'mark-small-gold: for use below 28 pixels. lockup-*: the mark with the name, light or dark.\n' +
      'app-icon: the icon as it appears in the stores (the stores add the rounded corners).\n\n' +
      'Please use these files as they are: do not redraw, recolour, stretch or add effects to them.\n' +
      'The name "Simple Prayer" and the mosque mark belong to Majani Plus LLC and are not covered by\n' +
      "the code's MIT licence. You may use them to write about the app.\n"
  );
  return z;
}

function factSheet(): string {
  const width = Math.max(...press.facts.map(([k]) => k.length)) + 2;
  const rows = (pairs: readonly (readonly [string, string])[]) =>
    pairs.map(([k, v]) => `${(k + ':').padEnd(width)}${v}`).join('\n');
  return [
    'SIMPLE PRAYER: FACT SHEET',
    '',
    'In one sentence',
    press.oneLine,
    '',
    'In a paragraph',
    press.short,
    '',
    'In more detail',
    press.long.join('\n\n'),
    '',
    'Facts',
    rows(press.facts),
    '',
    'What stands out',
    press.highlights.map((h) => `- ${h}`).join('\n'),
    '',
    'Easy to get wrong',
    press.accuracy.map(([wrong, right]) => `- Not "${wrong}". ${right}`).join('\n'),
    '',
    'Links',
    rows(press.links),
    '',
    `Contact: ${press.contact}`,
    'More: https://simpleprayer.app/press',
    '',
  ].join('\n');
}

const text = (s: string) => new TextEncoder().encode(s);

function write(name: string, data: Uint8Array) {
  if (data.byteLength > MAX_BYTES) {
    throw new Error(`${name} is ${(data.byteLength / 2 ** 20).toFixed(1)} MiB, over Cloudflare Pages' 25 MiB file limit`);
  }
  writeFileSync(join(OUT, name), data);
  console.log(`  press/files/${name}  ${(data.byteLength / 2 ** 20).toFixed(1)} MiB`);
}

const zip = (z: Zippable) => zipSync(z, { level: 0, mtime: MTIME }); // JPEG and PNG do not compress

const started = Date.now();
const logoZip = await logos();
const shots = Object.fromEntries(
  await Promise.all(['en', 'ar', 'tr'].map(async (l) => [l, await screenshots(l)] as const))
);
const sheet = factSheet();

write('simple-prayer-fact-sheet.txt', text(sheet));
write('simple-prayer-icon-1024.png', readFileSync(join(REPO, 'assets', 'images', 'icon.png')));
write('simple-prayer-logos.zip', zip(logoZip));
for (const l of ['en', 'ar', 'tr']) write(`simple-prayer-screenshots-${l}.zip`, zip(shots[l]));
write(
  'simple-prayer-press-kit.zip',
  zip({
    'simple-prayer-press-kit': {
      'fact-sheet.txt': text(sheet),
      logos: logoZip,
      'screenshots-en': shots.en,
      'link-preview-1200x630.png': readFileSync(join(SITE, 'public', 'og.png')),
      'feature-graphic-1024x500.png': readFileSync(join(REPO, 'docs', 'screenshots', 'graphics', 'play-feature-graphic.png')),
    },
  })
);
console.log(`press kit built in ${((Date.now() - started) / 1000).toFixed(1)} s`);

