import {
  I18nManager,
  Platform,
  Text,
  type ColorValue,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { fonts, useTheme } from '@/theme';

/**
 * Material Symbols Rounded glyphs, rendered from a subset font bundled in assets/fonts
 * (two static instances: FILL=1 "filled" and FILL=0 "outlined"; wght 400, opsz 24).
 * Codepoints come from the official Google codepoints file. To add a glyph: add its
 * name+codepoint here AND regenerate the subset fonts (see docs/DESIGN.md typography notes).
 */
const GLYPHS = {
  add: 0xe145,
  alarm: 0xe855,
  arrow_back: 0xe5c4,
  arrow_forward: 0xe5c8,
  bedtime: 0xf159,
  cached: 0xe86a,
  calendar_month: 0xebcc,
  check: 0xe668,
  check_circle: 0xf0be,
  chevron_left: 0xe5cb,
  chevron_right: 0xe5cc,
  circle: 0xef4a,
  close: 0xe5cd,
  compass_calibration: 0xe57c,
  dark_mode: 0xe51c,
  done_all: 0xe877,
  edit: 0xf097,
  electric_bolt: 0xec1c,
  error: 0xf8b6,
  expand_less: 0xe5ce,
  expand_more: 0xe5cf,
  explore: 0xe87a,
  favorite: 0xe87e,
  file_download: 0xf090,
  help: 0xe8fd,
  history: 0xe8b3,
  info: 0xe88e,
  ios_share: 0xe6b8,
  keyboard_arrow_down: 0xe313,
  keyboard_arrow_up: 0xe316,
  language: 0xea07,
  light_mode: 0xe518,
  location_on: 0xf1db,
  lock: 0xe899,
  menu_book: 0xea19,
  mosque: 0xeab2,
  my_location: 0xe55c,
  north: 0xf1e0,
  notifications: 0xe7f5,
  notifications_active: 0xe7f7,
  notifications_off: 0xe7f6,
  open_in_new: 0xe89e,
  payments: 0xef63,
  redo: 0xe15a,
  refresh: 0xe5d5,
  remove: 0xe15b,
  routine: 0xe20c,
  schedule: 0xefd6,
  screen_rotation: 0xf2d5,
  search: 0xef7a,
  self_improvement: 0xea78,
  settings: 0xe8b8,
  share: 0xe80d,
  spa: 0xeb4c,
  star: 0xf09a,
  sunny: 0xe81a,
  sync: 0xe627,
  task_alt: 0xe2e6,
  today: 0xe8df,
  turn_left: 0xeba6,
  turn_right: 0xebab,
  undo: 0xe166,
  vibration: 0xf2cb,
  visibility: 0xe8f4,
  visibility_off: 0xe8f5,
  volume_off: 0xe04f,
  volume_up: 0xe050,
  warning: 0xf083,
  water_drop: 0xe798,
  wb_twilight: 0xe1c6,
  workspace_premium: 0xe7af,
} as const;

export type IconName = keyof typeof GLYPHS;

/**
 * Glyphs that are drawings of the reading direction, and so must be flipped when the reading
 * direction flips. `undo` is an arrow curving *backwards* through what you just did — in Arabic,
 * backwards points the other way, and an unflipped undo arrow reads as "redo".
 *
 * The list is deliberately short, and three families are deliberately **not** on it:
 *
 * - **Chevrons.** `chevron_left`/`chevron_right` are already chosen *by name* at every call site
 *   (see `i18n/direction.backChevron`). Mirroring them here as well would flip them twice and
 *   land them back where they started.
 * - **The Qibla's `turn_left` / `turn_right`.** They are instructions about the user's body, not
 *   about the page: "turn right" means turn right, in every language.
 * - **`north`, `explore`, `my_location`, `compass_calibration`.** Geography. See CompassDial.
 */
const MIRRORED_GLYPHS: ReadonlySet<IconName> = new Set<IconName>(['undo', 'redo']);

/** One entry of a style's `transform` list (the RN type also allows a CSS string; not used). */
type Transform = Extract<NonNullable<TextStyle['transform']>, readonly unknown[]>[number];

/** Flat horizontal mirror, applied to {@link MIRRORED_GLYPHS} while the layout is right-to-left. */
const MIRROR: Transform[] = [{ scaleX: -1 }];

/**
 * Vertical metrics of the bundled Material Symbols subsets (their `hhea` table: 960 units/em,
 * ascent 1056, descent 96). The face is built so a glyph's optical centre sits at
 * (ascent − descent)/2 = 480 units — exactly half the em — which means a glyph is perfectly
 * centred as long as the line box keeps the font's natural ascent:descent split.
 */
const ICON_UNITS_PER_EM = 960;
const ICON_ASCENT = 1056;
const ICON_DESCENT = 96;

/**
 * The optical correction that keeps a glyph centred inside its `size`×`size` box.
 *
 * The style below pins `lineHeight` to `size` so an icon occupies a square box, and there the
 * platforms part ways. Android re-centres the shrunken line box with CSS half-leading
 * (`CustomLineHeightSpan`), so it needs nothing. iOS applies no compensation when the requested
 * line height is *smaller* than the font's natural one (`RCTApplyBaselineOffsetForRange` bails
 * out), and TextKit then keeps the baseline pinned `descent` above the box bottom — which lifts
 * every glyph by half the trimmed leading. That was the "everything sits slightly high in its
 * circle" defect: seals, option icons, calendar chevrons, all of them.
 *
 * The translate puts exactly that half-leading back. It is a measurement of the font, never an
 * eyeballed nudge: (naturalLineHeight − size) / 2 = size × (1056 + 96 − 960) / (2 × 960).
 *
 * @param size - The icon's font size (and box height).
 * @returns Points to shift the glyph down; `0` where the platform already centres.
 */
export function iconOpticalShift(size: number): number {
  if (Platform.OS !== 'ios') return 0;
  return (size * (ICON_ASCENT + ICON_DESCENT - ICON_UNITS_PER_EM)) / (2 * ICON_UNITS_PER_EM);
}

export interface IconProps {
  name: IconName;
  size?: number;
  color?: ColorValue;
  /** filled (FILL=1, design default) or outlined (FILL=0, e.g. inactive tabs) */
  variant?: 'filled' | 'outlined';
  style?: StyleProp<TextStyle>;
}

export function Icon({ name, size = 20, color, variant = 'filled', style }: IconProps) {
  const { colors } = useTheme();

  // Both corrections are transforms, so they compose here instead of fighting in the style array.
  const transform: Transform[] = [];
  const opticalShift = iconOpticalShift(size);
  if (opticalShift !== 0) transform.push({ translateY: opticalShift });
  // `isRTL` is read during render rather than captured at module scope, so a direction
  // change is picked up on the reload that applies it.
  if (MIRRORED_GLYPHS.has(name) && I18nManager.isRTL) transform.push(...MIRROR);

  return (
    <Text
      accessible={false}
      // Icons follow the user's type size, modestly (spec-accessibility §2.4): a 1.4× cap lets
      // icon-only affordances grow with Dynamic Type without bursting the fixed geometry they sit
      // in (tab bar, seal, 46pt calendar cells).
      maxFontSizeMultiplier={1.4}
      style={[
        {
          fontFamily: variant === 'filled' ? fonts.iconFilled : fonts.iconOutlined,
          fontSize: size,
          lineHeight: size,
          color: color ?? colors.ink,
        },
        transform.length > 0 ? { transform } : null,
        style,
      ]}
    >
      {String.fromCodePoint(GLYPHS[name])}
    </Text>
  );
}
