/**
 * "Keep tabular alignment working" (DESIGN.md §RTL), checked against the actual font files.
 *
 * The times column, the ticking countdown and the qada counters all depend on digits being
 * equal-width. In Latin that is what `fontVariant: ['tabular-nums']` buys from Lora. In Arabic it
 * cannot be: `AppText` switches every variant to an Arabic face when the UI language is Arabic
 * — Noto Naskh Arabic for UI text, Amiri for the two calligraphy variants. Amiri has no `tnum`
 * feature to ask for (Noto Naskh has one, but nothing relies on it), and a proportional Arabic-Indic set would make a column of prayer
 * times ragged and a running countdown shimmer once a second.
 *
 * Amiri's figures happen to be uniform — which is *why* D40 is safe — but "happen to be" is not a
 * guarantee anyone can rely on across a dependency bump. So it is measured here, straight out of
 * the shipped TTFs' `hmtx` tables. If `@expo-google-fonts/amiri` ever ships a face with
 * proportional digits, this is the test that says so, instead of a bug report about the times
 * "wobbling".
 *
 * Lora is measured too: it is the Latin face, and the same column has to hold in English.
 */

import { readFileSync } from 'fs';

/** Advance widths (in font units) for a set of codepoints, read from `hmtx` via `cmap` format 4. */
function digitAdvances(path: string, codepoints: number[]): number[] {
  const font = readFileSync(path);

  const tables = new Map<string, number>();
  const tableCount = font.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + 16 * index;
    tables.set(font.toString('latin1', record, record + 4), font.readUInt32BE(record + 8));
  }

  const hhea = tables.get('hhea');
  const hmtx = tables.get('hmtx');
  const cmap = tables.get('cmap');
  if (hhea === undefined || hmtx === undefined || cmap === undefined) {
    throw new Error(`${path}: missing hhea/hmtx/cmap`);
  }
  const metricCount = font.readUInt16BE(hhea + 34);

  // Format 4 covers the BMP, and both digit ranges live far below U+FFFF.
  let subtable: number | null = null;
  const encodings = font.readUInt16BE(cmap + 2);
  for (let index = 0; index < encodings; index += 1) {
    const offset = font.readUInt32BE(cmap + 4 + 8 * index + 4);
    if (font.readUInt16BE(cmap + offset) === 4) subtable = cmap + offset;
  }
  if (subtable === null) throw new Error(`${path}: no format-4 cmap subtable`);

  const segments = font.readUInt16BE(subtable + 6) / 2;
  const ends = subtable + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;

  const glyphFor = (codepoint: number): number => {
    for (let segment = 0; segment < segments; segment += 1) {
      const end = font.readUInt16BE(ends + segment * 2);
      const start = font.readUInt16BE(starts + segment * 2);
      if (codepoint > end || codepoint < start) continue;
      const delta = font.readInt16BE(deltas + segment * 2);
      const rangeOffset = font.readUInt16BE(rangeOffsets + segment * 2);
      if (rangeOffset === 0) return (codepoint + delta) & 0xffff;
      const address = rangeOffsets + segment * 2 + rangeOffset + (codepoint - start) * 2;
      const glyph = font.readUInt16BE(address);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };

  return codepoints.map((codepoint) => {
    const glyph = glyphFor(codepoint);
    if (glyph === 0) {
      throw new Error(`${path}: no glyph for U+${codepoint.toString(16).toUpperCase()}`);
    }
    return font.readUInt16BE(hmtx + 4 * Math.min(glyph, metricCount - 1));
  });
}

const range = (first: number): number[] => Array.from({ length: 10 }, (_, n) => first + n);
const ARABIC_INDIC = range(0x0660);
const WESTERN = range(0x0030);

/** The two Amiri instances the app registers (see app/_layout.tsx). */
const AMIRI = [
  ['Amiri 400', 'node_modules/@expo-google-fonts/amiri/400Regular/Amiri_400Regular.ttf'],
  ['Amiri 700', 'node_modules/@expo-google-fonts/amiri/700Bold/Amiri_700Bold.ttf'],
] as const;

describe('Amiri — the calligraphy face (heroArabic, rowArabic, the qibla title)', () => {
  it.each(AMIRI)('%s draws all ten Arabic-Indic digits at one width', (_name, path) => {
    const widths = digitAdvances(path, ARABIC_INDIC);
    expect(new Set(widths).size).toBe(1);
    // Pinned so a font bump that changes the metric shows up as a diff rather than as silence.
    expect(widths[0]).toBe(585);
  });

  it.each(AMIRI)('%s draws all ten Western digits at one width too', (_name, path) => {
    // The Maghreb path renders Latin digits in Amiri, so that column has to hold as well.
    const widths = digitAdvances(path, WESTERN);
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBe(532);
  });

  it.each(AMIRI)('%s keeps a mixed-script column from jumping mid-run', (_name, path) => {
    // The two systems need not match each other — a screen is in one language at a time — but each
    // must be internally uniform, which is what the two assertions above establish. This one just
    // states the corollary the layout relies on: swapping one digit for another never resizes it.
    const [arabic] = new Set(digitAdvances(path, ARABIC_INDIC));
    const [western] = new Set(digitAdvances(path, WESTERN));
    expect(arabic).toBeGreaterThan(0);
    expect(western).toBeGreaterThan(0);
  });
});

/** The four Noto Naskh instances the app registers (see app/_layout.tsx). */
const NOTO_NASKH = [
  [
    'Noto Naskh 400',
    'node_modules/@expo-google-fonts/noto-naskh-arabic/400Regular/NotoNaskhArabic_400Regular.ttf',
  ],
  [
    'Noto Naskh 500',
    'node_modules/@expo-google-fonts/noto-naskh-arabic/500Medium/NotoNaskhArabic_500Medium.ttf',
  ],
  [
    'Noto Naskh 600',
    'node_modules/@expo-google-fonts/noto-naskh-arabic/600SemiBold/NotoNaskhArabic_600SemiBold.ttf',
  ],
  [
    'Noto Naskh 700',
    'node_modules/@expo-google-fonts/noto-naskh-arabic/700Bold/NotoNaskhArabic_700Bold.ttf',
  ],
] as const;

describe('Noto Naskh Arabic — the face Arabic UI text is set in', () => {
  // This is where D40's alignment guarantee actually lives now: the times column, the ticking
  // countdown and the qada counters are UI text, so they are set in Noto Naskh, not Amiri.
  it.each(NOTO_NASKH)('%s draws all ten Arabic-Indic digits at one width', (_name, path) => {
    const widths = digitAdvances(path, ARABIC_INDIC);
    expect(new Set(widths).size).toBe(1);
  });

  it.each(NOTO_NASKH)('%s draws all ten Western digits at one width too', (_name, path) => {
    // The Maghreb and the UAE read Latin digits in an Arabic UI, so that column has to hold too.
    const widths = digitAdvances(path, WESTERN);
    expect(new Set(widths).size).toBe(1);
  });

  it('keeps one weight’s column self-consistent, which is all a column ever mixes', () => {
    // Widths differ *between* weights (449 / 462 / 476 / 488) and that is fine: a column is one
    // role, so it is one weight. What would tear it is a single weight being proportional.
    for (const [, path] of NOTO_NASKH) {
      expect(new Set(digitAdvances(path, ARABIC_INDIC)).size).toBe(1);
    }
  });
});

describe('Noto Nastaliq Urdu — the face Urdu UI text is set in (D210)', () => {
  // Urdu reads Western digits, so that is the column that has to hold.
  it.each([
    [
      'Noto Nastaliq 400',
      'node_modules/@expo-google-fonts/noto-nastaliq-urdu/400Regular/NotoNastaliqUrdu_400Regular.ttf',
    ],
    [
      'Noto Nastaliq 700',
      'node_modules/@expo-google-fonts/noto-nastaliq-urdu/700Bold/NotoNastaliqUrdu_700Bold.ttf',
    ],
  ])('%s draws all ten Western digits at one width', (_name, path) => {
    expect(new Set(digitAdvances(path, WESTERN)).size).toBe(1);
  });
});

describe('Lora — the Latin face', () => {
  it.each([
    ['Lora 400', 'node_modules/@expo-google-fonts/lora/400Regular/Lora_400Regular.ttf'],
    ['Lora 700', 'node_modules/@expo-google-fonts/lora/700Bold/Lora_700Bold.ttf'],
  ])('%s carries ten Western digits', (_name, path) => {
    // Lora's default figures are proportional, which is exactly why `AppText` asks for
    // `tabular-nums` on the `time` variant rather than trusting the defaults. All this pins is
    // that the glyphs exist — the alignment itself comes from the OpenType feature.
    expect(digitAdvances(path, WESTERN)).toHaveLength(10);
  });

  it('has no Arabic-Indic digits at all, which is why it is never used for Arabic', () => {
    // If Lora were ever selected under an Arabic UI, every Arabic-Indic digit would fall back to a
    // system face mid-column and the alignment would be gone. `AppText` prevents that by switching
    // the whole scale to Amiri; this records the reason.
    expect(() =>
      digitAdvances('node_modules/@expo-google-fonts/lora/400Regular/Lora_400Regular.ttf', [0x0660])
    ).toThrow(/no glyph/);
  });
});
