/**
 * The widget snapshot (D26) — everything a homescreen widget will ever say, resolved in advance.
 *
 * ## Why a snapshot, and why it is *fully* resolved
 *
 * A widget renders in another process (iOS) or with no JS runtime alive (Android). Neither place
 * may re-derive a prayer day, re-run adhan, or reach for the i18n bundles — that would be
 * `src/domain` reimplemented in Swift and Kotlin, drifting in two languages nobody runs the
 * domain tests in, which D92 already named the one class of bug this project treats as harm. So
 * the app precomputes ~two weeks of *final* content — times as display strings (12/24h, D40
 * numerals), prayer names that already know Friday (D77), captions, Hijri dates — and the native
 * side does two things only: pick the {@link WidgetSegment} containing "now", and lay the pending
 * queue over the day's statuses with `overlayPendingMarks`' one rule. Comparing an instant to a
 * precomputed boundary is the whole of the logic a widget is allowed.
 *
 * ## What it deliberately does not contain
 *
 * - **No streaks, counts, or verdicts.** A widget shows today; it is never a ledger (CLAUDE.md).
 * - **No exemption vocabulary** beyond the register-safe status word (D62) — and the exempt flag
 *   itself stays honest: an exempt day's seals are inert crescents reading "not required".
 * - **No English fallbacks.** Every string is rendered through the app's own translator at build
 *   time; the only native-bundled strings are the no-snapshot states, which by definition cannot
 *   travel in a snapshot that does not exist.
 *
 * ## Staleness contract
 *
 * The snapshot covers {@link WIDGET_SNAPSHOT_DAYS} prayer days. Inside that horizon a widget is
 * correct without the app ever waking — day rollovers included, because the segments carry the
 * Fajr boundaries `domain/dates` computed. Past the horizon a widget must show its bundled
 * "open the app" state, never yesterday's schedule: {@link WidgetSnapshot.expiresAt} is that line.
 *
 * Like `ongoingNotification.ts`, this module is deliberately pure: no store, no platform module,
 * no i18n import — the translator and preferences arrive as {@link WidgetSnapshotDeps}. The
 * impure edge (`services/widgets.ts`) gathers inputs and ships the JSON to the native bridge.
 */

import { addDays, daysBetween } from '../domain/dates';
import { prayerNameKey } from '../domain/prayerNames';
import { computeDayTimes, getCurrentPrayerDay, type TimesLocation } from '../domain/prayerTimes';
import { formatHijri, toHijri } from '../domain/hijri';
import { PRAYERS, type CalculationSettings, type DayTimes, type Prayer, type PrayerDay, type PrayerStatus } from '../domain/types';
import { WINDOW_END_MARKER } from '../domain/windows';
import { formatTime, type TimeFormatPreference } from '../utils/formatTime';
import { formatDate, formatNumber } from '../i18n/numerals';

// ---------------------------------------------------------------------------
// The contract (version it, always — old snapshots are rejected, never guessed at)
// ---------------------------------------------------------------------------

/**
 * Bumped whenever a field changes meaning or shape. A native reader that finds any other version
 * renders its bundled "open the app" state — a widget briefly asking for a launch after an app
 * update is honest; misparsing a stale layout is not.
 */
export const WIDGET_SNAPSHOT_VERSION = 1;

/** How many prayer days the snapshot covers, today included. */
export const WIDGET_SNAPSHOT_DAYS = 14;

/** One prayer of one day, ready to draw. */
export interface WidgetDayPrayer {
  prayer: Prayer;
  /** Localized display name — the SHORT "Jumu'ah" on a Friday (the pair is app-only; owner, 2026-08-28). */
  name: string;
  /** The Arabic calligraphy companion, or `null` when it would just repeat {@link name} (ar). */
  arabicName: string | null;
  /** The prayer's start, epoch ms. */
  at: number;
  /** The start as display text — 12/24h and numerals already applied. */
  timeText: string;
  /** When the window shuts, epoch ms; `null` when unresolvable (horizon edge, polar day). */
  windowEndAt: number | null;
  /**
   * The caption shown while this prayer is current and unlogged — "now · until 6:42 pm", with
   * Fajr naming sunrise (D71). Falls back to the bare "now" when the deadline is unresolvable.
   */
  dueCaption: string;
  /**
   * The deadline alone — "until 6:42 pm", the app hero's own phrase (`today.hero.until`) — for
   * the Now widget's line under its live countdown. `null` alongside {@link windowEndAt}, and
   * absent from snapshots older builds wrote: readers treat missing as `null`.
   */
  untilText: string | null;
  /**
   * "until Asr" — the CALM countdown's caption, counting to this prayer's START rather than to a
   * deadline (D190): shown while the current prayer is already marked, and in the sunrise gap.
   * Optional: older snapshots lack it, and readers fall back to {@link name}.
   */
  untilStartText?: string;
  /**
   * The status as the database knew it when the snapshot was written. `unlogged` for every day
   * the log has nothing on — which is every future day, and that is not a gap: unlogged IS the
   * truthful default (D06). The native side lays the pending queue over this at render time.
   */
  status: PrayerStatus;
}

/** One prayer day, ready to draw. */
export interface WidgetDay {
  day: PrayerDay;
  /** The day's Fajr — where this prayer day begins, epoch ms. */
  startsAt: number;
  /** The next day's Fajr — where it ends, epoch ms. */
  endsAt: number;
  /** "Monday · Aug 24" in the app's language, weekday first. */
  dateText: string;
  /** "11 Rabiʿ al-Awwal 1448" in the app's language (user's Hijri offset applied). */
  hijriText: string;
  /** Whether the whole day is exempt (derived, D64) — seals render inert crescents. */
  isExempt: boolean;
  /** Sunrise, epoch ms, `null` if unresolvable. */
  sunriseAt: number | null;
  /** Sunrise as display text, `null` alongside {@link sunriseAt}. */
  sunriseText: string | null;
  /** The five prayers in canonical order. */
  prayers: WidgetDayPrayer[];
}

/**
 * A stretch of time during which nothing about "current" and "next" changes. Contiguous and
 * sorted; a native renderer binary-searches for the segment containing now and reads the answer.
 */
export interface WidgetSegment {
  /** Inclusive start, epoch ms. */
  from: number;
  /** Exclusive end, epoch ms. */
  to: number;
  /** The prayer day this stretch belongs to (Fajr→next Fajr). */
  day: PrayerDay;
  /** The prayer whose window contains this stretch, or `null` (sunrise→Dhuhr, daily). */
  current: Prayer | null;
  /** The next prayer to begin, possibly on the next day; `null` only at the horizon's edge. */
  next: { day: PrayerDay; prayer: Prayer } | null;
}

/** The static words widgets need beyond the per-day content. All pre-translated. */
export interface WidgetStrings {
  /** "Sunrise" — the marker's label. */
  sunrise: string;
  /** Status words, exactly the seal's vocabulary (icon + word, never color alone). */
  statusPrayed: string;
  statusLate: string;
  statusMissed: string;
  statusNotMarked: string;
  statusNotRequired: string;
  statusUpcoming: string;
  /** "now" — the current prayer's word when no deadline can be named. */
  now: string;
  /** "next" — the upcoming prayer's word. */
  next: string;
  /** "left to pray" — under the live countdown (iOS). */
  leftToPray: string;
  /** "until {time}" already needs the time, so it lives in {@link WidgetDayPrayer.dueCaption}. */
}

/** The whole snapshot, exactly as serialized for the native side. */
/**
 * One buddy's face, resolved for the native side (D177).
 *
 * Fully resolved on purpose, like everything else in this snapshot: native draws a disc in `color`
 * with `initials` on it, and re-derives nothing. Both values are chosen locally by the person
 * holding this phone — no name, nothing that came off the wire.
 *
 * **Always letters, even for a buddy the viewer gave a picture to.** The widgets draw their glyphs
 * as hand-built shapes rather than from a font, so a picture would mean porting the whole icon set
 * into Swift and Kotlin for a 16pt disc. Initials are the default face anyway, and a buddy is
 * recognised on a widget by their colour and their letters either way.
 */
export interface WidgetBuddy {
  /** A `BuddyColor` name; the widget palette maps it, as the app's theme does. */
  color: string;
  /** Two letters from the name this phone gave them. Never the name itself. */
  initials: string;
}

export interface WidgetSnapshot {
  version: typeof WIDGET_SNAPSHOT_VERSION;
  /** When it was built, epoch ms. */
  generatedAt: number;
  /** Past this instant the native side shows its bundled "open the app" state. Epoch ms. */
  expiresAt: number;
  /** The app's resolved language tag ('en' | 'ar' | 'tr'), for font choices native-side. */
  language: string;
  /** Whether layouts mirror (follows the APP language, never the device locale — D41). */
  rtl: boolean;
  /** The in-app theme override; 'system' means follow the OS appearance. */
  theme: 'system' | 'light' | 'dark';
  strings: WidgetStrings;
  days: WidgetDay[];
  segments: WidgetSegment[];
  /**
   * Who else has prayed each prayer of the day named in `day` (D177) — always today's, since that
   * is all this feature keeps. Large home-screen widget only: never a lock-screen widget, StandBy,
   * a Live Activity, the watch or a watch face, which is the distinction D177 turns on.
   *
   * It carries its own day so the renderer can check rather than assume. A schedule widget can be
   * asked for any day in the horizon, and yesterday's row borrowing today's badges would be a
   * quiet little lie. Absent entirely when buddy mode is off, which is most installs.
   */
  buddies?: { day: PrayerDay; marks: Partial<Record<Prayer, WidgetBuddy[]>> };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The app-state half of the inputs — everything the impure edge reads from stores. */
export interface WidgetSnapshotDeps {
  /** The app's translator, already bound to the app language. */
  translate: (key: string, params?: Record<string, unknown>) => string;
  /** Resolved app language tag, e.g. 'en', 'ar', 'tr'. */
  language: string;
  /** The numeral-resolving locale (D40) — what formatTime/formatNumber should use. */
  numericLocale: string;
  /** Whether the app language lays out right-to-left. */
  rtl: boolean;
  timeFormat: TimeFormatPreference;
  theme: 'system' | 'light' | 'dark';
  /** The user's Hijri offset in days (±2). */
  hijriOffset: number;
  /** Statuses for a day, or `undefined` when the log has nothing (→ all unlogged). */
  statusesFor: (day: PrayerDay) => Record<Prayer, PrayerStatus> | undefined;
  /**
   * Who else has prayed each of today's prayers (D177), already resolved to faces. Omitted when
   * buddy mode is off — which is the default, and most installs.
   */
  buddiesFor?: (day: PrayerDay) => Partial<Record<Prayer, WidgetBuddy[]>> | undefined;
  /** Whether a day is exempt (derived from periods; false when the mode is off). */
  isExemptDay: (day: PrayerDay) => boolean;
}

/** The world half of the inputs. */
export interface WidgetSnapshotInput {
  now: Date;
  location: TimesLocation;
  calculation: CalculationSettings;
  /** Horizon override for tests. */
  days?: number;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

const ALL_UNLOGGED: Record<Prayer, PrayerStatus> = {
  fajr: 'unlogged',
  dhuhr: 'unlogged',
  asr: 'unlogged',
  maghrib: 'unlogged',
  isha: 'unlogged',
};

/**
 * Builds the snapshot, or returns `null` when it cannot be built honestly — no location, or a
 * sky the engine cannot solve for even one day. `null` means "clear what the widgets have":
 * a bundled "open the app" state is the truth then, and stale times are not.
 *
 * @param input - Where and when.
 * @param deps - The app-state accessors and the translator.
 * @returns The snapshot, or `null` when none can be produced.
 */
export function buildWidgetSnapshot(
  input: WidgetSnapshotInput,
  deps: WidgetSnapshotDeps
): WidgetSnapshot | null {
  const horizon = input.days ?? WIDGET_SNAPSHOT_DAYS;

  let today: PrayerDay;
  try {
    today = getCurrentPrayerDay(input.now, input.location, input.calculation);
  } catch {
    return null;
  }

  // One extra day at each end: yesterday's Isha window reaches into today (its end is today's
  // Fajr), and the last day's Isha needs the day after the horizon for its own end.
  const first = addDays(today, -1);
  const last = addDays(today, horizon);
  const allTimes = new Map<PrayerDay, DayTimes>();
  for (const day of daysBetween(first, last)) {
    try {
      allTimes.set(day, computeDayTimes(day, input.location, input.calculation));
    } catch {
      // A day the engine cannot solve (extreme latitude without a rule) ends the horizon early
      // rather than leaving a hole in the middle of the timeline — but an unsolvable LEADING day
      // (yesterday exists only to bridge its Isha) must not discard a horizon whose own days are
      // fine: skip until the first success, truncate after it.
      if (allTimes.size === 0) continue;
      break;
    }
  }

  const timeText = (date: Date): string =>
    formatTime(date, { timeFormat: deps.timeFormat, locale: deps.numericLocale });

  const days: WidgetDay[] = [];
  const dayList = [...allTimes.keys()];
  for (const day of dayList) {
    const times = allTimes.get(day);
    const nextTimes = allTimes.get(addDays(day, 1));
    if (times === undefined || nextTimes === undefined) break;

    const statuses = deps.statusesFor(day) ?? ALL_UNLOGGED;
    const isExempt = deps.isExemptDay(day);
    const sunrise = usable(times.times.sunrise);

    const prayers: WidgetDayPrayer[] = PRAYERS.map((prayer) => {
      const at = times.times[prayer];
      const marker = WINDOW_END_MARKER[prayer];
      const windowEnd = usable(marker === null ? nextTimes.times.fajr : times.times[marker]);
      const nameKey = prayerNameKey(prayer, day);
      // Friday's midday prayer: the APP says the pair ("Jumu'ah · Dhuhr", D77), but every
      // snapshot surface — widgets, watch, tile — is too small for it, so they get the short
      // single name (owner, 2026-08-28: "the full thing is too long").
      const shortKey = nameKey === 'jumuah' ? 'jumuahShort' : nameKey;
      const name = deps.translate(`prayers.${shortKey}`);
      const arabicName = deps.translate(`prayers.arabic.${shortKey}`);
      const dueCaption =
        prayer === 'fajr'
          ? sunrise !== null
            ? deps.translate('today.caption.dueUntilSunrise', { time: timeText(sunrise) })
            : deps.translate('today.caption.dueNow')
          : windowEnd !== null
            ? deps.translate('today.caption.dueUntil', { time: timeText(windowEnd) })
            : deps.translate('today.caption.dueNow');
      return {
        prayer,
        name,
        arabicName: arabicName === name ? null : arabicName,
        at: at.getTime(),
        timeText: timeText(at),
        windowEndAt: windowEnd === null ? null : windowEnd.getTime(),
        dueCaption,
        untilText:
          windowEnd === null ? null : deps.translate('today.hero.until', { time: timeText(windowEnd) }),
        untilStartText: deps.translate('widgets.untilPrayer', { prayer: name }),
        status: isExempt ? 'exempt' : statuses[prayer],
      };
    });

    days.push({
      day,
      startsAt: times.times.fajr.getTime(),
      endsAt: nextTimes.times.fajr.getTime(),
      dateText: gregorianText(day, deps.numericLocale),
      hijriText: hijriText(day, deps),
      isExempt,
      sunriseAt: sunrise === null ? null : sunrise.getTime(),
      sunriseText: sunrise === null ? null : timeText(sunrise),
      prayers,
    });
  }

  if (days.length < 2) return null;

  const segments = buildSegments(days);
  // Today only, and only when there is something to show. D177 keeps this to the large home-screen
  // widget; the snapshot carries it, and each native surface decides whether it draws it.
  const buddies = deps.buddiesFor?.(today);
  const lastDay = days[days.length - 1];

  return {
    version: WIDGET_SNAPSHOT_VERSION,
    generatedAt: input.now.getTime(),
    expiresAt: lastDay.endsAt,
    language: deps.language,
    rtl: deps.rtl,
    theme: deps.theme,
    strings: {
      sunrise: deps.translate('today.sunrise.label'),
      statusPrayed: deps.translate('seal.status.prayed'),
      statusLate: deps.translate('seal.status.late'),
      statusMissed: deps.translate('seal.status.missed'),
      statusNotMarked: deps.translate('seal.status.unlogged'),
      statusNotRequired: deps.translate('seal.status.exempt'),
      statusUpcoming: deps.translate('today.caption.upcoming'),
      now: deps.translate('today.caption.dueNow'),
      next: deps.translate('today.caption.next'),
      leftToPray: deps.translate('widgets.leftToPray'),
    },
    days,
    segments,
    ...(buddies && Object.keys(buddies).length > 0 ? { buddies: { day: today, marks: buddies } } : {}),
  };
}

/**
 * Parses what a native bridge (or an old app version) stored. Anything that is not this build's
 * version, shape included, is `null` — the reader shows its bundled state rather than guessing.
 *
 * @param raw - The stored JSON string.
 * @returns The snapshot, or `null` when it cannot be trusted.
 */
export function parseWidgetSnapshot(raw: string | null | undefined): WidgetSnapshot | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object') return null;
    const snapshot = value as WidgetSnapshot;
    if (snapshot.version !== WIDGET_SNAPSHOT_VERSION) return null;
    if (!Array.isArray(snapshot.days) || !Array.isArray(snapshot.segments)) return null;
    return snapshot;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** A Date that can actually be drawn, or `null`. */
function usable(date: Date | undefined): Date | null {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
}

/** "Monday · Aug 24", weekday first, in the numeral-correct locale. */
function gregorianText(day: PrayerDay, locale: string): string {
  const date = new Date(`${day}T12:00:00`);
  const weekday = formatDate(date, locale, { weekday: 'long' });
  const md = formatDate(date, locale, { day: 'numeric', month: 'short' });
  return `${weekday} · ${md}`;
}

/** "11 Rabiʿ al-Awwal 1448" through the app's own tokens — never Intl's month names. */
function hijriText(day: PrayerDay, deps: WidgetSnapshotDeps): string {
  try {
    const formatted = formatHijri(toHijri(day, deps.hijriOffset), { style: 'dayMonthYear' });
    return formatted.tokens
      .map((token) => {
        if (token.type === 'month' || token.type === 'era') return deps.translate(token.key);
        // A year is a name, not a quantity: grouping would render 1448 as "1,448".
        return formatNumber(token.value, deps.numericLocale, { useGrouping: false });
      })
      .join(' ');
  } catch {
    return '';
  }
}

/**
 * The boundary walk: within each day, Fajr → sunrise (window shuts, nothing current) → Dhuhr →
 * Asr → Maghrib → Isha, whose window runs to the next day's Fajr — where the next day's first
 * segment takes over. Contiguous by construction.
 */
function buildSegments(days: readonly WidgetDay[]): WidgetSegment[] {
  const segments: WidgetSegment[] = [];
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    const following: WidgetDay | undefined = days[i + 1];
    const at = (prayer: Prayer): number =>
      day.prayers.find((entry) => entry.prayer === prayer)?.at ?? Number.NaN;

    const ref = (target: WidgetDay, prayer: Prayer): { day: PrayerDay; prayer: Prayer } => ({
      day: target.day,
      prayer,
    });

    const sunriseAt = day.sunriseAt ?? at('dhuhr');
    const walk: { from: number; to: number; current: Prayer | null; next: { day: PrayerDay; prayer: Prayer } | null }[] = [
      { from: at('fajr'), to: sunriseAt, current: 'fajr', next: ref(day, 'dhuhr') },
      { from: sunriseAt, to: at('dhuhr'), current: null, next: ref(day, 'dhuhr') },
      { from: at('dhuhr'), to: at('asr'), current: 'dhuhr', next: ref(day, 'asr') },
      { from: at('asr'), to: at('maghrib'), current: 'asr', next: ref(day, 'maghrib') },
      { from: at('maghrib'), to: at('isha'), current: 'maghrib', next: ref(day, 'isha') },
      // The final day's Isha still knows its own end (the terminal Fajr the builder computed);
      // there is simply nothing to point to beyond the horizon.
      {
        from: at('isha'),
        to: day.endsAt,
        current: 'isha',
        next: following === undefined ? null : ref(following, 'fajr'),
      },
    ];
    for (const step of walk) {
      if (!Number.isFinite(step.from) || !Number.isFinite(step.to) || step.to <= step.from) {
        continue;
      }
      segments.push({ from: step.from, to: step.to, day: day.day, current: step.current, next: step.next });
    }
  }
  // The horizon's edge: past the last Isha window there is nothing to say.
  const tail = segments[segments.length - 1];
  if (tail !== undefined) {
    segments.push({ from: tail.to, to: Number.MAX_SAFE_INTEGER, day: days[days.length - 1].day, current: null, next: null });
  }
  return segments;
}

/**
 * The segment containing `now`, for parity tests and for any TS surface that wants to preview
 * exactly what a widget would show. Mirrors the native binary search.
 *
 * @param snapshot - A parsed snapshot.
 * @param now - Epoch ms.
 * @returns The active segment, or `null` before the first / when none matches.
 */
export function segmentAt(snapshot: WidgetSnapshot, now: number): WidgetSegment | null {
  return snapshot.segments.find((segment) => now >= segment.from && now < segment.to) ?? null;
}

/**
 * What a "Now" widget's hero shows at an instant (D190) — the single rule both native renderers
 * mirror (`WidgetRenderer.buildNow`, `NowWidget` small/medium). Two countdowns, deliberately
 * different (owner, 2026-11-07):
 *
 * - **deadline** — time LEFT to pray the current, unmarked prayer, counting to its window's end.
 * - **upcoming** — the calm one: time until the NEXT prayer starts. Shown when the current
 *   prayer is already marked (with its status), and in the sunrise→Dhuhr gap (Jumu'ah on Friday,
 *   by the snapshot's own Friday name).
 *
 * `static` is an unmarked current prayer whose deadline is unknown or already passed — never a
 * countdown that would start negative (D189).
 */
export type WidgetHero =
  | { kind: 'none' }
  | { kind: 'exempt'; day: PrayerDay }
  | { kind: 'deadline'; day: PrayerDay; current: Prayer; countdownTo: number }
  | { kind: 'static'; day: PrayerDay; current: Prayer }
  | {
      kind: 'upcoming';
      day: PrayerDay;
      /** The current prayer and its (marked) status, or `null` in the sunrise gap. */
      marked: { prayer: Prayer; status: PrayerStatus } | null;
      next: { day: PrayerDay; prayer: Prayer };
      countdownTo: number;
    }
  | { kind: 'logged'; day: PrayerDay; current: Prayer; status: PrayerStatus };

/**
 * @param snapshot - A parsed snapshot.
 * @param now - Epoch ms.
 * @param statusOf - Effective status of a prayer (the stored status with the pending queue laid
 *        over it, as the native side computes it).
 * @returns The hero state at `now`.
 */
export function widgetHeroAt(
  snapshot: WidgetSnapshot,
  now: number,
  statusOf: (day: PrayerDay, prayer: Prayer) => PrayerStatus
): WidgetHero {
  const segment = segmentAt(snapshot, now);
  if (segment === null) return { kind: 'none' };
  const day = snapshot.days.find((entry) => entry.day === segment.day);
  if (day === undefined) return { kind: 'none' };
  if (day.isExempt) return { kind: 'exempt', day: day.day };

  const nextAt =
    segment.next === null
      ? null
      : (snapshot.days
          .find((entry) => entry.day === segment.next?.day)
          ?.prayers.find((entry) => entry.prayer === segment.next?.prayer)?.at ?? null);

  if (segment.current === null) {
    if (segment.next === null || nextAt === null || nextAt <= now) return { kind: 'none' };
    return { kind: 'upcoming', day: day.day, marked: null, next: segment.next, countdownTo: nextAt };
  }

  const current = segment.current;
  const status = statusOf(day.day, current);
  if (status === 'unlogged') {
    const end = day.prayers.find((entry) => entry.prayer === current)?.windowEndAt ?? null;
    return end !== null && end > now
      ? { kind: 'deadline', day: day.day, current, countdownTo: end }
      : { kind: 'static', day: day.day, current };
  }
  if (segment.next === null || nextAt === null || nextAt <= now) {
    return { kind: 'logged', day: day.day, current, status };
  }
  return {
    kind: 'upcoming',
    day: day.day,
    marked: { prayer: current, status },
    next: segment.next,
    countdownTo: nextAt,
  };
}

