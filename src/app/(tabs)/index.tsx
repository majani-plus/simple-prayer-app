import { router } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { useSettledRevision } from '@/hooks/useSettledRevision';
import { errorHaptic, markHaptic, tickHaptic } from '@/utils/haptics';
import { Card } from '@/components/Card';
import { ClockZoneNote } from '@/components/ClockZoneNote';
import { CountdownHero, type HeroMode } from '@/components/CountdownHero';
import { DayDetail } from '@/components/DayDetail';
import { ExemptionBanner } from '@/components/ExemptionBanner';
import { BeginExemptionSheet, EndExemptionSheet } from '@/components/ExemptionSheets';
import { LocationPromptCard, type LocationPromptState } from '@/components/LocationPromptCard';
import { TodayOverflowSheet } from '@/components/TodayOverflowSheet';
import { TravelBanner } from '@/components/TravelBanner';
import { BeginTravelSheet } from '@/components/TravelSheets';
import { PaperBackground } from '@/components/PaperBackground';
import { PrayerRow } from '@/components/PrayerRow';
import type { SealPickMeta } from '@/components/PrayerSeal';
import { SunriseMarker } from '@/components/SunriseMarker';
import { QadaCard } from '@/components/QadaCard';
import { SealDismissBoundary } from '@/components/SealDismiss';
import { TodayGlancePane } from '@/components/TodayGlancePane';
import { TodayHeader } from '@/components/TodayHeader';
import { TwoPaneLayout } from '@/components/TwoPaneLayout';
import { YesterdayCard } from '@/components/YesterdayCard';
import { addDays } from '@/domain/dates';
import { findOngoingPeriod } from '@/domain/exemptions';
import { isTravelingOn, travelPrayedStatusAt } from '@/domain/travel';
import { afterSheetDismissed } from '@/utils/sheetTransition';
import { prayerNameKey } from '@/domain/prayerNames';
import { computeDayTimes } from '@/domain/prayerTimes';
import { displayRecord } from '@/domain/trackingMode';
import { prayedStatusAt } from '@/domain/windows';
import { useTrackingModeView } from '@/hooks/useTrackingModeView';
import {
  PRAYERS,
  type LoggableStatus,
  type Prayer,
  type PrayerDay,
  type TimeMarker,
} from '@/domain/types';
import { useLayout } from '@/hooks/useLayout';
import { usePrayerDay } from '@/hooks/usePrayerDay';
import {
  useLocationActions,
  useLocationPermission,
  useLocationStatus,
} from '@/stores/locationStore';
import {
  useCalculationSettings,
  useExemptionSettings,
  useLocation,
  useSettingsActions,
  useTravelSettings,
} from '@/stores/settingsStore';
import { useBuddiesByPrayer, useBuddyEnabled } from '@/stores/buddyStore';
import {
  useExemptPeriods,
  useTrackingActions,
  useTrackingHydrated,
  useTrackingStore,
} from '@/stores/trackingStore';
import { spacing } from '@/theme';

/**
 * The Today tab (mockup 2a).
 *
 * Header → hero → five prayer rows → footer hint, on paper, in one scroll view. The screen is a
 * *composition*: `usePrayerDay` answers every question about time and status, the components own
 * their own looks, and the tracking store owns every write. What is left here is the small amount
 * of state that genuinely belongs to the screen, and the wiring between the two.
 *
 * Three rules it enforces:
 *
 * 1. **Exactly one seal is open at a time.** The open prayer lives here, so opening a second seal
 *    closes the first and any pick closes the pill — the seal itself never decides (see
 *    `PrayerSeal`'s "it is controlled" note). The day rolling over closes it too.
 * 2. **A prayer is loggable from its adhan time onward** (PRODUCT_SPEC §2). Future prayers — the
 *    upcoming one included — render "upcoming" and their seal refuses to open; every prayer of the
 *    current prayer day whose time has passed stays loggable, which after midnight still means
 *    *yesterday's* Isha, because the prayer day runs Fajr→Fajr.
 * 3. **Nothing nags.** Without a location the hero is replaced by one calm card with one button —
 *    the only place in the app a permission prompt originates (PRODUCT_SPEC §10) — and the rest of
 *    the screen stays exactly as calm as it was. On an exempt day the rows say "not required" and
 *    the footer explains itself instead of asking for anything (PRODUCT_SPEC §6).
 */

/** The gap between prayer rows in the mockup (9px, tighter than the 16px section rhythm). */
const ROW_GAP = 9;

/**
 * The sheet the screen is showing, if any. Exactly one at a time.
 *
 * Ending travel has no sheet: unlike an exempt period there is no per-day record to backdate, so
 * the tap in the menu is the whole gesture (D117).
 */
type TodaySheet = 'none' | 'overflow' | 'begin' | 'end' | 'travelBegin';

export default function TodayScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { contentClampStyle, contentClampPadding, isExpanded } = useLayout();
  const today = usePrayerDay();
  // One lookup for the whole screen: a hook cannot be called inside the rows' map, and a phone
  // without buddy mode gets the same frozen empty table every render.
  const buddiesByPrayer = useBuddiesByPrayer(today.day);
  const buddyMode = useBuddyEnabled();
  const {
    toggleStatus,
    toggleSimpleStatus,
    startExemptPeriod,
    addExemptPeriod,
    endExemptPeriod,
    loadDay,
    markMadeUp,
    clearMadeUp,
    onWriteFailed,
  } = useTrackingActions();
  // Today is always mounted, so this covers a failed write from any surface.
  useEffect(() => onWriteFailed(errorHaptic), [onWriteFailed]);

  const locationStatus = useLocationStatus();
  const location = useLocation();
  const { canAskAgain } = useLocationPermission();
  const { requestAndResolve } = useLocationActions();

  const { day, record: storedRecord, times } = today;
  // What the rows SHOW (D192): in simple mode a closed, unmarked prayer reads as missed and a late
  // one as prayed. Detailed mode hands back the very same object. Writes never see this.
  const modeView = useTrackingModeView();
  const simple = modeView.mode === 'simple';
  const record = useMemo(
    () => (storedRecord === null ? null : displayRecord(storedRecord, modeView)),
    [storedRecord, modeView]
  );

  // Excused days (spec-exemption §2b/§3). The ⋯ is on the header for EVERYONE, not only once the
  // mode has been switched on in Settings: the owner's report was that he could not find the
  // feature at all, and a control nobody can reach is worse than three quiet dots that say
  // nothing. What the mode flag still gates is everything that has weight — the banner, the
  // paused reminders, the inert seals — none of which appears until somebody actually begins.
  const { enabled: exemptionEnabled } = useExemptionSettings();
  const { setExemptionModeEnabled, setExemptionMuteReminders, startTravel, endTravel } = useSettingsActions();
  const exemptPeriods = useExemptPeriods();
  // "Ongoing", not "open-ended": a period may have been begun with an end date, and it counts as
  // current until its last day is past — after which it stops on its own, with nothing scheduled.
  const ongoingPeriod =
    exemptionEnabled && day !== null ? findOngoingPeriod(exemptPeriods, day) : null;
  const [sheet, setSheet] = useState<TodaySheet>('none');
  /**
   * A sheet's dismissal closes ONLY that sheet. The ⋯ menu unmounts when it hands off to
   * another sheet, and the library reports that dismissal afterwards — a blanket "close
   * everything" handler then shut the sheet the menu had just opened, so choosing "I'm
   * travelling" flashed the travel sheet and closed it (owner, 2026-08-28). Identities are
   * stable, so the sheets do not re-render on every keystroke of the screen above them.
   */
  const closeSheetIf = useMemo(() => {
    const make = (kind: TodaySheet) => () =>
      setSheet((current) => afterSheetDismissed(current, kind, 'none'));
    return {
      overflow: make('overflow'),
      begin: make('begin'),
      end: make('end'),
      travelBegin: make('travelBegin'),
    };
  }, []);

  const handleBeginExemption = useCallback(
    (fromDay: PrayerDay, lastDay: PrayerDay | null, muteReminders: boolean) => {
      setSheet('none');
      // Her answer to "pause reminders?" — the plan reads it on the next sync (owner, 2026-08-28).
      setExemptionMuteReminders(muteReminders);
      // Beginning from Today turns the mode on as a side effect of *using* it — the switch in
      // Settings exists to keep the feature invisible to people it does not concern, not to be
      // a gate somebody has to find first (§2a's "the switch never implies a period" still
      // holds in the other direction: a period always implies the switch).
      setExemptionModeEnabled(true);
      // A duration is an ordinary closed period, which is the whole trick: "excused for three
      // days" needs no timer and nothing to remember, because the coverage simply runs out.
      if (lastDay === null) startExemptPeriod(fromDay);
      else addExemptPeriod(fromDay, lastDay);
      markHaptic();
    },
    [setExemptionModeEnabled, setExemptionMuteReminders, startExemptPeriod, addExemptPeriod]
  );

  const handleEndExemption = useCallback(
    (lastDay: PrayerDay) => {
      setSheet('none');
      endExemptPeriod(lastDay);
      markHaptic();
    },
    [endExemptPeriod]
  );

  // Travel mode (D115). Whether it applies is derived per day rather than read as a flag, which is
  // what lets an end date need no timer: when the day rolls past the last travel day this simply
  // answers `false`, the banner unmounts, and the menu offers to begin again.
  const travel = useTravelSettings();
  const traveling = day !== null && isTravelingOn(day, travel);

  const handleBeginTravel = useCallback(
    (lastDay: PrayerDay | null) => {
      if (day === null) return;
      setSheet('none');
      startTravel(day, lastDay);
      markHaptic();
    },
    [day, startTravel]
  );

  const handleEndTravel = useCallback(() => {
    setSheet('none');
    endTravel();
    markHaptic();
  }, [endTravel]);

  // ── Yesterday (owner request, 2026-08-24): the morning-after way to finish marking last
  // night's prayers without a trip through History. A quiet card below the rows, opening the
  // SAME day sheet History uses — imported, never reimplemented, so a day repaired from here and
  // a day repaired there cannot diverge. Two gates keep it an offer rather than an audit: the
  // card itself hides when yesterday has nothing unmarked (an exempt yesterday has nothing by
  // construction), and `loggerGate` hides it from anyone who does not log at all — a person who
  // only wants prayer times must never be greeted by a daily count of prayers they never meant
  // to mark (CLAUDE.md, two audiences). "Logged something in the last 7 days" is that test:
  // cheap (the store memoises the summary), and self-fulfilling in the right direction — the
  // first mark of the morning brings the card with it.
  const hydrated = useTrackingHydrated();
  const calculation = useCalculationSettings();
  const yesterday = day === null ? null : addDays(day, -1);
  const yesterdayRecord = useTrackingStore((state) =>
    yesterday === null ? undefined : state.dayRecords[yesterday]
  );
  useEffect(() => {
    if (!hydrated || yesterday === null || yesterdayRecord !== undefined) return;
    // A cache miss (first mount, or the store dropped its day cache wholesale) is read through
    // once; the write ends the effect's own condition, so this can never loop.
    loadDay(yesterday);
  }, [hydrated, yesterday, yesterdayRecord, loadDay]);
  // Settled, like the streak in `TodayHeader` (D197): as a selector this read a week from SQLite
  // inside every store write, the seal tap included.
  const statsRevision = useSettledRevision();
  const statsFor = useTrackingStore((state) => state.statsFor);
  const recentStats = useMemo(() => {
    void statsRevision;
    // `detailed`: the gate asks whether this person LOGS, so it reads the stored log. In simple
    // mode the shown misses would otherwise open it for someone who has never tapped a seal.
    return hydrated ? statsFor(7, 'detailed') : null;
  }, [hydrated, statsFor, statsRevision]);
  const loggerGate = recentStats !== null && recentStats.totalTracked > 0;

  const [yesterdayOpen, setYesterdayOpen] = useState(false);
  const closeYesterday = useCallback(() => {
    setYesterdayOpen(false);
  }, []);

  const yesterdayTimes = useMemo((): Record<Prayer, Date> | null => {
    if (yesterday === null || location === null) return null;
    try {
      const { times } = computeDayTimes(yesterday, location, calculation);
      // Narrowed to the five tracked prayers, exactly as History's sheet does.
      const pick = (marker: TimeMarker) => times[marker];
      return {
        fajr: pick('fajr'),
        dhuhr: pick('dhuhr'),
        asr: pick('asr'),
        maghrib: pick('maghrib'),
        isha: pick('isha'),
      };
    } catch {
      // An unresolvable day must not take the whole screen down; the sheet explains itself.
      return null;
    }
  }, [yesterday, location, calculation]);

  const handleYesterdayPick = useCallback(
    (prayer: Prayer, status: LoggableStatus, meta: SealPickMeta) => {
      if (yesterday === null) return;
      const applied = simple
        ? toggleSimpleStatus(yesterday, prayer)
        : toggleStatus(yesterday, prayer, status);
      if (applied) (meta.clears ? tickHaptic : markHaptic)();
    },
    [yesterday, toggleStatus, toggleSimpleStatus, simple]
  );

  const handleYesterdayMadeUp = useCallback(
    (prayer: Prayer, next: boolean) => {
      if (yesterday === null) return;
      const applied = next ? markMadeUp(yesterday, prayer) : clearMadeUp(yesterday, prayer);
      if (applied) markHaptic();
    },
    [yesterday, markMadeUp, clearMadeUp]
  );

  // The open seal is remembered together with the day it belongs to, so a rollover closes it
  // without an effect: yesterday's Isha must not stay open as today's Fajr.
  const [open, setOpen] = useState<{ day: PrayerDay | null; prayer: Prayer | null }>({
    day: null,
    prayer: null,
  });
  const openPrayer = open.day === day ? open.prayer : null;

  const closeSeal = useCallback(() => {
    setOpen({ day, prayer: null });
  }, [day]);

  const handleToggleOpen = useCallback(
    (prayer: Prayer) => {
      setOpen((current) => ({
        day,
        prayer: current.day === day && current.prayer === prayer ? null : prayer,
      }));
    },
    [day]
  );

  const handlePick = useCallback(
    (prayer: Prayer, status: LoggableStatus, meta: SealPickMeta) => {
      closeSeal();
      if (day === null) return;
      // Simple mode (D192): the one tap stores prayed or nothing — never `late`, so the rewrite
      // below does not apply. `toggleSimpleStatus` reads the STORED status, which is what lets a
      // stored `late` (shown as prayed) clear on the same tap that clears a `prayed`.
      if (simple) {
        // Taking a mark back off buzzes lighter than making one (D193), in simple mode too.
        (meta.clears ? tickHaptic : markHaptic)();
        toggleSimpleStatus(day, prayer);
        return;
      }
      // The wordless one-tap says "done, NOW" — so if now is past the deadline, the honest
      // record is `late` (`domain/windows.prayedStatusAt`). It normally cannot happen, because
      // the tap is only offered while the window is open; it happens when the tap races the
      // window shutting, which for Fajr is a real risk — sunrise is a hard edge people log
      // against. Clock read here rather than `today.asOf` deliberately: this is an event
      // handler, not a render, and the question is what time it is at the instant of the tap.
      //
      // **Only the tap that MARKS is rewritten.** The same face also carries the undo, and
      // `meta.clears` is how the seal says which of the two just happened. "I did not pray this
      // after all" never becomes a claim about lateness — and rewriting it would not merely
      // mislabel the log, it would swallow the gesture: `toggleStatus` clears only when the
      // status it is handed matches the stored one, so `late` against a stored `prayed` SETS
      // late instead of clearing, leaving a mark the same gesture can no longer remove (a `late`
      // row is not direct-pick).
      //
      // The deliberate pill is NOT rewritten either: it offers ✓ Prayed and 🕐 Late in words,
      // and someone logging a Fajr they prayed on time but only opened the app at nine must be
      // able to say so. Rewriting their pick would also make the pill's own Late option dead
      // (D71).
      //
      // While TRAVELLING the deadline is the jam' partner's instead (Dhuhr's runs to Maghrib,
      // Maghrib's to the next Fajr), because praying a combined pair there is praying it on time —
      // see `domain/travel`. This is the only thing travel mode changes about marking, and it can
      // only ever forgive lateness, never invent it.
      const resolved =
        meta.direct && status === 'prayed' && !meta.clears
          ? traveling
            ? travelPrayedStatusAt(today.windows, prayer, Date.now())
            : prayedStatusAt(
                today.windows.find((candidate) => candidate.prayer === prayer),
                Date.now()
              )
          : status;
      // `toggleStatus` IS the seal's semantics: picking the status a prayer already has clears it.
      // The confirm lands with the tap rather than after the write: a refused write is rare (and
      // logged), and the reward of the tap is the whole point of the screen. Taking a mark back
      // off is not a reward, so the undo gets the lighter tick instead of Success.
      (meta.clears ? tickHaptic : markHaptic)();
      toggleStatus(day, prayer, resolved);
    },
    [day, toggleStatus, toggleSimpleStatus, simple, closeSeal, today.windows, traveling]
  );

  // One pair of callbacks per prayer, minted only when the handlers above change. Written inline
  // in the row loop they were new closures on every render, so a single tap handed all five rows
  // — and their seals — fresh props and re-rendered every one of them (seven translations and
  // four animated styles per seal) to change one. With these, and `PrayerRow` memoised, only the
  // tapped row and the one that becomes NEXT re-render.
  const rowHandlers = useMemo(() => {
    const handlers = {} as Record<
      Prayer,
      { toggleOpen: () => void; pick: (status: LoggableStatus, meta: SealPickMeta) => void }
    >;
    for (const prayer of PRAYERS) {
      handlers[prayer] = {
        toggleOpen: () => handleToggleOpen(prayer),
        pick: (status, meta) => handlePick(prayer, status, meta),
      };
    }
    return handlers;
  }, [handleToggleOpen, handlePick]);

  const handleLocationAction = useCallback(() => {
    if (locationStatus === 'denied' && !canAskAgain) {
      // `Promise.resolve` because a platform that returns nothing here must not throw.
      void Promise.resolve(Linking.openSettings()).catch(() => {
        // Some OEM builds refuse to open the settings screen; the copy already explains the
        // manual route, so a failure here is silent rather than an error the user cannot act on.
      });
      return;
    }
    void requestAndResolve();
  }, [locationStatus, canAskAgain, requestAndResolve]);

  const promptState: LocationPromptState =
    locationStatus === 'denied'
      ? canAskAgain
        ? 'denied'
        : 'blocked'
      : locationStatus === 'error'
        ? 'error'
        : 'idle';

  // One condition, narrowed by TypeScript rather than by a boolean, so the rows can only be
  // rendered when every piece they need actually exists.
  const ready = times !== null && day !== null && record !== null;

  // The three row tiers and the hero's framing all hang off one question: which prayer's window
  // contains now, and is it logged? (spec-today-interaction, owner amendment.) `isCurrent` is
  // already false on exempt days and when no window covers the instant, so `currentPrayer` is
  // null exactly when nothing is due.
  const currentPrayer = PRAYERS.find((prayer) => today.isCurrent(prayer)) ?? null;
  const currentStatus =
    currentPrayer !== null && record !== null ? record.statuses[currentPrayer] : null;

  // The NEXT tier — the subtle secondary highlight on the upcoming row — arrives only once the
  // current prayer is logged (before that there is exactly one emphasised row), and stands in
  // when no window contains now at all (degenerate extreme-latitude days), where next is the
  // only anchor left. Never on an exempt day: nothing is due, so nothing is "next up". After
  // Isha, `isNext` is false for every row of this day (next is tomorrow's Fajr), so no row —
  // least of all the already-past Fajr — takes it.
  const nextUpArrived =
    !today.isExempt &&
    (currentPrayer === null || (currentStatus !== null && currentStatus !== 'unlogged'));

  // The hero's framing. DUE speaks the current prayer and its deadline — the same instant the
  // WAITING countdown targets, since a window ends exactly when the next prayer starts. Fajr is
  // the one exception: its real deadline is sunrise, so DUE counts to sunrise while it is ahead
  // and falls back to PLAIN after ("left to pray" would overstate the time, "until Dhuhr" would
  // misstate fiqh — the row's caption says just "now" for the same reason). WAITING covers
  // `prayed` and `late` (both mean the prayer was performed); a `missed` edited in from History,
  // exempt days and no-current-window all fall to PLAIN, which never claims "prayed".
  const currentWindow =
    currentPrayer === null
      ? undefined
      : today.windows.find((candidate) => candidate.prayer === currentPrayer);
  const dueTarget =
    currentWindow === undefined || currentStatus !== 'unlogged'
      ? null
      : currentPrayer !== 'fajr'
        ? currentWindow.end
        : times !== null && times.times.sunrise.getTime() > today.asOf
          ? times.times.sunrise
          : null;
  const heroMode: HeroMode =
    dueTarget !== null
      ? 'due'
      : currentStatus === 'prayed' || currentStatus === 'late'
        ? 'waiting'
        : 'plain';
  const heroPrayer = heroMode === 'due' && currentPrayer !== null ? currentPrayer : null;

  // On Friday the midday prayer is named "Jumu'ah · Dhuhr" (D75) — a DISPLAY name only: `prayer`
  // stays `dhuhr` for the reminder pill, the seal, the log and every aggregate. Which Friday is
  // decided by the PRAYER DAY each occurrence belongs to, so the hero's two subjects are keyed
  // separately: the current prayer belongs to `day`, the next one to `today.next.day` — which
  // after Isha on a Thursday is already Friday, and after Isha on a Friday no longer is.
  const heroNameKey =
    day === null || today.next === null
      ? null
      : heroPrayer !== null
        ? prayerNameKey(heroPrayer, day)
        : prayerNameKey(today.next.prayer, today.next.day);
  const reminderNameKey =
    today.next === null ? null : prayerNameKey(today.next.prayer, today.next.day);
  const prayedNameKey =
    day === null || currentPrayer === null ? null : prayerNameKey(currentPrayer, day);

  const scrollShell = {
    paddingTop: insets.top + spacing.xxl,
    paddingHorizontal: spacing.xl,
    // Enough room under the last row that the tab bar never crowds it on a short device.
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  };

  /**
   * The reward loop, in one piece: header, hero, the five rows, yesterday, qada, footer.
   *
   * Hoisted into a variable rather than a component so the tree it renders is byte-identical at
   * every width — a JSX variable introduces no component boundary, no new state, and no
   * reordering. At expanded width it becomes the leading pane; below that it is the whole screen,
   * exactly as before (D124). Nothing about it changes with the layout, on purpose: this is the
   * thing the app is for, and it does not get rearranged to make room for a dashboard.
   */
  const rewardLoop = (
    <>
      <TodayHeader
        testID="today-header"
        day={day ?? undefined}
        // Two taps from here to "excused from today", from the very first launch — no trip
        // to Settings, and nothing on the header but three dots that name nothing.
        onOverflowPress={() => {
          setSheet('overflow');
        }}
      />

      {today.next !== null && ready ? (
        <CountdownHero
          testID="countdown-hero"
          // DUE names the current prayer and counts to its deadline; WAITING and PLAIN name
          // the next prayer. Except for Fajr (sunrise), the two targets are the same instant.
          prayer={heroPrayer ?? today.next.prayer}
          name={t(`prayers.${heroNameKey ?? heroPrayer ?? today.next.prayer}`)}
          arabicName={t(`prayers.arabic.${heroNameKey ?? heroPrayer ?? today.next.prayer}`)}
          time={dueTarget ?? today.next.at}
          msRemaining={
            dueTarget !== null
              ? Math.max(0, dueTarget.getTime() - today.asOf)
              : (today.msRemaining ?? 0)
          }
          mode={heroMode}
          // Who else has prayed the prayer the hero is naming. The slot is held open whenever buddy
          // mode is on, so the three hero modes stay layout-identical (D67) and nobody who has not
          // turned the feature on loses a point of hero height.
          reserveBuddies={buddyMode}
          buddies={buddiesByPrayer[heroPrayer ?? today.next.prayer]}
          // The pill is present in every mode (a pill that comes and goes is jitter) and
          // always belongs to the NEXT prayer — the one whose arrival ends the countdown.
          reminderPrayer={today.next.prayer}
          reminderName={t(`prayers.${reminderNameKey ?? today.next.prayer}`)}
          // WAITING names its subject — "Isha prayed · next in …" — so "prayed" can never
          // be read as describing the (next) prayer named above it.
          prayedName={
            heroMode === 'waiting' && prayedNameKey !== null
              ? t(`prayers.${prayedNameKey}`)
              : undefined
          }
          // On an exempt day the plan is silent; "Reminder on" would be a lie. The banner's
          // "Reminders are paused." replaces it (spec-exemption §3).
          showReminder={!today.isExempt}
        />
      ) : today.error !== null ? (
        <Card testID="times-error" variant="bright" border="mid" style={{ padding: spacing.lg }}>
          <AppText variant="caption" tone="header" style={{ textAlign: 'center' }}>
            {t('today.timesError')}
          </AppText>
        </Card>
      ) : (
        <LocationPromptCard
          state={promptState}
          busy={locationStatus === 'requesting'}
          onPress={handleLocationAction}
        />
      )}

      {/* The ongoing-period banner: record, end control and forgotten-period defence in one
              quiet card, directly under the hero and above the rows (spec-exemption §3). It is
              deliberately not dismissible — dismissing it would recreate the silent-forever-
              exempt trap it exists to prevent. */}
      {ongoingPeriod !== null && day !== null ? (
        <ExemptionBanner
          testID="exemption-banner"
          sinceDay={ongoingPeriod.startDay}
          untilDay={ongoingPeriod.endDay}
          today={day}
          onEnd={() => {
            setSheet('end');
          }}
        />
      ) : null}

      {/* Travel's own banner, under exemption's when both are on (a woman may travel during
              her period). Exemption first because it is the more consequential state — it decides
              whether the prayers are owed at all — and travel is then a note about something that
              stays true underneath it. No precedence logic is needed: the rows are already inert
              under exemption, so travel's marking rule never gets a chance to apply. */}
      {traveling && day !== null && travel.startDay !== null ? (
        <TravelBanner
          testID="travel-banner"
          sinceDay={travel.startDay}
          untilDay={travel.endDay}
          today={day}
          onEnd={handleEndTravel}
        />
      ) : null}

      {/* The clock/zone mismatch, said HERE rather than only two screens deep in Settings.
              When the chosen city's zone and the phone's clock disagree by more than a few hours,
              every time on this screen looks wrong — Fajr at 3 pm, Dhuhr near midnight — and the
              honest explanation was reachable only by someone who already suspected the cause and
              went looking for it. The owner hit exactly this (a simulator defaulting to Cupertino
              while the phone ran on Cairo time) and reasonably concluded the app ignored the clock.
              The component gates itself: it renders nothing until the difference passes its own
              three-hour threshold, which is wide enough that ordinary political offsets stay silent. */}
      <ClockZoneNote testID="today-clock-zone" location={location} />

      {/* `ready` rather than `times && record`: identical at runtime (day, times, next and
              record all come from one `usePrayerDay` snapshot, so they are null together), but it
              also narrows `day`, which the rows now need to name Friday's Dhuhr. */}
      {ready ? (
        <View testID="prayer-rows" style={{ gap: ROW_GAP }}>
          {PRAYERS.map((prayer) => {
            const isNext = today.isNext(prayer);
            const isCurrent = today.isCurrent(prayer);
            const status = record.statuses[prayer];
            // The currently-due prayer's seal is a single gesture — tap marks it prayed, tap
            // again undoes. Late/Missed are not offered because a prayer whose window is open
            // cannot yet be late or missed; a `late`/`missed` put there by editing today in
            // History keeps the deliberate pill.
            // In simple mode EVERY started prayer is one tap (prayed ↔ not marked, D192): there is
            // no pill to open, because there is nothing else to choose.
            const directPick = simple
              ? today.hasStarted(prayer) && !today.isExempt
              : isCurrent && (status === 'unlogged' || status === 'prayed') && !today.isExempt;
            const window = today.windows.find((candidate) => candidate.prayer === prayer);
            // Display name only — `prayer` (the identity the seal logs under) is untouched.
            const nameKey = prayerNameKey(prayer, day);
            return (
              <Fragment key={prayer}>
                <PrayerRow
                  testID={`prayer-row-${prayer}`}
                  prayer={prayer}
                  name={t(`prayers.${nameKey}`)}
                  arabicName={t(`prayers.arabic.${nameKey}`)}
                  time={times.times[prayer]}
                  status={status}
                  isNext={isNext}
                  isCurrent={isCurrent}
                  isNextUp={isNext && nextUpArrived}
                  isFuture={!today.hasStarted(prayer)}
                  msRemaining={isNext ? (today.msRemaining ?? undefined) : undefined}
                  windowEnd={isCurrent ? window?.end : undefined}
                  // Fajr's deadline caption names sunrise only while it is still ahead —
                  // measured on the hook's boundary clock, never a clock read in render.
                  sunrise={
                    isCurrent && prayer === 'fajr' && times.times.sunrise.getTime() > today.asOf
                      ? times.times.sunrise
                      : undefined
                  }
                  // On an exempt day every seal is inert — the kept `prayed`/`late` marks of
                  // the period's first day included. Their pill opening would offer edits the
                  // store refuses (writes are blocked under an exemption), and a tap that
                  // could clear a mark she cannot re-log would be a trap.
                  disabled={today.isExempt ? true : undefined}
                  directPick={directPick}
                  simple={simple}
                  // Who else has marked this prayer today (D174). Empty for everyone who has not
                  // turned buddy mode on, which is the overwhelming majority and costs them one
                  // reference comparison.
                  buddies={buddiesByPrayer[prayer]}
                  isOpen={openPrayer === prayer}
                  onToggleOpen={rowHandlers[prayer].toggleOpen}
                  onPick={rowHandlers[prayer].pick}
                />
                {/* Sunrise sits between the Fajr and Dhuhr rows because that is where it
                      falls: it closes Fajr's window (`domain/windows.ts`) and opens the
                      morning. A hairline with the sun on it — no card, no seal, nothing to
                      tap — so it can never read as a sixth prayer. */}
                {prayer === 'fajr' ? (
                  <SunriseMarker testID="sunrise-marker" time={times.times.sunrise} />
                ) : null}
              </Fragment>
            );
          })}
        </View>
      ) : null}

      {/* Yesterday, one tap away — only for people who log, only while something of
              yesterday's is still unmarked. See the gating note above. */}
      <YesterdayCard
        record={yesterdayRecord}
        show={loggerGate}
        onPress={() => {
          setYesterdayOpen(true);
        }}
      />

      {/* Only ever on screen when something is owed — the card hides itself at zero (§7). */}
      <QadaCard onPress={() => router.push('/qada')} />

      {ready ? (
        <AppText variant="hint" testID="today-footer" style={{ textAlign: 'center' }}>
          {today.isExempt ? t('today.exemptNote') : t('today.footerHint')}
        </AppText>
      ) : null}
    </>
  );

  /** Everything presented over the screen rather than in it. Unchanged by the layout. */
  const sheets = (
    <>
      {/* The ⋯ menu and the sheets behind it (§2b, §4a; D117), one at a time. */}
      {day !== null ? (
        <>
          <TodayOverflowSheet
            visible={sheet === 'overflow'}
            hasOngoingPeriod={ongoingPeriod !== null}
            modeEnabled={exemptionEnabled}
            traveling={traveling}
            onBegin={() => {
              setSheet('begin');
            }}
            onEndPeriod={() => {
              setSheet('end');
            }}
            onBeginTravel={() => {
              setSheet('travelBegin');
            }}
            onEndTravel={handleEndTravel}
            onOpenSettings={() => {
              setSheet('none');
              router.push('/settings/exemption');
            }}
            onClose={closeSheetIf.overflow}
          />
          <BeginExemptionSheet
            visible={sheet === 'begin'}
            today={day}
            onBegin={handleBeginExemption}
            onClose={closeSheetIf.begin}
          />
          <BeginTravelSheet
            visible={sheet === 'travelBegin'}
            today={day}
            onBegin={handleBeginTravel}
            onClose={closeSheetIf.travelBegin}
          />
          {ongoingPeriod !== null ? (
            <EndExemptionSheet
              visible={sheet === 'end'}
              today={day}
              startDay={ongoingPeriod.startDay}
              onEnd={handleEndExemption}
              onClose={closeSheetIf.end}
            />
          ) : null}
        </>
      ) : null}

      {/* Yesterday's day sheet — History's own DayDetail, opened from the card above. It reads
          the record live from the store (refreshed by every write), so a mark made here updates
          both the sheet and the card underneath it in the same render. */}
      <DayDetail
        testID="yesterday-detail"
        day={yesterdayOpen ? yesterday : null}
        record={yesterdayRecord}
        times={yesterdayTimes}
        onClose={closeYesterday}
        onPick={handleYesterdayPick}
        onToggleMadeUp={handleYesterdayMadeUp}
      />
    </>
  );

  // Expanded: the reward loop keeps the leading pane, and the trailing one becomes the dashboard
  // the owner asked for — this month, the live qibla dial, and the record (D124).
  if (isExpanded) {
    return (
      <PaperBackground>
        {/* The boundary spans both panes, so a tap on the glance pane's bare paper closes an open
            pill too — the correct generalisation of "anywhere outside the pill". */}
        <SealDismissBoundary testID="today-seal-dismiss" style={{ flex: 1 }}>
          <TwoPaneLayout
            testID="today-panes"
            start={
              <ScrollView
                testID="today-scroll"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ ...scrollShell, ...contentClampStyle }}
              >
                {rewardLoop}
              </ScrollView>
            }
            end={
              <ScrollView
                testID="today-glance-scroll"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ ...scrollShell, ...contentClampStyle }}
              >
                <TodayGlancePane />
              </ScrollView>
            }
          />
        </SealDismissBoundary>
        {sheets}
      </PaperBackground>
    );
  }

  return (
    <PaperBackground>
      {/* A tap anywhere on the screen outside an open seal pill closes it without logging —
          "I opened the choices and decided not to change it" must cost nothing. Pass-through:
          the same tap still scrolls, or opens the row it was aimed at (see SealDismiss). */}
      <SealDismissBoundary testID="today-seal-dismiss" style={{ flex: 1 }}>
        <ScrollView
          testID="today-scroll"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ ...scrollShell, ...contentClampPadding(spacing.xl) }}
        >
          {rewardLoop}
        </ScrollView>
      </SealDismissBoundary>
      {sheets}
    </PaperBackground>
  );
}
