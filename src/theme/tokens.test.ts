import {
  buddyDiscLight,
  buddyDiscNight,
  nightPaper,
  paperLight,
  type BuddyColorName,
  type Palette,
} from './tokens';
import { BUDDY_COLORS, BUDDY_LIMIT } from '../domain/buddies';

/**
 * Contrast is the one part of a palette that cannot be judged from a screenshot, so both themes
 * are pinned here. The maths is WCAG 2.x relative luminance; the only wrinkle is that half of
 * the palette is translucent (cards are a warm tint *over* the ground, tints are a status colour
 * over a card), so everything is composited down to an opaque colour before it is measured —
 * exactly as the renderer does it.
 */

type Rgb = [number, number, number];

/** Parses `#rgb`, `#rrggbb`, `rgb(…)` and `rgba(…)` into channels plus alpha. */
function parseColor(color: string): { rgb: Rgb; alpha: number } {
  if (color.startsWith('#')) {
    const body = color.slice(1);
    const full =
      body.length === 3
        ? body
            .split('')
            .map((c) => c + c)
            .join('')
        : body;
    return {
      rgb: [
        parseInt(full.slice(0, 2), 16),
        parseInt(full.slice(2, 4), 16),
        parseInt(full.slice(4, 6), 16),
      ],
      alpha: 1,
    };
  }
  const parts = /rgba?\(([^)]+)\)/.exec(color)?.[1].split(',').map(Number);
  if (!parts || parts.length < 3) throw new Error(`unparseable colour: ${color}`);
  return { rgb: [parts[0], parts[1], parts[2]], alpha: parts[3] ?? 1 };
}

/** Source-over composite of `color` onto an opaque `backdrop`. */
function composite(color: string, backdrop: Rgb): Rgb {
  const { rgb, alpha } = parseColor(color);
  return [0, 1, 2].map((i) => rgb[i] * alpha + backdrop[i] * (1 - alpha)) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast of `color` (composited if translucent) against an opaque `backdrop`. */
function contrast(color: string, backdrop: Rgb): number {
  const a = luminance(composite(color, backdrop));
  const b = luminance(backdrop);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Hue in degrees — used to prove two status colours differ by more than lightness. */
function hue(color: string): number {
  const [r, g, b] = parseColor(color).rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const raw =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (raw * 60 + 360) % 360;
}

/** The four paper surfaces, composited over the ground, in the order they stack. */
function surfaces(palette: Palette): Record<string, Rgb> {
  const bg = parseColor(palette.bg).rgb;
  return {
    bg,
    cardQuiet: composite(palette.cardQuiet, bg),
    card: composite(palette.card, bg),
    cardBright: composite(palette.cardBright, bg),
    cardElevated: composite(palette.cardElevated, bg),
  };
}

/**
 * Documented thresholds for the night theme (see the `nightPaper` doc comment):
 *
 * - **4.5:1 — every token that carries words.** Body ink, the gold scale down to `muted`, both
 *   accents, the ornament (it doubles as the streak numeral) and both status colours, measured
 *   against *all four* surfaces, because the open seal puts 8.5pt status labels on the brightest
 *   one.
 * - **3:1 — the three quiet tones and the load-bearing borders.** `faint`/`soft`/`unlogged` are
 *   hints, inactive tab labels and the dashed seal ring: secondary text and graphical objects.
 *   AA asks 3:1 of those. (Since D53 the light palette holds its word-carrying quiet tones to
 *   the full 4.5:1 — see the light-paper suite below.)
 */
const AA_TEXT = 4.5;
const AA_LARGE_OR_GRAPHIC = 3;

const INK_TOKENS = [
  'ink',
  'inkStrong',
  'header',
  'muted',
  'accent',
  'accentDeep',
  'diamond',
  'late',
  'missed',
  'alignedText',
] as const satisfies readonly (keyof Palette)[];

const QUIET_TOKENS = ['faint', 'soft', 'unlogged'] as const satisfies readonly (keyof Palette)[];

describe('theme palettes', () => {
  it('light palette matches the approved values (post-AA retune, D53)', () => {
    // Ground, brand gold and the untouched status colours are still the approved design,
    // extracted verbatim.
    expect(paperLight.bg).toBe('#ece1c5');
    expect(paperLight.accent).toBe('#8a6420');
    expect(paperLight.missed).toBe('#a5522f');
    expect(paperLight.aligned).toBe('#3f6f42');
    // The quiet half deviates from the design-extracted values on purpose: the approved design's
    // quiet register failed WCAG AA (soft 2.21:1, faint 2.68:1, muted 3.17:1, header 4.15:1,
    // late 4.38:1 on its pill, diamond 2.91:1, unlogged 2.47:1). Darkening it was a deliberate,
    // owner-sanctioned change (D53, spec-accessibility §2.2) — same gold-brown hue family,
    // deeper ink. Do not "restore" these to DESIGN.md's original table.
    // D56 then re-lightened the register to the LIGHTEST compliant values: D53's first pass
    // overshot (header 5.00:1, muted 4.88:1 on bg) and collapsed four warm parchment tones into
    // near-identical desaturated olive. Each value below is its approved parent
    // (#7a6842/#8d7b52/#a08650/#ab9668) darkened hue-preservingly until it clears 4.5:1 on bg
    // with a small margin — 4.62/4.58/4.53/4.52 — keeping the parents' darkest→lightest order.
    expect(paperLight.header).toBe('#72613d');
    expect(paperLight.muted).toBe('#716241');
    expect(paperLight.faint).toBe('#75623b');
    expect(paperLight.soft).toBe('#716345');
    // Lightest value clearing 4.5:1 on late's real word surfaces (cardBright 4.65, cardElevated
    // 4.78) — D53's #ab5f2e measured 4.48 on cardBright, where HealthNotice sets its attention
    // caption, a genuine miss the light-paper suite below now pins (D56).
    expect(paperLight.late).toBe('#a75d2d');
    expect(paperLight.diamond).toBe('#a2792c');
    expect(paperLight.unlogged).toBe('#9e854d');
  });

  it('both palettes define the same token set', () => {
    expect(Object.keys(nightPaper).sort()).toEqual(Object.keys(paperLight).sort());
  });

  it('every night-paper value is a parseable colour', () => {
    for (const [token, value] of Object.entries(nightPaper)) {
      expect(() => parseColor(value)).not.toThrow();
      expect(token).toBeTruthy();
    }
  });
});

describe('night paper contrast', () => {
  const night = surfaces(nightPaper);

  it.each(INK_TOKENS)('%s meets AA text contrast on all four surfaces', (token) => {
    // Asserting the whole row at once means a failure names *which* surface is too bright,
    // instead of stopping at the first one.
    const failures = Object.entries(night)
      .map(([name, backdrop]) => [name, contrast(nightPaper[token], backdrop)] as const)
      .filter(([, ratio]) => ratio < AA_TEXT)
      .map(([name, ratio]) => `${name}: ${ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it.each(QUIET_TOKENS)('%s meets AA non-text contrast on all four surfaces', (token) => {
    for (const backdrop of Object.values(night)) {
      expect(contrast(nightPaper[token], backdrop)).toBeGreaterThanOrEqual(AA_LARGE_OR_GRAPHIC);
    }
  });

  it('keeps the strong border visible where it marks the next prayer and today', () => {
    expect(contrast(nightPaper.borderStrong, night.card)).toBeGreaterThanOrEqual(
      AA_LARGE_OR_GRAPHIC
    );
    expect(contrast(nightPaper.borderStrong, night.bg)).toBeGreaterThanOrEqual(
      AA_LARGE_OR_GRAPHIC
    );
  });

  it('reads labels on filled surfaces — seals, pills and the aligned state', () => {
    // Dark inverts the fill/ink roles, so these are the pairs that keep the inversion legible.
    expect(contrast(nightPaper.sealFg, parseColor(nightPaper.accent).rgb)).toBeGreaterThanOrEqual(
      AA_TEXT
    );
    expect(contrast(nightPaper.sealFg, parseColor(nightPaper.late).rgb)).toBeGreaterThanOrEqual(
      AA_TEXT
    );
    expect(
      contrast(nightPaper.alignedFg, parseColor(nightPaper.aligned).rgb)
    ).toBeGreaterThanOrEqual(AA_TEXT);
    // The qibla guidance card: green text on a green tint laid over a card.
    const tint = composite(nightPaper.alignedTintBg, night.card);
    expect(contrast(nightPaper.alignedText, tint)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('lifts the missed seal outline clear of the surfaces it is drawn on', () => {
    // `missed` and `unlogged` are also pure outlines (no fill) — graphical objects, 3:1.
    for (const backdrop of Object.values(night)) {
      expect(contrast(nightPaper.missed, backdrop)).toBeGreaterThanOrEqual(AA_LARGE_OR_GRAPHIC);
      expect(contrast(nightPaper.unlogged, backdrop)).toBeGreaterThanOrEqual(AA_LARGE_OR_GRAPHIC);
    }
  });
});

/**
 * Light-paper contrast (D53). The approved design's quiet half failed WCAG AA — inactive tabs
 * 2.21:1, hints 2.68:1, captions 3.17:1, the streak numeral 2.91:1, the unlogged ring 2.47:1 —
 * so the quiet tones were darkened until every word-carrying token clears 4.5:1 and every
 * state-carrying graphic clears 3:1 on its REAL surfaces, the same contract night paper already
 * had. Ratios are computed here, never hardcoded: an edit that drops any token below its bar
 * fails this suite, whichever surface it fails on (a token can pass on bg and fail on a card,
 * or vice versa).
 */
describe('light paper contrast (AA retune, D53)', () => {
  const light = surfaces(paperLight);

  // Word-carrying on every surface, bare bg included: body ink, the converged quiet register
  // (header/muted/faint/soft at 4.62/4.58/4.53/4.52 on bg — the lightest compliant values, with
  // italics/size/position carrying the hierarchy the shades used to), the deep accent that small
  // text on bare bg now uses, and the qibla guidance text.
  const LIGHT_INK_TOKENS = [
    'ink',
    'inkStrong',
    'header',
    'muted',
    'faint',
    'soft',
    'accentDeep',
    'alignedText',
  ] as const satisfies readonly (keyof Palette)[];

  it.each(LIGHT_INK_TOKENS)('%s meets AA text contrast on all five surfaces', (token) => {
    const failures = Object.entries(light)
      .map(([name, backdrop]) => [name, contrast(paperLight[token], backdrop)] as const)
      .filter(([, ratio]) => ratio < AA_TEXT)
      .map(([name, ratio]) => `${name}: ${ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it('keeps brand gold legal everywhere it still carries words', () => {
    // `accent` stays the approved #8a6420 (brand: seal fill, calligraphy). On bare bg it is
    // 4.11:1, which is why small text there moved to `accentDeep` (active tab label, countdown
    // caption) — on bg only the 30px heroArabic remains, a large-text/graphic use (3:1 bar).
    expect(contrast(paperLight.accent, light.bg)).toBeGreaterThanOrEqual(AA_LARGE_OR_GRAPHIC);
    for (const surface of ['cardQuiet', 'card', 'cardBright', 'cardElevated'] as const) {
      expect(contrast(paperLight.accent, light[surface])).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('reads the status words on every surface they actually sit on', () => {
    // `late` and `missed` carry words in exactly two places: the option labels on the open
    // pill's cardElevated fill (PrayerSeal), and HealthNotice's status caption on a bright card.
    // Both surfaces are pinned — D53 pinned only cardElevated, which let #ab5f2e ship at 4.48:1
    // under the HealthNotice caption (fixed by D56).
    for (const surface of ['cardBright', 'cardElevated'] as const) {
      expect(contrast(paperLight.late, light[surface])).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(paperLight.missed, light[surface])).toBeGreaterThanOrEqual(AA_TEXT);
    }
    // As seal fills/outlines both are also state-carrying graphics on every surface.
    for (const backdrop of Object.values(light)) {
      expect(contrast(paperLight.late, backdrop)).toBeGreaterThanOrEqual(AA_LARGE_OR_GRAPHIC);
      expect(contrast(paperLight.missed, backdrop)).toBeGreaterThanOrEqual(AA_LARGE_OR_GRAPHIC);
    }
  });

  it('keeps the quiet register quiet — compliant, never carbonized (D56)', () => {
    // The counterpart of the AA floor: these are whisper tones on parchment, and past ~4.85:1
    // on bg they stop whispering (D53's first pass hit 5.00 and the page went cold). A failure
    // here means someone darkened "for safety" — take the lightness back instead.
    for (const token of ['header', 'muted', 'faint', 'soft'] as const) {
      expect(contrast(paperLight[token], light.bg)).toBeLessThan(4.85);
    }
    // Same guard for the streak gold: it needs 3:1 as large text and loses its shine past ~3.4.
    expect(contrast(paperLight.diamond, light.bg)).toBeLessThan(3.4);
  });

  it('keeps the approved darkest-to-lightest order of the quiet register (D56)', () => {
    // The design's four parchment tones ran header → muted → faint → soft, darkest to lightest.
    // AA forces them close together, but the ordering (and each parent's hue) is what survives
    // of the original hierarchy — a retune that reorders them scrambles which role reads first.
    const [header, muted, faint, soft] = (['header', 'muted', 'faint', 'soft'] as const).map(
      (token) => luminance(composite(paperLight[token], light.bg))
    );
    expect(header).toBeLessThan(muted);
    expect(muted).toBeLessThan(faint);
    expect(faint).toBeLessThan(soft);
  });

  it('keeps the streak numeral readable as large text', () => {
    // `diamond` is the 20px/600 streak numeral (large text, 3:1) and the ornament; it sits on
    // bare bg and on cards.
    for (const backdrop of Object.values(light)) {
      expect(contrast(paperLight.diamond, backdrop)).toBeGreaterThanOrEqual(AA_LARGE_OR_GRAPHIC);
    }
  });

  it('lifts the unlogged dashed ring to the graphics bar without losing its lightness', () => {
    // State-carrying graphic: 3:1 exactly, and no more — the ring's lightness IS its meaning
    // ("empty, nothing logged"). Its real surfaces are the card fills (prayer rows, day-detail
    // sheet, option cards); it is never drawn on bare bg.
    for (const surface of ['cardQuiet', 'card', 'cardBright', 'cardElevated'] as const) {
      const ratio = contrast(paperLight.unlogged, light[surface]);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_OR_GRAPHIC);
    }
    // Guard the "and no more": if a future edit darkens it past ~4:1 on its quietest surface,
    // the empty ring starts reading as a logged state.
    expect(contrast(paperLight.unlogged, light.cardQuiet)).toBeLessThan(4);
  });

  it('reads the seal glyph on every filled seal', () => {
    // The cream glyph on gold/late/missed fills is a graphic (3:1); it comfortably exceeds it.
    for (const fill of [paperLight.accent, paperLight.late, paperLight.missed] as const) {
      expect(contrast(paperLight.sealFg, parseColor(fill).rgb)).toBeGreaterThanOrEqual(
        AA_LARGE_OR_GRAPHIC
      );
    }
  });
});

describe('night paper structure', () => {
  const night = surfaces(nightPaper);
  const light = surfaces(paperLight);

  it('lifts each card level above the one below it', () => {
    const ladder = ['bg', 'cardQuiet', 'card', 'cardBright', 'cardElevated'] as const;
    const luminances = ladder.map((name) => luminance(night[name]));
    for (let i = 1; i < luminances.length; i += 1) {
      expect(luminances[i]).toBeGreaterThan(luminances[i - 1]);
    }
  });

  it('gives the default card at least as much lift off the ground as the light theme does', () => {
    // A dark ground hides an edge more easily, so night paper is allowed to lift further — but
    // never less, or the rows dissolve into the page (which is what the first pass did).
    expect(contrast(nightPaper.card, night.bg)).toBeGreaterThanOrEqual(
      contrast(paperLight.card, light.bg)
    );
    expect(contrast(nightPaper.card, night.bg)).toBeGreaterThanOrEqual(1.2);
  });

  it('keeps the ground a warm brown rather than a neutral grey', () => {
    const [r, g, b] = parseColor(nightPaper.bg).rgb;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    // Same warm hue family as the approved paper, not a desaturated near-black.
    expect(Math.abs(hue(nightPaper.bg) - hue(paperLight.bg))).toBeLessThan(15);
    expect((Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b)).toBeGreaterThan(0.35);
  });

  it('darkens behind a sheet in both themes', () => {
    // The one token that must NOT invert. Both scrims have to land below their own ground once
    // composited over the brightest surface they can ever cover.
    for (const [palette, own] of [
      [paperLight, light],
      [nightPaper, night],
    ] as const) {
      const scrimmed = composite(palette.scrim, own.cardElevated);
      expect(luminance(scrimmed)).toBeLessThan(luminance(own.cardElevated));
      expect(luminance(scrimmed)).toBeLessThan(luminance(own.bg));
    }
  });

  it('puts sealFg past the ground, the way the light palette does', () => {
    // Light: cream sealFg sits *above* the paper. Dark: it must sit *below* the night ground,
    // otherwise a filled seal cannot be both legible and calm.
    expect(luminance(parseColor(nightPaper.sealFg).rgb)).toBeLessThan(luminance(night.bg));
    expect(luminance(parseColor(paperLight.sealFg).rgb)).toBeGreaterThan(luminance(light.bg));
  });

  it('keeps the status colours apart by hue, not only by lightness', () => {
    // Seal states are told apart by glyph and by the word in their accessibility label first —
    // `PrayerSeal.test.tsx` ("gives every status its own glyph") pins that, and it is the part
    // that survives colour blindness. Hue is the redundant second channel, and this guards it
    // from collapsing into one orange the next time the palette is retuned.
    const gap = (a: string, b: string) => Math.abs(hue(a) - hue(b));
    for (const palette of [paperLight, nightPaper]) {
      expect(gap(palette.accent, palette.late)).toBeGreaterThan(8);
    }
    // The approved light palette separates late from missed by barely 6° (they are both burnt
    // orange, and the seal carries the difference); night paper is not allowed to be worse.
    expect(gap(nightPaper.late, nightPaper.missed)).toBeGreaterThanOrEqual(
      gap(paperLight.late, paperLight.missed)
    );
  });

  it('lifts the qibla green to sit alongside the golds, not beneath them', () => {
    // Aligned is a peer of the accent in dark: a green that reads dimmer than the gold it
    // replaces makes "aligned" feel like a downgrade.
    const gold = contrast(nightPaper.accent, night.bg);
    const green = contrast(nightPaper.aligned, night.bg);
    expect(green).toBeGreaterThanOrEqual(gold * 0.8);
    expect(hue(nightPaper.aligned)).toBeGreaterThan(80);
    expect(hue(nightPaper.aligned)).toBeLessThan(170);
  });
});

/**
 * Buddy avatar discs (D174).
 *
 * An avatar is a coloured disc with an icon on it, sitting on a prayer row. Two contrasts matter
 * and they pull against each other: the icon has to read on the disc, and the disc has to read on
 * the card. Both are pinned from below — and the disc is pinned from ABOVE as well, because the
 * failure mode here is not an invisible avatar, it is eight avatars darkened until they are all
 * the same brown and nobody can tell which buddy is which.
 */
describe('buddy avatar discs', () => {
  const light = surfaces(paperLight);
  const night = surfaces(nightPaper);
  const NAMES = Object.keys(buddyDiscLight) as BuddyColorName[];

  const THEMES = [
    ['paper', buddyDiscLight, paperLight.sealFg, light] as const,
    ['night paper', buddyDiscNight, nightPaper.sealFg, night] as const,
  ];

  it('offers exactly the colours the domain names, in the same order', () => {
    // The order is load-bearing: `firstFreeAvatar` walks it, so it is what makes the first five
    // buddies land on hues that are far apart.
    expect(NAMES).toEqual([...BUDDY_COLORS]);
    expect(Object.keys(buddyDiscNight)).toEqual([...BUDDY_COLORS]);
    expect(NAMES.length).toBeGreaterThan(BUDDY_LIMIT);
  });

  describe.each(THEMES)('on %s', (_label, discs, glyph, cards) => {
    it.each(NAMES)('%s carries its icon at AA', (name) => {
      expect(contrast(glyph, parseColor(discs[name]).rgb)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each(NAMES)('%s reads as a shape on every card it can sit on', (name) => {
      for (const backdrop of Object.values(cards)) {
        expect(contrast(discs[name], backdrop)).toBeGreaterThanOrEqual(AA_LARGE_OR_GRAPHIC);
      }
    });

    it.each(NAMES)('%s keeps its hue rather than being darkened into the brown', (name) => {
      // The cap from above, and the reason it exists. A disc held at twice its bar has lost the
      // saturation that made it that buddy; D56 made the same argument about the quiet register.
      expect(contrast(glyph, parseColor(discs[name]).rgb)).toBeLessThan(AA_TEXT * 2);
    });

    it('keeps every colour clear of the qibla green, which is reserved for alignment', () => {
      for (const name of NAMES) {
        const distance = Math.min(
          Math.abs(hue(discs[name]) - 124),
          360 - Math.abs(hue(discs[name]) - 124)
        );
        expect(distance).toBeGreaterThan(40);
      }
    });

    it('lets no saturated colour sit on the app’s own gold', () => {
      // `stone` shares gold's hue on purpose and is allowed through by being a warm grey; anything
      // vivid up there would read as the app's accent rather than as a person.
      for (const name of NAMES) {
        const { rgb } = parseColor(discs[name]);
        const max = Math.max(...rgb);
        const saturation = max === 0 ? 0 : (max - Math.min(...rgb)) / max;
        const nearGold = Math.min(Math.abs(hue(discs[name]) - 38), 360 - Math.abs(hue(discs[name]) - 38)) < 15;
        if (nearGold) expect(saturation).toBeLessThan(0.35);
      }
    });

    it('gives every buddy a distinguishable disc', () => {
      const hues = NAMES.map((name) => hue(discs[name]));
      for (let i = 0; i < hues.length; i += 1) {
        for (let j = i + 1; j < hues.length; j += 1) {
          const apart = Math.min(Math.abs(hues[i] - hues[j]), 360 - Math.abs(hues[i] - hues[j]));
          expect(apart).toBeGreaterThan(10);
        }
      }
    });
  });

  it('keeps a buddy the same colour when the lamp goes out', () => {
    // Night is the same hue lifted, not an inversion: "the blue one" has to stay the blue one.
    for (const name of NAMES) {
      const apart = Math.min(
        Math.abs(hue(buddyDiscLight[name]) - hue(buddyDiscNight[name])),
        360 - Math.abs(hue(buddyDiscLight[name]) - hue(buddyDiscNight[name]))
      );
      expect(apart).toBeLessThan(12);
    }
  });
});
