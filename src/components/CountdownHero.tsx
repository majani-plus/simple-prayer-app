import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from './AppText';
import { BuddyAvatars } from './BuddyAvatar';
import { Icon } from './Icon';
import { LiveCountdown } from './LiveCountdown';
import { ReminderPill } from './ReminderPill';
import { SectionDivider } from './SectionDivider';
import { motion, type as typeScale, spacing, useTheme } from '@/theme';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useTimeFormat } from '@/stores/settingsStore';
import type { BuddyPair } from '@/stores/buddyStore';
import { formatTime } from '@/utils/formatTime';

import type { Prayer } from '@/domain/types';

/**
 * The Today hero, bounded above and below by the section hairlines with the ◆ ornament riding the
 * top one (mockup 2a): calligraphy name → name + time → live countdown → reminder pill.
 *
 * **The hero has two modes, and they must not be confusable** (spec-today-interaction, owner
 * amendment). Both count down to the *same instant* — a prayer's window ends exactly when the next
 * prayer starts — so the number on screen is identical either way, and the framing has to carry
 * the entire distinction:
 *
 * - **DUE** (the current prayer is not logged): the current prayer's name, the deadline as
 *   "until 8:47 pm" in the accent gold, and the countdown line as the mode line — a small hollow
 *   check in a dashed accent ring (the awaiting seal, echoed) leading "2 hours 7 minutes **left
 *   to pray**", all in the accent register: this hero asks for your hand.
 * - **WAITING** (the current prayer is logged): the next prayer's name and start time in the calm
 *   ink register, the countdown line led by a small filled gold disc (the prayed seal, echoed)
 *   reading "**Isha prayed** · next in 2 hours 7 minutes". The prayed prayer is NAMED: a bare
 *   "prayed" directly under the next prayer's name was read — by an actual reviewer — as that
 *   prayer being prayed, the exact current-vs-next confusion this screen exists to prevent
 *   (Turkish was worst: passive "kılındı" under "Sabah" reads as "Fajr was prayed"). Naming the
 *   subject and calling the countdown's referent "next" makes the sentence unambiguous in all
 *   three languages, and puts the gold disc beside the name it actually describes.
 * - **PLAIN** (nothing is due — exempt days, degenerate windows, a `missed` edited in from
 *   History): the unadorned original. It never claims "prayed" when that would be untrue.
 *
 * **The three modes are layout-identical** (owner: no extra row, no jitter). The mode is carried
 * entirely on elements that exist in every mode — the time slot's wording and colour, and the
 * countdown line's glyph, words and colour — so switching modes reflows NOTHING: the same rows,
 * the same sizes, only treatment changes, cross-faded in place. The seal-echo glyph rides inside
 * the countdown line at caption height, costing zero layout. Icon + words, never colour alone.
 * Because "38 minutes" reading as time-to-pray after the window has shut is the worst failure
 * this screen can have, the DUE framing is triple-redundant: glyph, "until", and "left to pray".
 *
 * The reminder pill is present in **every** mode — a pill that comes and goes is exactly the
 * jitter the owner rejected. It always belongs to the NEXT prayer (`reminderPrayer`): the prayer
 * whose arrival ends the countdown on screen, in both framings. The screen passes it explicitly
 * in DUE mode, where the hero's *named* prayer is the current one.
 *
 * A mode switch under the user's eyes animates (a 200ms fade with a small rise, opacity and
 * transform only — never layout); under reduced motion the rise is dropped and the cross-fade
 * stays, the established pattern from the seal morph. The hero still computes **nothing** about
 * prayer times: name, instant and remaining are resolved by the screen and handed in, and the
 * countdown ticks in its own leaf.
 */

/** Which framing the hero speaks. See the component note; `plain` is the chip-less original. */
export type HeroMode = 'due' | 'waiting' | 'plain';

/**
 * The reserved height of the buddy line: the 30pt badge plus the ring it is drawn with. Fixed, so
 * a buddy praying never moves the reminder pill under somebody's finger.
 */
const BUDDY_LINE_HEIGHT = 32;

export interface CountdownHeroProps {
  /**
   * Who else has prayed the prayer the hero names (D174/B2-9), drawn under the countdown.
   *
   * The slot is **reserved whenever buddy mode is on**, whether or not anybody has prayed yet, and
   * absent entirely when it is off. That is what keeps D67's rule intact: the three hero modes stay
   * layout-identical, nothing appears or disappears under somebody's thumb, and the overwhelming
   * majority who never turn buddy mode on lose not one point of hero height.
   */
  buddies?: readonly BuddyPair[];
  /** Whether to reserve the buddy line at all. False for everybody who has not turned it on. */
  reserveBuddies?: boolean;
  /** The prayer named by the hero — next (waiting/plain), or the current one (due). */
  prayer: Prayer;
  /** Localized Latin name, e.g. "Maghrib". */
  name: string;
  /** Arabic calligraphy name, e.g. "المغرب". Set in Amiri at 30pt. */
  arabicName: string;
  /**
   * The one instant this hero counts down to: the next prayer's start, which in DUE mode is the
   * same timestamp as the current window's end (Fajr, whose real deadline is sunrise, is the one
   * exception — the screen passes sunrise instead). Rendered through the shared `formatTime`.
   */
  time: Date;
  /** Milliseconds until `time`, as the screen computed it; used if `time` is unusable. */
  msRemaining: number;
  /** DUE ("…left to pray"), WAITING ("prayed · in …") or PLAIN. Default `plain`. */
  mode?: HeroMode;
  /**
   * The prayer the reminder pill toggles — the NEXT prayer, whose arrival is the instant the
   * countdown ends in both modes. Defaults to `prayer`, which is already the next prayer in
   * WAITING and PLAIN; DUE names the *current* prayer, so the screen passes this explicitly.
   */
  reminderPrayer?: Prayer;
  /** Localized name for `reminderPrayer`. Defaults to `name`. */
  reminderName?: string;
  /**
   * Localized name of the prayer that was prayed — WAITING's sentence subject ("Isha prayed ·
   * next in …"). Required for the WAITING wording; without it the countdown stays in the plain
   * framing (the glyph still marks the mode) rather than showing a subject-less "prayed" that
   * could be misread as describing the prayer named above it.
   */
  prayedName?: string;
  /**
   * Whether the reminder pill renders. Defaults to `true`; Today passes `false` on an exempt
   * day, where the plan is silent and "Reminder on" would be a lie — the exemption banner's
   * "Reminders are paused." speaks instead (spec-exemption §3). The hero itself stays: exemption
   * silences *obligation*, not *information*. DUE mode hides the pill regardless (see above).
   */
  showReminder?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The design's UI easing, `cubic-bezier(.4,0,.2,1)` — same curve as the seal morph. */
const MODE_EASING = Easing.bezier(0.4, 0, 0.2, 1);
/** How far the incoming mode rises from (dropped under reduced motion). */
const MODE_RISE = 6;

/**
 * The Dynamic Type multiplier past which the countdown sentence is allowed a second line.
 *
 * Measured against the longest phrase the line can hold — the DUE sentence at its widest — on the
 * narrowest supported screen. Below this the sentence still fits one row and D67's equal-height
 * hero is untouched; above it, one row could only be bought with an ellipsis.
 */
const LINE_BREAK_SCALE = 1.3;

/**
 * The Today tab's hero block.
 *
 * @param mode - The framing; see {@link HeroMode}.
 * @param msRemaining - Remaining milliseconds from `domain/prayerTimes.getNextPrayer` (or to the
 * due deadline, which is the same instant except for Fajr).
 * @returns The hero section, hairline-bounded, with a self-ticking countdown.
 */
export function CountdownHero({
  prayer,
  name,
  arabicName,
  time,
  msRemaining,
  mode = 'plain',
  reminderPrayer,
  reminderName,
  prayedName,
  showReminder = true,
  buddies,
  reserveBuddies = false,
  style,
  testID,
}: CountdownHeroProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const timeFormat = useTimeFormat();
  const timeText = formatTime(time, { timeFormat });
  const { fontScale } = useWindowDimensions();

  // D67 keeps the countdown to one line so the hero is the same height in every mode — a
  // guarantee about *this* line, made at the size it was designed at. At raised Dynamic Type the
  // sentence stops fitting ("2 hours 14 minutes left to pray" needs more than the screen is wide
  // by around 1.5×), and one line then means a truncated one, with the missing half living
  // nowhere: Apple's Larger Text criterion, on the app's most important words. Past that point the
  // line is allowed a second row. Below it — every default install — the arithmetic is exactly
  // D67's and the hero is unchanged.
  const countdownLines = fontScale > LINE_BREAK_SCALE ? 2 : 1;

  // A mode change while the user is looking (they just logged the prayer, or the window rolled
  // over) animates in; the very first render does not. Initialised settled so a screen opened
  // mid-state never flashes.
  const transition = useSharedValue(1);
  const previousMode = useRef(mode);
  useEffect(() => {
    if (previousMode.current === mode) return;
    previousMode.current = mode;
    transition.set(0);
    transition.set(withTiming(1, { duration: motion.state, easing: MODE_EASING }));
  }, [mode, transition]);
  const transitionStyle = useAnimatedStyle(() => ({
    opacity: transition.get(),
    transform: [{ translateY: reduceMotion ? 0 : (1 - transition.get()) * MODE_RISE }],
  }));

  const due = mode === 'due';

  return (
    <View testID={testID} style={style}>
      <SectionDivider placement="top" />
      <Animated.View
        testID={testID === undefined ? undefined : `${testID}-content`}
        style={[
          {
            alignItems: 'center',
            gap: 3,
            paddingTop: spacing.xl,
            paddingBottom: spacing.lg,
          },
          transitionStyle,
        ]}
      >
        <AppText variant="heroArabic" accessibilityElementsHidden importantForAccessibility="no">
          {arabicName}
        </AppText>
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={t(due ? 'today.hero.a11yDue' : 'today.hero.a11yLabel', {
            prayer: name,
            time: timeText,
          })}
          // Wrap-safe, and only ever wraps when it would otherwise overflow. The longest this
          // line gets is DUE on a Friday — "Jumu’ah · Dhuhr" beside "until 12:59 pm" at 23pt
          // (D75) — which fits a 6.5" screen with a few points to spare and does not fit a
          // smaller one or a raised Dynamic Type. Wrapping centres the time under the name
          // instead of pushing it off the edge; nothing else in the hero moves.
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          {/* In Arabic the name above already *is* this name. Dropping the repeat (rather than the
              calligraphy) keeps the hero's shape: the 30pt name stays the anchor and the line
              below it becomes the time alone. */}
          {arabicName === name ? null : <AppText variant="hero">{name}</AppText>}
          <AppText
            variant="hero"
            weight={700}
            tone="strong"
            {...(due ? { color: colors.accent } : {})}
            tabularNums
          >
            {/* DUE renders the instant as a deadline, not a start: "until 8:47 pm", in the
                accent gold — the word carries the state, the colour merely underlines it. */}
            {due ? t('today.hero.until', { time: timeText }) : timeText}
          </AppText>
        </View>
        {/* The countdown line IS the mode line, and the glyph in front of it says which mode
            without costing any layout: a clock while the window is open and the sentence is about
            time left, nothing once it is not.

            It used to be a 14pt dashed ring echoing the awaiting seal. React Native gives no
            control over dash length on a border, so at that diameter it resolved to four long
            dashes — conspicuously coarser than the dashed rings everywhere else in the app, which
            are large enough to render properly. A clock is also the truer glyph: this line counts
            down time, it is not a seal to tap. Hidden from assistive tech — the countdown text
            and the block label above already speak the state. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {due ? (
            <View
              testID={testID === undefined ? undefined : `${testID}-mode-${mode}`}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Icon name="schedule" size={16} color={colors.accent} />
            </View>
          ) : null}
          <LiveCountdown
            target={time}
            fallbackMs={msRemaining}
            durationStyle="long"
            variant="caption"
            weight={500}
            {...(due
              ? { phraseKey: 'today.hero.leftToPray', color: colors.accent }
              : mode === 'waiting' && prayedName !== undefined
                ? {
                    phraseKey: 'today.hero.prayedIn',
                    phraseValues: { prayer: prayedName },
                    tone: 'header' as const,
                  }
                : { tone: 'header' as const })}
            // One line while one line still holds the sentence; see `countdownLines`.
            numberOfLines={countdownLines}
            // Without `flexShrink` the text sizes to its intrinsic width inside the row and runs
            // off the edge instead of wrapping — React Native's flex children do not shrink by
            // default. `textAlign` only shows once it has wrapped, and keeps the hero symmetrical
            // when it does.
            // A hair larger than the caption role it borrows, because this line carries the one
            // number the screen exists to show, and at 13.5 regular it read as a footnote to the
            // prayer name rather than as the answer.
            style={{ fontSize: typeScale.countdown + 1.5, flexShrink: 1, textAlign: 'center' }}
          />
        </View>
        {/* Reserved, not conditional — see `buddies` above. An empty slot is empty: no "no one
            yet", no placeholder, nothing that reads as a comparison (D174). */}
        {reserveBuddies ? (
          <View
            testID="hero-buddies"
            style={{ height: BUDDY_LINE_HEIGHT, justifyContent: 'center', marginTop: spacing.xs }}
          >
            <BuddyAvatars buddies={buddies ?? []} size={30} />
          </View>
        ) : null}
        {showReminder ? (
          <ReminderPill
            prayer={reminderPrayer ?? prayer}
            prayerName={reminderName ?? name}
            style={{ marginTop: spacing.md }}
          />
        ) : null}
      </Animated.View>
      <SectionDivider placement="bottom" />
    </View>
  );
}
