/**
 * Domain type contract for Simple Prayer.
 *
 * This file is the shared vocabulary for every other domain module, the database layer,
 * the stores and the UI. It is PURE TypeScript — no React, no React Native, no side effects.
 * Changing a type here is a cross-cutting change: check every consumer.
 *
 * See docs/PRODUCT_SPEC.md for the behavioural meaning of each concept.
 */

// ---------------------------------------------------------------------------
// Prayers & time markers
// ---------------------------------------------------------------------------

/** The five obligatory prayers — the only prayers that are tracked. */
export const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type Prayer = (typeof PRAYERS)[number];

/** Points in the day we can display or schedule against (sunrise is shown, never tracked). */
export const TIME_MARKERS = [
  'fajr',
  'sunrise',
  'dhuhr',
  'asr',
  'maghrib',
  'isha',
  'middleOfTheNight',
  'lastThirdOfTheNight',
] as const;
export type TimeMarker = (typeof TIME_MARKERS)[number];

export function isPrayer(value: string): value is Prayer {
  return (PRAYERS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * A prayer day, as `YYYY-MM-DD`. The prayer day runs from Fajr to the next Fajr:
 * an Isha prayed at 00:30 belongs to the PREVIOUS calendar date's prayer day.
 * All conversion between wall-clock instants and PrayerDay lives in `dates.ts`.
 */
export type PrayerDay = string;

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface AppLocation extends Coordinates {
  /** Human label shown in the UI, e.g. "Brooklyn, NY". */
  label: string;
  /** ISO 3166-1 alpha-2, uppercase. Drives automatic calculation-method selection. */
  countryCode?: string;
  /** IANA timezone id when known; otherwise the device timezone is used. */
  timeZone?: string;
  /** How this location was obtained. */
  source: 'auto' | 'manual';
  /** Epoch ms when resolved. */
  resolvedAt: number;
}

// ---------------------------------------------------------------------------
// Calculation settings
// ---------------------------------------------------------------------------

/**
 * Calculation methods we expose. `auto` resolves to a concrete method from the
 * user's country (see `methods.ts`); every other value maps onto an adhan-js method
 * (with `jafari` built from custom angles).
 */
export const CALCULATION_METHODS = [
  'auto',
  'muslimWorldLeague',
  'egyptian',
  'karachi',
  'ummAlQura',
  'dubai',
  'qatar',
  'kuwait',
  'moonsightingCommittee',
  'northAmerica',
  'singapore',
  'turkey',
  'tehran',
  'jafari',
] as const;
export type CalculationMethodId = (typeof CALCULATION_METHODS)[number];
/** Methods that can actually be computed (i.e. everything except the `auto` sentinel). */
export type ConcreteMethodId = Exclude<CalculationMethodId, 'auto'>;

/**
 * Which Asr the user follows. `'auto'` resolves per country (`resolveMadhab` in methods.ts):
 * Hanafi where local calendars use it, the majority (one shadow length) everywhere else.
 */
export type Madhab = 'auto' | 'shafi' | 'hanafi';
/** A madhab that can actually be computed (everything except the `auto` sentinel). */
export type ConcreteMadhab = Exclude<Madhab, 'auto'>;

export type HighLatitudeRuleId = 'auto' | 'middleOfTheNight' | 'seventhOfTheNight' | 'twilightAngle';

/** Per-prayer manual adjustment in minutes (−30…+30), for matching a local mosque or calendar. */
export type PrayerOffsets = Record<Prayer, number>;

export interface CalculationSettings {
  method: CalculationMethodId;
  madhab: Madhab;
  highLatitudeRule: HighLatitudeRuleId;
  offsets: PrayerOffsets;
  /** ±2 days applied to the computed Umm al-Qura Hijri date. */
  hijriOffset: number;
}

// ---------------------------------------------------------------------------
// Prayer times
// ---------------------------------------------------------------------------

/** Computed times for one prayer day, after offsets have been applied. */
export interface DayTimes {
  day: PrayerDay;
  times: Record<TimeMarker, Date>;
  /** The concrete method actually used (never `auto`). */
  method: ConcreteMethodId;
}

/** A prayer's window: [start, end). Isha's window ends at the next day's Fajr. */
export interface PrayerWindow {
  prayer: Prayer;
  start: Date;
  end: Date;
}

export interface NextPrayerInfo {
  prayer: Prayer;
  /** The prayer day the upcoming prayer belongs to. */
  day: PrayerDay;
  at: Date;
  msRemaining: number;
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

/**
 * `unlogged` is the absence of a record and is NEVER written to the database; it is
 * what a missing row means. It is never auto-converted to `missed` (see PRODUCT_SPEC §4).
 */
export const PRAYER_STATUSES = ['unlogged', 'prayed', 'late', 'missed', 'exempt'] as const;
export type PrayerStatus = (typeof PRAYER_STATUSES)[number];

/** The three statuses a user can actively choose from the seal. */
export type LoggableStatus = Extract<PrayerStatus, 'prayed' | 'late' | 'missed'>;

export interface PrayerLog {
  day: PrayerDay;
  prayer: Prayer;
  status: Exclude<PrayerStatus, 'unlogged'>;
  /** Epoch ms when a `missed` prayer was made up (qada). */
  madeUpAt?: number;
  loggedAt: number;
  updatedAt: number;
}

/** All five prayers of one day, resolved (including exemption and unlogged states). */
export interface DayRecord {
  day: PrayerDay;
  statuses: Record<Prayer, PrayerStatus>;
  madeUp: Partial<Record<Prayer, boolean>>;
  isExempt: boolean;
}

// ---------------------------------------------------------------------------
// Exemptions
// ---------------------------------------------------------------------------

/** A closed or open-ended range of exempt days (menstruation / postnatal). */
export interface ExemptPeriod {
  id?: number;
  startDay: PrayerDay;
  /** `null` means still ongoing. */
  endDay: PrayerDay | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Streaks & stats
// ---------------------------------------------------------------------------

export type StreakMode = 'soft' | 'hard';

/**
 * How the seal logs (D192). `detailed` is prayed / late / missed, as the app always was.
 * `simple` is one tap, prayed ↔ not marked, and a prayer left unmarked shows as missed once its
 * time has passed — a DISPLAY rule only (`domain/trackingMode`); nothing is written for it.
 */
export const TRACKING_MODES = ['simple', 'detailed'] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

export interface StreakSummary {
  mode: StreakMode;
  current: number;
  best: number;
  /** First day of the current streak, if any. */
  currentStartedOn: PrayerDay | null;
  bestStartedOn: PrayerDay | null;
}

export interface PrayerBreakdown {
  prayer: Prayer;
  prayed: number;
  late: number;
  missed: number;
  unlogged: number;
  /** Days excluded from all counts because they were exempt. */
  exempt: number;
}

export interface StatsSummary {
  /** Window in days the stats were computed over (e.g. 7, 30) or `null` for lifetime. */
  windowDays: number | null;
  totalTracked: number;
  prayed: number;
  late: number;
  missed: number;
  unlogged: number;
  /** (prayed + late) / (tracked − exempt), 0…1. `null` when there is nothing to divide by. */
  completionRate: number | null;
  /** prayed / (prayed + late), 0…1. `null` when nothing was logged. */
  onTimeRate: number | null;
  /** Days where all five were prayed or late. */
  fullDays: number;
  byPrayer: PrayerBreakdown[];
}

// ---------------------------------------------------------------------------
// Qada
// ---------------------------------------------------------------------------

export type QadaDebts = Record<Prayer, number>;

export const QADA_EVENT_TYPES = [
  'tick',
  'add',
  'estimateSet',
  'manualSet',
  'forgive',
  'forgiveUndo',
] as const;
export type QadaEventType = (typeof QADA_EVENT_TYPES)[number];

export interface QadaEvent {
  id?: number;
  type: QadaEventType;
  prayer: Prayer | null;
  /** Signed change applied to the debt by this event (negative = paid off). */
  delta: number;
  at: number;
  /** Snapshot payload — e.g. the full debts archived by a `forgive`. */
  meta?: Record<string, unknown>;
}

/** Input for the backtracking estimate wizard. */
export interface QadaEstimateInput {
  startDay: PrayerDay;
  endDay: PrayerDay;
  /** Apply a menstruation deduction (only offered when exemption mode is on). */
  deductExemptions: boolean;
  /** Average exempt days per month used for the deduction. */
  exemptDaysPerMonth: number;
}

export interface QadaProgress {
  debts: QadaDebts;
  total: number;
  /** Prayers made up over the pace window. */
  paidInWindow: number;
  /** Average prayers made up per day over the pace window; 0 when idle. */
  perDay: number;
  /** Projected clear date, or `null` when the pace is zero or nothing is owed. */
  projectedClearDay: PrayerDay | null;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * The four phases of a prayer's reminder life, in the order they fire:
 * `preReminder` → `adhan` → `nudge` (last call) → `expiry` (the window has closed).
 *
 * `expiry` is **Fajr-only** by design — see `domain/notificationPlan.ts` for why, and
 * PRODUCT_SPEC §11 for the whole lifecycle.
 */
export const NOTIFICATION_KINDS = ['adhan', 'preReminder', 'nudge', 'expiry'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type ReminderSound = 'silent' | 'system' | 'adhan';

/**
 * Which recitation the `adhan` sound plays. **Global, never per prayer** — nobody picks a reciter
 * for Asr and a different one for Maghrib, and offering it would be five questions where there is
 * one answer (CLAUDE.md: "so dumb and easy that an old person or a 7 year old could use").
 *
 * The files, the per-platform resolution and the default live in `domain/adhanVoices`.
 */
export type AdhanVoice = 'makkah' | 'alqatami' | 'menk' | 'fakhry';

export interface PrayerReminderSettings {
  /** Notification at the prayer's start time. */
  adhanEnabled: boolean;
  sound: ReminderSound;
  /** "X minutes before" reminder. */
  preReminderEnabled: boolean;
  preReminderMinutes: number;
  /**
   * The last call before the window closes. It fires only while the prayer is still unlogged, and
   * the lead time is global (`AppSettings.nudgeLeadMinutes`), because "how late is a last call" is
   * one answer, not five. It no longer carries Fajr's note at sunrise, which has a switch of its
   * own (`AppSettings.sunriseNoteEnabled`, D90).
   */
  nudgeEnabled: boolean;
}

export type ReminderSettings = Record<Prayer, PrayerReminderSettings>;

/** One notification the app wants the OS to deliver. Produced purely by `notificationPlan.ts`. */
export interface PlannedNotification {
  /** Stable identity: `${kind}:${day}:${prayer}` — used to diff desired vs scheduled. */
  key: string;
  kind: NotificationKind;
  prayer: Prayer;
  day: PrayerDay;
  fireAt: Date;
  sound: ReminderSound;
  /**
   * When this notification stops being worth reading — the prayer's window end for the first three
   * phases, and the *next prayer's start* for the sunrise note, which exists to be read after the
   * fact. `undefined` when the day's times cannot resolve it.
   *
   * It is the same judgement `selectStaleDelivered` makes when the app runs, carried in the
   * request so **Android can act on it with the app dead**: the service arms an alarm for this
   * instant that takes the notification out of the tray (`modules/notification-dismissal`, D88).
   * iOS has no equivalent and simply ignores it.
   */
  expiresAt?: Date;
}

// ---------------------------------------------------------------------------
// Settings (persisted in MMKV via the settings store)
// ---------------------------------------------------------------------------

export type ThemePreference = 'system' | 'light' | 'dark';
export type LanguagePreference = 'system' | 'en' | 'ar' | 'tr';
/**
 * Which digits Arabic renders in. `auto` is D40's region rule, which is right for almost everyone;
 * the two explicit values exist because on Android the region is a guess (D136) and the reader who
 * gets the wrong one has no other way to correct it.
 */
export type NumeralPreference = 'auto' | 'arab' | 'latn';

export interface AppSettings {
  location: AppLocation | null;
  useAutoLocation: boolean;
  calculation: CalculationSettings;
  streakMode: StreakMode;
  /** One-tap or three-choice logging (D192). Existing installs read `detailed`. */
  trackingMode: TrackingMode;
  /**
   * The prayer day simple mode was last turned on. Only days on or after it can show an
   * unmarked prayer as missed, so switching modes never paints old history red. `null` while
   * simple mode has never been on.
   */
  simpleModeSince: PrayerDay | null;
  /**
   * Simple mode's made-up count per prayer: how many of the misses it SHOWS (closed, unmarked,
   * on or after {@link simpleModeSince}) were made up on the qada screen. Those misses have no
   * row to mark, so this is where their make-up lives (D192).
   */
  simpleQadaMadeUp: Record<Prayer, number>;
  exemptionModeEnabled: boolean;
  /**
   * Whether excused days silence the prayer reminders (the default, and the only behaviour
   * before 2026-08-28). `false` keeps the adhan and the wake-up pre-reminder speaking on
   * excused days — the call is a fact of the clock, not a claim about the listener — while the
   * last call and the sunrise note stay silent (they presume an obligation). Owner, 2026-08-28.
   */
  exemptionMuteReminders: boolean;
  /** Average exempt days per month, used by the qada estimator. */
  exemptDaysPerMonth: number;
  /**
   * Travel mode, as the user set it. Whether it applies to a given day is *derived* from these
   * three (`domain/travel.isTravelingOn`), so the end date needs nothing scheduled: see that
   * module for what travel changes and what it deliberately does not.
   */
  travelActive: boolean;
  /** First travel day, or `null` when travel is off. */
  travelStartDay: PrayerDay | null;
  /** Last travel day, inclusive; `null` means "until I end it". */
  travelEndDay: PrayerDay | null;
  reminders: ReminderSettings;
  /**
   * Which recitation the `adhan` sound plays, for every prayer that uses it. One choice, not five
   * (see {@link AdhanVoice}).
   */
  adhanVoice: AdhanVoice;
  /**
   * How many minutes before a window closes its last-call notification arrives. Global rather
   * than per-prayer (PRODUCT_SPEC §11, §12) — one number the user can reason about.
   */
  nudgeLeadMinutes: number;
  /**
   * The silent note at sunrise saying Fajr's time has ended, and naming the next prayer
   * (PRODUCT_SPEC §11.2). **Off by default** and independent of any prayer's `nudgeEnabled`: it
   * arrives after the fact, so it is the one reminder that has to be asked for (D90). Fajr is the
   * only prayer it exists for, so this is one global flag rather than five.
   */
  sunriseNoteEnabled: boolean;
  /** Android-only ongoing notification showing the current/next prayer. */
  persistentNotificationEnabled: boolean;
  /**
   * iOS only: the single-window Live Activity (D27) — a lockscreen/Dynamic Island countdown for
   * the prayer whose window is open, started when the app is foregrounded (no push entitlement
   * exists, D49, so it can neither start nor roll over in the background). **Off by default**,
   * mirroring the ongoing notification it is the iOS counterpart of.
   */
  liveActivityEnabled: boolean;
  /**
   * How many minutes before the NEXT prayer's start the Live Activity may appear as a
   * lead card — a countdown to get the current prayer in before the next arrives, so it only
   * shows while the current prayer is still unlogged. Like every Activity here it is born on a
   * foreground, never in the background (D49).
   */
  liveActivityLeadMinutes: number;
  /**
   * How many minutes after a prayer's time comes in the Live Activity stays up as the due
   * card. Marking the prayer always ends it early; after the linger the lockscreen goes quiet
   * even though the window is still open — the card is a moment, not a ledger.
   */
  liveActivityLingerMinutes: number;
  /**
   * Android only: pause whatever the phone is playing when a prayer's time comes in (D96,
   * "Pause what's playing"). **Off by default**; the toggle renders only where the native
   * module that can act on it exists.
   */
  pauseAudioEnabled: boolean;
  theme: ThemePreference;
  language: LanguagePreference;
  arabicNumerals: NumeralPreference;
  /** Whether the qada feature has been set up (wizard completed or skipped). */
  qadaSetupCompleted: boolean;
  /**
   * Whether the first-run setup flow has been seen (finished OR skipped — the two are the same
   * fact: it must never open twice). `false` on a genuinely fresh install only; an install that
   * predates the flow migrates to `true` so an existing user is never sent through setup for
   * settings they already chose (see `sanitizeSettings`).
   */
  onboardingCompleted: boolean;
  /** 12/24-hour display; `system` follows the device locale. */
  timeFormat: 'system' | '12h' | '24h';
  /**
   * Anonymous crash reports (services/telemetry.ts). Diagnostic data only — never the prayer
   * log, the location or anything identifying. Read once at startup; changing it takes effect
   * at the next launch.
   */
  crashReportingEnabled: boolean;
}
