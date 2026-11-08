/**
 * The observer half of review prompting.
 *
 * `services/review.test.ts` proves the *policy* — what may be asked, and when. This file proves
 * the *wiring*: that the app actually notices the moments PRODUCT_SPEC §13 describes, that it
 * notices the dissatisfaction signals too, and that the settle timer it arms is always let go of.
 *
 * Three things here are easy to get wrong and expensive to discover on a device:
 *
 * 1. **A trigger nobody notices.** With no telemetry, a milestone the hook fails to see is
 *    indistinguishable from an OS that declined to show the sheet. So each of the four triggers
 *    is driven end to end into a real `ReviewService` over memory storage, and the assertion is
 *    on `adapter.requestCount` — the same single observable the real OS gives us.
 * 2. **A prompt that lands mid-interaction.** The hook arms a timer rather than prompting inline;
 *    the tests advance the clock deliberately and check that state observed *at fire time*
 *    (an adhan starting, a prayer coming in) still blocks.
 * 3. **A timer that outlives the hook.** `jest.getTimerCount()` after unmount is the guard, in the
 *    spirit of `src/__tests__/timerLeaks.test.tsx`.
 *
 * The tracking store is mocked — the real one opens SQLite — with a genuine zustand store, so the
 * hook's `subscribe` wiring behaves exactly as it does in the app. The settings store is real,
 * over an in-memory MMKV, because a real `setCalculation` reaching the "times adjusted" signal is
 * the point of that test.
 *
 * One thing every test here has to say out loud: the hook's scans are **deferred**. A store change
 * arms a `SCAN_DEBOUNCE_MS` timer and hands off to `InteractionManager`, so that a seal tap is
 * never charged for a full-history streak read; {@link flushScans} is what stands in for "the
 * user stopped tapping and the animation finished". The mis-tap diff is the exception and is
 * still observed synchronously, which is why those tests need no flush.
 */

import { act, cleanup, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { REVIEW_TRIGGERS, type ReviewTriggerConfig } from '@/config/reviewTriggers';
import { computeDayTimes } from '@/domain/prayerTimes';
import { PRAYERS, type AppSettings, type DayRecord, type PrayerStatus } from '@/domain/types';
import {
  createFakeReviewAdapter,
  createMemoryReviewStorage,
  createReviewService,
  type FakeReviewAdapter,
  type ReviewService,
} from '@/services/review';
import {
  hasSessionMoment,
  noteSessionMoment,
  resetSessionMoments,
} from '@/services/supportMoments';
import { DEFAULT_SETTINGS, useSettingsStore } from '@/stores/settingsStore';

import {
  isPrayingNow,
  SCAN_DEBOUNCE_MS,
  SCAN_STARTUP_DELAY_MS,
  useReviewPrompt,
} from './useReviewPrompt';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('react-native-mmkv', () => {
  const instances = new Map<string, Map<string, string>>();
  return {
    createMMKV: ({ id }: { id: string }) => {
      let values = instances.get(id);
      if (values === undefined) {
        values = new Map();
        instances.set(id, values);
      }
      const store = values;
      return {
        id,
        set: (key: string, value: string) => void store.set(key, value),
        getString: (key: string) => store.get(key),
        remove: (key: string) => void store.delete(key),
        clearAll: () => store.clear(),
      };
    },
  };
});

/** A real zustand store with the four reads the hook makes; no SQLite in sight. */
jest.mock('@/stores/trackingStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    useTrackingStore: create(() => ({
      revision: 0,
      hydrated: true,
      dayRecords: {} as Record<string, unknown>,
      todayDay: () => '2026-04-11',
      loadRange: () => [] as unknown[],
      streakSummary: () => ({ mode: 'soft', current: 0, best: 0, currentStartedOn: null }),
    })),
  };
});

/** The only thing the hook wants from notifications: a way to learn that one was tapped. */
jest.mock('@/services/notifications', () => {
  const listeners = new Set<() => void>();
  return {
    getNotificationService: () => ({
      observeTaps: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    __tap: () => {
      for (const listener of [...listeners]) listener();
    },
    __listenerCount: () => listeners.size,
    __reset: () => listeners.clear(),
  };
});

const tracking = jest.requireMock('@/stores/trackingStore') as {
  useTrackingStore: {
    setState(patch: Record<string, unknown>): void;
    getState(): Record<string, unknown>;
  };
};
const notifications = jest.requireMock('@/services/notifications') as {
  __tap(): void;
  __listenerCount(): number;
  __reset(): void;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Accra — on the prime meridian and near the equator, so all five prayers genuinely exist. */
const LOCATION: AppSettings['location'] = {
  latitude: 5.6037,
  longitude: -0.187,
  label: 'Accra',
  countryCode: 'GH',
  source: 'auto',
  resolvedAt: 0,
};

const TODAY = '2026-04-11';
/** Mid-morning in Accra: after Fajr's busy half hour, well before Dhuhr. */
const T0 = Date.UTC(2026, 3, 11, 9, 0, 0);
const DAY = 86_400_000;

const CONFIG: ReviewTriggerConfig = {
  ...REVIEW_TRIGGERS,
  minSessionsBeforeFirstPrompt: 2,
  minDaysSinceInstall: 0,
  settleDelayMs: 100,
};

function record(day: string, status: PrayerStatus): DayRecord {
  return {
    day,
    statuses: Object.fromEntries(PRAYERS.map((p) => [p, status])) as DayRecord['statuses'],
    madeUp: {},
    isExempt: false,
  };
}

interface Rig {
  service: ReviewService;
  adapter: FakeReviewAdapter;
  now(): number;
  advance(ms: number): void;
  storage: ReturnType<typeof createMemoryReviewStorage>;
}

function rig(): Rig {
  const storage = createMemoryReviewStorage();
  const adapter = createFakeReviewAdapter();
  let clock = T0;
  return {
    storage,
    adapter,
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
    service: createReviewService({ adapter, storage, config: CONFIG, now: () => clock }),
  };
}

/** A second cold start over the same storage — the hook is remounted against it. */
function restart(r: Rig): ReviewService {
  r.service.endSession();
  return createReviewService({
    adapter: r.adapter,
    storage: r.storage,
    config: CONFIG,
    now: r.now,
  });
}

let appStateListeners: ((state: AppStateStatus) => void)[] = [];

beforeEach(() => {
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, location: LOCATION });
  tracking.useTrackingStore.setState({
    revision: 0,
    hydrated: true,
    dayRecords: {},
    todayDay: () => TODAY,
    loadRange: () => [],
    streakSummary: () => ({ mode: 'soft', current: 0, best: 0, currentStartedOn: null }),
  });
  appStateListeners = [];
  notifications.__reset();
  resetSessionMoments();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    const listener = handler as (state: AppStateStatus) => void;
    appStateListeners.push(listener);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((entry) => entry !== listener);
      },
    } as NativeEventSubscription;
  });
  jest.useFakeTimers();
});

afterEach(async () => {
  // RNTL's own auto-cleanup runs after this hook, which is too late: a hook still mounted while
  // the fake timers are torn down flushes effects into a half-dismantled environment and poisons
  // every later test in the file. Unmount first, inside act, then unwind.
  await act(async () => {
    cleanup();
  });
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/**
 * Runs the deferred scan out: the store has stopped changing, so the observer wakes and looks.
 *
 * Deliberately the *smallest* jump that gets there, and it leaves the rig's clock alone. A longer
 * one would also mature a settle timer armed by the very scan it ran — with the injected clock
 * still where it was, so the moment would be judged unsettled — and the tests below need "armed"
 * and "asked" to stay distinguishable.
 */
async function flushScans(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(SCAN_DEBOUNCE_MS + 1);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Runs the settle timer out and drains the promise queue the request rides on.
 *
 * The rig's clock is advanced by the same amount *first*: the hook stamps `momentAt` from the
 * injected clock and re-reads it when the timer fires, so a fake-timer jump that leaves the
 * injected clock behind would look like "the moment has not settled" forever.
 */
async function settle(r: Rig): Promise<void> {
  const step = CONFIG.settleDelayMs + 10;
  r.advance(step);
  await act(async () => {
    jest.advanceTimersByTime(step);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Mounts the hook against a service, awaiting RNTL v14's async render and the first scan. */
async function mount(r: Rig, options: Record<string, unknown> = {}) {
  const view = await renderHook(() =>
    useReviewPrompt({
      service: r.service,
      config: CONFIG,
      now: r.now,
      startupScanDelayMs: 0,
      ...options,
    })
  );
  await act(async () => {
    await Promise.resolve();
  });
  await flushScans();
  return view;
}

/** Sets the streak the mocked store reports, and bumps the revision so the hook wakes. */
async function setStreak(current: number): Promise<void> {
  await act(async () => {
    const state = tracking.useTrackingStore.getState();
    tracking.useTrackingStore.setState({
      revision: (state.revision as number) + 1,
      streakSummary: () => ({ mode: 'soft', current, best: current, currentStartedOn: null }),
    });
    await Promise.resolve();
  });
  await flushScans();
}

/** Pushes an arbitrary patch into the mocked tracking store, inside `act`. */
async function pushTracking(patch: Record<string, unknown>): Promise<void> {
  await act(async () => {
    tracking.useTrackingStore.setState(patch);
    await Promise.resolve();
  });
  await flushScans();
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

describe('the session', () => {
  it('opens on mount and closes when the app backgrounds', async () => {
    const r = rig();
    await mount(r);
    expect(r.service.snapshot().sessionCount).toBe(1);
    expect(r.service.snapshot().sessionOpen).toBe(true);

    await act(async () => {
      for (const listener of appStateListeners) listener('background');
    });
    expect(r.service.snapshot().sessionOpen).toBe(false);
  });

  it('leaves the session open for `inactive`, which is not a departure', async () => {
    const r = rig();
    await mount(r);
    await act(async () => {
      for (const listener of appStateListeners) listener('inactive');
    });
    expect(r.service.snapshot().sessionOpen).toBe(true);
  });

  it('opens nothing at all when disabled', async () => {
    const r = rig();
    await mount(r, { enabled: false });
    expect(r.service.snapshot().sessionCount).toBe(0);
    expect(notifications.__listenerCount()).toBe(0);
  });

  it('releases the AppState subscription and the notification listener on unmount', async () => {
    const r = rig();
    const view = await mount(r);
    expect(appStateListeners).toHaveLength(1);
    expect(notifications.__listenerCount()).toBe(1);

    await act(async () => {
      view.unmount();
    });
    expect(appStateListeners).toHaveLength(0);
    expect(notifications.__listenerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Nothing in the first session
// ---------------------------------------------------------------------------

describe('the first session', () => {
  it('prompts for nothing, however good the moment', async () => {
    const r = rig();
    await mount(r);
    await setStreak(7);
    await settle(r);
    expect(r.adapter.requestCount).toBe(0);
    // Recorded once, not once per render: the refusal is debuggable without being noise.
    expect(r.service.history().map((entry) => entry.reason)).toEqual(['firstSession']);
  });

  it('does not even arm a timer', async () => {
    const r = rig();
    const view = await mount(r);
    await setStreak(7);
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.result.current.pending).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The triggers
// ---------------------------------------------------------------------------

describe('trigger detection', () => {
  /** Burns session 1, then mounts a fresh hook against session 2. */
  async function secondSession(r: Rig) {
    const first = await mount(r);
    await act(async () => {
      first.unmount();
    });
    r.service = restart(r);
    return await mount(r);
  }

  it('offers a 7-day streak, once the settle delay has passed', async () => {
    const r = rig();
    const view = await secondSession(r);

    await setStreak(7);
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.result.current.pending).toEqual({ kind: 'streakMilestone', milestone: 7 });
    expect(r.adapter.requestCount).toBe(0);

    await settle(r);
    expect(r.adapter.requestCount).toBe(1);
    expect(r.service.snapshot().firedTriggers).toEqual(['streakMilestone:7']);
  });

  it('ignores a streak length the config does not celebrate', async () => {
    const r = rig();
    await secondSession(r);
    for (const value of [3, 8, 100]) {
      await setStreak(value);
      await settle(r);
    }
    expect(r.adapter.requestCount).toBe(0);
  });

  it('offers the first complete week', async () => {
    const r = rig();
    await secondSession(r);

    // Seven closed days ending yesterday, all five prayed.
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 3, 4 + i));
      return record(date.toISOString().slice(0, 10), 'prayed');
    });
    await pushTracking({
      revision: 1,
      loadRange: () => days,
    });
    await settle(r);

    expect(r.adapter.requestCount).toBe(1);
    expect(r.service.snapshot().firedTriggers).toEqual(['firstCompleteWeek']);
  });

  it('offers setup success once times are shown and a reminder is confirmed delivered', async () => {
    const r = rig();
    await secondSession(r);
    // A location was set before mount, so `timesShown` is already recorded; the tap is the
    // second half.
    expect(r.service.snapshot().timesShownAt).not.toBeNull();
    expect(r.adapter.requestCount).toBe(0);

    await act(async () => {
      notifications.__tap();
    });
    await pushTracking({ revision: 5 });
    await settle(r);

    expect(r.adapter.requestCount).toBe(1);
    expect(r.service.snapshot().firedTriggers).toEqual(['setupSuccess']);
  });

  it('prefers the streak milestone when two moments land together', async () => {
    const r = rig();
    await secondSession(r);
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 3, 4 + i));
      return record(date.toISOString().slice(0, 10), 'prayed');
    });
    await pushTracking({
      revision: 1,
      loadRange: () => days,
      streakSummary: () => ({ mode: 'hard', current: 7, best: 7, currentStartedOn: null }),
    });
    await settle(r);
    expect(r.service.snapshot().firedTriggers).toEqual(['streakMilestone:7']);
  });

  it('tells the tip jar the session is spent (D29)', async () => {
    const r = rig();
    await secondSession(r);
    expect(hasSessionMoment('reviewPrompt')).toBe(false);

    await setStreak(7);
    await settle(r);
    expect(r.adapter.requestCount).toBe(1);
    expect(hasSessionMoment('reviewPrompt')).toBe(true);
  });

  it('leaves the tip jar alone when nothing was actually asked', async () => {
    const r = rig();
    r.adapter.setAvailable(false);
    await secondSession(r);
    await setStreak(7);
    await settle(r);
    expect(hasSessionMoment('reviewPrompt')).toBe(false);
  });

  it('says nothing at all in a session where the user already left a tip (D29)', async () => {
    const r = rig();
    await secondSession(r);
    // What `components/TipJar` records the instant a purchase completes.
    noteSessionMoment('tipPrompt');

    await setStreak(7);
    await settle(r);
    expect(r.adapter.requestCount).toBe(0);
    expect(r.service.history().map((entry) => entry.reason)).toEqual(['alreadyGaveThisSession']);
    // Nothing is spent, so the milestone is still there to be offered another day.
    expect(r.service.snapshot().firedTriggers).toEqual([]);
    expect(r.service.snapshot().attemptCount).toBe(0);
  });

  it('drops an armed moment when the tip lands during the settle delay', async () => {
    const r = rig();
    await secondSession(r);
    await setStreak(7);
    // Armed, waiting — and then the user walks into Settings and tips before it fires.
    noteSessionMoment('tipPrompt');
    await settle(r);
    expect(r.adapter.requestCount).toBe(0);
  });

  it('asks once per session, even as more moments arrive', async () => {
    const r = rig();
    await secondSession(r);
    await setStreak(7);
    await settle(r);
    expect(r.adapter.requestCount).toBe(1);

    await setStreak(30);
    await settle(r);
    expect(r.adapter.requestCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Exclusions observed at fire time
// ---------------------------------------------------------------------------

describe('state observed when the timer fires', () => {
  async function secondSession(r: Rig, options: Record<string, unknown> = {}) {
    const first = await mount(r);
    await act(async () => {
      first.unmount();
    });
    r.service = restart(r);
    return await mount(r, options);
  }

  it('blocks when the adhan started during the settle delay', async () => {
    const r = rig();
    let playing = false;
    await secondSession(r, { isAdhanPlaying: () => playing });

    await setStreak(7);
    await act(async () => {
      await Promise.resolve();
    });
    playing = true;
    await settle(r);

    expect(r.adapter.requestCount).toBe(0);
    expect(r.service.history().at(-1)?.reason).toBe('adhanPlaying');
  });

  it('blocks when a prayer has just come in', async () => {
    const r = rig();
    const times = computeDayTimes(TODAY, LOCATION, DEFAULT_SETTINGS.calculation);
    // Ten minutes into Asr: inside the busy half hour, so the user is on the mat.
    const at = times.times.asr.getTime() + 10 * 60_000;
    r.advance(at - r.now());

    await secondSession(r);
    await setStreak(7);
    await settle(r);

    expect(r.adapter.requestCount).toBe(0);
    expect(r.service.history().at(-1)?.reason).toBe('prayerWindow');
  });

  it('blocks while the user has no location — setup is not finished', async () => {
    const r = rig();
    useSettingsStore.setState({ location: null });
    await secondSession(r);
    await setStreak(7);
    await settle(r);
    expect(r.adapter.requestCount).toBe(0);
    expect(r.service.history().at(-1)?.reason).toBe('setupIncomplete');
  });
});

// ---------------------------------------------------------------------------
// The dissatisfaction signals
// ---------------------------------------------------------------------------

describe('dissatisfaction signals', () => {
  it('records a streak break when the number goes down', async () => {
    const r = rig();
    await mount(r);
    await setStreak(12);
    await act(async () => {
      await Promise.resolve();
    });
    expect(r.service.snapshot().lastStreakBreakAt).toBeNull();

    await setStreak(0);
    await act(async () => {
      await Promise.resolve();
    });
    expect(r.service.snapshot().lastStreakBreakAt).toBe(T0);
  });

  it('does not read a soft↔hard mode switch as a break', async () => {
    const r = rig();
    await mount(r);
    await setStreak(12);

    // In the app `streakSummary()` reads the mode at call time, so the number and the mode change
    // together — the mock has to do the same, or the test would be checking a race that cannot
    // happen. A hard streak of 1 where the soft one was 12 is a re-baseline, not a break.
    await act(async () => {
      tracking.useTrackingStore.setState({
        revision: 2,
        streakSummary: () => ({
          mode: useSettingsStore.getState().streakMode,
          current: useSettingsStore.getState().streakMode === 'hard' ? 1 : 12,
          best: 12,
          currentStartedOn: null,
        }),
      });
      useSettingsStore.getState().setStreakMode('hard');
      await Promise.resolve();
    });
    await flushScans();
    expect(r.service.snapshot().lastStreakBreakAt).toBeNull();
  });

  it('records a times adjustment when the calculation settings change', async () => {
    const r = rig();
    await mount(r);
    expect(r.service.snapshot().lastTimesAdjustedAt).toBeNull();

    await act(async () => {
      useSettingsStore.getState().setPrayerOffset('fajr', 3);
    });
    expect(r.service.snapshot().lastTimesAdjustedAt).toBe(T0);
  });

  it('records a mis-tap correction when a logged prayer goes back to unlogged', async () => {
    const r = rig();
    await mount(r);
    await pushTracking({
      revision: 1,
      dayRecords: { [TODAY]: record(TODAY, 'prayed') },
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(r.service.snapshot().lastMistapAt).toBeNull();

    await pushTracking({
      revision: 2,
      dayRecords: { [TODAY]: record(TODAY, 'unlogged') },
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(r.service.snapshot().lastMistapAt).toBe(T0);
  });

  it('does not read a day leaving the cache as a correction', async () => {
    const r = rig();
    await mount(r);
    await pushTracking({
      revision: 1,
      dayRecords: { [TODAY]: record(TODAY, 'prayed') },
    });
    await act(async () => {
      await Promise.resolve();
    });

    await pushTracking({ revision: 2, dayRecords: {} });
    expect(r.service.snapshot().lastMistapAt).toBeNull();
  });

  it('a recorded signal blocks the next moment', async () => {
    const r = rig();
    const first = await mount(r);
    await act(async () => {
      first.unmount();
    });
    r.service = restart(r);
    await mount(r);

    r.service.noteTimesAdjusted();
    await setStreak(7);
    await settle(r);
    expect(r.adapter.requestCount).toBe(0);
    expect(r.service.history().at(-1)?.reason).toBe('timesAdjusted');
  });
});

// ---------------------------------------------------------------------------
// Throttling, observed through the hook
// ---------------------------------------------------------------------------

describe('throttling across mounted sessions', () => {
  it('spends three attempts and then stops, across simulated launches', async () => {
    const r = rig();
    const greenWeek = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 3, 4 + i));
      return record(date.toISOString().slice(0, 10), 'prayed');
    });

    /** A *different* unspent trigger per launch, so the cap — not "already used" — is what stops us. */
    const chances: Record<string, unknown>[] = [
      { streakSummary: () => ({ mode: 'soft', current: 7, best: 7, currentStartedOn: null }) },
      { streakSummary: () => ({ mode: 'soft', current: 30, best: 30, currentStartedOn: null }) },
      // The streak stays at 30 — dropping it would register as a break and suppress everything.
      // The spent `streakMilestone:30` must not mask the fresh complete week behind it.
      { loadRange: () => greenWeek },
      { loadRange: () => greenWeek },
    ];

    // Launch 1 is silent by rule, so five launches offer four chances — one more than the cap.
    for (let launch = 0; launch < 5; launch += 1) {
      const view = await mount(r);
      if (launch > 0) {
        // The last chance is `setupSuccess`, freshly unlocked by a reminder tap — so what stops
        // it is the lifetime cap and nothing else.
        if (launch === 4) {
          await act(async () => {
            notifications.__tap();
            await Promise.resolve();
          });
        }
        await pushTracking({ revision: launch, ...chances[launch - 1] });
        await settle(r);
      }
      await act(async () => {
        view.unmount();
      });
      r.advance(CONFIG.cooldownDays * DAY + DAY);
      r.service = restart(r);
    }

    expect(r.adapter.requestCount).toBe(CONFIG.lifetimeCap);
    expect(r.service.snapshot().attemptCount).toBe(CONFIG.lifetimeCap);
    expect(r.service.history().at(-1)?.reason).toBe('lifetimeCapReached');
  });
});

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

describe('the settle timer', () => {
  it('is cleared on unmount, so nothing fires into a dead tree', async () => {
    const r = rig();
    const first = await mount(r);
    await act(async () => {
      first.unmount();
    });
    r.service = restart(r);
    const view = await mount(r);

    const baseline = jest.getTimerCount();
    await setStreak(7);
    expect(view.result.current.pending).not.toBeNull();
    // Arming really did schedule something — otherwise the assertion below would prove nothing.
    expect(jest.getTimerCount()).toBeGreaterThan(baseline);

    await act(async () => {
      view.unmount();
    });
    // React's scheduler keeps timers of its own, so a bare count is not the guard. The guarantee
    // that matters is behavioural: run the clock past the settle delay and nothing is asked.
    r.advance(CONFIG.settleDelayMs + 10);
    await act(async () => {
      jest.advanceTimersByTime(CONFIG.settleDelayMs + 10);
      await Promise.resolve();
    });
    expect(r.adapter.requestCount).toBe(0);
  });

  it('is cancelled when the app leaves, rather than spending an attempt nobody sees', async () => {
    const r = rig();
    const first = await mount(r);
    await act(async () => {
      first.unmount();
    });
    r.service = restart(r);
    const view = await mount(r);

    await setStreak(7);
    expect(view.result.current.pending).not.toBeNull();

    // The user swipes away mid-settle. `requestReview()` into a backgrounded app shows nothing on
    // either platform and still burns one of this install's three attempts — and one of iOS's
    // three per year — so the moment is dropped instead.
    await act(async () => {
      for (const listener of appStateListeners) listener('background');
    });
    await settle(r);

    expect(r.adapter.requestCount).toBe(0);
    expect(r.service.snapshot().attemptCount).toBe(0);
    expect(r.service.snapshot().firedTriggers).toEqual([]);
    expect(view.result.current.pending).toBeNull();
  });

  it('releases its AppState subscription when the moment is disarmed', async () => {
    const r = rig();
    const first = await mount(r);
    await act(async () => {
      first.unmount();
    });
    r.service = restart(r);
    expect(appStateListeners).toHaveLength(0);

    // One listener for the session; arming a moment adds a second, and unmounting drops both.
    const view = await mount(r);
    expect(appStateListeners).toHaveLength(1);
    await setStreak(7);
    expect(appStateListeners).toHaveLength(2);

    await act(async () => {
      view.unmount();
    });
    expect(appStateListeners).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// What the tap pays for
// ---------------------------------------------------------------------------

/**
 * This hook lives in the root layout, so anything it does synchronously is charged to the user's
 * seal tap — the one interaction the whole product is built around. These tests pin the three
 * ways it stays out of that path.
 */
describe('the cost of a logged prayer', () => {
  it('does not re-render its host when the store changes', async () => {
    const r = rig();
    let renders = 0;
    await renderHook(() => {
      renders += 1;
      return useReviewPrompt({ service: r.service, config: CONFIG, now: r.now, startupScanDelayMs: 0 });
    });
    await flushScans();

    const before = renders;
    await pushTracking({ revision: 1, dayRecords: { [TODAY]: record(TODAY, 'prayed') } });

    // A render-time `useTrackingStore((s) => s.revision)` re-rendered the entire app — every root
    // hook, every provider — for a fact nothing on screen shows.
    expect(renders).toBe(before);
  });

  it('leaves the full-history streak read out of the write that triggered it', async () => {
    const r = rig();
    await mount(r);
    await setStreak(12);

    let scans = 0;
    await act(async () => {
      tracking.useTrackingStore.setState({
        revision: 99,
        streakSummary: () => {
          scans += 1;
          return { mode: 'soft', current: 0, best: 12, currentStartedOn: null };
        },
      });
      await Promise.resolve();
    });
    // Still nothing: `streakSummary({ includeToday: false })` walks every day since the first log
    // ever, and the tap's commit is the worst possible moment for it.
    expect(scans).toBe(0);
    expect(r.service.snapshot().lastStreakBreakAt).toBeNull();

    await flushScans();
    expect(scans).toBe(1);
    expect(r.service.snapshot().lastStreakBreakAt).toBe(T0);
  });

  it('holds the first scan of a process back past the debounce, and absorbs triggers inside the wait', async () => {
    // Hydration lands within the first few hundred milliseconds of a cold start; a 300 ms debounce
    // put the full-history streak read on the JS thread right where the first seal tap arrives —
    // 1.7 s before the syncs D159 moved out of that window. The first scan waits like they do.
    const r = rig();
    let scans = 0;
    const counting = (): { mode: string; current: number; best: number; currentStartedOn: null } => {
      scans += 1;
      return { mode: 'soft', current: 3, best: 3, currentStartedOn: null };
    };
    await act(async () => {
      tracking.useTrackingStore.setState({ streakSummary: counting });
      await Promise.resolve();
    });
    // Four debounces run out below before the wait is meant to be over, so the wait used here is
    // longer than the real one; what is pinned is the absorbing, not the number.
    const startupWait = Math.max(SCAN_STARTUP_DELAY_MS, 5 * (SCAN_DEBOUNCE_MS + 1));
    await mount(r, { startupScanDelayMs: startupWait });

    // Past the ordinary debounce: nothing yet.
    await flushScans();
    expect(scans).toBe(0);

    // A store change inside the wait is absorbed, not turned into an early scan.
    await pushTracking({ revision: 1, dayRecords: { [TODAY]: record(TODAY, 'prayed') } });
    await flushScans();
    expect(scans).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(startupWait);
      await Promise.resolve();
    });
    expect(scans).toBe(1);

    // …and exactly one: nothing else was left pending.
    await act(async () => {
      jest.advanceTimersByTime(startupWait);
      await Promise.resolve();
    });
    expect(scans).toBe(1);
  });

  it('coalesces a burst of writes into a single scan', async () => {
    const r = rig();
    await mount(r);

    let scans = 0;
    const counting = (): {
      mode: string;
      current: number;
      best: number;
      currentStartedOn: null;
    } => {
      scans += 1;
      return { mode: 'soft', current: 3, best: 3, currentStartedOn: null };
    };
    // A cold start does this: hydration, Today's day, yesterday's, five notification-plan reads.
    await act(async () => {
      for (const revision of [1, 2, 3, 4, 5]) {
        tracking.useTrackingStore.setState({ revision, streakSummary: counting });
      }
      await Promise.resolve();
    });
    await flushScans();

    expect(scans).toBe(1);
  });

  it('does not re-read the week when every day of it is already cached', async () => {
    const r = rig();
    await mount(r);

    const loadRange = jest.fn(() => []);
    const days = Array.from({ length: CONFIG.completeWeekDays }, (_, i) => {
      const date = new Date(Date.UTC(2026, 3, 4 + i));
      return record(date.toISOString().slice(0, 10), 'prayed');
    });
    await pushTracking({
      revision: 1,
      dayRecords: Object.fromEntries(days.map((day) => [day.day, day])),
      loadRange,
    });

    // `loadRange` is a SQL read AND a store write, so it fans out to every selector in the app.
    // Once the week is in the cache — which it is, from the moment Today rendered — the complete
    // week can be judged without touching the database at all.
    expect(loadRange).not.toHaveBeenCalled();
  });

  it('still reads the week when a day of it is missing', async () => {
    const r = rig();
    await mount(r);

    const loadRange = jest.fn(() => []);
    await pushTracking({ revision: 1, dayRecords: {}, loadRange });

    expect(loadRange).toHaveBeenCalledTimes(1);
  });

  it('still notices a mis-tap corrected within the same second', async () => {
    const r = rig();
    await mount(r);
    await pushTracking({ revision: 1, dayRecords: { [TODAY]: record(TODAY, 'prayed') } });

    // Tapped and untapped inside one debounce window — the case the signal exists for. Deferring
    // the record diff with the rest of the scan would coalesce the two into "nothing happened".
    await act(async () => {
      tracking.useTrackingStore.setState({
        revision: 2,
        dayRecords: { [TODAY]: record(TODAY, 'unlogged') },
      });
      await Promise.resolve();
    });

    expect(r.service.snapshot().lastMistapAt).toBe(T0);
  });
});

// ---------------------------------------------------------------------------
// isPrayingNow
// ---------------------------------------------------------------------------

describe('isPrayingNow', () => {
  const calculation = DEFAULT_SETTINGS.calculation;
  const times = computeDayTimes(TODAY, LOCATION, calculation);

  it('is true in the first minutes of every prayer', () => {
    for (const prayer of PRAYERS) {
      const at = times.times[prayer].getTime() + 60_000;
      expect(isPrayingNow(at, LOCATION, calculation, 30)).toBe(true);
    }
  });

  it('is false once the busy period is over', () => {
    const at = times.times.dhuhr.getTime() + 45 * 60_000;
    expect(isPrayingNow(at, LOCATION, calculation, 30)).toBe(false);
  });

  it('is not permanently true — the day is not one long prayer', () => {
    // The bug this guards: `getPrayerWindows` tiles the whole prayer day, so a naive "inside a
    // window" test never lets a single prompt through.
    const samples = Array.from({ length: 24 }, (_, hour) => Date.UTC(2026, 3, 11, hour, 17));
    const free = samples.filter((at) => !isPrayingNow(at, LOCATION, calculation, 30));
    expect(free.length).toBeGreaterThan(12);
  });

  it('answers true when it cannot tell', () => {
    expect(isPrayingNow(T0, null, calculation, 30)).toBe(true);
    expect(isPrayingNow(T0, { latitude: 999, longitude: 0 }, calculation, 30)).toBe(true);
    expect(isPrayingNow(Number.NaN, LOCATION, calculation, 30)).toBe(true);
  });
});
