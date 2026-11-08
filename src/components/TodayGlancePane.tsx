import { useCallback } from 'react';

import { Card } from './Card';
import { CalendarMonth } from './CalendarMonth';
import { DayDetail } from './DayDetail';
import type { SealPickMeta } from './PrayerSeal';
import { QiblaGlance } from './QiblaGlance';
import { SectionDivider } from './SectionDivider';
import { StatCards } from './StatCards';
import { useHistory } from '@/hooks/useHistory';
import { markHaptic, tickHaptic } from '@/utils/haptics';
import { useTrackingActions } from '@/stores/trackingStore';
import { spacing } from '@/theme';

import type { LoggableStatus, Prayer } from '@/domain/types';

/**
 * The Today dashboard's trailing pane at expanded width (D124): the live qibla dial, this month,
 * and the record — in that order, because the dial is the only one of the three anybody wants an
 * answer from at a glance.
 *
 * This is the "dashboard" half of the owner's request — History and Qibla at a glance beside the
 * reward loop, so a tablet's second column carries something worth having instead of white paper.
 * Nothing here belongs to the reward loop, and nothing here may interrupt it: the leading pane's
 * composition is untouched, and a tap in this pane never moves anything over there.
 *
 * ## Why it owns its own hooks
 *
 * It is a separate component precisely so `useHistory()` is mounted only when the pane is on
 * screen. A phone, or a tablet in portrait, never renders this and therefore never pays for the
 * month read — which is also why the width branch lives in the screen and not inside here.
 *
 * Its `useHistory` is a *second* instance, independent of the History tab's: month paging and
 * selection are local state in that hook, so browsing here never moves the other tab, and the
 * store subscriptions underneath are memoised per revision, so the cost is a reference comparison.
 * At worst the two instances each ask for a month once; the second finds it cached.
 *
 * ## What a non-logger sees
 *
 * A calendar and the dial — no record. The stats table is gated on an empty log, because a
 * permanent grid of zeros pushed into the face of someone who only wants prayer times is exactly
 * the ambient nagging this app refuses to do (CLAUDE.md: a non-logger may never feel nagged, or
 * like they are using it wrong). The calendar itself stays, drawn in its calm unlogged register.
 */

export interface TodayGlancePaneProps {
  testID?: string;
}

/**
 * @returns The month, the record and the qibla dial, with its own day sheet for a tapped cell.
 */
export function TodayGlancePane({ testID = 'today-glance' }: TodayGlancePaneProps) {
  const history = useHistory();
  const { toggleStatus, markMadeUp, clearMadeUp } = useTrackingActions();

  const { selectedDay, selectedRecord } = history;

  const handlePick = useCallback(
    (prayer: Prayer, status: LoggableStatus, meta: SealPickMeta) => {
      if (selectedDay === null) return;
      if (toggleStatus(selectedDay, prayer, status)) (meta.clears ? tickHaptic : markHaptic)();
    },
    [selectedDay, toggleStatus]
  );

  const handleToggleMadeUp = useCallback(
    (prayer: Prayer, next: boolean) => {
      if (selectedDay === null) return;
      const applied = next ? markMadeUp(selectedDay, prayer) : clearMadeUp(selectedDay, prayer);
      if (applied) markHaptic();
    },
    [selectedDay, markMadeUp, clearMadeUp]
  );

  return (
    <>
      {/* The dial leads the pane (owner, 2026-08-27: "i would put Qibla above history"). It is the
          one thing here somebody wants an answer from *now* — which way to face — and it is small
          enough that leading with it costs the month almost nothing. It brings its own rule, on its
          trailing side, because on a device with no compass it renders nothing at all and a rule of
          ours would be left stranded above the calendar. */}
      <QiblaGlance divider="trailing" testID={`${testID}-qibla`} />

      <Card testID={`${testID}-calendar-card`} style={{ padding: spacing.lg }}>
        <CalendarMonth
          testID={`${testID}-calendar`}
          year={history.month.year}
          monthIndex0={history.month.monthIndex0}
          records={history.shownRecords}
          today={history.today}
          selectedDay={history.selectedDay}
          canGoNext={history.canGoNext}
          onPreviousMonth={history.goToPreviousMonth}
          onNextMonth={history.goToNextMonth}
          onSelectDay={history.selectDay}
        />
      </Card>

      {history.hydrated && !history.isEmpty ? (
        <>
          <SectionDivider placement="top" />
          <StatCards
            testID={`${testID}-stats`}
            stats={history.stats}
            lifetime={history.lifetime}
            window={history.window}
            onSelectWindow={history.setWindow}
            mostMissed={history.mostMissed}
            mostLate={history.mostLate}
          />
        </>
      ) : null}

      {/* A tapped cell opens the same sheet History uses, over this pane. Its own testID keeps it
          distinct from Today's yesterday sheet, which lives in the other pane. */}
      <DayDetail
        testID={`${testID}-detail`}
        day={selectedDay}
        record={selectedRecord}
        times={history.selectedTimes}
        onClose={history.clearSelection}
        onPick={handlePick}
        onToggleMadeUp={handleToggleMadeUp}
      />
    </>
  );
}
