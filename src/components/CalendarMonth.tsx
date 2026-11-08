import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { SectionDivider } from './SectionDivider';
import { backChevron, forwardChevron } from '@/i18n/direction';
import { formatDate, formatNumber } from '@/i18n/numerals';
import { isFutureDay, monthGrid, parseDay, type WeekStart } from '@/domain/dates';
import { hijriMonthSpanForGregorianMonth } from '@/domain/hijri';
import { PRAYERS, type DayRecord, type PrayerDay, type PrayerStatus } from '@/domain/types';
import { useLayout } from '@/hooks/useLayout';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useCalculationSettings } from '@/stores/settingsStore';
import { motion, spacing, useTheme, type Palette } from '@/theme';

/**
 * The History tab's month calendar — the Paper & Seal language applied to a grid (DESIGN.md
 * §History: "thin ring segments (5 slots) in status colours; today outlined; exempt days a soft
 * neutral dot; empty past days dashed like unlogged").
 *
 * Each cell is one prayer day: a five-segment ring around a legible day number. The ring is a
 * **count**, not a colour code — five slots in prayer order, each drawn only once that prayer has
 * been logged — so how much of a day was marked is readable from the geometry alone, at a glance
 * and in greyscale. Colour then says *what* was logged, and the cell's accessibility label spells
 * the whole thing out in words (DESIGN.md §Accessibility: never colour alone).
 *
 * Four states the grid refuses to blur together:
 *
 * - **Exempt** days get one calm, continuous neutral ring and the word "exempt" — never a missed
 *   look, never an empty one (PRODUCT_SPEC §6).
 * - **Unlogged** slots stay the faint dashed-feeling track, because "I did not record this" is not
 *   "I did not pray this" (PRODUCT_SPEC §4).
 * - **Today** is outlined in `borderStrong`, the same ring that marks the next prayer on Today.
 * - **Future** days are inert: no ring, dimmed numeral, not pressable, `disabled` to assistive
 *   technology. There is nothing there yet, so the cell does not pretend to be a target.
 *
 * The header names the Gregorian month and the Hijri month(s) it spans ("August · Rabiʿ al-Awwal /
 * Rabiʿ al-Thani", PRODUCT_SPEC §8), and the two arrows never page past the current month. A month
 * change is announced, because for a screen-reader user the whole grid silently becoming different
 * numbers is the *only* feedback the arrow gives.
 *
 * ## Why the grid is built the way it is (D183)
 *
 * Paging a month used to be visibly laggy, and the reason was structural rather than heavy: cells
 * were keyed by their **day**, so every arrow tap retired thirty keys and introduced thirty new
 * ones — a full teardown and rebuild of thirty `Svg` roots, ~180 `Path`s and thirty Reanimated
 * press wrappers, on the native side, for a grid whose shape never changed.
 *
 * So the grid is now keyed by **position** (`row-column`). A page is a prop update to thirty cells
 * that stay mounted; only a position that actually flips between a day and a blank remounts, which
 * is a handful per month. Three things follow from that, and all three are load-bearing:
 *
 * - `DayCell` is `memo`ised, so a store write for *one* day re-renders one cell, not thirty.
 * - For the memo to hold, every prop has to be stable: the cell reads no context of its own. The
 *   parent hands it the palette, the resolved metrics, one `labels` object memoised per language,
 *   and its already-formatted numeral and date — one map built per visible month, not two `useMemo`s
 *   per cell.
 * - The press dip is a plain `Pressable`'s pressed style rather than `PressableScale`, because
 *   thirty Reanimated shared values and animated styles are thirty subscriptions to maintain for a
 *   0.92 scale that a style function gives for free. `hitSlop` keeps the 48pt floor `PressableScale`
 *   used to measure out.
 *
 * Segment paths are pure trigonometry over `(index, size, stroke)` — five slots and at most a couple
 * of sizes per install — so they are cached at module level instead of recomputed per cell.
 *
 * Finally, the repaint is given a shape: the grid cross-fades from 0.35 on a month change, so the
 * page reads as turning rather than flickering. Never on first mount, and never under reduce motion.
 */

/** Columns in the grid. Named because the ring's size is derived from the share of one. */
const WEEKDAYS_IN_WEEK = 7;
/** Outer diameter of a cell's ring. Sized so a 7-column grid fits a 390pt screen with air. */
const RING_SIZE = 34;
/** Stroke width of the ring's segments. */
const RING_STROKE = 2.5;
/**
 * Air the drawing surface keeps *outside* the segment ring, so today's outline can sit clear of
 * the segments instead of underneath them. Drawn at the same radius they were invisible: the
 * segments are painted last and covered the marker completely.
 */
const RING_PAD = 3.5;
/** The Svg box: the ring plus its halo of air on every side. */
const RING_BOX = RING_SIZE + RING_PAD * 2;
/** Degrees of blank between two of the five segments. */
const SEGMENT_GAP_DEGREES = 12;
/** Height of one calendar row; keeps the 48pt touch target with the cells' hit slop. */
const CELL_HEIGHT = 46;
/**
 * How far the grid dips before fading back up on a month change. Not to zero: the month should
 * look like it is turning, not like it went away and a new one arrived.
 */
const GRID_FADE_FROM = 0.35;

/**
 * The share of its column a ring takes. Read off the mockup rather than chosen: 34pt in the ~45.4pt
 * column a 7-day grid gets on a 390pt screen.
 */
const RING_COLUMN_RATIO = 0.75;
/**
 * How large a ring may grow (D125). The day numeral inside it is deliberately frozen
 * (spec-accessibility §2.4), so past roughly this size the number starts to look adrift in its own
 * ring and the "thin ring segments" of the design language stop reading as thin.
 */
const RING_SIZE_MAX = 48;
/** Air between the ring and the next row — `CELL_HEIGHT - RING_SIZE` at the mockup's size. */
const CELL_AIR = CELL_HEIGHT - RING_SIZE;

/** A cell's drawing geometry, all of it derived from the width the grid actually got. */
export interface CalendarCellMetrics {
  ringSize: number;
  ringStroke: number;
  ringPad: number;
  /** The Svg box: the ring plus its halo of air on every side. */
  ringBox: number;
  cellHeight: number;
}

/** The mockup's geometry, verbatim — a phone, and the floor everywhere else. */
const MOCKUP_METRICS: CalendarCellMetrics = Object.freeze({
  ringSize: RING_SIZE,
  ringStroke: RING_STROKE,
  ringPad: RING_PAD,
  ringBox: RING_BOX,
  cellHeight: CELL_HEIGHT,
});

/**
 * A cell's geometry for a grid this wide (D125).
 *
 * The seven columns are `flex: 1`, so the grid has always stretched to whatever width it was given
 * — but the ring inside each column stayed 34pt, which on a tablet left small dots floating in wide
 * squat cells. Growing the ring with its column keeps the proportion the mockup drew.
 *
 * Everything scales together from `ringSize`, so the stroke stays a hairline relative to the ring
 * rather than thinning as it grows.
 *
 * @param gridWidth - The grid's measured width in points, or `null` before it has been laid out and
 *   on any window narrow enough that the mockup's geometry is already right.
 */
export function calendarCellMetrics(gridWidth: number | null): CalendarCellMetrics {
  if (gridWidth === null) return MOCKUP_METRICS;
  const columnWidth = gridWidth / WEEKDAYS_IN_WEEK;
  const ringSize = Math.max(
    RING_SIZE,
    Math.min(Math.round(columnWidth * RING_COLUMN_RATIO), RING_SIZE_MAX)
  );
  if (ringSize === RING_SIZE) return MOCKUP_METRICS;
  const growth = ringSize / RING_SIZE;
  const ringPad = RING_PAD * growth;
  return {
    ringSize,
    ringStroke: RING_STROKE * growth,
    ringPad,
    ringBox: ringSize + ringPad * 2,
    cellHeight: ringSize + CELL_AIR,
  };
}

/**
 * The header title's alignment. `alignItems: 'center'` centres a single line for free, but a title
 * long enough to wrap fills the width and its second line falls back to `AppText`'s leading edge —
 * so the alignment has to be said out loud for the wrapped case.
 */
const CENTRED = { textAlign: 'center' } as const;

/** Statuses that are drawn as a segment at all. */
type DrawnStatus = Exclude<PrayerStatus, 'unlogged'>;

export interface CalendarMonthProps {
  /** Gregorian year of the month to render. */
  year: number;
  /** **Zero-based** month, `0` = January … `11` = December. */
  monthIndex0: number;
  /** Resolved records by day. A day with no entry renders as fully unlogged. */
  records: Record<PrayerDay, DayRecord | undefined>;
  /** The current prayer day — the outlined cell, and the boundary past which days are inert. */
  today: PrayerDay;
  /** The day the detail panel is showing, if any. */
  selectedDay?: PrayerDay | null;
  /** Whether a later month may be paged to. `false` on the current month (§8: never the future). */
  canGoNext: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  /** A past or present day was tapped. Future days never call this. */
  onSelectDay: (day: PrayerDay) => void;
  /** Column the week starts in. Defaults to the active language's convention. */
  weekStartsOn?: WeekStart;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Which weekday a locale's calendar starts on.
 *
 * Only the three shipped languages need an answer, and `Intl.Locale.weekInfo` is not available on
 * Hermes, so this is a small explicit table rather than a guess: Sunday for English and Arabic
 * (the working week in most Arabic-speaking countries starts Sunday), Monday for Turkish.
 *
 * @param language - BCP-47 tag from i18next, e.g. `"tr"` or `"en-GB"`.
 * @returns `0` for a Sunday-first week, `1` for Monday-first.
 */
export function weekStartForLanguage(language: string): WeekStart {
  return language.toLowerCase().startsWith('tr') ? 1 : 0;
}

/** A point on the ring circle, at `degrees` clockwise from twelve o'clock. */
function pointOnRing(
  degrees: number,
  size: number,
  stroke: number = RING_STROKE
): { x: number; y: number } {
  const centre = size / 2;
  const sweepRadius = centre - stroke / 2;
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: centre + sweepRadius * Math.cos(radians),
    y: centre + sweepRadius * Math.sin(radians),
  };
}

/**
 * Every path the grid has ever asked for, by `index|size|stroke`.
 *
 * The arguments are drawn from a tiny set — five slots against the one geometry a device's width
 * class resolves to — so this settles at a few dozen entries on the first month and never grows
 * again. It is deliberately not an LRU: bounding it would cost more than it could ever save.
 */
const segmentPaths = new Map<string, string>();

/**
 * SVG path for one of the five ring segments.
 *
 * Memoised across the module (D183): the same five arcs were being recomputed for all thirty cells
 * of every month, and the answer depends on nothing but the three arguments.
 *
 * @param index - Slot 0…4, in prayer order (Fajr first, at twelve o'clock, running clockwise).
 * @param size - Ring diameter.
 * @param stroke - Segment stroke width; scales with the ring on a wide grid (D125).
 * @returns An `M … A …` arc command.
 */
export function segmentPath(
  index: number,
  size: number = RING_SIZE,
  stroke: number = RING_STROKE
): string {
  const key = `${String(index)}|${String(size)}|${String(stroke)}`;
  const cached = segmentPaths.get(key);
  if (cached !== undefined) return cached;

  const slice = 360 / PRAYERS.length;
  const start = index * slice + SEGMENT_GAP_DEGREES / 2;
  const end = (index + 1) * slice - SEGMENT_GAP_DEGREES / 2;
  const from = pointOnRing(start, size, stroke);
  const to = pointOnRing(end, size, stroke);
  const sweepRadius = size / 2 - stroke / 2;
  const path = `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${sweepRadius.toFixed(2)} ${sweepRadius.toFixed(2)} 0 0 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
  segmentPaths.set(key, path);
  return path;
}

/** How many of the five were prayed, late, missed or exempt on a day. */
export interface DayTally {
  prayed: number;
  late: number;
  missed: number;
  unlogged: number;
  exempt: number;
}

/**
 * Counts a day's five statuses. Pure tallying of what the store already resolved — no rule of its
 * own (a day flagged exempt arrives with all five statuses already `exempt`).
 *
 * @param record - The day's record, or `undefined` when nothing has been loaded for it.
 * @returns The five counts; an absent record is five unlogged prayers.
 */
export function tallyDay(record: DayRecord | undefined): DayTally {
  const tally: DayTally = { prayed: 0, late: 0, missed: 0, unlogged: 0, exempt: 0 };
  for (const prayer of PRAYERS) {
    const status = record?.statuses[prayer] ?? 'unlogged';
    tally[status] += 1;
  }
  return tally;
}

/**
 * A cell's words, translated once per language for the whole grid rather than once per cell.
 *
 * Functions rather than strings where the sentence takes the day's own numbers: `t` is the
 * expensive part and it has already been bound by the time the cell calls these.
 */
interface DayCellLabels {
  /** The day's state in words — future, exempt, nothing marked, or the three counts. */
  summarise: (record: DayRecord | undefined, isFuture: boolean) => string;
  /** The whole cell in one sentence: its date, then its summary. */
  label: (dateLabel: string, summary: string) => string;
  /** What a tap will do. Absent on a future day, which is not a target. */
  hint: string;
}

/**
 * The pressed dip, as a style object rather than an animation (D183).
 *
 * `Pressable` re-renders once on press-in and once on press-out and React Native applies the
 * transform on the next frame — indistinguishable from `PressableScale`'s 120ms tween at this
 * size, and it costs the grid no shared values at all.
 */
const PRESS_DIP = [{ scale: 0.92 }];

/**
 * The 48pt touch floor (D55), stated instead of measured.
 *
 * `PressableScale` used to measure each cell and grow a matching `hitSlop`; a cell is never
 * shorter than `CELL_HEIGHT`, so the answer is always the same 1pt of vertical slack. Columns are
 * a seventh of the grid, which clears 48pt on every phone.
 */
const CELL_HIT_SLOP = { top: 1, bottom: 1, left: 0, right: 0 };

/** One day of the month. Every prop is stable, so `memo` below actually holds. */
interface DayCellProps {
  day: PrayerDay;
  record: DayRecord | undefined;
  isToday: boolean;
  isSelected: boolean;
  isFuture: boolean;
  /** The day's number in the active language's numerals, formatted by the parent. */
  numeral: string;
  /** "Wednesday, 19 August" in the active language, formatted by the parent. */
  dateLabel: string;
  /** The grid's words, memoised per language. */
  labels: DayCellLabels;
  /** The active palette. A module-level object, so passing it costs nothing. */
  colors: Palette;
  /** The grid's resolved geometry — the mockup's on a phone, grown on a wide grid (D125). */
  metrics: CalendarCellMetrics;
  onSelectDay: (day: PrayerDay) => void;
}

const DayCell = memo(function DayCell({
  day,
  record,
  isToday,
  isSelected,
  isFuture,
  numeral,
  dateLabel,
  labels,
  colors,
  metrics,
  onSelectDay,
}: DayCellProps) {
  const isExempt = record?.isExempt === true;

  /** Segment colour per status; `unlogged` is drawn as the faint track instead. */
  const segmentColor: Record<DrawnStatus, string> = {
    prayed: colors.accent,
    late: colors.late,
    missed: colors.missed,
    // Exempt is calm and continuous — the same soft border the exempt seal wears.
    exempt: colors.borderMid,
  };

  const summary = labels.summarise(record, isFuture);

  return (
    <Pressable
      testID={`calendar-day-${day}`}
      disabled={isFuture}
      hitSlop={CELL_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={labels.label(dateLabel, summary)}
      accessibilityHint={isFuture ? undefined : labels.hint}
      accessibilityState={{ disabled: isFuture, selected: isSelected }}
      onPress={isFuture ? undefined : () => onSelectDay(day)}
      style={({ pressed }) => ({
        flex: 1,
        height: metrics.cellHeight,
        alignItems: 'center',
        justifyContent: 'center',
        // The one thing a future day says visually: there is nothing here yet.
        opacity: isFuture ? 0.4 : 1,
        transform: pressed ? PRESS_DIP : undefined,
      })}
    >
      <View
        style={{
          width: metrics.ringBox,
          height: metrics.ringBox,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isFuture ? null : (
          <Svg
            testID={`calendar-ring-${day}`}
            width={metrics.ringBox}
            height={metrics.ringBox}
            // Coordinates stay in ring space (0…ringSize); the viewBox simply keeps `ringPad` of
            // drawable air around it for today's outline.
            viewBox={`${String(-metrics.ringPad)} ${String(-metrics.ringPad)} ${String(metrics.ringBox)} ${String(metrics.ringBox)}`}
            style={{ position: 'absolute' }}
          >
            {isSelected ? (
              <Circle
                cx={metrics.ringSize / 2}
                cy={metrics.ringSize / 2}
                r={metrics.ringSize / 2 - metrics.ringStroke}
                fill={colors.cardElevated}
              />
            ) : null}
            {isToday ? (
              <Circle
                cx={metrics.ringSize / 2}
                cy={metrics.ringSize / 2}
                // Outside the segments, not under them — a halo, the way the next-prayer card is
                // ringed on Today.
                r={metrics.ringSize / 2 + metrics.ringPad / 2}
                stroke={colors.borderStrong}
                strokeWidth={1.5}
                fill="none"
              />
            ) : null}
            {PRAYERS.map((prayer, index) => {
              const status = record?.statuses[prayer] ?? 'unlogged';
              return (
                <Path
                  key={prayer}
                  testID={`calendar-segment-${day}-${prayer}`}
                  d={segmentPath(index, metrics.ringSize, metrics.ringStroke)}
                  stroke={status === 'unlogged' ? colors.borderFaint : segmentColor[status]}
                  strokeWidth={metrics.ringStroke}
                  strokeLinecap="round"
                  fill="none"
                />
              );
            })}
          </Svg>
        )}
        {/* Deliberately frozen (spec-accessibility §2.4): the 46pt grid geometry cannot absorb
            scaled numerals, and DayDetail — one tap away — scales fully and carries every fact
            the cell shows. That is Apple's explicit Larger Text escape hatch. */}
        <AppText
          variant="time"
          weight={isToday ? 600 : 400}
          tone={isFuture ? 'soft' : isExempt ? 'muted' : 'ink'}
          tabularNums
          allowFontScaling={false}
        >
          {numeral}
        </AppText>
      </View>
    </Pressable>
  );
});

/**
 * The month calendar.
 *
 * @param year - Gregorian year of the visible month.
 * @param monthIndex0 - Zero-based month index of the visible month.
 * @param canGoNext - Whether the "next month" arrow is live; `false` on the current month.
 * @returns The header, the weekday row and a fixed 6×7 grid of day cells.
 */
export function CalendarMonth({
  year,
  monthIndex0,
  records,
  today,
  selectedDay = null,
  canGoNext,
  onPreviousMonth,
  onNextMonth,
  onSelectDay,
  weekStartsOn,
  style,
  testID,
}: CalendarMonthProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { hijriOffset } = useCalculationSettings();

  // The grid measures itself rather than deriving from the window, because it sits inside a padded
  // card inside a padded page — and on an expanded layout, inside a pane. Only the window's width
  // class decides whether to look: on a phone the mockup's geometry is already right, so the
  // measurement is not even taken and the first frame is the only frame.
  const { widthClass: currentWidthClass } = useLayout();
  const [gridWidth, setGridWidth] = useState<number | null>(null);
  // Memoised because thirty memoised cells hold it: a fresh object every render would defeat all
  // of them. (On a phone `calendarCellMetrics` already returns one frozen constant.)
  const metrics = useMemo(
    () => calendarCellMetrics(currentWidthClass === 'compact' ? null : gridWidth),
    [currentWidthClass, gridWidth]
  );

  const locale = i18n.language;
  const weekStart = weekStartsOn ?? weekStartForLanguage(locale);
  const grid = useMemo(
    () => monthGrid(year, monthIndex0, weekStart),
    [year, monthIndex0, weekStart]
  );

  // Every sentence a cell can say, bound once for the whole grid. `t` is a new function per
  // language and nothing else, so this is exactly "per language".
  const labels = useMemo<DayCellLabels>(
    () => ({
      hint: t('history.day.a11yHint'),
      summarise: (record, isFuture) => {
        if (isFuture) return t('history.day.future');
        if (record?.isExempt === true) return t('history.day.exempt');
        const tally = tallyDay(record);
        const logged = tally.prayed + tally.late + tally.missed;
        if (logged === 0) return t('history.day.nothing');
        return t('history.day.counts', {
          prayed: tally.prayed,
          late: tally.late,
          missed: tally.missed,
        });
      },
      label: (dateLabel, summary) => t('history.day.a11yLabel', { date: dateLabel, summary }),
    }),
    [t]
  );

  // The month's grid with the two `Intl` formats every cell needs already applied — done once per
  // visible month instead of once per cell per render, since both depend only on the day and the
  // language. Carried on the grid rather than in a lookup so a rendered cell cannot miss its own
  // text.
  const cells = useMemo(
    () =>
      grid.map((row) =>
        row.map((day) =>
          day === null
            ? null
            : {
                day,
                numeral: formatNumber(Number(day.slice(8, 10)), locale, { useGrouping: false }),
                dateLabel: formatDate(parseDay(day), locale, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                }),
              }
        )
      ),
    [grid, locale]
  );

  const gregorianTitle = useMemo(
    () =>
      formatDate(new Date(year, monthIndex0, 1), locale, { month: 'long', year: 'numeric' }),
    [locale, year, monthIndex0]
  );

  const hijriTitle = useMemo(() => {
    const span = hijriMonthSpanForGregorianMonth(year, monthIndex0, hijriOffset);
    return span.months.map((month) => t(month.monthKey)).join(t('history.monthSpanSeparator'));
  }, [year, monthIndex0, hijriOffset, t]);

  const title = t('history.monthTitle', { gregorian: gregorianTitle, hijri: hijriTitle });

  // Weekday initials in the grid's own column order. 2024-01-07 was a Sunday, so walking forward
  // from it by `column + weekStart` names the weekday each column actually holds.
  const weekdayLabels = useMemo(() => {
    return Array.from({ length: 7 }, (_, column) => {
      const weekday = (column + weekStart) % 7;
      const label = formatDate(new Date(2024, 0, 7 + weekday), locale, { weekday: 'narrow' });
      return { weekday, label };
    });
  }, [locale, weekStart]);

  // What a month change owes the reader, in both senses.
  //
  // Out loud: the whole grid silently becoming different numbers is the *only* feedback the arrow
  // gives a screen-reader user. Never on mount, though — an announcement the moment the tab opens
  // would talk over the screen reader's own focus.
  //
  // On screen: the thirty cells now stay mounted and merely repaint (D183), which is fast but
  // reads as a flicker. Fading the grid back up from 0.35 gives the repaint the shape of a page
  // turning. Same mount rule, and none of it under reduce motion.
  const reduceMotion = useReduceMotion();
  const gridOpacity = useSharedValue(1);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const key = `${year}-${monthIndex0}`;
    if (shown.current === null) {
      shown.current = key;
      return;
    }
    if (shown.current === key) return;
    shown.current = key;
    AccessibilityInfo.announceForAccessibility(title);
    if (reduceMotion) return;
    gridOpacity.set(GRID_FADE_FROM);
    gridOpacity.set(withTiming(1, { duration: motion.morph }));
  }, [year, monthIndex0, title, reduceMotion, gridOpacity]);

  const gridStyle = useAnimatedStyle(() => ({ opacity: gridOpacity.get() }));

  // Paging back goes against the reading direction and paging forward goes with it, so both
  // glyphs come from the one place that knows which way that is.
  const previousIcon = backChevron();
  const nextIcon = forwardChevron();

  return (
    <View testID={testID} style={style}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          marginBottom: spacing.sm,
        }}
      >
        <PressableScale
          testID="calendar-previous"
          accessibilityRole="button"
          accessibilityLabel={t('history.a11yPreviousMonth')}
          onPress={onPreviousMonth}
          style={{ padding: spacing.xs }}
        >
          <Icon name={previousIcon} size={20} color={colors.faint} />
        </PressableScale>

        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel={title}
          style={{ flex: 1, alignItems: 'center' }}
        >
          {/* Two lines, not one. The month name is the only thing on this screen that says which
              month you are looking at — the numerals below are deliberately frozen *because* it
              scales — so it is the one label that must never be the thing that truncates.
              "September 2026" at full Dynamic Type is wider than the gap between the two chevrons;
              wrapping costs a few points of header height and keeps the word whole. At the default
              text size neither line has ever reached a second row. */}
          <AppText variant="rowName" weight={600} numberOfLines={2} style={CENTRED}>
            {gregorianTitle}
          </AppText>
          <AppText variant="caption" tone="header" numberOfLines={2} style={CENTRED}>
            {hijriTitle}
          </AppText>
        </View>

        <PressableScale
          testID="calendar-next"
          disabled={!canGoNext}
          accessibilityRole="button"
          accessibilityLabel={t('history.a11yNextMonth')}
          accessibilityState={{ disabled: !canGoNext }}
          onPress={canGoNext ? onNextMonth : undefined}
          style={{ padding: spacing.xs, opacity: canGoNext ? 1 : 0.3 }}
        >
          <Icon name={nextIcon} size={20} color={colors.faint} />
        </PressableScale>
      </View>

      <SectionDivider placement="bottom" />

      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: 'row', marginTop: spacing.sm }}
      >
        {weekdayLabels.map((weekday) => (
          <AppText
            key={weekday.weekday}
            variant="hint"
            // `soft` is the inactive-tab gold; at 12px on card it sat under 3:1 and the column
            // headings became guesswork. `header` is the same family, one step readable.
            tone="header"
            italic={false}
            // Deliberately frozen with the grid it captions (spec-accessibility §2.4): seven
            // columns at 46pt cannot absorb scaled headers, and DayDetail speaks the full date.
            allowFontScaling={false}
            style={{ flex: 1, textAlign: 'center' }}
          >
            {weekday.label}
          </AppText>
        ))}
      </View>

      <Animated.View
        testID="calendar-grid"
        style={[{ marginTop: spacing.xs }, gridStyle]}
        onLayout={
          currentWidthClass === 'compact'
            ? undefined
            : (event) => {
                // Width only; the cells' height is what this measurement changes, so reading it
                // back could never settle.
                const measured = event.nativeEvent.layout.width;
                setGridWidth((previous) => (previous === measured ? previous : measured));
              }
        }
      >
        {cells.map((row, rowIndex) => {
          // A fully empty trailing row would add 46pt of blank paper to short months.
          if (row.every((cell) => cell === null)) return null;
          return (
            <View
              key={`row-${String(rowIndex)}`}
              testID={`calendar-row-${String(rowIndex)}`}
              style={{ flexDirection: 'row' }}
            >
              {row.map((cell, columnIndex) => {
                // Keyed by where the cell sits, never by which day it holds (D183). A month is
                // the same 6×7 shape as the one before it, so paging is thirty prop updates
                // rather than thirty mounts. The handful of positions that genuinely change kind
                // — a day where a blank was — remount either way, because the element type is
                // different there.
                const key = `${String(rowIndex)}-${String(columnIndex)}`;
                if (cell === null) {
                  return <View key={key} style={{ flex: 1, height: metrics.cellHeight }} />;
                }
                return (
                  <DayCell
                    key={key}
                    day={cell.day}
                    record={records[cell.day]}
                    isToday={cell.day === today}
                    isSelected={cell.day === selectedDay}
                    isFuture={isFutureDay(cell.day, today)}
                    numeral={cell.numeral}
                    dateLabel={cell.dateLabel}
                    labels={labels}
                    colors={colors}
                    metrics={metrics}
                    onSelectDay={onSelectDay}
                  />
                );
              })}
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

/** The grid's geometry, so the screen and its tests can agree on it. */
export { CELL_HEIGHT as CALENDAR_CELL_HEIGHT, RING_SIZE as CALENDAR_RING_SIZE };
