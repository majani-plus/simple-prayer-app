/**
 * The review-prompt policy, exercised.
 *
 * This is the file that has to be right, because on a device none of this is observable: there is
 * no success callback on either platform, no analytics SDK in this app (D31), and the only
 * feedback loop is the store's public rating weeks later. If a hard exclusion regresses, nobody
 * finds out until a 1★ review says "it asked me to rate it during Maghrib".
 *
 * So every rule in PRODUCT_SPEC §13 has a test that would fail if the rule were deleted:
 *
 * - each trigger fires **exactly once**, ever, at its milestone;
 * - **every** exclusion blocks, each with its own machine-readable reason;
 * - the 90-day cooldown and the lifetime cap of 3 survive a simulated process restart;
 * - an unavailable review API degrades **silently** — no throw, nothing spent;
 * - nothing whatsoever fires in the first session.
 *
 * Sessions are simulated the way they actually happen: a *new service instance over the same
 * storage* is a cold start, and `endSession()` is the app backgrounding. That is what makes the
 * cooldown/cap tests meaningful — they prove the budget is persisted, not merely remembered.
 */

import { DAY_MS, REVIEW_TRIGGERS, type ReviewTriggerConfig } from '../config/reviewTriggers';
import type { HijriDate } from '../domain/hijri';
import { PRAYERS, type DayRecord, type PrayerDay, type PrayerStatus } from '../domain/types';

import {
  createDefaultReviewState,
  createFakeReviewAdapter,
  createMemoryReviewStorage,
  createReviewService,
  isFullyCompleteWeek,
  isRamadanEdgeDay,
  REVIEW_BLOCK_REASONS,
  REVIEW_STATE_VERSION,
  REVIEW_STORAGE_KEY,
  sanitizeReviewState,
  triggerKey,
  type FakeReviewAdapter,
  type ReviewBlockReason,
  type ReviewMoment,
  type ReviewService,
  type ReviewStorage,
  type ReviewTrigger,
} from './review';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A Saturday, mid-morning, well away from any boundary this suite cares about. */
const T0 = Date.UTC(2026, 3, 11, 9, 0, 0);
const DAY = 86_400_000;

/**
 * The suite's policy: the shipped one with the *user-history* gates relaxed, so a test that is
 * about (say) prayer windows does not have to simulate three sessions and four days first. Every
 * gate that is relaxed here has its own dedicated test below with the real value.
 */
const CONFIG: ReviewTriggerConfig = {
  ...REVIEW_TRIGGERS,
  minSessionsBeforeFirstPrompt: 2,
  minDaysSinceInstall: 0,
  settleDelayMs: 0,
};

const STREAK_7: ReviewTrigger = { kind: 'streakMilestone', milestone: 7 };
const STREAK_30: ReviewTrigger = { kind: 'streakMilestone', milestone: 30 };
const WEEK: ReviewTrigger = { kind: 'firstCompleteWeek' };
const SETUP: ReviewTrigger = { kind: 'setupSuccess' };

/** A moment with every exclusion clear. Patch one field per test. */
function moment(now: number, patch: Partial<ReviewMoment> = {}): ReviewMoment {
  return {
    now,
    momentAt: now - 60_000,
    inPrayerWindow: false,
    adhanPlaying: false,
    setupComplete: true,
    ...patch,
  };
}

interface Harness {
  storage: ReviewStorage;
  adapter: FakeReviewAdapter;
  /** The live service. Replaced by {@link Harness.restart}. */
  service: ReviewService;
  /** Current epoch ms; advance it with {@link Harness.advance}. */
  now(): number;
  advance(ms: number): void;
  /** Cold start: background the app, then build a fresh service over the same storage. */
  restart(options?: { clean?: boolean }): void;
}

function harness(config: ReviewTriggerConfig = CONFIG): Harness {
  const storage = createMemoryReviewStorage();
  const adapter = createFakeReviewAdapter();
  let clock = T0;

  const build = (): ReviewService =>
    createReviewService({ adapter, storage, config, now: () => clock });

  const self: Harness = {
    storage,
    adapter,
    service: build(),
    now: () => clock,
    advance(ms) {
      clock += ms;
    },
    restart({ clean = true } = {}) {
      if (clean) self.service.endSession();
      self.service = build();
    },
  };
  return self;
}

/** Starts `count` sessions, cleanly, so the service is past the first-session gate. */
function warmUp(h: Harness, count = 2): void {
  for (let i = 0; i < count; i += 1) {
    h.service.startSession();
    if (i < count - 1) h.restart();
  }
}

function day(index: number): PrayerDay {
  const date = new Date(Date.UTC(2026, 3, 1 + index));
  return date.toISOString().slice(0, 10);
}

function record(d: PrayerDay, status: PrayerStatus, isExempt = false): DayRecord {
  return {
    day: d,
    statuses: Object.fromEntries(PRAYERS.map((p) => [p, status])) as DayRecord['statuses'],
    madeUp: {},
    isExempt,
  };
}

function hijri(month: number, d: number): HijriDate {
  return { year: 1447, month, day: d };
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

describe('triggerKey', () => {
  it('is stable and distinguishes milestones', () => {
    expect(triggerKey(STREAK_7)).toBe('streakMilestone:7');
    expect(triggerKey(STREAK_30)).toBe('streakMilestone:30');
    expect(triggerKey(WEEK)).toBe('firstCompleteWeek');
    expect(triggerKey(SETUP)).toBe('setupSuccess');
  });
});

describe('REVIEW_BLOCK_REASONS', () => {
  it('has no duplicates', () => {
    expect(new Set(REVIEW_BLOCK_REASONS).size).toBe(REVIEW_BLOCK_REASONS.length);
  });
});

// ---------------------------------------------------------------------------
// Ramadan
// ---------------------------------------------------------------------------

describe('isRamadanEdgeDay', () => {
  it('is true on 1 Ramadan', () => {
    expect(isRamadanEdgeDay(hijri(9, 1), hijri(9, 2))).toBe(true);
  });

  it('is true on the last day, however long the month ran', () => {
    expect(isRamadanEdgeDay(hijri(9, 29), hijri(10, 1))).toBe(true);
    expect(isRamadanEdgeDay(hijri(9, 30), hijri(10, 1))).toBe(true);
  });

  it('is false in the middle of Ramadan', () => {
    expect(isRamadanEdgeDay(hijri(9, 15), hijri(9, 16))).toBe(false);
    expect(isRamadanEdgeDay(hijri(9, 29), hijri(9, 30))).toBe(false);
  });

  it('is false outside Ramadan, including 1 Shawwal', () => {
    expect(isRamadanEdgeDay(hijri(8, 1), hijri(8, 2))).toBe(false);
    expect(isRamadanEdgeDay(hijri(10, 1), hijri(10, 2))).toBe(false);
  });

  it('degrades to the first-day rule when tomorrow is unknown', () => {
    expect(isRamadanEdgeDay(hijri(9, 1))).toBe(true);
    expect(isRamadanEdgeDay(hijri(9, 29))).toBe(false);
    expect(isRamadanEdgeDay(null, null)).toBe(false);
    expect(isRamadanEdgeDay(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The complete week
// ---------------------------------------------------------------------------

describe('isFullyCompleteWeek', () => {
  const seven = Array.from({ length: 7 }, (_, i) => record(day(i), 'prayed'));

  it('accepts seven fully-prayed days', () => {
    expect(isFullyCompleteWeek(seven, day(6), 7)).toBe(true);
  });

  it('accepts `late` as green', () => {
    const withLate = [...seven.slice(0, 3), record(day(3), 'late'), ...seven.slice(4)];
    expect(isFullyCompleteWeek(withLate, day(6), 7)).toBe(true);
  });

  it('rejects a week with one missed prayer', () => {
    const partial = [...seven];
    partial[2] = { ...seven[2], statuses: { ...seven[2].statuses, asr: 'missed' } };
    expect(isFullyCompleteWeek(partial, day(6), 7)).toBe(false);
  });

  it('rejects a week with one unlogged prayer — unlogged is not prayed (PRODUCT_SPEC §4)', () => {
    const partial = [...seven];
    partial[5] = { ...seven[5], statuses: { ...seven[5].statuses, isha: 'unlogged' } };
    expect(isFullyCompleteWeek(partial, day(6), 7)).toBe(false);
  });

  it('rejects a week an exempt day bridges — an exempt day is not green', () => {
    const bridged = [...seven];
    bridged[4] = record(day(4), 'exempt', true);
    expect(isFullyCompleteWeek(bridged, day(6), 7)).toBe(false);
  });

  it('rejects a missing day', () => {
    expect(isFullyCompleteWeek(seven.slice(1), day(6), 7)).toBe(false);
  });

  it('ignores days outside the window', () => {
    const extra = [record(day(-1), 'missed'), ...seven, record(day(7), 'missed')];
    expect(isFullyCompleteWeek(extra, day(6), 7)).toBe(true);
  });

  it('refuses a nonsensical window length instead of guessing', () => {
    expect(isFullyCompleteWeek(seven, day(6), 0)).toBe(false);
    expect(isFullyCompleteWeek(seven, day(6), -3)).toBe(false);
    expect(isFullyCompleteWeek(seven, day(6), 1.5)).toBe(false);
  });

  it('throws on a malformed end day rather than silently reporting false', () => {
    expect(() => isFullyCompleteWeek(seven, 'not-a-day', 7)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Storage trust boundary
// ---------------------------------------------------------------------------

describe('sanitizeReviewState', () => {
  it('turns junk into a pristine state', () => {
    const pristine = createDefaultReviewState();
    for (const junk of [null, undefined, 42, 'x', [], {}]) {
      expect(sanitizeReviewState(junk)).toEqual(pristine);
    }
  });

  it('discards a blob from another version rather than half-trusting it', () => {
    const foreign = { ...createDefaultReviewState(), version: 99, attemptCount: 0 };
    expect(sanitizeReviewState(foreign).attemptCount).toBe(0);
    expect(sanitizeReviewState(foreign).version).toBe(REVIEW_STATE_VERSION);
  });

  it('keeps a spent budget — the fields a corrupt blob must never be able to unlock', () => {
    const spent = { ...createDefaultReviewState(), attemptCount: 3, lastAttemptAt: T0 };
    const clean = sanitizeReviewState(spent);
    expect(clean.attemptCount).toBe(3);
    expect(clean.lastAttemptAt).toBe(T0);
  });

  it('drops non-finite timestamps and duplicate trigger keys', () => {
    const messy = {
      ...createDefaultReviewState(),
      lastAttemptAt: Number.NaN,
      installedAt: 'yesterday',
      firedTriggers: ['setupSuccess', 'setupSuccess', 7, null],
    };
    const clean = sanitizeReviewState(messy);
    expect(clean.lastAttemptAt).toBeNull();
    expect(clean.installedAt).toBeNull();
    expect(clean.firedTriggers).toEqual(['setupSuccess']);
  });

  it('drops malformed log entries and unknown reasons', () => {
    const messy = {
      ...createDefaultReviewState(),
      log: [
        { at: T0, trigger: 'setupSuccess', session: 2, decision: 'prompted', reason: null },
        { at: T0, trigger: 'setupSuccess', session: 2, decision: 'blocked', reason: 'moon phase' },
        { trigger: 'setupSuccess' },
        'nonsense',
      ],
    };
    const clean = sanitizeReviewState(messy);
    expect(clean.log).toHaveLength(2);
    expect(clean.log[1].reason).toBeNull();
  });
});

describe('a service over hostile storage', () => {
  it('starts clean when the stored blob is unparseable', () => {
    const storage = createMemoryReviewStorage({ [REVIEW_STORAGE_KEY]: '{not json' });
    const service = createReviewService({
      storage,
      adapter: createFakeReviewAdapter(),
      config: CONFIG,
      now: () => T0,
    });
    expect(service.snapshot()).toEqual(createDefaultReviewState());
  });

  it('still governs the session when storage throws on every call', async () => {
    const broken: ReviewStorage = {
      getItem() {
        throw new Error('mmkv exploded');
      },
      setItem() {
        throw new Error('mmkv exploded');
      },
      removeItem() {
        throw new Error('mmkv exploded');
      },
    };
    const adapter = createFakeReviewAdapter();
    const service = createReviewService({
      storage: broken,
      adapter,
      config: CONFIG,
      now: () => T0,
    });
    service.startSession();
    service.endSession();
    service.startSession();
    const outcome = await service.request(STREAK_7, moment(T0));
    expect(outcome.prompted).toBe(true);
    expect(() => service.reset()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The first session
// ---------------------------------------------------------------------------

describe('the first session', () => {
  it('blocks every trigger, with the same reason', async () => {
    for (const trigger of [STREAK_7, STREAK_30, WEEK, SETUP]) {
      const h = harness();
      h.service.startSession();
      const outcome = await h.service.request(trigger, moment(h.now()));
      expect(outcome).toEqual({ prompted: false, reason: 'firstSession' });
      expect(h.adapter.requestCount).toBe(0);
    }
  });

  it('blocks even when the shipped config would allow it on session count alone', () => {
    const h = harness({ ...CONFIG, minSessionOrdinal: 1, minSessionsBeforeFirstPrompt: 1 });
    h.service.startSession();
    // The floor of 2 is not tunable: PRODUCT_SPEC §13's "not during first launch" is a rule, not
    // a threshold, so a config that tries to lower it is overruled.
    expect(h.service.evaluate(STREAK_7, moment(h.now())).reason).toBe('firstSession');
  });

  it('blocks a request made before any session was opened', async () => {
    const h = harness();
    const outcome = await h.service.request(STREAK_7, moment(h.now()));
    expect(outcome.reason).toBe('noSession');
  });
});

// ---------------------------------------------------------------------------
// The triggers
// ---------------------------------------------------------------------------

describe('each trigger', () => {
  it.each([
    ['a 7-day streak', STREAK_7],
    ['a 30-day streak', STREAK_30],
    ['the first complete week', WEEK],
    ['successful setup', SETUP],
  ])('fires once at %s', async (_label, trigger) => {
    const h = harness();
    warmUp(h);
    expect((await h.service.request(trigger, moment(h.now()))).prompted).toBe(true);
    expect(h.adapter.requestCount).toBe(1);
    expect(h.service.snapshot().firedTriggers).toEqual([triggerKey(trigger)]);
  });

  it('never fires the same trigger twice, even after the cooldown has expired', async () => {
    const h = harness();
    warmUp(h);
    expect((await h.service.request(STREAK_7, moment(h.now()))).prompted).toBe(true);

    h.advance(400 * DAY);
    h.restart();
    h.service.startSession();
    const again = await h.service.request(STREAK_7, moment(h.now()));
    expect(again).toEqual({ prompted: false, reason: 'triggerAlreadyUsed' });
    expect(h.adapter.requestCount).toBe(1);
  });

  it('lets the 30-day milestone through after the 7-day one, a cooldown later', async () => {
    const h = harness();
    warmUp(h);
    expect((await h.service.request(STREAK_7, moment(h.now()))).prompted).toBe(true);

    h.advance(CONFIG.cooldownDays * DAY + DAY);
    h.restart();
    h.service.startSession();
    expect((await h.service.request(STREAK_30, moment(h.now()))).prompted).toBe(true);
    expect(h.adapter.requestCount).toBe(2);
  });

  it('refuses a streak milestone the config does not celebrate', async () => {
    const h = harness();
    warmUp(h);
    for (const milestone of [3, 100, 365]) {
      const outcome = await h.service.request(
        { kind: 'streakMilestone', milestone },
        moment(h.now())
      );
      expect(outcome.reason).toBe('triggerNotConfigured');
    }
    expect(h.adapter.requestCount).toBe(0);
  });

  it('allows at most one prompt per session, whatever else happens', async () => {
    const h = harness();
    warmUp(h);
    expect((await h.service.request(STREAK_7, moment(h.now()))).prompted).toBe(true);
    const second = await h.service.request(WEEK, moment(h.now() + 1000));
    expect(second).toEqual({ prompted: false, reason: 'alreadyPromptedThisSession' });
    expect(h.adapter.requestCount).toBe(1);
  });
});

describe('setup success', () => {
  it('needs both halves — times shown AND a reminder confirmed delivered', () => {
    const h = harness();
    expect(h.service.isSetupSuccessReady()).toBe(false);

    h.service.noteTimesShown();
    expect(h.service.isSetupSuccessReady()).toBe(false);

    h.service.noteReminderDelivered();
    expect(h.service.isSetupSuccessReady()).toBe(true);
  });

  it('remembers the first time of each and does not move the stamps afterwards', () => {
    const h = harness();
    h.service.noteTimesShown();
    const first = h.service.snapshot().timesShownAt;
    h.advance(DAY);
    h.service.noteTimesShown();
    expect(h.service.snapshot().timesShownAt).toBe(first);
  });

  it('survives a restart', () => {
    const h = harness();
    h.service.noteTimesShown();
    h.service.noteReminderDelivered();
    h.restart();
    expect(h.service.isSetupSuccessReady()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The hard exclusions
// ---------------------------------------------------------------------------

describe('the hard exclusions', () => {
  /** Runs a scenario that should block, and asserts the OS was never touched. */
  async function expectBlocked(
    h: Harness,
    patch: Partial<ReviewMoment>,
    reason: ReviewBlockReason
  ): Promise<void> {
    const outcome = await h.service.request(STREAK_7, moment(h.now(), patch));
    expect(outcome).toEqual({ prompted: false, reason });
    expect(h.adapter.requestCount).toBe(0);
    expect(h.service.snapshot().firedTriggers).toEqual([]);
  }

  it('blocks inside a prayer window', async () => {
    const h = harness();
    warmUp(h);
    await expectBlocked(h, { inPrayerWindow: true }, 'prayerWindow');
  });

  it('blocks while the adhan is playing', async () => {
    const h = harness();
    warmUp(h);
    await expectBlocked(h, { adhanPlaying: true }, 'adhanPlaying');
  });

  it('blocks in the quiet period after the adhan stops', async () => {
    const h = harness();
    warmUp(h);
    h.service.noteAdhanFinished();
    h.advance(CONFIG.quietAfterAdhanMs - 1);
    await expectBlocked(h, {}, 'adhanQuietPeriod');
  });

  it('allows once the quiet period has passed', async () => {
    const h = harness();
    warmUp(h);
    h.service.noteAdhanFinished();
    h.advance(CONFIG.quietAfterAdhanMs + 1);
    expect((await h.service.request(STREAK_7, moment(h.now()))).prompted).toBe(true);
  });

  it('blocks after a streak break, for the configured fortnight', async () => {
    const h = harness();
    warmUp(h);
    h.service.noteStreakBreak();
    await expectBlocked(h, {}, 'streakBroken');

    h.advance(CONFIG.cooldownAfterStreakBreakDays * DAY);
    expect(h.service.evaluate(STREAK_7, moment(h.now())).allowed).toBe(true);
  });

  it('blocks after a mis-tap correction', async () => {
    const h = harness();
    warmUp(h);
    h.service.noteMistapCorrection();
    await expectBlocked(h, {}, 'mistapCorrection');

    h.advance(CONFIG.cooldownAfterMistapDays * DAY);
    expect(h.service.evaluate(STREAK_7, moment(h.now())).allowed).toBe(true);
  });

  it('blocks after the user adjusted times or offsets', async () => {
    const h = harness();
    warmUp(h);
    h.service.noteTimesAdjusted();
    await expectBlocked(h, {}, 'timesAdjusted');

    h.advance(CONFIG.cooldownAfterTimesAdjustedDays * DAY - 1);
    expect(h.service.evaluate(STREAK_7, moment(h.now())).reason).toBe('timesAdjusted');
    h.advance(1);
    expect(h.service.evaluate(STREAK_7, moment(h.now())).allowed).toBe(true);
  });

  it('blocks on the first day of Ramadan', async () => {
    const h = harness();
    warmUp(h);
    await expectBlocked(
      h,
      { hijriToday: hijri(9, 1), hijriTomorrow: hijri(9, 2) },
      'ramadanEdgeDay'
    );
  });

  it('blocks on the last day of Ramadan', async () => {
    const h = harness();
    warmUp(h);
    await expectBlocked(
      h,
      { hijriToday: hijri(9, 29), hijriTomorrow: hijri(10, 1) },
      'ramadanEdgeDay'
    );
  });

  it('allows in the middle of Ramadan — the month itself is not an exclusion', async () => {
    const h = harness();
    warmUp(h);
    const outcome = await h.service.request(
      STREAK_7,
      moment(h.now(), { hijriToday: hijri(9, 14), hijriTomorrow: hijri(9, 15) })
    );
    expect(outcome.prompted).toBe(true);
  });

  it('blocks while the user is still setting up', async () => {
    const h = harness();
    warmUp(h);
    await expectBlocked(h, { setupComplete: false }, 'setupIncomplete');
  });

  it('blocks in a session where the user has already given something (D29)', async () => {
    const h = harness();
    warmUp(h);
    // Somebody who has just left a tip must not then be asked for stars. Nothing is spent — no
    // attempt, no fired trigger — so the moment is still available in a later session.
    await expectBlocked(h, { alreadyGaveThisSession: true }, 'alreadyGaveThisSession');
    expect(h.service.snapshot().attemptCount).toBe(0);

    // A fresh session (the flag is process-scoped, so it arrives as `false` again) still may.
    expect((await h.service.request(STREAK_7, moment(h.now()))).prompted).toBe(true);
  });

  it('treats an omitted `alreadyGaveThisSession` as "nothing given"', async () => {
    const h = harness();
    warmUp(h);
    expect(h.service.evaluate(STREAK_7, moment(h.now())).allowed).toBe(true);
  });

  it('blocks before the moment has landed, and allows once it has', async () => {
    const h = harness({ ...CONFIG, settleDelayMs: 2500 });
    warmUp(h);
    const at = h.now();
    expect(h.service.evaluate(STREAK_7, moment(at, { momentAt: at - 100 })).reason).toBe(
      'notSettled'
    );
    expect(h.service.evaluate(STREAK_7, moment(at, { momentAt: at - 2500 })).allowed).toBe(true);
  });

  it('blocks when the app has not been installed long enough', async () => {
    const h = harness({ ...CONFIG, minDaysSinceInstall: 3 });
    warmUp(h);
    await expectBlocked(h, {}, 'tooSoonAfterInstall');

    h.advance(3 * DAY);
    expect(h.service.evaluate(STREAK_7, moment(h.now())).allowed).toBe(true);
  });

  it('blocks until the app has been opened enough times', async () => {
    const h = harness({ ...CONFIG, minSessionsBeforeFirstPrompt: 4 });
    warmUp(h, 3);
    await expectBlocked(h, {}, 'tooFewSessions');

    h.restart();
    h.service.startSession();
    expect(h.service.evaluate(STREAK_7, moment(h.now())).allowed).toBe(true);
  });

  it('blocks when the whole feature is switched off', async () => {
    const h = harness({ ...CONFIG, enabled: false });
    warmUp(h);
    await expectBlocked(h, {}, 'disabled');
  });
});

// ---------------------------------------------------------------------------
// The unclean-shutdown heuristic (NOT crash detection — see the module header)
// ---------------------------------------------------------------------------

describe('the unclean-shutdown gate', () => {
  it('blocks after a session that never reached background', async () => {
    const h = harness();
    h.service.startSession();
    // No endSession(): the process went away with the session still open.
    h.restart({ clean: false });
    h.service.startSession();

    const outcome = await h.service.request(STREAK_7, moment(h.now()));
    expect(outcome).toEqual({ prompted: false, reason: 'uncleanPreviousSession' });
    expect(h.adapter.requestCount).toBe(0);
  });

  it('reports the unclean previous session to the caller', () => {
    const h = harness();
    h.service.startSession();
    h.restart({ clean: false });
    expect(h.service.startSession()).toEqual({ ordinal: 2, previousSessionUnclean: true });
  });

  it('does not block after a clean exit', () => {
    const h = harness();
    h.service.startSession();
    h.restart();
    expect(h.service.startSession()).toEqual({ ordinal: 2, previousSessionUnclean: false });
    expect(h.service.evaluate(STREAK_7, moment(h.now())).allowed).toBe(true);
  });

  it('expires after the configured cooldown', () => {
    const h = harness();
    h.service.startSession();
    h.restart({ clean: false });
    h.service.startSession();
    expect(h.service.evaluate(STREAK_7, moment(h.now())).reason).toBe('uncleanPreviousSession');

    h.advance(CONFIG.cooldownAfterUncleanSessionDays * DAY);
    expect(h.service.evaluate(STREAK_7, moment(h.now())).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Throttling across sessions
// ---------------------------------------------------------------------------

describe('throttling', () => {
  it('holds the 90-day cooldown across a restart', async () => {
    const h = harness();
    warmUp(h);
    expect((await h.service.request(STREAK_7, moment(h.now()))).prompted).toBe(true);

    h.advance(CONFIG.cooldownDays * DAY - 1);
    h.restart();
    h.service.startSession();
    expect(await h.service.request(WEEK, moment(h.now()))).toEqual({
      prompted: false,
      reason: 'cooldown',
    });

    h.advance(1);
    expect((await h.service.request(WEEK, moment(h.now()))).prompted).toBe(true);
    expect(h.adapter.requestCount).toBe(2);
  });

  it('spends exactly three attempts in a lifetime, then never asks again', async () => {
    const h = harness();
    warmUp(h);
    const triggers: ReviewTrigger[] = [STREAK_7, WEEK, STREAK_30, SETUP];

    const reasons: (ReviewBlockReason | null)[] = [];
    for (const trigger of triggers) {
      const outcome = await h.service.request(trigger, moment(h.now()));
      reasons.push(outcome.reason);
      h.advance(CONFIG.cooldownDays * DAY + DAY);
      h.restart();
      h.service.startSession();
    }

    expect(reasons).toEqual([null, null, null, 'lifetimeCapReached']);
    expect(h.adapter.requestCount).toBe(CONFIG.lifetimeCap);
    expect(h.service.snapshot().attemptCount).toBe(CONFIG.lifetimeCap);
  });

  it('records the attempt timestamp that the cooldown is measured from', async () => {
    const h = harness();
    warmUp(h);
    const at = h.now();
    await h.service.request(STREAK_7, moment(at));
    expect(h.service.snapshot().lastAttemptAt).toBe(at);
  });
});

// ---------------------------------------------------------------------------
// The OS side
// ---------------------------------------------------------------------------

describe('an unavailable review API', () => {
  it('degrades silently — no throw, nothing spent, and the trigger stays live', async () => {
    const h = harness();
    warmUp(h);
    h.adapter.setAvailable(false);

    const outcome = await h.service.request(STREAK_7, moment(h.now()));
    expect(outcome).toEqual({ prompted: false, reason: 'unavailable' });
    expect(h.adapter.requestCount).toBe(0);
    expect(h.service.snapshot().attemptCount).toBe(0);
    expect(h.service.snapshot().firedTriggers).toEqual([]);

    // Next session, on a build where the API works, the same moment is still spendable.
    h.adapter.setAvailable(true);
    h.restart();
    h.service.startSession();
    expect((await h.service.request(STREAK_7, moment(h.now()))).prompted).toBe(true);
  });

  it('asks the OS about availability once per session, not once per trigger', async () => {
    const h = harness();
    warmUp(h);
    h.adapter.setAvailable(false);
    await h.service.request(STREAK_7, moment(h.now()));
    await h.service.request(WEEK, moment(h.now()));
    expect(h.adapter.availabilityCount).toBe(1);
  });

  it('treats a throwing availability check as unavailable', async () => {
    const adapter = createFakeReviewAdapter();
    adapter.isAvailable = () => Promise.reject(new Error('no native module'));
    const service = createReviewService({
      adapter,
      storage: createMemoryReviewStorage(),
      config: CONFIG,
      now: () => T0,
    });
    service.startSession();
    service.endSession();
    service.startSession();
    await expect(service.request(STREAK_7, moment(T0))).resolves.toEqual({
      prompted: false,
      reason: 'unavailable',
    });
  });
});

describe('a throwing requestReview', () => {
  it('spends nothing and leaves the trigger available for a later session', async () => {
    const h = harness();
    warmUp(h);
    h.adapter.failWith(new Error('SKStoreReviewController is unhappy'));

    const outcome = await h.service.request(STREAK_7, moment(h.now()));
    expect(outcome).toEqual({ prompted: false, reason: 'requestFailed' });
    expect(h.service.snapshot().attemptCount).toBe(0);
    expect(h.service.snapshot().firedTriggers).toEqual([]);

    h.adapter.failWith(null);
    h.restart();
    h.service.startSession();
    expect((await h.service.request(STREAK_7, moment(h.now()))).prompted).toBe(true);
  });
});

describe('concurrent requests', () => {
  it('cannot double-spend an attempt', async () => {
    const h = harness();
    warmUp(h);
    const [first, second] = await Promise.all([
      h.service.request(STREAK_7, moment(h.now())),
      h.service.request(WEEK, moment(h.now())),
    ]);
    expect([first.prompted, second.prompted].filter(Boolean)).toHaveLength(1);
    expect(h.adapter.requestCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The local log
// ---------------------------------------------------------------------------

describe('the attempt log', () => {
  it('records why every offered moment did or did not prompt', async () => {
    const h = harness();
    warmUp(h);
    await h.service.request(STREAK_7, moment(h.now(), { inPrayerWindow: true }));
    await h.service.request(STREAK_7, moment(h.now()));

    const log = h.service.history();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      trigger: 'streakMilestone:7',
      decision: 'blocked',
      reason: 'prayerWindow',
      session: 2,
    });
    expect(log[1]).toMatchObject({ decision: 'prompted', reason: null });
  });

  it('survives a restart, so yesterday’s decision is still readable', async () => {
    const h = harness();
    warmUp(h);
    await h.service.request(STREAK_7, moment(h.now(), { adhanPlaying: true }));
    h.restart();
    expect(h.service.history()[0].reason).toBe('adhanPlaying');
  });

  it('is capped, oldest first', async () => {
    const h = harness({ ...CONFIG, maxLogEntries: 3 });
    warmUp(h);
    for (let i = 0; i < 6; i += 1) {
      await h.service.request(STREAK_7, moment(h.now() + i, { inPrayerWindow: true }));
    }
    const log = h.service.history();
    expect(log).toHaveLength(3);
    expect(log[0].at).toBe(h.now() + 3);
  });

  it('is a copy — a caller cannot mutate the stored state through it', () => {
    const h = harness();
    const log = h.service.history() as ReviewLogEntryArray;
    log.push({ at: 0, trigger: 'x', session: 0, decision: 'prompted', reason: null });
    expect(h.service.history()).toHaveLength(0);
  });
});

/** Local alias so the mutation test can push onto the readonly array on purpose. */
type ReviewLogEntryArray =
  ReturnType<ReviewService['history']> extends readonly (infer T)[] ? T[] : never;

describe('explain', () => {
  it('returns the same verdict as evaluate', () => {
    const h = harness();
    warmUp(h);
    const at = moment(h.now(), { inPrayerWindow: true });
    expect(h.service.explain(STREAK_7, at)).toEqual(h.service.evaluate(STREAK_7, at));
  });

  it('records a refusal that never became an attempt', () => {
    const h = harness();
    warmUp(h);
    h.service.explain(STREAK_7, moment(h.now(), { adhanPlaying: true }));
    expect(h.service.history()).toHaveLength(1);
    expect(h.service.history()[0]).toMatchObject({ decision: 'blocked', reason: 'adhanPlaying' });
  });

  it('does not repeat itself while nothing changes', () => {
    const h = harness();
    warmUp(h);
    for (let i = 0; i < 5; i += 1) {
      h.service.explain(STREAK_7, moment(h.now(), { adhanPlaying: true }));
    }
    expect(h.service.history()).toHaveLength(1);
  });

  it('records the same trigger again when the reason changes', () => {
    const h = harness();
    warmUp(h);
    h.service.explain(STREAK_7, moment(h.now(), { adhanPlaying: true }));
    h.service.explain(STREAK_7, moment(h.now(), { inPrayerWindow: true }));
    expect(h.service.history().map((entry) => entry.reason)).toEqual([
      'adhanPlaying',
      'prayerWindow',
    ]);
  });

  it('dedupes per trigger, so alternating candidates do not flood the log', () => {
    const h = harness();
    warmUp(h);
    for (let i = 0; i < 4; i += 1) {
      h.service.explain(STREAK_7, moment(h.now(), { inPrayerWindow: true }));
      h.service.explain(WEEK, moment(h.now(), { inPrayerWindow: true }));
    }
    expect(h.service.history()).toHaveLength(2);
  });

  it('says nothing at all while a moment is merely still landing', () => {
    const h = harness({ ...CONFIG, settleDelayMs: 5000 });
    warmUp(h);
    const at = h.now();
    expect(h.service.explain(STREAK_7, moment(at, { momentAt: at })).reason).toBe('notSettled');
    expect(h.service.history()).toHaveLength(0);
  });

  it('writes nothing when the answer is yes — that is `request`’s job', () => {
    const h = harness();
    warmUp(h);
    expect(h.service.explain(STREAK_7, moment(h.now())).allowed).toBe(true);
    expect(h.service.history()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe('reset', () => {
  it('returns the install to a pristine state, session included', async () => {
    const h = harness();
    warmUp(h);
    await h.service.request(STREAK_7, moment(h.now()));
    h.service.reset();

    expect(h.service.snapshot()).toEqual(createDefaultReviewState());
    expect(h.service.evaluate(STREAK_7, moment(h.now())).reason).toBe('noSession');
    expect(h.storage.getItem(REVIEW_STORAGE_KEY) ?? null).toBeNull();
  });
});

describe('the steady-use trigger (D89)', () => {
  // The other three triggers all require a logged prayer or a tapped reminder. Someone who only
  // ever wants prayer times and a qibla satisfies none of them, ever — so before this existed
  // they could not be asked for a review at all, which for an app with no ads to advertise it
  // means losing its only discovery channel for a whole audience.
  /** Opens `count` further sessions, the way `restart` + a cold start would. */
  function openSessions(h: Harness, count: number): void {
    for (let i = 0; i < count; i += 1) {
      h.restart();
      h.service.startSession();
    }
  }

  function steadyHarness(): Harness {
    const h = harness();
    h.service.startSession();
    h.service.noteTimesShown();
    return h;
  }

  it('is unavailable to a fresh install, however many times it is opened', () => {
    const h = steadyHarness();
    openSessions(h, CONFIG.steadyUseSessions + 5);
    h.service.noteTimesShown();

    // Sessions alone are not enough: the install is still minutes old.
    expect(h.service.isSteadyUseReady()).toBe(false);
  });

  it('is unavailable to an old install that is barely opened', () => {
    const h = steadyHarness();
    h.advance(CONFIG.steadyUseMinDays * DAY_MS * 2);

    expect(h.service.isSteadyUseReady()).toBe(false);
  });

  it('needs times to have been shown — an install that never resolved a location is not "working"', () => {
    const h = harness();
    h.service.startSession();
    openSessions(h, CONFIG.steadyUseSessions);
    h.advance(CONFIG.steadyUseMinDays * DAY_MS);

    expect(h.service.isSteadyUseReady()).toBe(false);
  });

  it('opens once the app has quietly worked for long enough, and prompts', async () => {
    const h = steadyHarness();
    openSessions(h, CONFIG.steadyUseSessions);
    h.service.noteTimesShown();
    h.advance(CONFIG.steadyUseMinDays * DAY_MS);

    expect(h.service.isSteadyUseReady()).toBe(true);

    const outcome = await h.service.request(
      { kind: 'steadyUse' },
      {
        now: h.now(),
        momentAt: h.now() - CONFIG.settleDelayMs - 1,
        inPrayerWindow: false,
        adhanPlaying: false,
        setupComplete: true,
        alreadyGaveThisSession: false,
      }
    );

    expect(outcome.prompted).toBe(true);
    expect(h.adapter.requestCount).toBe(1);
  });

  it('is spent once, like every other trigger', async () => {
    const h = steadyHarness();
    openSessions(h, CONFIG.steadyUseSessions);
    h.service.noteTimesShown();
    h.advance(CONFIG.steadyUseMinDays * DAY_MS);

    const moment = () => ({
      now: h.now(),
      momentAt: h.now() - CONFIG.settleDelayMs - 1,
      inPrayerWindow: false,
      adhanPlaying: false,
      setupComplete: true,
      alreadyGaveThisSession: false,
    });
    await h.service.request({ kind: 'steadyUse' }, moment());

    // A new session, well past the cooldown, and it still refuses: one moment, one ask.
    h.advance(CONFIG.cooldownDays * DAY_MS * 2);
    h.restart();
    h.service.startSession();
    const again = await h.service.request({ kind: 'steadyUse' }, moment());

    expect(again.prompted).toBe(false);
    expect(again.reason).toBe('triggerAlreadyUsed');
  });

  it('obeys the same hard exclusions as every other trigger', async () => {
    const h = steadyHarness();
    openSessions(h, CONFIG.steadyUseSessions);
    h.service.noteTimesShown();
    h.advance(CONFIG.steadyUseMinDays * DAY_MS);

    const outcome = await h.service.request(
      { kind: 'steadyUse' },
      {
        now: h.now(),
        momentAt: h.now() - CONFIG.settleDelayMs - 1,
        inPrayerWindow: true,
        adhanPlaying: false,
        setupComplete: true,
        alreadyGaveThisSession: false,
      }
    );

    expect(outcome.prompted).toBe(false);
    expect(outcome.reason).toBe('prayerWindow');
  });
});
