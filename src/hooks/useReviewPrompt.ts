/**
 * The review-prompt observer — the one place the app watches for a delight moment.
 *
 * PRODUCT_SPEC §13, decision D28. `services/review.ts` owns the *policy* (may we prompt?); this
 * hook owns the *observation* (has something worth prompting about just happened?) and the
 * session lifecycle. Mount it exactly once, from the root layout, above the tabs.
 *
 * ## What it watches
 *
 * | Signal | Source | Effect |
 * |---|---|---|
 * | streak reached 7 / 30 | `trackingStore.streakSummary` → `domain/streaks.streakMilestone` | offers `streakMilestone` |
 * | first fully-logged week | the last N **closed** days from `trackingStore.loadRange` | offers `firstCompleteWeek` |
 * | setup finished | a location exists **and** a reminder tap was observed | offers `setupSuccess` |
 * | streak got shorter | the same streak value going down | records a break — suppresses prompting |
 * | a log was cleared back to `unlogged` | `trackingStore.dayRecords` diff | records a mis-tap correction |
 * | calculation settings changed | `settingsStore.calculation` | records "times adjusted" |
 * | a reminder was tapped | `services/notifications.observeTaps` | proves a reminder was delivered |
 *
 * The two facts the app cannot derive are passed in: {@link UseReviewPromptOptions.isAdhanPlaying}
 * (owned by the adhan playback layer) and the clock.
 *
 * ## Why it waits before asking
 *
 * A trigger does not prompt: it *arms* a timer for `settleDelayMs`, and the policy is re-evaluated
 * when the timer fires. That is what "after the moment has landed, never mid-interaction" means in
 * code — if the user has meanwhile tapped into a prayer window or started an adhan, the
 * re-evaluation blocks and nothing is spent. Leaving the app cancels the timer outright rather
 * than re-evaluating it: `requestReview()` into a backgrounded app shows nothing and still spends
 * an attempt. The timer is cleared on unmount and on anything other than `active`; both are
 * covered in `useReviewPrompt.test.ts` under "the settle timer".
 *
 * ## Where the state lives
 *
 * MMKV, through `stores/settingsStore.createMmkvSettingsStorage()` under its own
 * `services/review.REVIEW_STORAGE_KEY` key. The MMKV import is only legal inside `stores/`
 * (`src/__tests__/architecture.test.ts`), and a hook may import a store while a service may not —
 * so the binding happens here rather than in `services/review.ts`, which stays storage-agnostic.
 *
 * ## Never wired to a button
 *
 * Settings → About's "Rate the app" row is a store deep link and must stay one. Nothing in this
 * file is reachable from a tap.
 *
 * ## Why it never runs inside the tap
 *
 * This hook is mounted in the **root layout**, so anything it does on a render or in a synchronous
 * effect is charged to the user's seal tap: a log write bumps the tracking store's `revision`, and
 * a render-time `useTrackingStore((s) => s.revision)` here re-rendered the whole app and then ran
 * a full-history streak scan plus a seven-day SQL read *inside the tap's commit*, before the
 * animation could start. Nothing this hook observes is urgent — it decides whether to ask for a
 * rating *later* — so it watches the store through `subscribe` instead of a selector, and the
 * scans run behind {@link SCAN_DEBOUNCE_MS}, i.e. once the burst of writes has settled — and the
 * first one of a process behind {@link SCAN_STARTUP_DELAY_MS}, clear of the first tap. The one
 * thing kept synchronous is the mis-tap diff, which is a handful of object reads over the
 * already-cached day records: coalescing it would hide the very case it exists for, a log tapped
 * and untapped in the same second.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { REVIEW_TRIGGERS, type ReviewTriggerConfig } from '@/config/reviewTriggers';
import { addDays } from '@/domain/dates';
import { toHijri } from '@/domain/hijri';
import { getCurrentPrayerDay, getPrayerWindows } from '@/domain/prayerTimes';
import { streakMilestone } from '@/domain/streaks';
import type { CalculationSettings, DayRecord, PrayerDay } from '@/domain/types';
import { getNotificationService } from '@/services/notifications';
import {
  isAdhanPlaying as isAdhanPreviewPlaying,
  observeAdhanStopped,
} from '@/services/adhanPlayback';
import { hasSessionMoment, noteSessionMoment } from '@/services/supportMoments';
import {
  createExpoStoreReviewAdapter,
  createReviewService,
  isFullyCompleteWeek,
  type ReviewMoment,
  type ReviewOutcome,
  type ReviewService,
  type ReviewTrigger,
} from '@/services/review';
import { createMmkvSettingsStorage, useSettingsStore } from '@/stores/settingsStore';
import { useTrackingStore } from '@/stores/trackingStore';

// ---------------------------------------------------------------------------
// The app-wide service
// ---------------------------------------------------------------------------

let defaultService: ReviewService | null = null;

/**
 * The app-wide {@link ReviewService}, built on first use so no native module and no MMKV instance
 * is touched at import time.
 *
 * @returns The singleton, persisted to the settings MMKV instance under its own key.
 */
export function getReviewService(): ReviewService {
  defaultService ??= createReviewService({
    adapter: createExpoStoreReviewAdapter(),
    storage: createMmkvSettingsStorage(),
  });
  return defaultService;
}

/**
 * Replaces (or, with `null`, clears) the singleton. Tests only — the same seam
 * `services/notifications.setNotificationService` provides.
 *
 * @param service - The service to install, or `null` to rebuild on next use.
 */
export function setReviewService(service: ReviewService | null): void {
  defaultService = service;
}

// ---------------------------------------------------------------------------
// Imperative signals
// ---------------------------------------------------------------------------

/**
 * Signals the UI reports by hand, for moments this hook cannot see from store state.
 *
 * Safe to call from anywhere at any time — each is a cheap MMKV write and none of them can
 * prompt. Calling one only ever makes a prompt *less* likely.
 */
export const reviewSignals = {
  /** Adhan audio finished. Opens the quiet period in `config/reviewTriggers.quietAfterAdhanMs`. */
  adhanFinished(): void {
    getReviewService().noteAdhanFinished();
  },
  /** The user changed prayer times, offsets or method — the loudest dissatisfaction signal. */
  timesAdjusted(): void {
    getReviewService().noteTimesAdjusted();
  },
  /** The user undid a log they did not mean to make. */
  mistapCorrection(): void {
    getReviewService().noteMistapCorrection();
  },
  /** A reminder was confirmed delivered. */
  reminderDelivered(): void {
    getReviewService().noteReminderDelivered();
  },
} as const;

// ---------------------------------------------------------------------------
// Options and result
// ---------------------------------------------------------------------------

/** Construction-time options; every one of them exists so a test can drive the hook. */
export interface UseReviewPromptOptions {
  /** `false` mounts the hook inert — no session, no listeners, no timer. Defaults to `true`. */
  enabled?: boolean;
  /** The service to drive. Defaults to {@link getReviewService}. */
  service?: ReviewService;
  /** The policy, for the settle delay. Defaults to `config/reviewTriggers.REVIEW_TRIGGERS`. */
  config?: ReviewTriggerConfig;
  /** Live probe for "adhan audio is sounding right now". Defaults to "never". */
  isAdhanPlaying?: () => boolean;
  /** Epoch-ms clock. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * How long the first scan after mount waits. Defaults to {@link SCAN_STARTUP_DELAY_MS}; `0`
   * starts the ordinary debounce at once, which is what most tests use.
   */
  startupScanDelayMs?: number;
}

/** What the hook reports back, for a debug surface. Rendering it is optional. */
export interface ReviewPromptStatus {
  /** The moment currently waiting out its settle delay, or `null`. */
  pending: ReviewTrigger | null;
  /** The result of the last {@link ReviewService.request}, or `null` if none has run. */
  lastOutcome: ReviewOutcome | null;
}

// ---------------------------------------------------------------------------
// Trigger detection
// ---------------------------------------------------------------------------

/**
 * Every trigger that currently applies, best moment first.
 *
 * A **list**, not a single winner, because the best moment may already have been spent: a user who
 * was prompted at their 30-day streak and completes their first perfect week a fortnight later
 * should still be offered the week. Returning only the top candidate would let a used-up trigger
 * mask a live one forever. The caller walks the list and takes the first the policy accepts.
 *
 * Order: streak milestones beat the complete week (the bigger number is the better moment), and
 * setup success is last, being the least emotional of the three.
 *
 * @param facts - Everything observed about the current tracking state.
 * @returns Applicable triggers, most compelling first; possibly empty.
 */
function detectTriggers(facts: {
  streak: number;
  completeWeek: boolean;
  setupReady: boolean;
  steadyUseReady: boolean;
  milestones: readonly number[];
}): ReviewTrigger[] {
  const triggers: ReviewTrigger[] = [];
  const milestone = streakMilestone(facts.streak);
  if (milestone !== null && facts.milestones.includes(milestone)) {
    triggers.push({ kind: 'streakMilestone', milestone });
  }
  if (facts.completeWeek) triggers.push({ kind: 'firstCompleteWeek' });
  if (facts.setupReady) triggers.push({ kind: 'setupSuccess' });
  // Last, always. The caller takes the first candidate the policy allows, so order is precedence,
  // and `steadyUse` is the weakest moment in the set — "it has kept working for you" rather than
  // "look what you just did". It exists so the person who never logs is reachable at all (D89),
  // not to be preferred over a real milestone.
  if (facts.steadyUseReady) triggers.push({ kind: 'steadyUse' });
  return triggers;
}

// ---------------------------------------------------------------------------
// Deferral
// ---------------------------------------------------------------------------

/**
 * How long the observer waits for the tracking store to settle before scanning it.
 *
 * Long enough to coalesce a burst — hydration, Today's `loadDay`, yesterday's, the notification
 * plan's five day reads, and a seal tap's two writes all land inside a second — and to let the
 * tap's own animation start first. Nothing here is time-critical: the scans only decide whether a
 * rating *may* be asked for after a further settle delay.
 *
 * A plain trailing debounce rather than `InteractionManager.runAfterInteractions`, which reads
 * like the natural fit and is deprecated as of React Native 0.86 (it warns on first access). It
 * would also buy little here: the animations this must not tread on are Reanimated's, which run
 * on the UI thread and register no interaction handle.
 */
export const SCAN_DEBOUNCE_MS = 800;

/**
 * How long the **first** scan of a process waits.
 *
 * The debounce above is right for a store change mid-session; it is wrong for mount. Hydration
 * lands within the first few hundred milliseconds of a cold start, and a 300 ms debounce put this
 * hook's full-history streak read and seven-day SQL read on the JS thread about 1.7 s *before*
 * the notification and widget syncs that D159 deliberately moved out of the first-tap window —
 * making it the heaviest thing left in that window. Same wait as those two controllers, for the
 * same reason; nothing here is time-critical. A store change inside the wait is absorbed by the
 * pending startup scan, which reads the store when it runs.
 */
export const SCAN_STARTUP_DELAY_MS = 2000;

/** Whether a status map holds any log at all — used by the mis-tap diff. */
function loggedCount(record: DayRecord): number {
  return Object.values(record.statuses).filter((status) => status !== 'unlogged').length;
}

/**
 * Whether the day cache went *backwards* — a prayer that had a log now has none.
 *
 * That is the seal's clear-to-unlogged path, i.e. "I did not mean to tap that", which
 * PRODUCT_SPEC §13 lists as a hard exclusion. Days that appear or disappear from the cache
 * (History paging) are ignored; only a day present in both snapshots can regress.
 *
 * @param before - The previous `dayRecords` cache.
 * @param after - The current one.
 * @returns `true` when at least one day lost a log.
 */
function detectMistap(
  before: Record<PrayerDay, DayRecord>,
  after: Record<PrayerDay, DayRecord>
): boolean {
  for (const [day, next] of Object.entries(after)) {
    const previous = before[day];
    if (previous === undefined) continue;
    if (loggedCount(next) < loggedCount(previous)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * Observes the app for review-worthy moments and, at most once per session, asks the OS to show
 * its native rating sheet.
 *
 * Mount once, from `app/_layout.tsx`. Mounting it twice would open two sessions and double the
 * session counter; it is not a per-screen hook.
 *
 * @param options - See {@link UseReviewPromptOptions}.
 * @returns {@link ReviewPromptStatus} — purely informational; nothing needs to render it.
 */
export function useReviewPrompt(options: UseReviewPromptOptions = {}): ReviewPromptStatus {
  const {
    enabled = true,
    config = REVIEW_TRIGGERS,
    isAdhanPlaying = isAdhanPreviewPlaying,
    now: nowOption,
  } = options;

  const service = useMemo(() => options.service ?? getReviewService(), [options.service]);
  const startupScanDelayMs = options.startupScanDelayMs ?? SCAN_STARTUP_DELAY_MS;

  // The two injected callbacks, kept in one box so effects can read the newest values without
  // listing them as dependencies (which would re-arm the settle timer on every render). Declared
  // as the FIRST effect so it has already refreshed the box before any effect below runs.
  const latest = useRef({ now: nowOption, isAdhanPlaying });
  useEffect(() => {
    latest.current = { now: nowOption, isAdhanPlaying };
  });

  const [status, setStatus] = useState<ReviewPromptStatus>({ pending: null, lastOutcome: null });

  // Settings only. The tracking store is deliberately NOT read with a selector: this hook sits in
  // the root layout, so `useTrackingStore((s) => s.revision)` re-rendered the entire app on every
  // logged prayer. It is watched through `subscribe` further down instead.
  const location = useSettingsStore((s) => s.location);
  const calculation = useSettingsStore((s) => s.calculation);
  const streakMode = useSettingsStore((s) => s.streakMode);

  // -- session lifecycle ------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    service.startSession(latest.current.now?.());

    const onAppState = (state: AppStateStatus): void => {
      // Only `background` closes the session: iOS reports `inactive` for the app switcher and
      // Control Center, where the app has not gone anywhere. Marking those clean would make the
      // unclean-shutdown signal fire on genuinely abrupt exits only by accident.
      if (state === 'background') service.endSession();
    };
    const subscription: NativeEventSubscription = AppState.addEventListener('change', onAppState);
    return () => {
      subscription.remove();
    };
  }, [enabled, service]);

  // -- the adhan quiet period -------------------------------------------------
  // Self-wiring on purpose. This used to need a mount site to pass `isAdhanPlaying` and some
  // screen to call `reviewSignals.adhanFinished()`, and because neither happened the exclusion
  // was dead for as long as it existed. Registering here means the only way to lose it again is
  // to unmount this hook, which would take the whole feature with it (D89).
  useEffect(() => {
    if (!enabled) return;
    return observeAdhanStopped(() => {
      service.noteAdhanFinished(latest.current.now?.());
    });
  }, [enabled, service]);

  // -- "times are on screen" --------------------------------------------------
  useEffect(() => {
    if (!enabled || location === null) return;
    service.noteTimesShown(latest.current.now?.());
  }, [enabled, location, service]);

  // -- "a reminder was confirmed delivered" -----------------------------------
  useEffect(() => {
    if (!enabled) return;
    // A tap on one of our notifications is the only delivery confirmation either platform gives
    // us: `expo-notifications` reports what was *scheduled*, never what the OS actually showed.
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = getNotificationService().observeTaps(() => {
        service.noteReminderDelivered(latest.current.now?.());
      });
    } catch {
      // No notification service in this environment; setup success simply never completes.
    }
    return () => {
      unsubscribe?.();
    };
  }, [enabled, service]);

  // -- "the user adjusted the times" ------------------------------------------
  const calculationRef = useRef(calculation);
  useEffect(() => {
    if (!enabled) return;
    if (calculationRef.current === calculation) return;
    calculationRef.current = calculation;
    service.noteTimesAdjusted(latest.current.now?.());
  }, [enabled, calculation, service]);

  // -- the observer: watch cheaply, scan late ---------------------------------
  const streakRef = useRef<number | null>(null);
  const recordsRef = useRef<Record<PrayerDay, DayRecord>>({});
  const modeRef = useRef(streakMode);
  useEffect(() => {
    if (!enabled) return;

    const now = (): number => latest.current.now?.() ?? Date.now();

    let disposed = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    /** The moment currently waiting out its settle delay, and how to let go of it. */
    let armed: { cancel: () => void } | null = null;

    const clearPending = (): void => {
      setStatus((previous) =>
        previous.pending === null ? previous : { ...previous, pending: null }
      );
    };

    const disarm = (): void => {
      armed?.cancel();
      armed = null;
    };

    /**
     * Arms the settle delay for `trigger`. A trigger does not prompt — it waits, and the policy
     * is re-evaluated when the timer fires (see the module header).
     */
    const arm = (trigger: ReviewTrigger, momentAt: number, today: PrayerDay): void => {
      // The request is asynchronous and the tree may go away underneath it; the flag is what
      // keeps a resolved promise from calling `setStatus` on an unmounted hook.
      let cancelled = false;
      const timeout = setTimeout(
        () => {
          if (cancelled) return;
          const at = now();
          const moment: ReviewMoment = {
            now: at,
            momentAt,
            inPrayerWindow: isPrayingNow(at, location, calculation, config.prayerWindowMinutes),
            adhanPlaying: latest.current.isAdhanPlaying?.() ?? false,
            setupComplete: location !== null,
            alreadyGaveThisSession: hasSessionMoment('tipPrompt'),
            hijriToday: safeHijri(today, calculation.hijriOffset),
            hijriTomorrow: safeHijri(addDays(today, 1), calculation.hijriOffset),
          };
          void service.request(trigger, moment).then((outcome) => {
            // D29: the tip jar must never appear in a session that already asked for a review.
            // `services/supportMoments` is the one-way seam between the two asks; recording the
            // moment here rather than inside the service keeps `services/review.ts` unaware of
            // monetisation entirely.
            if (outcome.prompted) noteSessionMoment('reviewPrompt');
            if (!cancelled) setStatus({ pending: null, lastOutcome: outcome });
          });
        },
        Math.max(config.settleDelayMs, 0) + 1
      );

      // Leaving the app abandons the moment. Without this the timer keeps running while the app
      // is in the background and `requestReview()` is called into a screen nobody is looking at:
      // on iOS the OS shows nothing, but the attempt is still spent — one of this install's
      // three, and one of the OS's three per year — on a prompt the user never saw. Nothing is
      // recorded as fired, so the trigger stays live for a later session, which is the point.
      const onAppState = (next: AppStateStatus): void => {
        if (next === 'active') return;
        disarm();
        clearPending();
      };
      const leaving: NativeEventSubscription = AppState.addEventListener('change', onAppState);

      armed = {
        cancel: () => {
          cancelled = true;
          clearTimeout(timeout);
          leaving.remove();
        },
      };
    };

    /**
     * The seven closed days the complete-week trigger is judged over.
     *
     * `loadRange` is a SQL read *and* a store write, i.e. a full selector fan-out, so it is only
     * worth it for a day the cache is missing. On the path that matters — a seal tap, where the
     * week was already read at startup — every day is present and nothing is queried at all.
     */
    const weekRecords = (
      state: ReturnType<typeof useTrackingStore.getState>,
      end: PrayerDay
    ): readonly DayRecord[] => {
      const cached: DayRecord[] = [];
      for (let back = 0; back < config.completeWeekDays; back += 1) {
        const record = state.dayRecords[addDays(end, -back)];
        if (record === undefined) {
          return state.loadRange(addDays(end, -(config.completeWeekDays - 1)), end);
        }
        cached.push(record);
      }
      return cached;
    };

    /** The expensive half: a full-history streak read, and the week the triggers are read from. */
    const runScans = (): void => {
      const state = useTrackingStore.getState();
      if (!state.hydrated) return;

      // Switching soft <-> hard changes what the number *means*, so re-baseline rather than read
      // the drop as a break.
      if (modeRef.current !== streakMode) {
        modeRef.current = streakMode;
        streakRef.current = null;
      }
      const summary = state.streakSummary({ includeToday: false });
      const previousStreak = streakRef.current;
      streakRef.current = summary.current;
      if (previousStreak !== null && summary.current < previousStreak) {
        service.noteStreakBreak(now());
      }

      const today = state.todayDay();
      let completeWeek = false;
      try {
        // The window ends *yesterday*: today is still open (PRODUCT_SPEC §3) and cannot be judged.
        const end = addDays(today, -1);
        completeWeek = isFullyCompleteWeek(weekRecords(state, end), end, config.completeWeekDays);
      } catch {
        completeWeek = false;
      }

      const candidates = detectTriggers({
        streak: summary.current,
        completeWeek,
        setupReady: service.isSetupSuccessReady(),
        steadyUseReady: service.isSteadyUseReady(now()),
        milestones: config.streakMilestones,
      });

      const momentAt = now();
      const probe: ReviewMoment = {
        now: momentAt,
        momentAt,
        inPrayerWindow: false,
        adhanPlaying: false,
        setupComplete: location !== null,
        // D29 is symmetric: the tip jar checks `canOfferTipPrompt` before it puts itself forward,
        // and this is the other half — somebody who has just paid the developer must not then be
        // asked for stars in the same sitting. Read at both arm time and fire time, because a tip
        // left *during* the settle delay is exactly the case that matters.
        alreadyGaveThisSession: hasSessionMoment('tipPrompt'),
      };
      // A candidate whose *only* objection is "the moment has not settled" is worth waiting for;
      // anything else is refused now, cheaply, without arming a timer at all — and `explain`
      // records that refusal, so "we never noticed" and "we noticed and declined" stay
      // distinguishable in the log.
      const trigger =
        candidates.find((candidate) => {
          const verdict = service.explain(candidate, probe);
          return verdict.allowed || verdict.reason === 'notSettled';
        }) ?? null;

      // Whatever was waiting was armed against an older reading; this one replaces it.
      disarm();
      if (trigger === null) {
        clearPending();
        return;
      }
      setStatus((previous) => ({ ...previous, pending: trigger }));
      arm(trigger, momentAt, today);
    };

    let startupTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelScan = (): void => {
      if (debounce !== null) clearTimeout(debounce);
      debounce = null;
      if (startupTimer !== null) clearTimeout(startupTimer);
      startupTimer = null;
    };

    const requestScan = (): void => {
      if (disposed) return;
      // While the startup wait is pending it absorbs every trigger — the scan it ends in reads
      // the store when it runs (see SCAN_STARTUP_DELAY_MS).
      if (startupTimer !== null) return;
      if (debounce !== null) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        if (disposed) return;
        runScans();
      }, SCAN_DEBOUNCE_MS);
    };

    /**
     * The cheap half, run synchronously on every store change: has a log gone *backwards*?
     *
     * Deferring this one with the rest would coalesce a tap and its correction into a single
     * snapshot and see nothing — and "I did not mean to tap that", two taps a second apart, is
     * precisely the case it exists to catch. It is a few object reads over records already in
     * memory, and it writes only on the rare occasion it fires.
     */
    const observeRecords = (records: Record<PrayerDay, DayRecord>): void => {
      const before = recordsRef.current;
      if (records === before) return;
      recordsRef.current = records;
      if (detectMistap(before, records)) {
        service.noteMistapCorrection(now());
      }
    };

    // The baseline: a day can only be seen to regress against something already observed.
    const initial = useTrackingStore.getState();
    if (initial.hydrated) recordsRef.current = initial.dayRecords;
    if (startupScanDelayMs > 0) {
      startupTimer = setTimeout(() => {
        startupTimer = null;
        if (disposed) return;
        runScans();
      }, startupScanDelayMs);
    } else {
      requestScan();
    }

    const unsubscribe = useTrackingStore.subscribe((state, previous) => {
      if (disposed) return;
      if (state.hydrated) observeRecords(state.dayRecords);
      if (state.revision === previous.revision && state.hydrated === previous.hydrated) return;
      requestScan();
    });

    return () => {
      disposed = true;
      unsubscribe();
      cancelScan();
      disarm();
    };
  }, [enabled, streakMode, location, calculation, config, service, startupScanDelayMs]);

  return status;
}

// ---------------------------------------------------------------------------
// Small guarded helpers
// ---------------------------------------------------------------------------

/**
 * Whether the user is plausibly praying at `at`.
 *
 * **Not** "inside a `PrayerWindow`", which sounds like the same thing and is not: `getPrayerWindows`
 * covers nearly the whole prayer day (Dhuhr's window runs to Asr, Isha's to the next Fajr), so that
 * test is true for all but the morning between sunrise and Dhuhr and would all but silence the
 * feature. The state PRODUCT_SPEC §13 means is the stretch *just after* the adhan, so this asks
 * whether `at` falls in the first `windowMinutes` of any of today's five windows.
 *
 * Every failure mode answers **`true`** — no location, bad coordinates, a throwing engine. A
 * prompt is something we choose to do; when we cannot tell whether the user is mid-prayer, not
 * asking is free and asking is not.
 *
 * @param at - Epoch ms to classify.
 * @param location - The user's coordinates, or `null`.
 * @param calculation - Calculation settings, offsets included.
 * @param windowMinutes - How long a prayer keeps the user busy.
 * @returns `true` when a prompt must not appear.
 */
export function isPrayingNow(
  at: number,
  location: { latitude: number; longitude: number; countryCode?: string } | null,
  calculation: CalculationSettings,
  windowMinutes: number
): boolean {
  if (location === null) return true;
  const span = Math.max(windowMinutes, 0) * 60_000;
  try {
    const instant = new Date(at);
    const today = getCurrentPrayerDay(instant, location, calculation);
    return getPrayerWindows(today, location, calculation).some((window) => {
      const start = window.start.getTime();
      // Clamped to the window: a short window (polar latitudes, an aggressive offset) must not
      // let the busy period spill into the next prayer's.
      const busyUntil = Math.min(start + span, window.end.getTime());
      return start <= at && at < busyUntil;
    });
  } catch {
    return true;
  }
}

/** `toHijri`, but a malformed day yields `null` (which disables only the Ramadan check). */
function safeHijri(day: PrayerDay, offsetDays: number): ReturnType<typeof toHijri> | null {
  try {
    return toHijri(day, offsetDays);
  } catch {
    return null;
  }
}
