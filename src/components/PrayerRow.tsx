import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewInstance, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppText } from './AppText';
import { BuddyAvatars } from './BuddyAvatar';
import { Card } from './Card';
import { LiveCountdown } from './LiveCountdown';
import { PrayerSeal, type PrayerSealProps } from './PrayerSeal';
import { useSealDismissRegion } from './SealDismiss';
import { motion, radius as radiusScale, type as typeScale, spacing, useTheme } from '@/theme';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useTimeFormat } from '@/stores/settingsStore';
import { formatDuration, formatTime } from '@/utils/formatTime';

import type { Prayer, PrayerStatus } from '@/domain/types';
import type { BuddyPair } from '@/stores/buddyStore';

/**
 * One prayer's row: name + Arabic name on a shared baseline, time + italic caption beneath, and
 * the seal on the trailing edge (mockup 2a).
 *
 * The row is a *shell*. It owns layout, hierarchy and the caption; the seal owns the status
 * interaction (the direct tap on the current prayer, the morph into three choices elsewhere) and
 * is imported, never reimplemented here.
 *
 * **The rows carry three tiers of emphasis** (spec-today-interaction, owner amendment):
 *
 * - **CURRENT** — the prayer whose window contains now, *whether or not it is logged*. The row
 *   grows (name 20 vs 17, time 19/700 vs 14/400), brightens (`cardBright` vs `cardQuiet`),
 *   takes the strong gold border and the soft gold glow, and holds all of it for as long as its
 *   window is open. The row's weight says *which window you are in*; the seal says whether you
 *   still owe it. Unlogged, the caption names the deadline ("now · until 8:47 pm"); logged, it
 *   says the status word ("prayed") while the register stays put.
 * - **NEXT** — the upcoming prayer once the current one is logged: the quiet card keeps its
 *   accent countdown caption and gains a soft "next ·" word plus a faint mid-weight border ring,
 *   *animated in* at the moment the log lands ("so I can see oh that's next and this is how much
 *   time is left"). It echoes the hero's WAITING chip vocabulary — muted border, small words —
 *   and is never confusable with CURRENT: no bright fill, no glow, no larger type.
 * - **REST** — past prayers and later-today prayers: quiet, exactly as before.
 *
 * Status is never colour-only: every state also spells itself out in the caption — "prayed",
 * "prayed late", "missed", "exempt", "upcoming", "not marked", "now · until …", "next · in 2 h"
 * (DESIGN.md §Accessibility).
 */
export interface PrayerRowProps {
  /** Which prayer this row is. */
  prayer: Prayer;
  /** Localized Latin name, e.g. "Asr". */
  name: string;
  /** Arabic calligraphy name, e.g. "العصر". */
  arabicName: string;
  /** The prayer's start time. */
  time: Date;
  /** Current status; `unlogged` is the absence of a log, never an auto-"missed". */
  status: PrayerStatus;
  /** Marks this as the upcoming prayer — the accent countdown caption (the hero's row). */
  isNext?: boolean;
  /** Marks the prayer whose window contains now — the row that holds the primary emphasis. */
  isCurrent?: boolean;
  /**
   * The NEXT tier: the current prayer is logged (or no window contains now), so this — the
   * upcoming — row carries the subtle secondary treatment: a "next ·" word before the countdown
   * and a faint mid-weight border, both fading in when the flag arrives while mounted. The
   * screen computes it; the row never reasons about another row's status.
   */
  isNextUp?: boolean;
  /** Whether the prayer's time has not arrived yet (drives "upcoming" and locks the seal). */
  isFuture?: boolean;
  /** Milliseconds until `time`; only used for the next prayer's compact countdown caption. */
  msRemaining?: number;
  /**
   * The buddies who have marked this prayer today (D174), drawn as a stack of discs at the
   * trailing end of the time line. Empty or absent renders nothing at all — a prayer no buddy has
   * marked is not a prayer anybody failed, and it must never be drawn as one.
   */
  buddies?: readonly BuddyPair[];
  /**
   * The current prayer's window end — the absolute deadline its caption names ("now · until
   * 8:47 pm"). Not a second countdown: for every prayer whose deadline is the next adhan the
   * hero already ticks out the identical remaining time. Ignored for Fajr (see `sunrise`).
   */
  windowEnd?: Date;
  /**
   * Sunrise, passed for the current Fajr row only *while sunrise is still ahead* — Fajr's real
   * deadline ("now · until sunrise 6:14 am"). Once it has passed the caller omits it and the
   * caption says just "now": claiming "until Dhuhr" would misstate fiqh, and going silent would
   * drop the register's word.
   */
  sunrise?: Date;
  /**
   * Single-gesture mode for the currently-due prayer's seal: tap marks prayed, tap again undoes —
   * no pill. Forwarded to `PrayerSeal`; DayDetail never passes it.
   */
  directPick?: boolean;
  /** Simple tracking mode: forwarded to `PrayerSeal` (D192). */
  simple?: boolean;
  /** Whether this row's seal is expanded into its three choices. */
  isOpen: boolean;
  /** Tap on the seal face: open, or close without changing anything. */
  onToggleOpen: () => void;
  /**
   * A choice was made. Picking the current status again clears it back to `unlogged`; the seal's
   * `meta` says which of the two happened.
   */
  onPick: PrayerSealProps['onPick'];
  /** Locks the seal. Defaults to `isFuture` — a future prayer is not loggable (PRODUCT_SPEC §2). */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The italic caption under the time.
 *
 * The wording comes from `seal.status.*` — the same strings the seal announces — so a row and its
 * seal can never describe the same prayer differently. Only "upcoming" is the row's own: the seal
 * has no word for a prayer whose time has not arrived, it simply refuses to open.
 */
function captionKey(status: PrayerStatus, isFuture: boolean): string {
  switch (status) {
    case 'prayed':
      return 'seal.status.prayed';
    case 'late':
      return 'seal.status.late';
    case 'missed':
      return 'seal.status.missed';
    case 'exempt':
      return 'seal.status.exempt';
    case 'unlogged':
      return isFuture ? 'today.caption.upcoming' : 'seal.status.unlogged';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unknown prayer status: ${String(exhaustive)}`);
    }
  }
}

/** The design's UI easing — the same curve as the hero's mode switch and the seal morph. */
const REVEAL_EASING = Easing.bezier(0.4, 0, 0.2, 1);
/** How far the arriving "next" cue rises from (dropped under reduced motion). */
const REVEAL_RISE = 4;

/**
 * A prayer row.
 *
 * @param isCurrent - The prayer whose window is open; it holds the primary emphasis (size, fill,
 * border, glow) for as long as the window is, logged or not. Exactly one row is ever loud.
 * @param isNext - The upcoming prayer; adds the compact accent countdown caption.
 * @param isNextUp - The NEXT tier: adds the animated "next ·" word + faint border to that caption.
 * @returns A `Card` row hosting the prayer's text column and its seal.
 *
 * Memoised: a tap on one seal changes one row's `status` and one row's `isNextUp`; the other
 * three must not pay for it. That only holds while the parent passes stable callbacks — Today
 * keeps one pair per prayer (`rowHandlers`) for exactly this reason.
 */
export const PrayerRow = memo(function PrayerRow({
  prayer,
  name,
  arabicName,
  time,
  status,
  isNext = false,
  isCurrent = false,
  isNextUp = false,
  isFuture = false,
  msRemaining,
  buddies,
  windowEnd,
  sunrise,
  directPick,
  simple,
  isOpen,
  onToggleOpen,
  onPick,
  disabled,
  style,
  testID,
}: PrayerRowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const timeFormat = useTimeFormat();

  // While this row's pill is open, its slot is the one region a tap does NOT dismiss — any touch
  // outside it (this row's text included) closes the pill without changing the log. The nearest
  // `SealDismissBoundary` (the Today screen, the day-detail sheet) does the listening.
  const sealSlotRef = useRef<ViewInstance>(null);
  useSealDismissRegion(isOpen, sealSlotRef, onToggleOpen);

  const timeText = formatTime(time, { timeFormat });

  // The CURRENT register holds for as long as the window is open, logged or not (owner
  // amendment): the row's weight says which window you are in; the seal says whether you still
  // owe it. The deadline caption, though, belongs only to the unlogged state — once logged the
  // caption speaks the status word, same as any sealed row.
  const emphasised = isCurrent;
  const deadline = isCurrent && status === 'unlogged';

  // The NEXT tier's arrival is the explanation of what just happened — the user logged the
  // current prayer and the eye needs "oh, that's next" — so it fades (and slightly rises) in
  // when the flag flips while mounted, but a screen opened mid-state never flashes. Its
  // *departure* (the undo) is a cut: the current row re-brightening in the same render is the
  // louder, self-announcing motion, and two simultaneous animations would fight.
  const reveal = useSharedValue(1);
  const wasNextUp = useRef(isNextUp);
  useEffect(() => {
    if (wasNextUp.current === isNextUp) return;
    wasNextUp.current = isNextUp;
    if (!isNextUp) return;
    reveal.set(0);
    reveal.set(withTiming(1, { duration: motion.state, easing: REVEAL_EASING }));
  }, [isNextUp, reveal]);
  const revealStyle = useAnimatedStyle(() => ({
    opacity: reveal.get(),
    // Under reduced motion the cue still arrives, just without travel — the established pattern
    // (the hero's mode switch, the seal morph): the cross-fade stays, the rise is dropped.
    transform: [{ translateY: reduceMotion ? 0 : (1 - reveal.get()) * REVEAL_RISE }],
  }));
  // The ring must stay glued to the card's bounds, so it fades without the word's rise.
  const revealRingStyle = useAnimatedStyle(() => ({ opacity: reveal.get() }));

  // The current row's caption is the deadline line. Fajr is special: its loggable window runs to
  // Dhuhr, but its *deadline* is sunrise — so it names sunrise while ahead and says just "now"
  // after (dashed accent seal + a word: still icon + word, never colour alone).
  const currentCaption =
    prayer === 'fajr'
      ? sunrise !== undefined
        ? t('today.caption.dueUntilSunrise', { time: formatTime(sunrise, { timeFormat }) })
        : t('today.caption.dueNow')
      : windowEnd !== undefined
        ? t('today.caption.dueUntil', { time: formatTime(windowEnd, { timeFormat }) })
        : t('today.caption.dueNow');

  // The next prayer's caption is the countdown *only while it is still unlogged* — once it is
  // logged, what happened matters more than when it starts.
  const showCountdown = isNext && status === 'unlogged' && !isCurrent;
  const showNextWord = showCountdown && isNextUp;
  const captionText = deadline ? currentCaption : t(captionKey(status, isFuture));
  const captionColor = showCountdown || deadline ? colors.accent : colors.muted;

  // The spoken row: name, time, and what the caption says — the countdown spelled out in full so
  // the announcement is a sentence rather than a ticking clock. Without a supplied `msRemaining`
  // there is no duration to speak (reading the clock here would be an impure render), so the
  // plain caption stands in. The NEXT tier's word is spoken exactly as it is shown.
  const spokenCaption =
    showCountdown && msRemaining !== undefined
      ? showNextWord
        ? `${t('today.caption.next')} · ${formatDuration(msRemaining, { style: 'long' })}`
        : formatDuration(msRemaining, { style: 'long' })
      : captionText;

  return (
    <Card
      testID={testID}
      variant={emphasised ? 'bright' : 'quiet'}
      emphasised={emphasised}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: emphasised ? 14 : 10,
          paddingHorizontal: 14,
        },
        style,
      ]}
    >
      {/* The NEXT tier's ring: a mid-weight border fading in over the card's faint one. It is
          the hero's WAITING-chip border weight, an octave below CURRENT's strong gold + glow —
          if a viewer could hesitate about which row is which, this would be too strong. */}
      {showNextWord ? (
        <Animated.View
          testID={testID === undefined ? undefined : `${testID}-next-up-ring`}
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              borderRadius: radiusScale.card,
              borderWidth: 1,
              borderColor: colors.borderMid,
            },
            revealRingStyle,
          ]}
        />
      ) : null}
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={t('today.row.a11yLabel', {
          prayer: name,
          time: timeText,
          caption: spokenCaption,
        })}
        style={{ flexShrink: 1, minWidth: 0, gap: 1 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
          <AppText
            variant="rowName"
            style={emphasised ? { fontSize: typeScale.rowNameNext } : undefined}
          >
            {name}
          </AppText>
          {/* In Arabic the localized name *is* the calligraphy, and printing both gave every row a
              stutter — "الفجر الفجر". The companion appears only when it says something new. */}
          {arabicName === name ? null : <AppText variant="rowArabic">{arabicName}</AppText>}
          {/* Beside the name, where the eye already is. `alignSelf: center` rather than the row's
              baseline, because a badge sitting on a text baseline looks dropped; and the row's
              height is set by the 48pt seal opposite, so a 24pt disc cannot grow it. */}
          {buddies !== undefined && buddies.length > 0 ? (
            <View style={{ alignSelf: 'center' }}>
              <BuddyAvatars
                buddies={buddies}
                testID={testID === undefined ? undefined : `${testID}-buddies`}
              />
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
          <AppText
            variant="time"
            weight={emphasised ? 700 : 400}
            tone={emphasised ? 'strong' : 'muted'}
            // The row's secondary line reads at its own raised sizes (see `rowTimeQuiet`).
            style={{ fontSize: emphasised ? typeScale.rowTimeNext : typeScale.rowTimeQuiet }}
            numberOfLines={1}
          >
            {timeText}
          </AppText>
          {showCountdown ? (
            <>
              {/* The NEXT tier's word — icon-free but never colour-only: the word IS the cue,
                  the tinted ring below merely underlines it. Spoken via `spokenCaption`. */}
              {showNextWord ? (
                <Animated.View testID={testID === undefined ? undefined : `${testID}-next-up`} style={revealStyle}>
                  <AppText
                    variant="caption"
                    color={captionColor}
                    numberOfLines={1}
                    style={{ fontSize: typeScale.rowCaption }}
                  >
                    {`${t('today.caption.next')} ·`}
                  </AppText>
                </Animated.View>
              ) : null}
              <LiveCountdown
                target={time}
                fallbackMs={msRemaining}
                durationStyle="compact"
                variant="caption"
                color={captionColor}
                numberOfLines={1}
                style={{ fontSize: typeScale.rowCaption }}
              />
            </>
          ) : (
            <AppText
              variant="caption"
              color={captionColor}
              numberOfLines={1}
              style={{ fontSize: typeScale.rowCaption }}
            >
              {captionText}
            </AppText>
          )}
        </View>
      </View>
      <View ref={sealSlotRef} style={{ marginStart: 'auto' }}>
        <PrayerSeal
          prayer={prayer}
          prayerName={name}
          status={status}
          isOpen={isOpen}
          isCurrent={isCurrent}
          isFuture={isFuture}
          directPick={directPick}
          simple={simple}
          onToggleOpen={onToggleOpen}
          onPick={onPick}
          disabled={disabled ?? isFuture}
        />
      </View>
    </Card>
  );
});
