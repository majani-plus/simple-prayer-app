import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { PressableScale } from './PressableScale';
import { StatusBar } from './StatusBar';
import { PRAYERS, type Prayer, type StatsSummary } from '@/domain/types';
import { STATS_WINDOWS, type StatsWindow } from '@/hooks/useHistory';
import { formatNumber } from '@/i18n/numerals';
import { radius, spacing, type as typeScale, useTheme } from '@/theme';

/**
 * The History tab's stats section (PRODUCT_SPEC §8), sitting **below** the calendar in the same
 * scroll view rather than behind a segmented control.
 *
 * That is the simpler of the two layouts the spec allows, and the better one here: a segment would
 * add a second navigation model to a tab that already has month paging, hide half the tab behind a
 * control, and make "how did this month go" and "how am I doing" mutually exclusive — when the
 * whole point of the pairing is reading one in the light of the other. Scrolling costs nothing;
 * every number below is memoised in the tracking store, so paging months never recomputes it.
 *
 * **This component computes no statistic.** Every figure arrives already computed by
 * `domain/stats` / `domain/streaks` through the tracking store; what happens here is formatting
 * (locale numerals, percentages, dates) and layout.
 *
 * **The copy never shames.** A bad week is presented in exactly the same voice as a good one:
 * counts and a percentage, no adjectives, no warning colour, no empty state that reads as a
 * reprimand (PRODUCT_SPEC §5 "forgiving by design"). Unlogged is reported as its own quiet
 * category and never folded into missed; exempt is reported and never counted against anything.
 */

export interface StatCardsProps {
  /** Stats over the active window. */
  stats: StatsSummary | null;
  /** Lifetime stats. */
  lifetime: StatsSummary | null;
  /** The active window, 7 or 30 days. */
  window: StatsWindow;
  onSelectWindow: (window: StatsWindow) => void;
  /** The window's most-missed prayer, or `null` when nothing was missed. */
  mostMissed: Prayer | null;
  /** The window's most-often-late prayer, or `null` when nothing was late. */
  mostLate: Prayer | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Formats a 0…1 rate as a locale percentage, or an em dash when there is nothing to divide. */
function usePercent(): (rate: number | null) => string {
  const { t, i18n } = useTranslation();
  const formatter = useMemo(
    () => (rate: number) =>
      formatNumber(rate, i18n.language, { style: 'percent', maximumFractionDigits: 0 }),
    [i18n.language]
  );
  return (rate) => (rate === null ? t('history.stats.none') : formatter(rate));
}

/** Formats an integer in the active locale. */
function useNumber(): (value: number) => string {
  const { i18n } = useTranslation();
  const formatter = useMemo(
    () => (value: number) => formatNumber(value, i18n.language, { useGrouping: true }),
    [i18n.language]
  );
  return (value) => formatter(value);
}

/**
 * One labelled figure: a big tabular numeral over an italic caption.
 *
 * Intrinsically sized (`flexShrink`, not `flex: 1`): its row lays the figures out
 * `space-between`, so a pair reads from the card's edges instead of both crowding the left half
 * — the second figure used to start at the card's midline and leave the right third empty.
 *
 * Exported for `StreakHero`, which shows the best run in exactly this shape beside its headline.
 */
export function Figure({
  value,
  label,
  tone = 'strong',
  testID,
}: {
  value: string;
  label: string;
  tone?: 'strong' | 'ink' | 'muted';
  testID?: string;
}) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${value} ${label}`}
      style={{ flexShrink: 1, gap: 1 }}
    >
      <AppText
        testID={testID}
        variant="rowName"
        weight={700}
        tone={tone}
        tabularNums
        style={{ fontSize: typeScale.streakNumber }}
      >
        {value}
      </AppText>
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}

/**
 * The stats section.
 *
 * @param window - Which of the 7/30-day windows `stats` was computed over.
 * @returns The window switch, completion, the lifetime totals, then the per-prayer bars and the
 * callouts. The streak is not here — it heads the tab, in `StreakHero`.
 */
export function StatCards({
  stats,
  lifetime,
  window,
  onSelectWindow,
  mostMissed,
  mostLate,
  style,
  testID,
}: StatCardsProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const percent = usePercent();
  const number = useNumber();

  // "Nothing has ever been logged" is a legitimate, calm state — not an error and not a nudge.
  const nothingEverLogged =
    lifetime !== null && lifetime.prayed + lifetime.late + lifetime.missed === 0;

  return (
    <View testID={testID} style={[{ gap: spacing.md }, style]}>
      <AppText variant="rowName" weight={600} accessibilityRole="header">
        {t('history.stats.title')}
      </AppText>

      {/* -- window switch ------------------------------------------------------------------ */}
      <View
        testID="stat-window"
        accessibilityRole="tablist"
        style={{ flexDirection: 'row', gap: spacing.sm }}
      >
        {STATS_WINDOWS.map((candidate) => {
          const active = candidate === window;
          return (
            <PressableScale
              key={candidate}
              testID={`stat-window-${String(candidate)}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t('history.stats.windowLabel', {
                days: number(candidate),
                count: candidate,
              })}
              onPress={() => onSelectWindow(candidate)}
              style={{
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.lg,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: active ? colors.borderStrong : colors.borderMid,
                backgroundColor: active ? colors.cardBright : 'transparent',
              }}
            >
              <AppText variant="caption" italic={false} tone={active ? 'accent' : 'muted'}>
                {/* `count` drives the plural form — Arabic says "٧ أيام" but "٣٠ يومًا"; `days`
                    stays a separate, pre-localized value so the digits match every other number. */}
                {t('history.stats.windowLabel', { days: number(candidate), count: candidate })}
              </AppText>
            </PressableScale>
          );
        })}
      </View>

      {stats === null ? null : (
        <>
          {/* -- completion ------------------------------------------------------------- */}
          <Card testID="stat-completion" style={{ padding: spacing.lg, gap: spacing.sm }}>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}
            >
              <Figure
                testID="stat-completion-rate"
                value={percent(stats.completionRate)}
                label={t('history.stats.completion')}
              />
              <Figure
                testID="stat-ontime-rate"
                value={percent(stats.onTimeRate)}
                label={t('history.stats.onTime')}
                tone="ink"
              />
            </View>
            <StatusBar
              testID="stat-completion-bar"
              prayed={stats.prayed}
              late={stats.late}
              missed={stats.missed}
              total={stats.prayed + stats.late + stats.missed + stats.unlogged}
            />
            <AppText variant="hint">
              {t('history.stats.completionCaption', {
                prayed: number(stats.prayed),
                late: number(stats.late),
                missed: number(stats.missed),
                unlogged: number(stats.unlogged),
              })}
            </AppText>
          </Card>
        </>
      )}

      {/* -- lifetime ------------------------------------------------------------------- */}
      {/* Above the by-prayer breakdown (owner): the lifetime totals answer the same "how am I
          doing" question the completion card opens, so the two read together before the table
          changes subject to per-prayer detail. */}
      {lifetime === null ? null : nothingEverLogged ? (
        <Card testID="stat-empty" style={{ padding: spacing.lg }}>
          <AppText variant="caption" style={{ textAlign: 'center' }}>
            {t('history.stats.empty')}
          </AppText>
        </Card>
      ) : (
        <Card testID="stat-lifetime" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <AppText variant="caption" tone="header">
            {t('history.stats.lifetime')}
          </AppText>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
            <Figure
              testID="stat-lifetime-prayed"
              value={number(lifetime.prayed + lifetime.late)}
              label={t('history.stats.lifetimePrayed')}
            />
            <Figure
              testID="stat-lifetime-ontime"
              value={number(lifetime.prayed)}
              label={t('history.stats.onTime')}
              tone="ink"
            />
            <Figure
              testID="stat-lifetime-fulldays"
              value={number(lifetime.fullDays)}
              label={t('history.stats.fullDays')}
              tone="ink"
            />
          </View>
        </Card>
      )}

      {stats === null ? null : (
        <>
          {/* -- per prayer ------------------------------------------------------------- */}
          <Card testID="stat-by-prayer" style={{ padding: spacing.lg, gap: spacing.sm }}>
            <AppText variant="caption" tone="header">
              {t('history.stats.byPrayer')}
            </AppText>

            {/* Five bar rows, not a three-column table. The table asked the reader to compare
                fifteen numerals across three columns to find the prayer that needs attention; a
                bar says it by length, and the caption beside it says it in words for anyone the
                shape does not serve. The row's spoken label is unchanged — a screen reader still
                hears all three counts. */}
            {PRAYERS.map((prayer) => {
              const row = stats.byPrayer.find((candidate) => candidate.prayer === prayer);
              const counts = {
                prayed: row?.prayed ?? 0,
                late: row?.late ?? 0,
                missed: row?.missed ?? 0,
                unlogged: row?.unlogged ?? 0,
              };
              // What was owed, and what of it was answered. Unlogged is in neither — it is the
              // track behind the bar, never a miss and never a shortfall in the caption.
              const obligated = counts.prayed + counts.late + counts.missed;
              const done = counts.prayed + counts.late;
              return (
                <View
                  key={prayer}
                  testID={`stat-prayer-${prayer}`}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={t('history.stats.prayerRowA11y', {
                    prayer: t(`prayers.${prayer}`),
                    prayed: number(counts.prayed),
                    late: number(counts.late),
                    missed: number(counts.missed),
                  })}
                  style={{ gap: 3, paddingVertical: 2 }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'baseline',
                      gap: spacing.sm,
                      minHeight: 20,
                    }}
                  >
                    <AppText variant="time" tone="ink" style={{ flex: 1 }}>
                      {t(`prayers.${prayer}`)}
                    </AppText>
                    {/* `header`, not `muted`: this is the row's data, and `muted` on card is
                        ~3.9:1 — below AA at this size. */}
                    <AppText variant="time" tone="header" tabularNums>
                      {obligated === 0
                        ? t('history.stats.none')
                        : t('history.stats.prayerRowCaption', {
                            done: number(done),
                            obligated: number(obligated),
                          })}
                    </AppText>
                  </View>
                  <StatusBar
                    testID={`stat-prayer-${prayer}-bar`}
                    prayed={counts.prayed}
                    late={counts.late}
                    missed={counts.missed}
                    total={obligated + counts.unlogged}
                  />
                </View>
              );
            })}

            <AppText testID="stat-callouts" variant="hint">
              {t('history.stats.callouts', {
                missed: mostMissed === null ? t('history.stats.none') : t(`prayers.${mostMissed}`),
                late: mostLate === null ? t('history.stats.none') : t(`prayers.${mostLate}`),
              })}
            </AppText>
          </Card>
        </>
      )}
    </View>
  );
}
