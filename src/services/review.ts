/**
 * Store review prompting — the whole policy behind `expo-store-review`.
 *
 * PRODUCT_SPEC §13, decision D28. This module decides **whether** the OS may be asked to show its
 * native rating sheet, records that it asked, and explains — in a log you can read on a device —
 * why it did or did not. It never renders anything: there is no custom rating UI anywhere in this
 * app, by rule.
 *
 * ## The two things that make this different from every blog post about review prompts
 *
 * 1. **Pre-gating is banned.** "Enjoying the app?" → happy path to the store, unhappy path to a
 *    feedback form is the single most-recommended pattern on the internet and it is *forbidden*:
 *    Google says so in writing in the Play In-App Review docs, and Apple's 5.6.1 disallows custom
 *    review prompts outright. So there is no question, no dialog, no A/B fork. The app decides on
 *    behaviour alone and hands the moment straight to the OS.
 * 2. **There is no success callback.** `requestReview()` resolves whether the sheet appeared or
 *    the OS silently swallowed it, and neither platform will ever tell you whether a review was
 *    written. Every design decision here follows from that: we cannot optimise a funnel we cannot
 *    observe, so we spend a **small, fixed budget of attempts on moments we are confident about**
 *    and log our own reasoning locally so the behaviour is debuggable without telemetry.
 *
 * ## The Settings row is not this
 *
 * Settings → About's "Rate the app" row opens a **store deep link** (`services/appInfo.storeReviewUrl`).
 * It must never call this module. Google explicitly forbids wiring a call-to-action button to the
 * In-App Review API, and on iOS a CTA would spend one of the OS's three-per-year slots on a user
 * who was already walking to the store under their own power. Two different mechanisms, two
 * different call sites, deliberately.
 *
 * ## Triggers (PRODUCT_SPEC §13)
 *
 * | Trigger | Fires when |
 * |---|---|
 * | `streakMilestone` | `domain/streaks.streakMilestone` returns a length listed in `config/reviewTriggers` (7, then 30) |
 * | `firstCompleteWeek` | the first run of N consecutive days with all five prayers logged `prayed`/`late` |
 * | `setupSuccess` | prayer times are on screen for a real location **and** a reminder has been confirmed delivered |
 *
 * Each fires **at most once, ever** ({@link ReviewState.firedTriggers}), and at most one prompt is
 * attempted per session.
 *
 * ## Hard exclusions
 *
 * Every one of these is a binary rule with no tunable threshold, checked in {@link ReviewService.evaluate}
 * and reported as a {@link ReviewBlockReason}:
 *
 * - `prayerWindow` — never inside a prayer's window. The user is here to pray, not to rate.
 * - `adhanPlaying` / `adhanQuietPeriod` — never over the adhan, nor in the minutes after it.
 * - `streakBroken`, `mistapCorrection`, `timesAdjusted` — never after a signal of dissatisfaction.
 *   Adjusting offsets means our times were wrong for this user; asking for stars then is asking
 *   to be told so publicly.
 * - `ramadanEdgeDay` — not on Ramadan's first or last day. Those are the two days of the year the
 *   app is most used and least interruptible.
 * - `setupIncomplete`, `firstSession`, `tooFewSessions`, `tooSoonAfterInstall` — not during
 *   onboarding, and never in the first session.
 * - `alreadyGaveThisSession` — never in a session where the user has already given the app
 *   something (decision D29). Handed in as {@link ReviewMoment.alreadyGaveThisSession}, so this
 *   module stays unaware that the app has monetisation at all.
 * - `uncleanPreviousSession` — see the honesty note below.
 *
 * ## The crash gate is a heuristic, and is labelled as one
 *
 * PRODUCT_SPEC §13 asks for a "crash-free-session gate". **This app ships no crash reporter** —
 * no Sentry, no Crashlytics, no analytics SDK of any kind (D31), and `expo-updates` reports
 * nothing about the previous run's exit. So a genuine crash-free gate is not implementable with
 * what is installed, and this module does not pretend otherwise.
 *
 * What it implements instead is a **clean-shutdown marker**: {@link ReviewService.startSession}
 * writes `sessionOpen: true`, and the app writes `sessionOpen: false` when it backgrounds. If a
 * cold start finds the flag still `true`, the previous run ended without passing through
 * `background`. That is *consistent with* a crash — and equally consistent with a force-quit from
 * the app switcher or an OS memory kill, both of which are common and harmless. It also cannot
 * see a native crash that takes the process down before JS runs, and on a device that never
 * backgrounds cleanly it would suppress forever.
 *
 * It is kept because the error is one-directional: it only ever *suppresses* prompts. Read
 * `uncleanPreviousSession` in the log as "the last run did not exit through the front door",
 * never as "the app crashed".
 *
 * ## Storage
 *
 * State is a single JSON blob under {@link REVIEW_STORAGE_KEY}, through an injected
 * {@link ReviewStorage}. This module does not import `react-native-mmkv`: the MMKV import lives in
 * `stores/` (enforced by `src/__tests__/architecture.test.ts`), so the app-side wiring happens in
 * `hooks/useReviewPrompt.ts`, which binds the store's MMKV adapter. Everything read back from
 * storage goes through {@link sanitizeReviewState} — a corrupt blob must degrade to "never
 * prompted", never to "prompt on every launch".
 *
 * ## Native module safety
 *
 * `expo-store-review` is `require`d lazily inside {@link createExpoStoreReviewAdapter}, the same
 * seam `services/notifications.ts`, `location.ts` and `heading.ts` use, so importing this file is
 * safe under Jest and in node scripts. A missing or throwing native module degrades to
 * "unavailable" — a blocked prompt, never a crash.
 *
 * Dependency rule: `services → domain`. No React, no stores, no user-facing strings.
 */

import { noteSessionMoment } from './supportMoments';
import { addDays, isValidDay } from '../domain/dates';
import type { HijriDate } from '../domain/hijri';
import { PRAYERS, type DayRecord, type PrayerDay, type PrayerStatus } from '../domain/types';
import {
  DAY_MS,
  REVIEW_TRIGGERS,
  type ReviewTriggerConfig,
  type ReviewTriggerKind,
} from '../config/reviewTriggers';

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/** Re-exported so callers need only one import to name a trigger. */
export type { ReviewTriggerKind };

/** A concrete delight moment offered to {@link ReviewService.request}. */
export type ReviewTrigger =
  | { kind: 'streakMilestone'; milestone: number }
  | { kind: 'firstCompleteWeek' }
  | { kind: 'setupSuccess' }
  | { kind: 'steadyUse' };

/**
 * The stable identity a trigger is remembered by, e.g. `streakMilestone:7`.
 *
 * Persisted in {@link ReviewState.firedTriggers}, so it must never change shape for a trigger
 * that has already shipped — a renamed key would let an old install prompt a second time for a
 * milestone it already used.
 *
 * @param trigger - The moment.
 * @returns Its persisted key.
 */
export function triggerKey(trigger: ReviewTrigger): string {
  return trigger.kind === 'streakMilestone'
    ? `streakMilestone:${String(trigger.milestone)}`
    : trigger.kind;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/**
 * Every reason a prompt can be refused, in roughly the order they are checked.
 *
 * Machine values, written to the local log and never shown to a user. Exhaustive on purpose: a
 * silent "nothing happened" is the failure mode that makes review prompting impossible to debug
 * on a device you cannot attach a profiler to.
 */
export const REVIEW_BLOCK_REASONS = [
  /** The kill switch in `config/reviewTriggers` is off. */
  'disabled',
  /** A streak milestone that this config does not prompt on (e.g. 3, 100, 365). */
  'triggerNotConfigured',
  /** `request` was called before `startSession`. A wiring bug; never prompts. */
  'noSession',
  /** The first session of this install. Never prompts, under any trigger. */
  'firstSession',
  /** Fewer sessions than `minSessionsBeforeFirstPrompt`. */
  'tooFewSessions',
  /** Installed more recently than `minDaysSinceInstall`. */
  'tooSoonAfterInstall',
  /** Times are not on screen yet, or no location — the user is still setting up. */
  'setupIncomplete',
  /** One prompt per session, and this session already used its one. */
  'alreadyPromptedThisSession',
  /**
   * The app has already asked this user for something else in this session and they said yes.
   * See {@link ReviewMoment.alreadyGaveThisSession}.
   */
  'alreadyGaveThisSession',
  /** This exact trigger has already been spent. */
  'triggerAlreadyUsed',
  /** `lifetimeCap` attempts have been made on this install. */
  'lifetimeCapReached',
  /** Fewer than `cooldownDays` since the last attempt. */
  'cooldown',
  /** The previous session did not end through `background`. See the module header. */
  'uncleanPreviousSession',
  /** `now` is inside a prayer's window. */
  'prayerWindow',
  /** Adhan audio is playing right now. */
  'adhanPlaying',
  /** Adhan audio stopped less than `quietAfterAdhanMs` ago. */
  'adhanQuietPeriod',
  /** A streak break was observed within `cooldownAfterStreakBreakDays`. */
  'streakBroken',
  /** A mis-tap correction was observed within `cooldownAfterMistapDays`. */
  'mistapCorrection',
  /** Times/offsets/method were adjusted within `cooldownAfterTimesAdjustedDays`. */
  'timesAdjusted',
  /** Ramadan's first or last day. */
  'ramadanEdgeDay',
  /** The moment has not settled for `settleDelayMs` yet. */
  'notSettled',
  /** Another `request` is mid-flight. */
  'inFlight',
  /** `expo-store-review` reports it cannot show a review flow here. */
  'unavailable',
  /** The native call threw. Nothing is spent; the trigger may fire again next session. */
  'requestFailed',
] as const;

export type ReviewBlockReason = (typeof REVIEW_BLOCK_REASONS)[number];

/** The synchronous verdict from {@link ReviewService.evaluate}. */
export interface ReviewDecision {
  /** `true` when nothing in the app's own policy objects. The OS may still decline. */
  allowed: boolean;
  /** Why not, or `null` when {@link allowed}. */
  reason: ReviewBlockReason | null;
}

/** What {@link ReviewService.request} actually did. */
export interface ReviewOutcome {
  /**
   * `true` when `requestReview()` was called and did not throw.
   *
   * It does **not** mean a sheet appeared, and can never mean a review was written — neither
   * platform reports either. Treat it as "we spent one of our attempts".
   */
  prompted: boolean;
  /** Why nothing was requested, or `null` when {@link prompted}. */
  reason: ReviewBlockReason | null;
}

/** One line of the local attempt log. Never leaves the device — there is no server (D31). */
export interface ReviewLogEntry {
  /** Epoch ms. */
  at: number;
  /** The moment that was offered, as {@link triggerKey}. */
  trigger: string;
  /** Which session (1-based) this happened in. */
  session: number;
  /** `prompted` means the native call was made; `blocked` means it was not. */
  decision: 'prompted' | 'blocked';
  /** The block reason, or `null` for a prompt. */
  reason: ReviewBlockReason | null;
}

// ---------------------------------------------------------------------------
// The moment
// ---------------------------------------------------------------------------

/**
 * Everything about *right now* that the policy cannot know by itself.
 *
 * Gathered by the caller and passed in, never read ambiently — the same discipline
 * `services/notifications.ts` applies to `SyncInput`, and what makes the exclusion rules testable
 * without a device.
 */
export interface ReviewMoment {
  /** Epoch ms. */
  now: number;
  /**
   * Epoch ms the delight moment happened. The prompt waits `settleDelayMs` after it, so a prompt
   * can never land on top of the tap that caused it.
   */
  momentAt: number;
  /** `true` when `now` falls inside a prayer window (`domain/prayerTimes.getCurrentPrayer`). */
  inPrayerWindow: boolean;
  /** `true` while adhan audio is actually sounding. */
  adhanPlaying: boolean;
  /** `true` once a location is set and prayer times have been rendered at least once. */
  setupComplete: boolean;
  /**
   * `true` when the user has already given the app something in this session — today that means a
   * completed tip (PRODUCT_SPEC §14, decision D29: the two asks never share a session).
   *
   * Passed in as a plain fact about now, for the same reason `adhanPlaying` is: this module must
   * stay unaware that the app has monetisation at all, and the caller
   * (`hooks/useReviewPrompt.ts` over `services/supportMoments.ts`) is the one place that knows.
   *
   * Omitted means `false`. The direction is one-way on purpose — a review prompt is the ask that
   * *interrupts*, so it is the one that yields.
   */
  alreadyGaveThisSession?: boolean;
  /** Today's Hijri date, for the Ramadan edge rule. `null` skips that check. */
  hijriToday?: HijriDate | null;
  /** Tomorrow's Hijri date; the only way to recognise the *last* day of Ramadan. */
  hijriTomorrow?: HijriDate | null;
}

// ---------------------------------------------------------------------------
// Ramadan
// ---------------------------------------------------------------------------

/** Ramadan is the ninth Hijri month. */
const RAMADAN_MONTH = 9;

/**
 * Whether a day is Ramadan's first or last (PRODUCT_SPEC §13).
 *
 * The last day cannot be recognised from a single date — Ramadan runs 29 or 30 days and which one
 * is not known until the crescent is sighted — so it is defined structurally: *today is Ramadan
 * and tomorrow is not*. That is correct under both the `intl` (Umm al-Qura) and `tabular` engines
 * in `domain/hijri`, and under the user's ±2-day Hijri offset, as long as both dates were
 * converted with the same offset.
 *
 * @param today - Today's Hijri date, or `null`/`undefined` when unknown.
 * @param tomorrow - Tomorrow's Hijri date. Omitted, only the first-day rule applies.
 * @returns `true` on 1 Ramadan and on the final day of Ramadan.
 */
export function isRamadanEdgeDay(
  today: HijriDate | null | undefined,
  tomorrow?: HijriDate | null
): boolean {
  if (today === null || today === undefined || today.month !== RAMADAN_MONTH) return false;
  if (today.day === 1) return true;
  if (tomorrow === null || tomorrow === undefined) return false;
  return tomorrow.month !== RAMADAN_MONTH;
}

// ---------------------------------------------------------------------------
// The complete week
// ---------------------------------------------------------------------------

/** The two statuses that count as "prayed" for the complete-week rule. */
const GREEN_STATUSES: readonly PrayerStatus[] = Object.freeze(['prayed', 'late']);

/**
 * Whether the `weekDays` days ending at `endDay` are *all* fully logged.
 *
 * Deliberately stricter than a hard-mode streak of the same length, which `domain/streaks` lets an
 * exempt day **bridge**. PRODUCT_SPEC §13 asks for "a week with all days fully green", and an
 * exempt day is not green — it is a respectful blank. So an exempt day inside the window fails the
 * check, and the trigger simply waits for a week that qualifies.
 *
 * `missed` and `unlogged` both fail, in keeping with PRODUCT_SPEC §4: unlogged is never treated as
 * missed, but neither is it treated as prayed.
 *
 * @param records - Day records covering at least the window; extra days are ignored, duplicates
 *   resolve to the last one seen.
 * @param endDay - The last day of the window, `YYYY-MM-DD`. Should be a **closed** day.
 * @param weekDays - Window length; values below 1 return `false`.
 * @returns `true` when every day in the window has all five prayers `prayed` or `late` and is not
 *   exempt.
 * @throws RangeError if `endDay` is not a valid day string.
 */
export function isFullyCompleteWeek(
  records: readonly DayRecord[],
  endDay: PrayerDay,
  weekDays: number
): boolean {
  if (!isValidDay(endDay)) throw new RangeError(`Invalid day: ${String(endDay)}`);
  if (!Number.isInteger(weekDays) || weekDays < 1) return false;

  const byDay = new Map<PrayerDay, DayRecord>();
  for (const record of records) byDay.set(record.day, record);

  for (let back = 0; back < weekDays; back += 1) {
    const record = byDay.get(addDays(endDay, -back));
    if (record === undefined || record.isExempt) return false;
    if (!PRAYERS.every((prayer) => GREEN_STATUSES.includes(record.statuses[prayer]))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------

/** Bumped when the shape below changes incompatibly; an older blob is discarded, not migrated. */
export const REVIEW_STATE_VERSION = 1;

/** The key the blob is stored under, inside whatever namespace the adapter owns. */
export const REVIEW_STORAGE_KEY = 'reviewPrompt';

/** Everything the policy remembers between launches. */
export interface ReviewState {
  version: number;
  /** Epoch ms of the first session ever seen; the anchor for `minDaysSinceInstall`. */
  installedAt: number | null;
  /** How many sessions have been started. The current session's ordinal. */
  sessionCount: number;
  /**
   * `true` between {@link ReviewService.startSession} and {@link ReviewService.endSession}.
   * Finding it `true` at a cold start is the unclean-shutdown signal — see the module header for
   * exactly how much that is and is not worth.
   */
  sessionOpen: boolean;
  /** Epoch ms a cold start last found {@link sessionOpen} already set. */
  lastUncleanAt: number | null;
  /** How many times `requestReview()` has been called on this install. */
  attemptCount: number;
  /** Epoch ms of the last attempt. */
  lastAttemptAt: number | null;
  /** {@link triggerKey}s already spent. Each trigger fires once, ever. */
  firedTriggers: string[];
  /** Epoch ms a streak break was last observed. */
  lastStreakBreakAt: number | null;
  /** Epoch ms a mis-tap correction was last observed. */
  lastMistapAt: number | null;
  /** Epoch ms prayer times / offsets / method were last adjusted. */
  lastTimesAdjustedAt: number | null;
  /** Epoch ms adhan audio last finished. */
  lastAdhanAt: number | null;
  /** Epoch ms prayer times were first rendered for a real location. */
  timesShownAt: number | null;
  /** Epoch ms a reminder was first confirmed delivered (a tap on one of ours proves it). */
  reminderConfirmedAt: number | null;
  /** Newest last. Capped at `maxLogEntries`. */
  log: ReviewLogEntry[];
}

/** A pristine state: nothing seen, nothing spent. */
export function createDefaultReviewState(): ReviewState {
  return {
    version: REVIEW_STATE_VERSION,
    installedAt: null,
    sessionCount: 0,
    sessionOpen: false,
    lastUncleanAt: null,
    attemptCount: 0,
    lastAttemptAt: null,
    firedTriggers: [],
    lastStreakBreakAt: null,
    lastMistapAt: null,
    lastTimesAdjustedAt: null,
    lastAdhanAt: null,
    timesShownAt: null,
    reminderConfirmedAt: null,
    log: [],
  };
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function sanitizeLogEntry(value: unknown): ReviewLogEntry | null {
  if (value === null || typeof value !== 'object') return null;
  const entry = value as Partial<ReviewLogEntry>;
  const at = finiteOrNull(entry.at);
  if (at === null || typeof entry.trigger !== 'string') return null;
  const decision = entry.decision === 'prompted' ? 'prompted' : 'blocked';
  const reason =
    typeof entry.reason === 'string' &&
    (REVIEW_BLOCK_REASONS as readonly string[]).includes(entry.reason)
      ? (entry.reason as ReviewBlockReason)
      : null;
  return { at, trigger: entry.trigger, session: nonNegativeInt(entry.session), decision, reason };
}

/**
 * The storage trust boundary.
 *
 * Anything unrecognised becomes the default. The direction of every fallback is "as if we had
 * never prompted, but also as if nothing is owed": a corrupt blob must not be able to *unlock*
 * prompting (`attemptCount` and `firedTriggers` are the fields that hold the budget), which is
 * why they clamp toward zero only when the stored value is not a usable number at all.
 *
 * @param input - Anything; typically `JSON.parse` of a stored string.
 * @returns A complete, self-consistent {@link ReviewState}.
 */
export function sanitizeReviewState(input: unknown): ReviewState {
  const base = createDefaultReviewState();
  if (input === null || typeof input !== 'object') return base;
  const raw = input as Partial<ReviewState> & Record<string, unknown>;
  // A blob from a future (or foreign) version is not merged field-by-field: an unknown shape is
  // exactly the case where partial trust is worse than none.
  if (raw.version !== REVIEW_STATE_VERSION) return base;

  return {
    version: REVIEW_STATE_VERSION,
    installedAt: finiteOrNull(raw.installedAt),
    sessionCount: nonNegativeInt(raw.sessionCount),
    sessionOpen: raw.sessionOpen === true,
    lastUncleanAt: finiteOrNull(raw.lastUncleanAt),
    attemptCount: nonNegativeInt(raw.attemptCount),
    lastAttemptAt: finiteOrNull(raw.lastAttemptAt),
    firedTriggers: Array.isArray(raw.firedTriggers)
      ? [...new Set(raw.firedTriggers.filter((key): key is string => typeof key === 'string'))]
      : [],
    lastStreakBreakAt: finiteOrNull(raw.lastStreakBreakAt),
    lastMistapAt: finiteOrNull(raw.lastMistapAt),
    lastTimesAdjustedAt: finiteOrNull(raw.lastTimesAdjustedAt),
    lastAdhanAt: finiteOrNull(raw.lastAdhanAt),
    timesShownAt: finiteOrNull(raw.timesShownAt),
    reminderConfirmedAt: finiteOrNull(raw.reminderConfirmedAt),
    log: Array.isArray(raw.log)
      ? raw.log.map(sanitizeLogEntry).filter((entry): entry is ReviewLogEntry => entry !== null)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * The synchronous string storage the state is persisted through — the same three-method subset of
 * MMKV that `stores/settingsStore.SettingsStorage` describes, restated here so this module needs
 * no dependency on the store.
 */
export interface ReviewStorage {
  /** `null`/`undefined` both mean "nothing stored"; MMKV wrappers differ on which they return. */
  getItem(key: string): string | null | undefined;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * An in-memory {@link ReviewStorage}.
 *
 * Exported from the production module for the same reason the fake adapters are: the seam has to
 * be reachable without importing a test file, and it is also the honest fallback on a platform
 * with no MMKV (web), where "nothing persists" is better than a crash.
 *
 * @param seed - Optional initial contents.
 * @returns A `Map`-backed storage.
 */
export function createMemoryReviewStorage(seed?: Record<string, string>): ReviewStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

// ---------------------------------------------------------------------------
// Native adapter
// ---------------------------------------------------------------------------

/** Everything the service needs from the platform. Two calls; neither reports success. */
export interface ReviewAdapter {
  /**
   * `expo-store-review`'s `isAvailableAsync()`. `false` on web, on TestFlight builds, and on
   * Android below 5.0.
   */
  isAvailable(): Promise<boolean>;
  /**
   * `expo-store-review`'s `requestReview()`. Resolving proves only that the call was made — the
   * OS may have shown nothing at all.
   */
  requestReview(): Promise<void>;
}

type ExpoStoreReviewModule = typeof import('expo-store-review');

/**
 * The real adapter, over `expo-store-review`.
 *
 * The native module is `require`d lazily on first use, so importing this file never loads it —
 * Jest stays clean, and a dev client that does not contain the module degrades to "unavailable"
 * instead of taking the app down at startup.
 *
 * @returns A {@link ReviewAdapter} whose `isAvailable` resolves `false` rather than throwing when
 *   the module is missing.
 */
export function createExpoStoreReviewAdapter(): ReviewAdapter {
  let module: ExpoStoreReviewModule | null = null;
  const load = (): ExpoStoreReviewModule | null => {
    if (module === null) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        module = require('expo-store-review') as ExpoStoreReviewModule;
      } catch {
        return null;
      }
    }
    return module;
  };

  return {
    async isAvailable() {
      const loaded = load();
      if (loaded === null) return false;
      return await loaded.isAvailableAsync();
    },
    async requestReview() {
      const loaded = load();
      if (loaded === null) throw new Error('expo-store-review is not available in this binary');
      await loaded.requestReview();
    },
  };
}

/** A scriptable {@link ReviewAdapter}: the test's fake OS. */
export interface FakeReviewAdapter extends ReviewAdapter {
  /** Sets what `isAvailable` resolves to. */
  setAvailable(available: boolean): void;
  /** Makes every `requestReview` reject with this error (`null` clears it). */
  failWith(error: unknown): void;
  /** How many times `requestReview` was called — the only observable a real OS gives us. */
  readonly requestCount: number;
  /** How many times availability was queried. */
  readonly availabilityCount: number;
}

/**
 * Builds a scriptable {@link ReviewAdapter}.
 *
 * @param available - Initial availability; defaults to `true`.
 * @returns The fake adapter.
 */
export function createFakeReviewAdapter(available = true): FakeReviewAdapter {
  let isAvailable = available;
  let failure: unknown = null;
  let requestCount = 0;
  let availabilityCount = 0;

  return {
    isAvailable() {
      availabilityCount += 1;
      return Promise.resolve(isAvailable);
    },
    requestReview() {
      requestCount += 1;
      return failure === null ? Promise.resolve() : Promise.reject(failure);
    },
    setAvailable(next) {
      isAvailable = next;
    },
    failWith(error) {
      failure = error;
    },
    get requestCount() {
      return requestCount;
    },
    get availabilityCount() {
      return availabilityCount;
    },
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** What {@link ReviewService.startSession} reports about the session it just opened. */
export interface ReviewSessionInfo {
  /** 1-based. `1` is the very first launch of this install, which never prompts. */
  ordinal: number;
  /** `true` when the previous session did not end through `background`. See the module header. */
  previousSessionUnclean: boolean;
}

/** The surface `hooks/useReviewPrompt` consumes. Nothing here throws. */
export interface ReviewService {
  /**
   * Opens a session. Call once per cold start, before anything else.
   *
   * Increments the session counter, stamps `installedAt` on the very first call, and detects an
   * unclean previous exit.
   *
   * @param now - Epoch ms; defaults to the injected clock.
   * @returns The new session's {@link ReviewSessionInfo}.
   */
  startSession(now?: number): ReviewSessionInfo;

  /**
   * Closes the session cleanly. Call when the app backgrounds — every time, cheaply; it is the
   * only thing that distinguishes a normal exit from an abrupt one.
   */
  endSession(): void;

  /** Records that prayer times have been rendered for a real location. Idempotent. */
  noteTimesShown(now?: number): void;
  /** Records that a reminder was confirmed delivered (a tap on ours proves it). Idempotent. */
  noteReminderDelivered(now?: number): void;
  /** Records a streak break. Suppresses prompting for `cooldownAfterStreakBreakDays`. */
  noteStreakBreak(now?: number): void;
  /** Records a mis-tap correction. Suppresses prompting for `cooldownAfterMistapDays`. */
  noteMistapCorrection(now?: number): void;
  /** Records a times/offset/method adjustment — the loudest dissatisfaction signal we have. */
  noteTimesAdjusted(now?: number): void;
  /** Records that adhan audio finished, opening the `quietAfterAdhanMs` window. */
  noteAdhanFinished(now?: number): void;

  /** `true` once both halves of the setup-success trigger have been recorded. */
  isSetupSuccessReady(): boolean;

  /**
   * Whether the quiet, long-standing-user moment is available (D89).
   *
   * The other three triggers all require the user to log a prayer or tap a reminder. Someone who
   * only ever wants prayer times and a qibla satisfies none of them, ever, and would never be
   * asked — which CLAUDE.md's two-audiences rule forbids treating as acceptable, and which costs
   * the app the one discovery channel it has.
   *
   * @param now - Epoch ms; defaults to the service clock.
   * @returns `true` once times have been shown, the install is old enough and the app has been
   *   opened enough times.
   */
  isSteadyUseReady(now?: number): boolean;

  /**
   * The synchronous verdict, with no side effects at all — safe to call from a render or a
   * `useEffect` guard.
   *
   * @param trigger - The moment being offered.
   * @param moment - Everything about now; see {@link ReviewMoment}.
   * @returns Whether the app's own policy permits a prompt, and why not if it does not. It does
   *   **not** consult the OS: availability is asynchronous and is checked by {@link request}.
   */
  evaluate(trigger: ReviewTrigger, moment: ReviewMoment): ReviewDecision;

  /**
   * {@link evaluate}, plus a log entry when the answer is no.
   *
   * This is the call an observer makes *before* arming its settle timer, so that "we saw the
   * milestone and declined" is recorded even when no attempt is ever made. Without it the two
   * most common outcomes — refused early, and never noticed at all — would be indistinguishable
   * in the only diagnostic this app has.
   *
   * Two kinds of noise are suppressed: `notSettled`, which is the *expected* answer while a
   * moment is still landing, and a verdict identical to the last one already recorded **for that
   * same trigger** (a screen re-rendering ten times a second, or an observer offering three
   * candidates per store change, must not fill the log with one repeated sentence).
   *
   * @param trigger - The moment being offered.
   * @param moment - Everything about now.
   * @returns The same {@link ReviewDecision} {@link evaluate} would return.
   */
  explain(trigger: ReviewTrigger, moment: ReviewMoment): ReviewDecision;

  /**
   * Evaluates, and on success asks the OS for its native review sheet.
   *
   * Never throws and never rejects. Every path writes exactly one {@link ReviewLogEntry}.
   *
   * @param trigger - The moment being offered.
   * @param moment - Everything about now.
   * @returns What happened. `prompted: true` means the native call was made — not that a review
   *   was left, which is unknowable.
   */
  request(trigger: ReviewTrigger, moment: ReviewMoment): Promise<ReviewOutcome>;

  /** A copy of the persisted state. For the debug surface and for tests. */
  snapshot(): ReviewState;

  /** The local attempt log, oldest first. Never leaves the device. */
  history(): readonly ReviewLogEntry[];

  /** Wipes everything, including the spent budget. Debug/testing only. */
  reset(): void;
}

/** Construction-time dependencies of {@link createReviewService}. */
export interface ReviewServiceOptions {
  /** Platform access. Defaults to {@link createExpoStoreReviewAdapter}. */
  adapter?: ReviewAdapter;
  /** Where state is persisted. Defaults to {@link createMemoryReviewStorage} (nothing survives). */
  storage?: ReviewStorage;
  /** Key inside the storage namespace. Defaults to {@link REVIEW_STORAGE_KEY}. */
  storageKey?: string;
  /** The policy. Defaults to {@link REVIEW_TRIGGERS}. */
  config?: ReviewTriggerConfig;
  /** Epoch-ms clock, injected so tests can pin time. Defaults to `Date.now`. */
  now?: () => number;
}

/** `true` when `stamp` is set and less than `days` days before `now`. */
function withinDays(stamp: number | null, now: number, days: number): boolean {
  if (stamp === null) return false;
  if (!Number.isFinite(days) || days <= 0) return false;
  return now - stamp < days * DAY_MS;
}

/**
 * Builds a {@link ReviewService}.
 *
 * @param options - See {@link ReviewServiceOptions}.
 * @returns A service that never throws from any of its methods.
 */
export function createReviewService(options: ReviewServiceOptions = {}): ReviewService {
  const adapter = options.adapter ?? createExpoStoreReviewAdapter();
  const storage = options.storage ?? createMemoryReviewStorage();
  const storageKey = options.storageKey ?? REVIEW_STORAGE_KEY;
  const config = options.config ?? REVIEW_TRIGGERS;
  const clock = options.now ?? (() => Date.now());

  function read(): ReviewState {
    let raw: string | null | undefined = null;
    try {
      raw = storage.getItem(storageKey);
    } catch {
      return createDefaultReviewState();
    }
    if (raw === null || raw === undefined) return createDefaultReviewState();
    try {
      return sanitizeReviewState(JSON.parse(raw));
    } catch {
      // A blob we cannot parse is a blob we cannot trust. Starting over costs the user at most
      // one extra prompt across the life of the install; guessing could cost them three.
      return createDefaultReviewState();
    }
  }

  let state = read();

  function write(): void {
    try {
      storage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Storage is a best effort. An unpersisted state still governs this session correctly,
      // which is the half that matters for not annoying the user right now.
    }
  }

  /** `true` only for the *first* time a stamp is set; the notes are idempotent by design. */
  function stampOnce(field: 'timesShownAt' | 'reminderConfirmedAt', now: number): void {
    if (state[field] !== null) return;
    state[field] = now;
    write();
  }

  function stamp(
    field: 'lastStreakBreakAt' | 'lastMistapAt' | 'lastTimesAdjustedAt' | 'lastAdhanAt',
    now: number
  ): void {
    state[field] = now;
    write();
  }

  /** Session-scoped, never persisted: a new launch is always allowed its one attempt. */
  let sessionStarted = false;
  let promptedThisSession = false;
  let inFlight = false;
  /** Cached across the session so a `false` from the OS is asked for once, not per trigger. */
  let availability: boolean | null = null;

  function log(
    trigger: ReviewTrigger,
    decision: 'prompted' | 'blocked',
    reason: ReviewBlockReason | null,
    now: number
  ): void {
    const entry: ReviewLogEntry = {
      at: now,
      trigger: triggerKey(trigger),
      session: state.sessionCount,
      decision,
      reason,
    };
    const limit =
      Number.isInteger(config.maxLogEntries) && config.maxLogEntries > 0 ? config.maxLogEntries : 1;
    state.log = [...state.log, entry].slice(-limit);
    write();
  }

  function triggerIsConfigured(trigger: ReviewTrigger): boolean {
    if (trigger.kind !== 'streakMilestone') return true;
    return config.streakMilestones.includes(trigger.milestone);
  }

  /**
   * The whole policy, in check order. The order is the log's usefulness: the *first* reason is
   * reported, so it should read as the most fundamental one ("we would never prompt this user"
   * before "not at this exact second").
   */
  function evaluate(trigger: ReviewTrigger, moment: ReviewMoment): ReviewDecision {
    const block = (reason: ReviewBlockReason): ReviewDecision => ({ allowed: false, reason });
    const { now } = moment;

    if (!config.enabled) return block('disabled');
    if (!triggerIsConfigured(trigger)) return block('triggerNotConfigured');
    if (!sessionStarted) return block('noSession');

    // -- who this user is -----------------------------------------------------
    if (state.sessionCount < Math.max(config.minSessionOrdinal, 2)) return block('firstSession');
    if (state.sessionCount < config.minSessionsBeforeFirstPrompt) return block('tooFewSessions');
    if (withinDays(state.installedAt, now, config.minDaysSinceInstall)) {
      return block('tooSoonAfterInstall');
    }
    if (!moment.setupComplete) return block('setupIncomplete');

    // -- what we have already spent -------------------------------------------
    if (promptedThisSession) return block('alreadyPromptedThisSession');
    if (moment.alreadyGaveThisSession === true) return block('alreadyGaveThisSession');
    if (state.firedTriggers.includes(triggerKey(trigger))) return block('triggerAlreadyUsed');
    if (state.attemptCount >= config.lifetimeCap) return block('lifetimeCapReached');
    if (withinDays(state.lastAttemptAt, now, config.cooldownDays)) return block('cooldown');
    if (withinDays(state.lastUncleanAt, now, config.cooldownAfterUncleanSessionDays)) {
      return block('uncleanPreviousSession');
    }

    // -- what is happening right now ------------------------------------------
    if (moment.inPrayerWindow) return block('prayerWindow');
    if (moment.adhanPlaying) return block('adhanPlaying');
    if (
      state.lastAdhanAt !== null &&
      config.quietAfterAdhanMs > 0 &&
      now - state.lastAdhanAt < config.quietAfterAdhanMs
    ) {
      return block('adhanQuietPeriod');
    }

    // -- signals of dissatisfaction -------------------------------------------
    if (withinDays(state.lastStreakBreakAt, now, config.cooldownAfterStreakBreakDays)) {
      return block('streakBroken');
    }
    if (withinDays(state.lastMistapAt, now, config.cooldownAfterMistapDays)) {
      return block('mistapCorrection');
    }
    if (withinDays(state.lastTimesAdjustedAt, now, config.cooldownAfterTimesAdjustedDays)) {
      return block('timesAdjusted');
    }

    // -- the calendar ----------------------------------------------------------
    if (isRamadanEdgeDay(moment.hijriToday, moment.hijriTomorrow)) return block('ramadanEdgeDay');

    // -- has the moment landed? ------------------------------------------------
    if (now - moment.momentAt < config.settleDelayMs) return block('notSettled');

    return { allowed: true, reason: null };
  }

  return {
    startSession(now = clock()) {
      const previousSessionUnclean = state.sessionOpen;
      state.sessionCount += 1;
      state.installedAt ??= now;
      state.sessionOpen = true;
      if (previousSessionUnclean) state.lastUncleanAt = now;
      sessionStarted = true;
      promptedThisSession = false;
      availability = null;
      write();
      return { ordinal: state.sessionCount, previousSessionUnclean };
    },

    endSession() {
      state.sessionOpen = false;
      write();
    },

    noteTimesShown(now = clock()) {
      stampOnce('timesShownAt', now);
    },
    noteReminderDelivered(now = clock()) {
      stampOnce('reminderConfirmedAt', now);
    },
    noteStreakBreak(now = clock()) {
      stamp('lastStreakBreakAt', now);
    },
    noteMistapCorrection(now = clock()) {
      stamp('lastMistapAt', now);
    },
    noteTimesAdjusted(now = clock()) {
      stamp('lastTimesAdjustedAt', now);
    },
    noteAdhanFinished(now = clock()) {
      stamp('lastAdhanAt', now);
    },

    isSetupSuccessReady() {
      return state.timesShownAt !== null && state.reminderConfirmedAt !== null;
    },

    isSteadyUseReady(now) {
      if (state.timesShownAt === null) return false;
      if (state.sessionCount < config.steadyUseSessions) return false;
      if (state.installedAt === null) return false;
      const at = now ?? clock();
      return at - state.installedAt >= config.steadyUseMinDays * DAY_MS;
    },

    evaluate,

    explain(trigger, moment) {
      const decision = evaluate(trigger, moment);
      if (decision.allowed || decision.reason === null || decision.reason === 'notSettled') {
        return decision;
      }
      // Deduped per trigger rather than against the tail of the log: an observer that offers
      // three candidates on every store change would otherwise alternate them into the log and
      // push the interesting entries out.
      const key = triggerKey(trigger);
      const last = [...state.log].reverse().find((entry) => entry.trigger === key);
      const repeats =
        last !== undefined && last.decision === 'blocked' && last.reason === decision.reason;
      if (!repeats) log(trigger, 'blocked', decision.reason, moment.now);
      return decision;
    },

    async request(trigger, moment) {
      if (inFlight) {
        log(trigger, 'blocked', 'inFlight', moment.now);
        return { prompted: false, reason: 'inFlight' };
      }

      const decision = evaluate(trigger, moment);
      if (!decision.allowed) {
        const reason = decision.reason ?? 'requestFailed';
        log(trigger, 'blocked', reason, moment.now);
        return { prompted: false, reason };
      }

      inFlight = true;
      try {
        if (availability === null) {
          try {
            availability = await adapter.isAvailable();
          } catch {
            // A throwing availability check is an unavailable one. Nothing is spent.
            availability = false;
          }
        }
        if (!availability) {
          log(trigger, 'blocked', 'unavailable', moment.now);
          return { prompted: false, reason: 'unavailable' };
        }

        try {
          await adapter.requestReview();
        } catch {
          // Nothing is recorded as spent: the OS never saw this, so the trigger stays live for a
          // later session rather than being silently burned.
          log(trigger, 'blocked', 'requestFailed', moment.now);
          return { prompted: false, reason: 'requestFailed' };
        }

        promptedThisSession = true;
        // D29's other direction: a review prompt and a tip prompt may not share a session. The tip
        // jar already notes itself; without this the gate only ever blocked review-after-tip, and
        // tip-after-review would have slipped through the moment a proactive tip card exists.
        noteSessionMoment('reviewPrompt');
        state.attemptCount += 1;
        state.lastAttemptAt = moment.now;
        const key = triggerKey(trigger);
        if (!state.firedTriggers.includes(key)) state.firedTriggers = [...state.firedTriggers, key];
        log(trigger, 'prompted', null, moment.now);
        return { prompted: true, reason: null };
      } finally {
        inFlight = false;
      }
    },

    snapshot() {
      return { ...state, firedTriggers: [...state.firedTriggers], log: [...state.log] };
    },

    history() {
      return [...state.log];
    },

    reset() {
      state = createDefaultReviewState();
      sessionStarted = false;
      promptedThisSession = false;
      availability = null;
      try {
        storage.removeItem(storageKey);
      } catch {
        // Nothing to do: the in-memory state is already pristine.
      }
    },
  };
}
