import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type AccessibilityActionEvent,
  type StyleProp,
  type ViewInstance,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import type { LoggableStatus, Prayer, PrayerStatus } from '@/domain/types';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { scriptFamilyFor } from '@/i18n/direction';
import { contentWidth, motion, radius, type as typeScale, typeScaleFor, useTheme } from '@/theme';
import { markTap } from '@/utils/perfMarks';

/**
 * The seal — the signature interaction of the app (PRODUCT_SPEC §2, DESIGN.md §Prayer row).
 *
 * Collapsed it is a 48pt circle whose face states the prayer's status. Tapped, it morphs into a
 * 160pt pill holding three choices (Prayed · Late · Missed); picking one applies it and the pill
 * collapses, and picking the status the prayer already has clears it back to unlogged.
 *
 * The currently-due prayer skips the pill entirely (`directPick`, spec-today-interaction §3): a
 * single tap on the face marks it prayed and the same tap undoes it. Late and Missed are
 * deliberately not offered there — a prayer whose window is still open cannot yet be late or
 * missed. History's DayDetail never passes `directPick`: it is a deliberate-correction surface
 * and keeps the full pill for every status.
 *
 * Three rules shape the implementation:
 *
 * 1. **It is controlled.** Exactly one seal may be open at a time, so the *parent* owns `isOpen`
 *    and closes the seal when a pick comes back. The seal never closes itself — that keeps the
 *    "apply the status" and "collapse" halves of a pick in one state update instead of two.
 * 2. **The morph runs on the UI thread.** Width, the two cross-fades and the elevated shell live
 *    in shared values driven by a single effect; nothing animates through React state, so the
 *    pill keeps moving while the JS thread writes the log to SQLite.
 * 3. **Status is never colour alone.** Every state carries its own glyph and its own word in the
 *    accessibility label, and `exempt` is rendered as a calm neutral — never as a miss.
 */

/** The collapsed seal's diameter. Straight from the mockup. */
export const SEAL_SIZE = 48;

/** One of the three option targets in the open pill (50×44 in the mockup). */
const OPTION_WIDTH = 50;
const OPTION_HEIGHT = 44;

/** The option's glyph, and the 1pt it sits above its word. */
const OPTION_ICON = 17;
const OPTION_GAP = 1;
/** The label's line box: `sealOptionLabel` plus the 2pt of leading the style adds. */
const OPTION_LINE = typeScale.sealOptionLabel + 2;

/**
 * How much of the option target is padding rather than word — the part that has no reason to grow
 * when the type does. The remaining `OPTION_WIDTH - OPTION_PAD_X` (42pt) is the text budget, and
 * it is what scales; see {@link sealPillMetrics}.
 */
const OPTION_PAD_X = 8;
/**
 * Vertically the mockup's 44pt target is a *floor*, not a proportion to keep: at the default text
 * size it holds a 30pt stack with 14 to spare, and reserving all 14 forever would make the Arabic
 * pill (whose line box is 15% taller) grow at the default size — a change to a design nobody asked
 * to change. So the box keeps 4pt of air above and below the stack once the stack outgrows 44.
 */
const OPTION_PAD_Y = 8;
/** The pill around the option target: the mockup's 48 less 44, kept at every size. */
const PILL_PAD_Y = SEAL_SIZE - OPTION_HEIGHT;
/**
 * Air inside the pill's rounded ends, before the first option's target and after the last.
 *
 * The mockup's 160pt width left `160 - 3×50 = 10pt` for both ends together — 5pt each — and at
 * that the outer two words sat against the curve of the pill with no room to breathe. The owner
 * called it out. 12pt each side is the smallest value that reads as deliberate rather than
 * cramped, and it is the padding the rest of the app already uses inside a chip.
 *
 * The middle option is untouched: the three targets keep their `OPTION_WIDTH`, so the tap targets
 * and the gaps between them are exactly as designed. Only the ends gain.
 */
const PILL_PAD_X = 12;

/** What the pill carries beyond its three options. */
const PILL_GUTTER = PILL_PAD_X * 2;

/** The width the seal morphs to when it opens: three targets plus the air at either end. */
export const SEAL_OPEN_WIDTH = 3 * OPTION_WIDTH + PILL_GUTTER;

/** The label's own ceiling (`maxFontSizeMultiplier`), and the `Icon`'s. */
const LABEL_MAX_SCALE = 2;
const ICON_MAX_SCALE = 1.4;

/**
 * The share of the screen the open pill may take before it stops growing. A last-resort clamp:
 * three words side by side at 200% simply cannot also leave a prayer name room on a small phone,
 * and a pill wider than the row would push its own third option off the screen edge — which is
 * worse than an ellipsis, because an option you cannot reach is an option you do not have.
 */
const PILL_MAX_WIDTH_RATIO = 0.78;

/** The open pill's resolved geometry. Every value is `SEAL_*`/`OPTION_*` verbatim at 1×. */
export interface SealPillMetrics {
  /** The pill's width once open. */
  width: number;
  /** The pill's height once open; `SEAL_SIZE` until the icon+word stack outgrows it. */
  height: number;
  /** One of the three option targets. */
  optionWidth: number;
  optionHeight: number;
}

/**
 * The open pill, sized from the type it actually has to hold rather than from the mockup's numbers.
 *
 * **Why this exists.** The pill was pinned at 48×160 with 50×44 options, which is right at the
 * system's default text size and wrong at every size above it: at Apple's 200% bar the three words
 * both truncate horizontally ("Prayed" wants ~66pt in a 50pt box) and overflow the 48pt
 * `overflow: hidden` clip vertically (icon 23.8 + gap 1 + line 24 = 48.8). Raising the label's cap
 * to 2.0 without giving the box anywhere to grow made that worse rather than better. So the box
 * grows with the type — spec-accessibility §2.4, D82.
 *
 * **Width grows by the type's factor, not by measuring the words.** The design already sized the
 * 50pt option so its widest word fits at the default size, in all three languages; scaling the
 * *text budget* by the same factor the text grows by preserves that fit exactly, whatever the
 * language, with no font metrics to guess and nothing to re-measure when a translation changes.
 * The padding is padding and does not scale. (Measured in the shipped faces, the default budget is
 * 42pt and the widest word of each language needs 33.6pt in English, 31.6 in Turkish and at most
 * 40.3 in Arabic — so all three are inside it, and stay inside it at every scale because both
 * sides of that comparison scale together. `PrayerSeal.test.tsx` pins it at 1× and 2×.)
 *
 * **The Arabic optical scale is deliberately absent from the width.** `AppText` sets Arabic 15%
 * larger (`arabicTypeScale`), and folding that in would widen the Arabic pill at the *default*
 * text size — a design change nobody asked for, in a language where the words already fit. It is
 * carried in the height, where it changes the line box and therefore the clip.
 *
 * @param fontScale - The OS Dynamic Type multiplier (`useWindowDimensions().fontScale`). Values
 *   below 1 are ignored: the mockup's geometry is the floor, never something to shrink past.
 * @param opticalScale - The per-language optical multiplier `AppText` applies to the label
 *   (`typeScaleFor` the UI language's script).
 * @param maxWidth - Hard ceiling on the pill's width; the option targets divide what is left.
 * @returns The pill's width, height and option target size, in points.
 */
export function sealPillMetrics(
  fontScale = 1,
  opticalScale = 1,
  maxWidth = Number.POSITIVE_INFINITY
): SealPillMetrics {
  const growth = Math.max(1, Math.min(fontScale, LABEL_MAX_SCALE));
  const iconScale = Math.max(1, Math.min(fontScale, ICON_MAX_SCALE));

  let optionWidth = Math.ceil(OPTION_PAD_X + (OPTION_WIDTH - OPTION_PAD_X) * growth);
  if (3 * optionWidth + PILL_GUTTER > maxWidth) {
    optionWidth = Math.max(OPTION_WIDTH, Math.floor((maxWidth - PILL_GUTTER) / 3));
  }

  // The stack as it will actually be set: the icon under its own 1.4 cap, the word under its 2.0
  // one, and the word's line box carrying the Arabic optical scale as `AppText` applies it.
  const content = OPTION_ICON * iconScale + OPTION_GAP + OPTION_LINE * growth * opticalScale;
  const optionHeight = Math.max(OPTION_HEIGHT, Math.ceil(content + OPTION_PAD_Y));

  return {
    width: 3 * optionWidth + PILL_GUTTER,
    height: Math.max(SEAL_SIZE, optionHeight + PILL_PAD_Y),
    optionWidth,
    optionHeight,
  };
}

/**
 * A strong ease-out: most of the morph lands in its first frames, so the pill reads as already open
 * rather than opening (D197). The design's ease-in-out spent its first third barely moving.
 */
const MORPH_EASING = Easing.bezier(0.2, 0, 0, 1);
/**
 * The options arrive as the face leaves — one cross-fade, no hold. The design staged them (face
 * out 150ms, then options in 180ms after a 70ms wait, ~250ms until the choices were readable) and
 * the owner found himself waiting for it; the pill's `prayed` option sits exactly where the face
 * was, so a straight cross-fade from ✓ to "✓ Prayed" reads as the seal *becoming* the choice
 * rather than as two things overlapping. Slightly longer than the face's fade so the words are
 * never fully in before the circle is fully gone.
 */
const OPTIONS_FADE = 80;

/** The status a pick resolves to; `unlogged` when the tap cleared the current status. */
export type SealNextStatus = LoggableStatus | 'unlogged';

/** What a pick meant, for callers that care about the difference between setting and clearing. */
export interface SealPickMeta {
  /** True when the tapped option matched the current status, i.e. the tap cleared the log. */
  clears: boolean;
  /** The status the prayer ends up in — the same as `status` unless `clears`. */
  next: SealNextStatus;
  /**
   * True when the pick was the one-tap mark on the face (`directPick`), false when it came from
   * an option in the pill. The seal says which, so a parent can keep one stable `onPick` per
   * prayer instead of closing over the row's render-time mode (Today rewrites only the wordless
   * direct tap to `late` past the deadline — see its `handlePick`).
   */
  direct: boolean;
}

export interface PrayerSealProps {
  /** Which prayer this seal logs. Used for test ids and as the key of its choices. */
  prayer: Prayer;
  /** The prayer's localized display name, announced by the seal ("Maghrib, prayed"). */
  prayerName: string;
  /** The status currently shown on the face. */
  status: PrayerStatus;
  /** Whether this seal is the one open pill. The parent owns "only one at a time". */
  isOpen: boolean;
  /**
   * A prayer whose time has not arrived yet is not loggable (PRODUCT_SPEC §2): the face still
   * shows its status but refuses to open.
   */
  disabled?: boolean;
  /**
   * The prayer whose window contains now. While unlogged, its face wears the "awaiting your
   * hand" skin of the current register — a dashed *accent* ring around a ghosted check, the
   * universal "tap to complete" idiom. Logged statuses keep their skins verbatim.
   */
  isCurrent?: boolean;
  /**
   * A prayer whose time has not arrived. The face swaps the actionable dashed ring for the
   * dormant future skin — a thin solid faint ring around a small dot — so an inert seal can
   * never be mistaken for one awaiting a mark (the caption's word carries the state).
   */
  isFuture?: boolean;
  /**
   * Single-gesture mode for the currently-due prayer (Today passes
   * `isCurrent && (unlogged || prayed) && !exempt`): tapping the face marks the prayer prayed and
   * tapping again undoes it — no pill, because Late and Missed do not exist yet for a window that
   * is still open. Omitted (DayDetail always omits it) the seal behaves exactly as before.
   */
  directPick?: boolean;
  /**
   * Simple tracking mode (D192). With `directPick`, a face showing `missed` also takes the one
   * tap (to prayed) — in simple mode a miss is just "not prayed", not a deliberate mark to guard.
   */
  simple?: boolean;
  /** Called when the face is tapped, and when an open pill is tapped outside its options. */
  onToggleOpen: () => void;
  /**
   * An option was picked. The parent applies it (`trackingStore.toggleStatus` implements exactly
   * these semantics) **and closes the seal**.
   */
  onPick: (status: LoggableStatus, meta: SealPickMeta) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The three options, ordered so that **`prayed` lands exactly where the closed seal was**.
 *
 * The pill is pinned to the row's outer edge and grows inward, so whichever option is last sits
 * under the thumb that just opened it. That used to be `missed`: the happy path — the thing four
 * taps in five are — meant opening the pill and then travelling all the way across it, while the
 * one destructive option waited under the finger. Reversed, tapping twice in the same place marks
 * a prayer prayed, and an accidental second tap can only ever over-record a prayer rather than
 * mint a qada debt the user does not owe.
 *
 * The mockup's order was prayed-first; this is a deliberate departure from it (owner, 2026-08-21).
 * It mirrors correctly without further work: the row reverses under RTL, and the seal moves to the
 * other edge with it, so `prayed` stays the option nearest the thumb in both directions.
 */
const OPTIONS: { status: LoggableStatus; icon: IconName }[] = [
  { status: 'missed', icon: 'close' },
  { status: 'late', icon: 'schedule' },
  { status: 'prayed', icon: 'check' },
];

/**
 * The face glyph per status. `exempt` wears the crescent (`bedtime`, already in the bundled
 * subset — no font regeneration): distinct in SHAPE from every other state — check, clock, ✕,
 * ring, dot — so "not required" survives greyscale and can never be misread as "missed" or
 * "not marked" (spec-exemption amendment 2b). It reads as rest, not as failure or prohibition:
 * the incumbent `remove` was a horizontal bar, which is exactly the "no entry" mark the
 * no-shaming rule forbids, and a blossom (`spa`) is the stock cycle-tracker glyph — nameable at
 * a glance, which the register rule (§P1) exists to prevent. A crescent on cream paper says
 * nothing to a stranger and everything to her.
 */
const FACE_ICON: Record<PrayerStatus, IconName> = {
  prayed: 'check',
  late: 'schedule',
  missed: 'close',
  unlogged: 'circle',
  exempt: 'bedtime',
};

/**
 * The prayer seal.
 *
 * @param status - What the face shows; `exempt` is inert (it is derived from an exempt period,
 * never chosen per prayer).
 * @param isOpen - Whether this seal is the open one; the parent guarantees there is only one.
 * @param onPick - Receives the tapped status plus whether the tap cleared it.
 * @returns The 48pt seal, morphing into the three-choice pill while `isOpen`.
 */
export function PrayerSeal({
  prayer,
  prayerName,
  status,
  isOpen,
  disabled = false,
  isCurrent = false,
  isFuture = false,
  directPick = false,
  simple = false,
  onToggleOpen,
  onPick,
  testID = `seal-${prayer}`,
  style,
}: PrayerSealProps) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const reduceMotion = useReduceMotion();
  // The pill's geometry has to know how big the type actually is, not how big it was designed to
  // be; see `sealPillMetrics`. The width is only the last-resort ceiling — and it is the content
  // column's, not the window's (D123): the ratio was chosen against the row the pill sits in, and
  // on a tablet that row is bounded by the page, not by the glass.
  const { fontScale, width: windowWidth } = useWindowDimensions();
  const pill = sealPillMetrics(
    fontScale,
    typeScaleFor(scriptFamilyFor(i18n.language)),
    contentWidth(windowWidth) * PILL_MAX_WIDTH_RATIO
  );

  // `exempt` is not a choice the user makes, so the seal shows it and stays shut.
  const interactive = !disabled && status !== 'exempt';
  // A direct-pick seal never expands: its face IS the whole interaction, so it also never
  // registers a dismiss region (SealDismissBoundary has nothing of its to close).
  const expanded = isOpen && interactive && !directPick;

  const width = useSharedValue(expanded ? pill.width : SEAL_SIZE);
  const height = useSharedValue(expanded ? pill.height : SEAL_SIZE);
  const faceOpacity = useSharedValue(expanded ? 0 : 1);
  const optionsOpacity = useSharedValue(expanded ? 1 : 0);
  const shellOpacity = useSharedValue(expanded ? 1 : 0);
  // The little bounce a mark lands with (D197): the face swells a few percent and springs back, so
  // the tap feels like it clicked something into place. Separate from the press scale, which
  // `PressableScale` owns; the two multiply.
  const pop = useSharedValue(1);

  // The shape the shared values are travelling to. The tap that opens or closes the pill starts the
  // morph itself (below), on the UI thread, before React has re-rendered anything; the effect then
  // sees the prop arrive and has nothing left to do. Without this the morph waited for the whole
  // hosting screen to re-render and commit before it was even asked to start.
  const animatedTarget = useRef<{ expanded: boolean; width: number; height: number } | null>(
    null
  );
  const animateTo = (next: boolean) => {
    const targetWidth = next ? pill.width : SEAL_SIZE;
    const targetHeight = next ? pill.height : SEAL_SIZE;
    const previous = animatedTarget.current;
    if (
      previous !== null &&
      previous.expanded === next &&
      previous.width === targetWidth &&
      previous.height === targetHeight
    ) {
      return;
    }
    animatedTarget.current = { expanded: next, width: targetWidth, height: targetHeight };
    // Reduced motion: no morph. The pill takes its size at once and the two layers cross-fade,
    // which conveys the same change without anything travelling across the screen.
    width.set(
      reduceMotion
        ? targetWidth
        : withTiming(targetWidth, { duration: motion.morph, easing: MORPH_EASING })
    );
    // Height only ever moves above the default text size (`pill.height` IS `SEAL_SIZE` at 1×), so
    // the collapsed seal stays the mockup's circle and most users never see this animate at all.
    height.set(
      reduceMotion
        ? targetHeight
        : withTiming(targetHeight, { duration: motion.morph, easing: MORPH_EASING })
    );
    faceOpacity.set(withTiming(next ? 0 : 1, { duration: motion.fade }));
    optionsOpacity.set(
      next
        ? withTiming(1, { duration: OPTIONS_FADE, easing: MORPH_EASING })
        : withTiming(0, { duration: motion.fade })
    );
    // The surface arrives with the width it is drawn under, not on a clock of its own.
    shellOpacity.set(withTiming(next ? 1 : 0, { duration: motion.morph }));
  };

  // First render: the shared values were created at their resting values, so this only records
  // the target. Later: catches every change the seal's own tap did not start (another seal
  // opening, a tap outside, a pick) and a pill resized by font scale.
  useEffect(() => {
    if (animatedTarget.current === null) {
      animatedTarget.current = {
        expanded,
        width: expanded ? pill.width : SEAL_SIZE,
        height: expanded ? pill.height : SEAL_SIZE,
      };
      return;
    }
    animateTo(expanded);
  });

  /**
   * Set when a pick in the open pill is what closed it — so the collapse knows two things: that
   * the outcome has already been spoken, and that the button holding VoiceOver's focus is about
   * to stop existing. A pick is the app's whole reward loop, and until now it was the one thing
   * the seal never said out loud: VoiceOver heard the pill shut and nothing about what had been
   * written down.
   */
  const pickClosedPill = useRef(false);
  const faceRef = useRef<ViewInstance | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The pending focus hand-off belongs to the seal, not to the effect that started it: a re-render
  // in the ~quarter-second the morph takes (a countdown tick two rows up is enough) must not
  // cancel it. Only unmounting does.
  useEffect(
    () => () => {
      clearTimeout(focusTimer.current);
    },
    []
  );

  // Opening and closing are structural, not decorative: say so, for people who cannot see the
  // pill grow. `announceForAccessibility` is a no-op when no screen reader is running.
  const previouslyExpanded = useRef(expanded);
  useEffect(() => {
    if (previouslyExpanded.current === expanded) return;
    previouslyExpanded.current = expanded;
    // A new open/close supersedes a hand-off that has not landed yet — never steal focus back to
    // a face the user has just reopened. (A plain re-render does not reach here, by the guard.)
    clearTimeout(focusTimer.current);
    if (expanded) {
      AccessibilityInfo.announceForAccessibility(t('seal.a11y.opened', { prayer: prayerName }));
      return;
    }
    // A pick has already said what it recorded; "Choices closed" on top of that would bury the
    // sentence that matters under the housekeeping one.
    if (!pickClosedPill.current) {
      AccessibilityInfo.announceForAccessibility(t('seal.a11y.closed'));
      return;
    }
    pickClosedPill.current = false;
    // The option button the user just tapped is gone, and with it VoiceOver's place on the screen
    // — which lands the reader back at the top of Today, five rows from where they were working.
    // Focus moves to the face of the same seal instead: the element that replaced the pill, now
    // reading "Maghrib, prayed". Delayed by the morph because iOS ignores a focus request aimed
    // at a view that is still transparent (alpha 0 is not in the accessibility tree).
    focusTimer.current = setTimeout(() => {
      if (faceRef.current !== null) {
        // `sendAccessibilityEvent` rather than the deprecated `setAccessibilityFocus`: it takes the
        // host instance itself, so there is no node handle to find, and it routes through the
        // renderer that knows whether this is a Fabric node.
        AccessibilityInfo.sendAccessibilityEvent(faceRef.current, 'focus');
      }
    }, motion.morph);
  }, [expanded, prayerName, t]);

  const wrapperStyle = useAnimatedStyle(() => ({ width: width.get(), height: height.get() }));
  const faceStyle = useAnimatedStyle(() => ({
    opacity: faceOpacity.get(),
    transform: [{ scale: pop.get() }],
  }));
  const optionsStyle = useAnimatedStyle(() => ({ opacity: optionsOpacity.get() }));
  const shellStyle = useAnimatedStyle(() => ({ opacity: shellOpacity.get() }));

  const statusWord = t(`seal.status.${status}`);

  const optionColors: Record<LoggableStatus, string> = {
    prayed: colors.accentDeep,
    late: colors.late,
    missed: colors.missed,
  };

  /**
   * The unlogged face wears one of three skins (spec-today-interaction §2): the dashed ring is
   * the exclusive mark of "awaiting your hand" — accent with a ghosted check while the window is
   * open ("tap to complete"), the muted dot once it has closed — and a future seal is dormant on
   * purpose: a thin *solid* faint ring around a small dot, structurally different (border style,
   * weight, glyph size) so an inert seal is never colour-alone-different from an actionable one.
   */
  const unloggedRegister: 'future' | 'current' | 'past' = isFuture
    ? 'future'
    : isCurrent
      ? 'current'
      : 'past';

  /** Face fill / outline / glyph colour per status, mapped onto the palette. */
  const faceSkin: ViewStyle = {
    prayed: {
      backgroundColor: colors.accent,
      borderWidth: 1,
      borderColor: 'transparent',
      // The mockup's `0 2px 8px -2px rgba(138,100,32,.5)` — the seal's soft gold glow.
      boxShadow: [
        { offsetX: 0, offsetY: 2, blurRadius: 8, spreadDistance: -2, color: colors.shadowGold },
      ],
    },
    late: { backgroundColor: colors.late, borderWidth: 1, borderColor: 'transparent' },
    missed: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.missed },
    unlogged: {
      future: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.borderMid },
      current: {
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: colors.accent,
        borderStyle: 'dashed',
      },
      past: {
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: colors.unlogged,
        borderStyle: 'dashed',
      },
    }[unloggedRegister],
    // Calm, "nothing is owed here": the paper fill of an elevated card behind a soft border.
    exempt: { backgroundColor: colors.cardElevated, borderWidth: 1, borderColor: colors.borderMid },
  }[status] as ViewStyle;

  const faceForeground: string = {
    prayed: colors.sealFg,
    late: colors.sealFg,
    missed: colors.missed,
    unlogged: { future: colors.soft, current: colors.accent, past: colors.unlogged }[
      unloggedRegister
    ],
    exempt: colors.muted,
  }[status];

  /** The hollow check that telegraphs "tap to complete"; a small dot on a dormant future seal. */
  const faceIcon: IconName =
    status === 'unlogged' && unloggedRegister === 'current' ? 'check' : FACE_ICON[status];
  const faceIconSize = status === 'unlogged' && unloggedRegister === 'future' ? 10 : 20;

  /**
   * Whether the face's ring is the dashed one. Android never *clears* a border's dash effect on
   * a mounted view — restyling a seal from `unlogged` (dashed) to `missed` (the one logged skin
   * whose ring is visible) left the missed ✕ inside a dashed circle, which is exactly what the
   * owner reported from the History day sheet ("the Isha seal always has a dashed circle even
   * when it's logged as missed"): Isha is simply the prayer still unmarked when a sheet opens,
   * so it is the one that transitions in place. Verified on the Android emulator, 2026-08-24;
   * iOS restyles correctly. The fix keys the face on its dashedness, so a change of border
   * style is a fresh native view rather than a restyle Android will half-apply.
   *
   * Android only. On iOS the remount bought nothing and cost the one tap that matters: a direct
   * pick turns the dashed current face into the solid prayed one, and remounting it mid-press
   * threw away the pressed scale and the 120ms release with it — the seal cut from held to
   * prayed instead of springing back. iOS restyles a border in place, so it keeps the view.
   */
  const faceDashed =
    Platform.OS === 'android' && status === 'unlogged' && unloggedRegister !== 'future';

  const hint = !interactive
    ? status === 'exempt'
      ? t('seal.a11y.hintExempt')
      : t('seal.a11y.hintUpcoming')
    : directPick
      ? status === 'prayed'
        ? t('seal.a11y.hintUndo')
        : t('seal.a11y.hintMarkPrayed', { prayer: prayerName })
      : t('seal.a11y.hintOpen');

  const handlePick = (picked: LoggableStatus, direct: boolean) => {
    markTap();
    const clears = picked === status;
    // Say what was recorded, in the app's own words — on both platforms, because unlike the
    // status surfaces `useAnnounceChange` serves, the seal carries no `accessibilityLiveRegion`
    // for Android to read from: the thing that changed is a button that stops existing.
    AccessibilityInfo.announceForAccessibility(
      clears
        ? t('seal.a11y.cleared', { prayer: prayerName })
        : t(`seal.a11y.recorded.${picked}`, { prayer: prayerName })
    );
    // Only a pick made *in the pill* has a collapse coming, and only that collapse needs the
    // closing line suppressed and the focus caught. A direct pick never opened anything.
    pickClosedPill.current = expanded;
    // Collapse now, on this tap, instead of after the parent has re-rendered and committed the
    // closed prop — the same reason the face's own tap starts the open morph itself.
    if (expanded) animateTo(false);
    if (!clears && !reduceMotion) {
      pop.set(
        withSequence(
          withTiming(1.1, { duration: 70, easing: MORPH_EASING }),
          withSpring(1, { stiffness: 700, damping: 18, mass: 1 })
        )
      );
    }
    onPick(picked, { clears, next: clears ? 'unlogged' : picked, direct });
  };

  // Direct pick: the tap that marks the prayer prayed is the tap that undoes it. A current
  // prayer carrying `late`/`missed` (only reachable by editing today in History) is deliberately
  // NOT direct — a single tap must never silently overwrite a deliberate mark — so the parent
  // only passes `directPick` for `unlogged`/`prayed`; this guard keeps a race harmless.
  const facePicksDirectly =
    directPick &&
    (status === 'unlogged' || status === 'prayed' || (simple && status === 'missed'));
  const handleFacePress = () => {
    if (facePicksDirectly) {
      handlePick('prayed', true);
      return;
    }
    // The same rule as `expanded`: a direct-pick face never grows into the pill.
    if (interactive && !directPick) animateTo(!expanded);
    onToggleOpen();
  };

  // The three options are not built until the pill first opens. Today mounts five seals, and
  // fifteen invisible buttons — each an icon, a word and a measured touch target — were being
  // laid out at first paint for pills most of which never open in a session. Once opened they
  // stay mounted, so a re-open is the same cross-fade as before; the very first open mounts them
  // in the same commit that starts the morph, and they fade in from the 0 their shared value
  // already holds. (Derived from a prop during render, the way React documents "adjusting state
  // when a prop changes": no effect, no extra pass on later renders.)
  const [optionsMounted, setOptionsMounted] = useState(expanded);
  if (expanded && !optionsMounted) setOptionsMounted(true);

  const handleAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'close') onToggleOpen();
  };

  const closeAction = { name: 'close', label: t('seal.a11y.closeAction') };

  return (
    <Animated.View
      testID={testID}
      style={[
        styles.wrapper,
        wrapperStyle,
        // Not animated: the elevation appears with the pill, and a shadow can only be tweened by
        // re-rendering. It is also on the outer view on purpose — an `overflow: hidden` node
        // clips its own shadow on iOS.
        expanded && {
          boxShadow: [
            {
              offsetX: 0,
              offsetY: 3,
              blurRadius: 12,
              spreadDistance: -4,
              color: colors.shadowGold,
            },
          ],
        },
        style,
      ]}
    >
      <View style={styles.clip}>
        {/* The expanded pill's own surface, faded in under both layers. */}
        <Animated.View
          pointerEvents="none"
          testID={`${testID}-shell`}
          style={[
            StyleSheet.absoluteFill,
            styles.shell,
            { backgroundColor: colors.cardElevated, borderColor: colors.borderStrong },
            shellStyle,
          ]}
        />

        {/* "Tap again to close": anything inside the open pill that is not one of the three
            options dismisses it without changing the log. */}
        {expanded ? (
          <Pressable
            accessible={false}
            testID={`${testID}-dismiss`}
            onPress={onToggleOpen}
            style={StyleSheet.absoluteFill}
          />
        ) : null}

        <Animated.View
          pointerEvents={expanded ? 'none' : 'auto'}
          accessibilityElementsHidden={expanded}
          importantForAccessibility={expanded ? 'no-hide-descendants' : 'auto'}
          style={[styles.faceSlot, faceStyle]}
        >
          <PressableScale
            // See `faceDashed`: a border-style change must remount, not restyle, on Android.
            key={faceDashed ? 'face-dashed' : 'face-solid'}
            ref={faceRef}
            testID={`${testID}-face`}
            scale={0.88}
            // One haptic per tap. Opening the pill is a small state change and gets the
            // selection tick; a direct pick is a *log*, and the parent answers that with its own
            // confirm haptic (Today's Success notification) — a tick under it would be two buzzes
            // for one action.
            haptics={!facePicksDirectly}
            disabled={!interactive}
            accessibilityRole="button"
            accessibilityLabel={t('seal.a11y.face', { prayer: prayerName, status: statusWord })}
            accessibilityHint={hint}
            accessibilityState={{ disabled: !interactive, expanded }}
            minTouchTarget={0}
            onPress={handleFacePress}
            style={[styles.face, faceSkin]}
          >
            <Icon name={faceIcon} size={faceIconSize} color={faceForeground} />
          </PressableScale>
        </Animated.View>

        {optionsMounted ? (
          <Animated.View
            pointerEvents={expanded ? 'auto' : 'none'}
            accessibilityElementsHidden={!expanded}
            importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
            testID={`${testID}-options`}
            style={[styles.options, { width: pill.width }, optionsStyle]}
          >
            {OPTIONS.map((option) => {
            const selected = option.status === status;
            return (
              <PressableScale
                key={option.status}
                testID={`${testID}-option-${option.status}`}
                scale={0.86}
                // No tick here: every surface that hosts the pill answers a pick with its own
                // confirm haptic once the log is written (Today, History's day sheet, the glance
                // calendar, Yesterday). See the face above.
                accessibilityRole="button"
                accessibilityLabel={t(`seal.a11y.${selected ? 'clear' : 'mark'}.${option.status}`, {
                  prayer: prayerName,
                })}
                accessibilityState={{ selected }}
                accessibilityActions={[closeAction]}
                onAccessibilityAction={handleAction}
                minTouchTarget={0}
                onPress={() => handlePick(option.status, false)}
                style={[styles.option, { width: pill.optionWidth, height: pill.optionHeight }]}
              >
                <Icon name={option.icon} size={OPTION_ICON} color={optionColors[option.status]} />
                <AppText
                  variant="tabLabel"
                  weight={600}
                  color={optionColors[option.status]}
                  numberOfLines={1}
                  // 2.0 rather than 1.4 (spec-accessibility §2.4): at full Dynamic Type the 10px
                  // label reaches 20px — and the option target grows to hold it, which is the
                  // other half of the same fix (`sealPillMetrics`, D82).
                  maxFontSizeMultiplier={LABEL_MAX_SCALE}
                  style={styles.optionLabel}
                >
                  {t(`seal.option.${option.status}`)}
                </AppText>
              </PressableScale>
            );
          })}
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    height: SEAL_SIZE,
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  clip: {
    flex: 1,
    borderRadius: radius.pill,
    // Keeps the 160pt options row invisible while the pill is only 48pt wide.
    overflow: 'hidden',
  },
  shell: {
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  faceSlot: {
    position: 'absolute',
    top: 0,
    // Stretched rather than 48pt tall, so that when large type gives the open pill a taller box
    // the circle stays in the middle of it instead of clinging to the top edge mid-morph. At the
    // default text size the box is exactly 48 and this is the same 48pt square as before.
    bottom: 0,
    // `start` rather than `left`: under RTL the pill grows the other way and the face stays at
    // the row's outer edge.
    start: 0,
    width: SEAL_SIZE,
    justifyContent: 'center',
  },
  face: {
    width: SEAL_SIZE,
    height: SEAL_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  options: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    // `end`, not `start` — and this is what makes a fast double-tap land on `prayed` rather than
    // on whatever the morph happens to have slid under the finger.
    //
    // The pill grows inward from the row's outer edge, so its START edge is the one that moves
    // during the animation. Anchoring the options row there dragged all three options along with
    // it, and a second tap arriving 150ms into a 200ms morph hit whichever one was passing. Pinned
    // to the END edge instead, the row's outer option stays exactly where the closed seal was for
    // the whole morph, and the others emerge from underneath it.
    end: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  option: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: OPTION_GAP,
  },
  optionLabel: {
    fontSize: typeScale.sealOptionLabel,
    lineHeight: typeScale.sealOptionLabel + 2,
  },
});
