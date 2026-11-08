/**
 * Design tokens for the "Paper & Seal" language.
 *
 * Light palette values were extracted verbatim from the approved design (docs/DESIGN.md), then
 * the quiet half was deliberately darkened for WCAG AA (D53, spec-accessibility §2.2): the
 * approved values put word-carrying text at 2.2–4.4:1. Every retuned value stays in the same
 * gold-brown hue family — deeper ink on the same parchment. Whisper-light values survive only
 * on decorative, non-word elements (hairlines, borderFaint, the ornament at large size).
 *
 * D56 then took back the lightness D53 over-spent: each quiet tone is the LIGHTEST value that
 * still clears its bar on its real surfaces (small safety margin included), each derived from
 * its own approved parent by hue-preserving darkening, so the register keeps the parents'
 * darkest→lightest order and their warmth instead of collapsing onto one desaturated olive.
 * Do not darken these further "for safety" — quiet that shouts is a design failure here
 * (the test suite caps them from above as well as below).
 *
 * The night-paper palette is the darkened-parchment counterpart (refined during M8); it always
 * met AA and is untouched.
 */

export interface Palette {
  /** Screen background (under the paper texture) */
  bg: string;
  /** Card fills at increasing prominence */
  cardQuiet: string;
  card: string;
  cardBright: string;
  cardElevated: string;
  /** Text */
  ink: string;
  inkStrong: string;
  header: string;
  muted: string;
  faint: string;
  soft: string;
  /** Accent family */
  accent: string;
  accentDeep: string;
  diamond: string;
  /** Status */
  late: string;
  missed: string;
  unlogged: string;
  sealFg: string;
  /**
   * The scrim behind a sheet. Its own token because it is the one colour that must go the SAME
   * way in both themes: a scrim always darkens. Reusing `ink` for it (as the day-detail sheet
   * first did) is correct on paper and inverts on night paper, where it washes the screen pale
   * behind the sheet instead of pushing it back.
   */
  scrim: string;
  /** Borders */
  borderStrong: string;
  borderMid: string;
  borderFaint: string;
  hairline: string;
  /** Qibla aligned state (green — used ONLY for alignment) */
  aligned: string;
  alignedFg: string;
  alignedText: string;
  alignedTintBg: string;
  alignedTintBorder: string;
  /** Shadows (color part) */
  shadowGold: string;
  /**
   * The ink the paper-grain tile is drawn in on this ground (`PaperBackground`). The bundled tile
   * is warm brown and works by *darkening* the sheet, which is correct on paper and does nothing
   * at all on night paper — so the dark palette re-inks it cream and it lightens instead.
   */
  textureInk: string;
}

export const paperLight: Palette = {
  bg: '#ece1c5',
  cardQuiet: 'rgba(255,252,242,0.45)',
  card: 'rgba(255,252,242,0.7)',
  cardBright: 'rgba(255,252,242,0.85)',
  cardElevated: 'rgba(255,252,242,0.97)',
  ink: '#2b2115',
  inkStrong: '#5a4413',
  // The quiet register (header → soft) converges when forced to 4.5:1 on this parchment (D53) —
  // italics, size and position carry the hierarchy the shades used to. D56 holds each at the
  // LIGHTEST compliant value derived from its own approved parent (#7a6842/#8d7b52/#a08650/
  // #ab9668), keeping the parents' darkest→lightest order: 4.62/4.58/4.53/4.52 on bg.
  header: '#72613d',
  muted: '#716241',
  faint: '#75623b',
  soft: '#716345',
  accent: '#8a6420',
  accentDeep: '#7c5a16',
  // Streak numeral (20px/600, large-text 3:1 bar) and the ◆ ornament: 3.04:1 on bg — held just
  // over the bar so the gold stays gold (D56).
  diamond: '#a2792c',
  // The lightest value that clears 4.5:1 on late's REAL word surfaces — the "Late" option label
  // on the open pill (cardElevated, 4.78) and the HealthNotice attention caption (cardBright,
  // 4.65). D53's #ab5f2e measured 4.48 on cardBright — a real miss the pin now covers (D56).
  late: '#a75d2d',
  missed: '#a5522f',
  // Deliberately held AT the 3:1 graphics bar, no deeper — the dashed ring's lightness IS its
  // meaning ("nothing logged yet"), so it must stay visibly empty and light (D53). It also
  // cannot go lighter: its quietest real surface is the quiet prayer-row card (PrayerRow renders
  // non-next rows on cardQuiet), where this value is 3.04:1 already (D56).
  unlogged: '#9e854d',
  sealFg: '#faf4e4',
  // Exactly what the day-detail sheet already rendered (`ink` at 35%), so the approved light
  // theme is unchanged by the token's arrival.
  scrim: 'rgba(43,33,21,0.35)',
  borderStrong: '#c9a75c',
  borderMid: '#cdb98a',
  borderFaint: 'rgba(166,124,46,0.22)',
  hairline: 'rgba(166,124,46,0.35)',
  aligned: '#3f6f42',
  alignedFg: '#f2f7ee',
  alignedText: '#2f5632',
  alignedTintBg: 'rgba(63,111,66,0.12)',
  alignedTintBorder: 'rgba(63,111,66,0.4)',
  shadowGold: 'rgba(138,100,32,0.45)',
  // The tile exactly as authored (every one of its pixels is this brown at some alpha), so the
  // approved light ground renders unchanged whether or not the tint is applied.
  textureInk: '#6b542e',
};

/**
 * Night paper — the same sheet of parchment, seen by lamplight.
 *
 * Three rules shaped it, and they are what a future edit has to preserve:
 *
 * 1. **One ground, one ink family.** The page is a deep warm brown at the design's own hue
 *    (~37°, `#20190e`), never a neutral grey; every card is that same brown *lit* — a single
 *    warm tint `rgba(64,50,26,…)` at the light palette's four alphas, so the four surface levels
 *    stay one material. Composited they read `#2e2413 · #362b16 · #3b2e18 · #3f311a`, a 1.14 →
 *    1.38 lift over the ground (light lifts 1.11 → 1.26; a dark ground needs slightly more to
 *    show an edge at all).
 * 2. **The fill/ink roles invert, the hues do not.** In light, `accent` is dark gold with a cream
 *    `sealFg` on it; in dark, `accent` is lit gold with a near-black-brown `sealFg` on it. Both
 *    directions have to clear AA at once — `accent` as ink on a card *and* `sealFg` as ink on
 *    `accent` — which is only possible if `sealFg` sits past the ground on the far side. It does
 *    (`#1c1509`, a shade under `bg`), exactly as light's `#faf4e4` sits a shade over `#ece1c5`.
 *    `accent` is deliberately held at ~6.5:1 on the ground rather than the 7.4:1 of the first
 *    pass: a 48pt seal is a large field of colour, and past ~6.5 it stops reading as gold ink
 *    and starts glowing.
 * 3. **Status colours are lifted, but shape still carries the meaning.** `late` and `missed` are
 *    raised until the 8.5pt option labels clear 4.5:1 on the *brightest* surface they ever sit on
 *    (the open seal's elevated pill), and `aligned` is lifted to sit at the golds' luminance so
 *    the qibla green reads as a peer of the accent, not as a dimmer version of it. Gold and late
 *    stay ~13° apart in hue, as they are in light; late and missed are ~13° apart here against
 *    light's ~6°, because a lifted orange and a lifted terracotta drift together faster than the
 *    burnt originals do. None of that is what makes a seal readable, though — as in light, every
 *    state also differs by glyph and by its accessibility word (see `PrayerSeal`).
 *
 * Every text token clears WCAG AA (4.5:1) against all four surfaces; the three quiet tones
 * (`faint`, `soft`, `unlogged`) are secondary/decorative and clear 3:1, which is still a better
 * margin than the approved light palette gives them. `theme/tokens.test.ts` pins all of it.
 */
export const nightPaper: Palette = {
  bg: '#20190e',
  cardQuiet: 'rgba(64,50,26,0.45)',
  card: 'rgba(64,50,26,0.7)',
  cardBright: 'rgba(64,50,26,0.85)',
  cardElevated: 'rgba(64,50,26,0.97)',
  ink: '#ece0c4',
  inkStrong: '#dcb96f',
  header: '#bda882',
  muted: '#ad9a6e',
  faint: '#9c8a60',
  soft: '#93805a',
  accent: '#bf9950',
  accentDeep: '#d9b46b',
  diamond: '#cba85e',
  late: '#dd8a48',
  missed: '#e2876c',
  unlogged: '#8f7d57',
  sealFg: '#1c1509',
  // Deeper and heavier than light's: on a ground this dark a 35% scrim is barely a change, and
  // the sheet has to look like it is in front of the page rather than printed on it.
  scrim: 'rgba(8,5,2,0.62)',
  borderStrong: '#b58f3f',
  borderMid: 'rgba(203,168,94,0.55)',
  borderFaint: 'rgba(214,180,110,0.22)',
  hairline: 'rgba(214,180,110,0.34)',
  aligned: '#6fa872',
  alignedFg: '#0e1a0f',
  alignedText: '#a9cfab',
  alignedTintBg: 'rgba(111,168,114,0.16)',
  alignedTintBorder: 'rgba(111,168,114,0.45)',
  // Gold, not black: a black glow is invisible on a dark ground, so the next-prayer card and the
  // prayed seal simply lost their halo in the first pass. Warm and low-alpha, it reads as the
  // lamp catching the seal's edge.
  shadowGold: 'rgba(201,167,92,0.28)',
  textureInk: '#d9c49b',
};

/**
 * Buddy avatars — the disc a buddy is drawn as on a prayer row (D174).
 *
 * An avatar is a filled disc with an icon in it, and the pair of them is the identity: **never
 * colour alone**, because a state or a person carried by colour alone is unreadable to a
 * colour-blind eye and invisible in a screenshot printed in grey. `BUDDY_ICONS` in
 * `domain/buddies.ts` is the other half.
 *
 * ## How these were chosen
 *
 * Three things were fixed before a single hue was picked:
 *
 * 1. **No green.** The deep qibla green is reserved for alignment and for nothing else
 *    (`aligned`, DESIGN.md, D124). Nothing here comes nearer to it than teal, sixty degrees away.
 * 2. **No gold.** Gold is the app's own accent; a buddy wearing it would read as the app talking
 *    about itself. `stone` sits on gold's hue but at a third of its saturation, so it reads as a
 *    warm grey rather than a dim accent.
 * 3. **The order is load-bearing.** `firstFreeAvatar` walks the colour list, so the sequence below
 *    is what guarantees that the first five buddies somebody adds are as far apart on the wheel as
 *    it allows — ocean, brick, violet, teal, rose.
 *
 * Every value is then the tone that *just* clears its bars, which is D56's rule applied to a new
 * family: the glyph reads at 4.5:1 against its own disc, and the disc reads at 3:1 against every
 * card it can sit on. Darkening these "for safety" would drain the hue, and the hue is the whole
 * job — eight of these have to be told apart at 22pt. `tokens.test.ts` caps them from both sides.
 */
export type BuddyColorName =
  | 'ocean'
  | 'brick'
  | 'violet'
  | 'teal'
  | 'rose'
  | 'stone'
  | 'plum'
  | 'clay';

/** Disc fills on paper. The glyph on them is {@link paperLight}'s `sealFg`. */
export const buddyDiscLight: Record<BuddyColorName, string> = {
  ocean: '#4072a4',
  brick: '#b74750',
  violet: '#7647b7',
  teal: '#31787e',
  rose: '#b5467d',
  stone: '#796d5b',
  plum: '#ac43ac',
  clay: '#9f5e3e',
};

/**
 * Disc fills on night paper. Lifted rather than inverted: the same hue at the DEEPEST tone that
 * still clears both bars against a dark ground, so a buddy who is "the blue one" stays the blue
 * one when the lamp goes out. The glyph on them is {@link nightPaper}'s `sealFg`.
 */
export const buddyDiscNight: Record<BuddyColorName, string> = {
  ocean: '#4e84ba',
  brick: '#c3646c',
  violet: '#946fc7',
  teal: '#398c92',
  rose: '#c16091',
  stone: '#8d7f6b',
  plum: '#be58be',
  clay: '#b86e49',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 26,
} as const;

export const radius = {
  card: 14,
  cardLarge: 24,
  pill: 999,
} as const;

/**
 * Motion durations from the design (ms).
 *
 * `morph` and `fade` are the seal's: the pill's width and the cross-fade between its face and its
 * three options. The design drew them at 240 and 150 with the options held back a further 70ms;
 * the owner found the result something to wait through ("I don't want the user to have to wait
 * to watch a seal open before they can take action", 2026-09-13), so both are shorter and the
 * hold is gone. The tap targets were never gated on the animation — this only shortens how long
 * the eye waits to see them. Shortened again on 2026-11-07 (owner: "the seals animation is slow,
 * should be snappy and quick"): press 120 → 70, fade 100 → 70, morph 160 → 120, with an ease-out
 * curve so the motion is mostly done in the first frames (D197).
 */
export const motion = {
  press: 70,
  fade: 70,
  morph: 120,
  state: 200,
  dial: 420,
} as const;
