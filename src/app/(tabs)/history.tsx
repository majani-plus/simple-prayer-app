import { router, useIsFocused } from 'expo-router';
import { Activity, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { markHaptic, tickHaptic } from '@/utils/haptics';
import { CalendarMonth } from '@/components/CalendarMonth';
import { Card } from '@/components/Card';
import { DayDetail, DayDetailPanel } from '@/components/DayDetail';
import { MonthBar } from '@/components/MonthBar';
import { PaperBackground } from '@/components/PaperBackground';
import type { SealPickMeta } from '@/components/PrayerSeal';
import { SealDismissBoundary } from '@/components/SealDismiss';
import { SectionDivider } from '@/components/SectionDivider';
import { SettingGroup } from '@/components/SettingGroup';
import { SettingRow } from '@/components/SettingRow';
import { StatCards } from '@/components/StatCards';
import { StreakHero } from '@/components/StreakHero';
import { TwoPaneLayout } from '@/components/TwoPaneLayout';
import { daysBetween } from '@/domain/dates';
import { monthRange, useHistory } from '@/hooks/useHistory';
import { useLayout } from '@/hooks/useLayout';
import { useExemptionSettings, useTrackingMode } from '@/stores/settingsStore';
import { useTrackingActions } from '@/stores/trackingStore';
import { spacing } from '@/theme';

import type { LoggableStatus, Prayer } from '@/domain/types';

/**
 * The History tab (PRODUCT_SPEC §8).
 *
 * Streak hero → month calendar (with the month's own bar) → hairline + ◆ → stats, in one scroll
 * view on paper (D183) — the same composition shape as Today, and for the same reason: `useHistory`
 * answers every question about which month, which day and which numbers, the components own their
 * own looks, and the tracking store owns every write. What is left here is the wiring.
 *
 * Three rules it enforces:
 *
 * 1. **Nothing pages into the future.** The hook clamps the visible month to the current one and
 *    refuses to open a future day; the calendar renders those cells inert; the store refuses the
 *    write. Three independent locks, because the day can roll over underneath any of them
 *    (PRODUCT_SPEC §4).
 * 2. **Every write goes through the tracking store**, with the seal's own semantics — picking the
 *    status a prayer already has clears it (`toggleStatus`) — so a day edited here behaves exactly
 *    as it does on Today, months later and with no time limit.
 * 3. **Nothing here computes a statistic or a date.** Day arithmetic is `domain/dates`, the Hijri
 *    span is `domain/hijri`, the numbers are `domain/stats`/`domain/streaks` via the store.
 */

/**
 * The tab, hidden while another tab is showing.
 *
 * `freezeOnBlur` does nothing in Expo Router 58 (its tab screens hard-code it off), so History used
 * to re-render — calendar, stats, streak — behind Today on every seal tap (D191). A hidden
 * `Activity` keeps the tab's state (month, selection, scroll) but drops its effects, and with them
 * its store subscriptions: nothing here runs until the tab is shown again, and then it renders
 * once against whatever changed.
 */
export default function HistoryScreen() {
  const focused = useIsFocused();
  return (
    <Activity mode={focused ? 'visible' : 'hidden'}>
      <HistoryContent />
    </Activity>
  );
}

function HistoryContent() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { contentClampStyle, contentClampPadding, isExpanded } = useLayout();
  const history = useHistory();
  const { toggleStatus, toggleSimpleStatus, markMadeUp, clearMadeUp } = useTrackingActions();
  const simple = useTrackingMode() === 'simple';
  const { enabled: exemptionEnabled } = useExemptionSettings();

  const { selectedDay, selectedRecord } = history;

  /**
   * The day the detail is showing. On an expanded window the panel is always showing *something*,
   * and that something is today until the user taps a cell (D124) — derived, never written, so
   * narrowing the window can never leave a selection behind that pops a sheet the user did not open.
   */
  const detailDay = selectedDay ?? (isExpanded ? history.today : null);
  const detailRecord = selectedDay === null ? history.records[history.today] : selectedRecord;
  const detailTimes = selectedDay === null ? history.todayTimes : history.selectedTimes;

  const handlePick = useCallback(
    (prayer: Prayer, status: LoggableStatus, meta: SealPickMeta) => {
      if (detailDay === null) return;
      // `toggleStatus` IS the seal's semantics: picking the status a prayer already has clears it.
      // Simple mode's one tap is prayed ↔ not marked against the STORED status (D192).
      const applied = simple
        ? toggleSimpleStatus(detailDay, prayer)
        : toggleStatus(detailDay, prayer, status);
      // A mark buzzes Success; taking one back off buzzes lighter (D193).
      if (applied) (meta.clears ? tickHaptic : markHaptic)();
    },
    [detailDay, toggleStatus, toggleSimpleStatus, simple]
  );

  const handleToggleMadeUp = useCallback(
    (prayer: Prayer, next: boolean) => {
      if (detailDay === null) return;
      // The missed → made-up conversion of PRODUCT_SPEC §7. The store refuses when there is no
      // outstanding debt left to pay off, and says so by returning false; a refusal is simply
      // silent here — nothing changed, so nothing is confirmed.
      const applied = next ? markMadeUp(detailDay, prayer) : clearMadeUp(detailDay, prayer);
      if (applied) markHaptic();
    },
    [detailDay, markMadeUp, clearMadeUp]
  );

  // The visible month's days, for the bar under the grid. One array per month, not per render.
  const monthDays = useMemo(() => {
    const { from, to } = monthRange(history.month);
    return daysBetween(from, to);
  }, [history.month]);

  const calendarPane = (
    <>
      {/* The run comes first (D183): the tab opens on how it is going, in one glance, before the
          month it is going through. Rendered only once the store has read the database, so a cold
          open never shows a zero that is not yet true. */}
      {history.hydrated ? (
        <StreakHero
          testID="history-streak"
          streak={history.streak}
          streakMode={history.streakMode}
          weekRate={history.weekRate}
        />
      ) : null}

      <Card testID="history-calendar-card" style={{ padding: spacing.lg }}>
        <CalendarMonth
          testID="history-calendar"
          year={history.month.year}
          monthIndex0={history.month.monthIndex0}
          records={history.shownRecords}
          today={history.today}
          // The highlighted cell follows the panel, so the month always says which day is open.
          selectedDay={detailDay}
          canGoNext={history.canGoNext}
          onPreviousMonth={history.goToPreviousMonth}
          onNextMonth={history.goToNextMonth}
          onSelectDay={history.selectDay}
        />
        <MonthBar
          testID="history-month"
          days={monthDays}
          records={history.shownRecords}
          today={history.today}
        />
      </Card>

      <View accessible={false}>
        <SectionDivider placement="top" />
      </View>

      {/* The excused-days register (spec-exemption): History is where the owner looks for past
            days, so past excused periods are reachable from here too. Gated on the mode being on —
            invisible to anyone the feature does not concern. `bedtime` is the feature's identity
            glyph, the same crescent the exempt seal wears.

            It is a SECTION, and says so. Owner, 2026-08-30: *"when we have excused days in the
            history, the history screen gets confusing cause I see a banner for editing past
            record. No title no heading for that section, and I see 2 divider lines on top of
            eachother?"* — both true. The row sat under the calendar's rule with no heading, so it
            read as a stray banner rather than as the top of something; and `SettingGroup` draws
            its OWN rule by default, which landed directly on the one above. So: the group takes
            the feature's own name as its heading, `divider={false}` leaves the rule above to be
            the only one, and the stats section gets the rule it always had — which now has to be
            written here, because this section sits between the calendar and it. */}
      {exemptionEnabled ? (
        <>
          <SettingGroup
            testID="history-group-exemption"
            title={t('settings.home.tracking.exemption.label')}
            divider={false}
          >
            <SettingRow
              testID="history-row-exemption"
              icon="bedtime"
              label={t('exemption.settings.periods.label')}
              description={t('exemption.settings.periods.description')}
              accessibilityHint={t('exemption.settings.periods.a11yHint')}
              onPress={() => router.push('/settings/exemption')}
            />
          </SettingGroup>

          <View accessible={false}>
            <SectionDivider placement="top" />
          </View>
        </>
      ) : null}

      {history.hydrated ? (
        <StatCards
          testID="history-stats"
          stats={history.stats}
          lifetime={history.lifetime}
          window={history.window}
          onSelectWindow={history.setWindow}
          mostMissed={history.mostMissed}
          mostLate={history.mostLate}
        />
      ) : null}

      <AppText testID="history-footer" variant="hint" style={{ textAlign: 'center' }}>
        {t('history.footerHint')}
      </AppText>
    </>
  );

  const scrollShell = {
    paddingTop: insets.top + spacing.xxl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  };

  // Expanded: the month and the day stand side by side, and the sheet is not rendered at all — a
  // rotation that crosses the breakpoint with a day selected must not show both at once.
  if (isExpanded && detailDay !== null) {
    return (
      <PaperBackground>
        {/* One boundary over both panes: a tap on either pane's bare paper closes an open pill,
            exactly as the sheet's own boundary does at narrower widths. */}
        <SealDismissBoundary testID="history-seal-dismiss" style={{ flex: 1 }}>
          <TwoPaneLayout
            testID="history-panes"
            start={
              <ScrollView
                testID="history-scroll"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ ...scrollShell, ...contentClampStyle }}
              >
                {calendarPane}
              </ScrollView>
            }
            end={
              <ScrollView
                testID="history-detail-scroll"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ ...scrollShell, ...contentClampStyle }}
              >
                <DayDetailPanel
                  testID="history-day-panel"
                  day={detailDay}
                  record={detailRecord}
                  times={detailTimes}
                  onPick={handlePick}
                  onToggleMadeUp={handleToggleMadeUp}
                />
              </ScrollView>
            }
          />
        </SealDismissBoundary>
      </PaperBackground>
    );
  }

  return (
    <PaperBackground>
      <ScrollView
        testID="history-scroll"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ ...scrollShell, ...contentClampPadding(spacing.xl) }}
      >
        {calendarPane}
      </ScrollView>

      <DayDetail
        day={selectedDay}
        record={selectedRecord}
        times={history.selectedTimes}
        onClose={history.clearSelection}
        onPick={handlePick}
        onToggleMadeUp={handleToggleMadeUp}
      />
    </PaperBackground>
  );
}
