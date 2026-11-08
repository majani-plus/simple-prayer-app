import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { formatDate, formatNumber } from '@/i18n/numerals';
import { useSettledRevision } from '@/hooks/useSettledRevision';
import { parseDay, todayDay } from '@/domain/dates';
import { formatHijri, toHijri } from '@/domain/hijri';
import { type as typeScale, spacing, useTheme } from '@/theme';
import { useCalculationSettings, useStreakMode } from '@/stores/settingsStore';
import { useTrackingHydrated, useTrackingStore } from '@/stores/trackingStore';

import type { PrayerDay } from '@/domain/types';

/**
 * The top line of the Today tab: "16 Muharram · July 2" on the leading edge, the streak on the
 * trailing one, sharing a baseline (mockup 2a).
 *
 * Two things this component refuses to do:
 *
 * - **Hardcode a date.** The Hijri half is converted here from the prayer day through
 *   `domain/hijri` with the user's ±2 day offset, and the month name comes from the locale
 *   (`hijri.months.*`), never from English text baked into a string. Both halves are numbered in
 *   the locale's own numbering system, so `ar` gets Arabic-Indic digits.
 * - **Shame anyone.** A streak of 0 renders as a calm "0", exactly like any other number — no
 *   "broken", no warning colour, no empty state (PRODUCT_SPEC §5, "forgiving by design"). The
 *   value is the *active* mode's current streak and counts today optimistically while the day is
 *   still open.
 */
export interface TodayHeaderProps {
  /** The prayer day to render. Defaults to today. */
  day?: PrayerDay;
  /**
   * Overrides the streak. By default it is read from the tracking store's summary for the
   * active streak mode; pass this when a screen already holds the value (or in tests).
   */
  streak?: number;
  /**
   * Renders the trailing ⋯ affordance and wires its tap (spec-exemption §2b). Omitted, the
   * header is exactly what it always was — the screen only passes this while exemption mode is
   * enabled. It is deliberately three quiet dots in the footnote gold: reachable in one tap,
   * and silent to a glance at her open phone (the register rule, P1).
   */
  onOverflowPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Current streak for the active mode, or 0 before the store has read the database.
 *
 * The selector returns a *number*, so subscribing costs nothing extra: `streakSummary()` is
 * memoised inside the tracking store against its revision, and the primitive result keeps
 * zustand's snapshot comparison stable. The streak mode lives in the *settings* store, which
 * cannot bump that revision, so it is subscribed to separately — a mode change re-renders, and
 * the selector recomputes with the new mode.
 */
function useCurrentStreak(): number {
  const hydrated = useTrackingHydrated();
  const mode = useStreakMode();
  // Subscribed to the revision, not to the summary. A selector runs inside every store write, so
  // `state.streakSummary()` as a selector read the whole history from SQLite inside the seal tap
  // itself. Settled (D197): the streak recomputes once the taps stop, not under each one.
  const revision = useSettledRevision();
  const streakSummary = useTrackingStore((state) => state.streakSummary);

  // Before hydration the database has not been opened; asking for a summary would read through
  // to SQLite during the very first render.
  return useMemo(() => {
    void revision;
    void mode;
    return hydrated ? streakSummary().current : 0;
  }, [hydrated, streakSummary, revision, mode]);
}

/**
 * The Today tab's header row.
 *
 * @param day - Prayer day to render; defaults to today.
 * @param streak - Optional override for the streak value.
 * @returns A baseline-aligned row: localized Hijri + Gregorian date, and the streak.
 */
export function TodayHeader({ day, streak, onOverflowPress, style, testID }: TodayHeaderProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { hijriOffset } = useCalculationSettings();
  const storeStreak = useCurrentStreak();
  const value = streak ?? storeStreak;

  const locale = i18n.language;
  const resolvedDay = day ?? todayDay();

  const dateLine = useMemo(() => {
    const hijri = formatHijri(toHijri(resolvedDay, hijriOffset), { style: 'dayMonth' });
    const hijriText = t('hijri.dayMonth', {
      day: formatNumber(hijri.date.day, locale, { useGrouping: false }),
      month: t(hijri.monthKey),
    });
    const gregorianText = formatDate(parseDay(resolvedDay), locale, {
      month: 'long',
      day: 'numeric',
    });
    return t('today.dateLine', { hijri: hijriText, gregorian: gregorianText });
  }, [locale, resolvedDay, hijriOffset, t]);

  const streakText = useMemo(
    () => formatNumber(value, locale, { useGrouping: false }),
    [locale, value]
  );
  const streakLabel = t('today.streakLabel', { count: value });

  return (
    <View
      testID={testID}
      // The row wraps rather than overflowing. At Apple's 200% bar the Turkish date line
      // ("7 Rebiülevvel · 20 Ağustos") plus the streak is wider than the screen, and without
      // `flexWrap` the streak simply ran off the right edge — "0 günl…" with the rest nowhere.
      // Wrapping lets the streak drop to its own line and keeps `marginStart: 'auto'` holding
      // it against the trailing edge there; `flexShrink` lets the date give up width first,
      // so at ordinary sizes nothing moves at all.
      style={[
        { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' },
        style,
      ]}
    >
      <AppText variant="headerMeta" style={{ flexShrink: 1 }}>
        {dateLine}
      </AppText>
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${streakText} ${streakLabel}`}
        style={{
          marginStart: 'auto',
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: 5,
        }}
      >
        <AppText
          variant="rowName"
          weight={600}
          tone="diamond"
          tabularNums
          style={{ fontSize: typeScale.streakNumber }}
        >
          {streakText}
        </AppText>
        <AppText variant="caption" tone="header">
          {streakLabel}
        </AppText>
      </View>
      {onOverflowPress === undefined ? null : (
        <PressableScale
          testID={testID === undefined ? 'today-overflow-button' : `${testID}-overflow`}
          accessibilityRole="button"
          accessibilityLabel={t('today.overflow.a11y')}
          onPress={onOverflowPress}
          // Laid out small on purpose; PressableScale's 48pt floor grows the hitSlop to match.
          style={{ paddingHorizontal: spacing.xs, justifyContent: 'center' }}
        >
          {/* Literal three dots (the ⋯ affordance colour from DESIGN.md) — a glyph that names
              nothing, for a register that must announce nothing. */}
          <AppText variant="rowName" weight={600} color={colors.faint} accessible={false}>
            ⋯
          </AppText>
        </PressableScale>
      )}
    </View>
  );
}
