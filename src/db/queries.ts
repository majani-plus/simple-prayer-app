/**
 * Query layer — the ONLY module in the app that talks SQL.
 *
 * It owns the translation between the physical rows declared in `schema.ts` and the domain
 * values declared in `src/domain/types.ts`. Everything above this layer (stores, services,
 * screens) works exclusively in `DayRecord` / `PrayerLog` / `ExemptPeriod` / `QadaDebts` /
 * `QadaEvent`; raw row shapes never escape this file.
 *
 * What it owns:
 * - Reading and writing prayer logs, including the "absence of a row means `unlogged`" rule
 *   (PRODUCT_SPEC §4): setting a prayer back to `unlogged` DELETES its row, and an
 *   `'unlogged'` status is never persisted.
 * - Materialising **dense** day ranges: `getDayRecords` returns one `DayRecord` for every day
 *   in the requested range, gaps resolved to `unlogged`, so History, `domain/streaks.ts` and
 *   `domain/stats.ts` can consume a contiguous array without doing any date arithmetic.
 * - CRUD for exempt periods and qada debts/events.
 *
 * What it deliberately does NOT own:
 * - **Business rules.** Exemption merge/normalisation lives in `domain/exemptions.ts`, debt
 *   math in `domain/qada.ts`, streak/stat rules in their own modules. This layer stores what
 *   it is told and reads back exactly that.
 * - **Exemption resolution by query.** Callers pass a `ReadonlySet<PrayerDay>` of exempt days
 *   (built once with `domain/exemptions.expandExemptDays`); reads never re-query the periods
 *   table per day.
 * - **Day arithmetic.** Every day string is produced/validated by `domain/dates.ts`. No date
 *   maths is reimplemented here, and none is pushed into SQL.
 * - **The connection.** Every function takes the Drizzle handle as its first argument
 *   ({@link SyncDatabase}), so the same code runs against expo-sqlite in the app and
 *   better-sqlite3 in tests, and so a caller can pass a transaction handle instead.
 *
 * No user-facing strings: errors are developer-facing `RangeError`s, i18n happens in the UI.
 */

import { and, asc, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';

import type { SyncDatabase } from './client';
import {
  exemptPeriods,
  prayerLogs,
  qadaDebts,
  qadaEvents,
  type ExemptPeriodRow,
  type PrayerLogRow,
  type QadaEventRow,
} from './schema';
import { daysBetween, isAfterDay, isBeforeDay, isValidDay, parseDay } from '../domain/dates';
import { emptyDebts, normalizeDebts } from '../domain/qada';
import { unloggedDayRecord } from '../domain/streaks';
import {
  isPrayer,
  PRAYERS,
  QADA_EVENT_TYPES,
  type DayRecord,
  type ExemptPeriod,
  type Prayer,
  type PrayerDay,
  type PrayerLog,
  type PrayerStatus,
  type QadaDebts,
  type QadaEvent,
  type QadaEventType,
} from '../domain/types';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for the mutations that only need a clock. */
export interface ClockOptions {
  /** Epoch ms to stamp `updatedAt` with. Defaults to `Date.now()`. */
  now?: number;
}

/** Filters for {@link listQadaEvents}. */
export interface ListQadaEventsOptions {
  /** Only events at or after local midnight of this prayer day (`YYYY-MM-DD`). */
  sinceDay?: PrayerDay;
  /** Only these event types. An empty array matches nothing. */
  types?: readonly QadaEventType[];
  /** Cap the result at N events (the N most recent). Must be an integer ≥ 1. */
  limit?: number;
}

/** The fields of an {@link ExemptPeriod} that {@link updateExemptPeriod} can change. */
export type ExemptPeriodPatch = Partial<Pick<ExemptPeriod, 'startDay' | 'endDay'>>;

// ---------------------------------------------------------------------------
// Internal helpers — validation
// ---------------------------------------------------------------------------

/** @throws RangeError unless `day` is a real `YYYY-MM-DD` calendar date. */
function assertDay(day: PrayerDay, label: string): PrayerDay {
  if (!isValidDay(day)) {
    throw new RangeError(`Invalid ${label}: expected a YYYY-MM-DD date, got ${String(day)}`);
  }
  return day;
}

/** @throws RangeError unless `prayer` is one of the five tracked prayers. */
function assertPrayer(prayer: Prayer, label: string): Prayer {
  if (typeof prayer !== 'string' || !isPrayer(prayer)) {
    throw new RangeError(
      `Invalid ${label}: expected one of ${PRAYERS.join('|')}, got ${String(prayer)}`
    );
  }
  return prayer;
}

/** @throws RangeError unless `value` is a finite epoch-millisecond integer. */
function assertInstant(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Invalid ${label}: expected an epoch-ms number, got ${String(value)}`);
  }
  return Math.trunc(value);
}

/** @throws RangeError unless `id` is a positive integer row id. */
function assertId(id: number, label: string): number {
  if (!Number.isInteger(id) || id <= 0) {
    throw new RangeError(`Invalid ${label}: expected a positive integer id, got ${String(id)}`);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Internal helpers — row ⇄ domain
// ---------------------------------------------------------------------------

/** A `prayer_logs` row as the domain sees it; `null` columns become absent optional fields. */
function toPrayerLog(row: PrayerLogRow): PrayerLog {
  const log: PrayerLog = {
    day: row.day,
    prayer: row.prayer,
    status: row.status,
    loggedAt: row.loggedAt,
    updatedAt: row.updatedAt,
  };
  if (row.madeUpAt !== null) log.madeUpAt = row.madeUpAt;
  return log;
}

/** An `exempt_periods` row as the domain sees it. */
function toExemptPeriod(row: ExemptPeriodRow): ExemptPeriod {
  return {
    id: row.id,
    startDay: row.startDay,
    endDay: row.endDay ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Decodes the JSON `meta` column. Corrupt or non-object payloads read as absent rather than
 * throwing — a bad audit row must never be able to take the qada screen down.
 */
function decodeMeta(raw: string | null): Record<string, unknown> | undefined {
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** A `qada_events` row as the domain sees it, with `meta` decoded. */
function toQadaEvent(row: QadaEventRow): QadaEvent {
  const event: QadaEvent = {
    id: row.id,
    type: row.type,
    prayer: row.prayer ?? null,
    delta: row.delta,
    at: row.at,
  };
  const meta = decodeMeta(row.meta);
  if (meta !== undefined) event.meta = meta;
  return event;
}

/** Reads the single log for one prayer of one day, or `null` when the prayer is unlogged. */
function selectLogRow(db: SyncDatabase, day: PrayerDay, prayer: Prayer): PrayerLogRow | null {
  const rows = db
    .select()
    .from(prayerLogs)
    .where(and(eq(prayerLogs.day, day), eq(prayerLogs.prayer, prayer)))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * Runs `fn` inside a database transaction, so a log and its qada side effect commit or roll
 * back together. The handle passed to `fn` is a transaction handle with the same type as the
 * database, so every query function in this module accepts it unchanged.
 *
 * Nesting is safe: an inner `withTransaction` on a transaction handle opens a SAVEPOINT
 * rather than a second transaction. Throwing from `fn` rolls back and rethrows.
 *
 * @param db - Database (or outer transaction) handle.
 * @param fn - Work to perform; receives the transaction handle to pass to query functions.
 * @returns Whatever `fn` returns.
 */
export function withTransaction<T>(db: SyncDatabase, fn: (tx: SyncDatabase) => T): T {
  return db.transaction((tx) => fn(tx));
}

// ---------------------------------------------------------------------------
// Prayer logs — writes
// ---------------------------------------------------------------------------

/**
 * Upserts the status of one prayer on one prayer day, keyed on `UNIQUE(day, prayer)`.
 *
 * Semantics (PRODUCT_SPEC §4):
 * - `status: 'unlogged'` DELETES the row — `unlogged` is the absence of a record and is never
 *   stored. Deleting a row that does not exist is a no-op.
 * - `loggedAt` is stamped on first insert and never rewritten; `updatedAt` moves on every edit.
 * - `madeUpAt` only survives while the status stays `missed`; any other status clears it,
 *   because "made up" is meaningless for a prayer that was not missed.
 *
 * @param db - Database or transaction handle.
 * @param day - Prayer day (`YYYY-MM-DD`), from `domain/dates.ts`.
 * @param prayer - One of the five tracked prayers.
 * @param status - The new status, including `'unlogged'` to clear the log.
 * @param opts - Clock override for `loggedAt`/`updatedAt`.
 * @returns The stored log, or `null` when the status was `'unlogged'` (row removed).
 * @throws RangeError if `day` is not a valid date or `prayer` is not a tracked prayer.
 */
export function setPrayerStatus(
  db: SyncDatabase,
  day: PrayerDay,
  prayer: Prayer,
  status: PrayerStatus,
  opts: ClockOptions = {}
): PrayerLog | null {
  assertDay(day, 'day');
  assertPrayer(prayer, 'prayer');

  if (status === 'unlogged') {
    db.delete(prayerLogs)
      .where(and(eq(prayerLogs.day, day), eq(prayerLogs.prayer, prayer)))
      .run();
    return null;
  }

  const now = assertInstant(opts.now ?? Date.now(), 'opts.now');

  return withTransaction(db, (tx) => {
    const existing = selectLogRow(tx, day, prayer);

    const madeUpAt = status === 'missed' ? (existing?.madeUpAt ?? null) : null;
    const loggedAt = existing?.loggedAt ?? now;

    const rows = tx
      .insert(prayerLogs)
      .values({ day, prayer, status, madeUpAt, loggedAt, updatedAt: now })
      .onConflictDoUpdate({
        target: [prayerLogs.day, prayerLogs.prayer],
        set: { status, madeUpAt, updatedAt: now },
      })
      .returning()
      .all();

    // `returning()` always yields the affected row for an upsert.
    return toPrayerLog(rows[0] as PrayerLogRow);
  });
}

/**
 * Records that a `missed` prayer has been made up (qada) — the missed → made-up conversion
 * offered from the History day detail (PRODUCT_SPEC §7).
 *
 * Only applies to a stored `missed` log; an unlogged prayer or any other status is left
 * untouched and `null` is returned. Decrementing the qada debt is the caller's job: wrap both
 * in {@link withTransaction} so they commit together.
 *
 * @param db - Database or transaction handle.
 * @param day - Prayer day (`YYYY-MM-DD`) the missed prayer belongs to.
 * @param prayer - One of the five tracked prayers.
 * @param at - Epoch ms the prayer was made up; also stamped on `updatedAt`.
 * @returns The updated log, or `null` when there was no `missed` row to convert.
 * @throws RangeError if `day`, `prayer` or `at` is invalid.
 */
export function markMadeUp(
  db: SyncDatabase,
  day: PrayerDay,
  prayer: Prayer,
  at: number
): PrayerLog | null {
  assertDay(day, 'day');
  assertPrayer(prayer, 'prayer');
  const madeUpAt = assertInstant(at, 'at');

  const rows = db
    .update(prayerLogs)
    .set({ madeUpAt, updatedAt: madeUpAt })
    .where(
      and(eq(prayerLogs.day, day), eq(prayerLogs.prayer, prayer), eq(prayerLogs.status, 'missed'))
    )
    .returning()
    .all();

  const row = rows[0];
  return row === undefined ? null : toPrayerLog(row);
}

/**
 * Reverses {@link markMadeUp}, returning the log to plain `missed`.
 *
 * A no-op (returning `null`) when the prayer is unlogged. Re-incrementing the qada debt is the
 * caller's job; wrap both in {@link withTransaction}.
 *
 * @param db - Database or transaction handle.
 * @param day - Prayer day (`YYYY-MM-DD`).
 * @param prayer - One of the five tracked prayers.
 * @param opts - Clock override for `updatedAt`.
 * @returns The updated log, or `null` when there was no row.
 * @throws RangeError if `day` or `prayer` is invalid.
 */
export function clearMadeUp(
  db: SyncDatabase,
  day: PrayerDay,
  prayer: Prayer,
  opts: ClockOptions = {}
): PrayerLog | null {
  assertDay(day, 'day');
  assertPrayer(prayer, 'prayer');
  const now = assertInstant(opts.now ?? Date.now(), 'opts.now');

  const rows = db
    .update(prayerLogs)
    .set({ madeUpAt: null, updatedAt: now })
    .where(and(eq(prayerLogs.day, day), eq(prayerLogs.prayer, prayer)))
    .returning()
    .all();

  const row = rows[0];
  return row === undefined ? null : toPrayerLog(row);
}

// ---------------------------------------------------------------------------
// Prayer logs — reads
// ---------------------------------------------------------------------------

/**
 * The stored log for one prayer of one day.
 *
 * Raw, un-resolved: exemption is not applied (use {@link getDayRecord} for the resolved view).
 *
 * @param db - Database or transaction handle.
 * @param day - Prayer day (`YYYY-MM-DD`).
 * @param prayer - One of the five tracked prayers.
 * @returns The log, or `null` when the prayer is unlogged.
 * @throws RangeError if `day` or `prayer` is invalid.
 */
export function getPrayerLog(db: SyncDatabase, day: PrayerDay, prayer: Prayer): PrayerLog | null {
  assertDay(day, 'day');
  assertPrayer(prayer, 'prayer');
  const row = selectLogRow(db, day, prayer);
  return row === null ? null : toPrayerLog(row);
}

/**
 * Every stored log in an inclusive day range, **sparse** (days with nothing logged are absent)
 * and ordered by day then by the canonical prayer order.
 *
 * For the dense, exemption-resolved view that History/streaks/stats want, use
 * {@link getDayRecords}.
 *
 * @param db - Database or transaction handle.
 * @param fromDay - First day of the range, inclusive (`YYYY-MM-DD`).
 * @param toDay - Last day of the range, inclusive (`YYYY-MM-DD`).
 * @returns Ascending list of logs; empty when `fromDay` is after `toDay`.
 * @throws RangeError if either day is invalid.
 */
export function listPrayerLogs(
  db: SyncDatabase,
  fromDay: PrayerDay,
  toDay: PrayerDay
): PrayerLog[] {
  assertDay(fromDay, 'fromDay');
  assertDay(toDay, 'toDay');
  if (isAfterDay(fromDay, toDay)) return [];

  const rows = db
    .select()
    .from(prayerLogs)
    .where(and(gte(prayerLogs.day, fromDay), lte(prayerLogs.day, toDay)))
    .orderBy(asc(prayerLogs.day))
    .all();

  return sortByDayThenPrayer(rows).map(toPrayerLog);
}

/**
 * Stable ordering: ascending day, then the canonical Fajr→Isha order within a day.
 *
 * The day comparison is a plain string compare rather than `dates.compareDays`, deliberately:
 * this is a presentation tie-break over rows already in the table, and `compareDays` throws on a
 * malformed day — a single corrupt row must not be able to make a read fail. Every day that gets
 * *written* is validated by `assertDay`, so for real data the two orderings agree.
 */
function sortByDayThenPrayer(rows: PrayerLogRow[]): PrayerLogRow[] {
  const order = new Map<Prayer, number>(PRAYERS.map((prayer, index) => [prayer, index]));
  return [...rows].sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    return (order.get(a.prayer) ?? PRAYERS.length) - (order.get(b.prayer) ?? PRAYERS.length);
  });
}

/**
 * The **dense** resolved history for an inclusive day range: exactly one `DayRecord` per day
 * from `fromDay` to `toDay`, ascending, with no gaps. This is the read that History,
 * `domain/streaks.ts` and `domain/stats.ts` consume.
 *
 * Resolution rules:
 * - A day with no rows yields an all-`unlogged` record (`domain/streaks.unloggedDayRecord`).
 * - A prayer with no row on an otherwise logged day is `unlogged`.
 * - A day present in `exemptDays` is resolved to `isExempt: true`, and exemption overrides
 *   `unlogged` and `missed` — **never an explicit `prayed`/`late` log** (spec-exemption
 *   amendment 2). Hayd begins at a moment, not at midnight: a woman who prayed Fajr and Dhuhr
 *   and then began her period is correctly recorded as having prayed them, and a day-level
 *   period must not visually erase those marks. `missed` resolving to `exempt` is the
 *   protective behaviour the feature exists for (PRODUCT_SPEC §6); its made-up marker is
 *   hidden with it. The underlying rows are not touched, so un-marking the exemption restores
 *   them — and the qada debt a hidden `missed` created is refunded by the tracking store in
 *   the same transaction that covers it.
 *
 * The exempt set is supplied by the caller (build it once per range with
 * `domain/exemptions.expandExemptDays`); this function never queries the periods table.
 *
 * @param db - Database or transaction handle.
 * @param fromDay - First day of the range, inclusive (`YYYY-MM-DD`).
 * @param toDay - Last day of the range, inclusive (`YYYY-MM-DD`).
 * @param exemptDays - Days to resolve as exempt. Pass an empty set when exemption mode is off.
 * @returns One record per day, ascending; empty when `fromDay` is after `toDay`.
 * @throws RangeError if either day is invalid.
 */
export function getDayRecords(
  db: SyncDatabase,
  fromDay: PrayerDay,
  toDay: PrayerDay,
  exemptDays: ReadonlySet<PrayerDay> = new Set()
): DayRecord[] {
  assertDay(fromDay, 'fromDay');
  assertDay(toDay, 'toDay');
  if (isAfterDay(fromDay, toDay)) return [];

  const rowsByDay = new Map<PrayerDay, PrayerLogRow[]>();
  const rows = db
    .select()
    .from(prayerLogs)
    .where(and(gte(prayerLogs.day, fromDay), lte(prayerLogs.day, toDay)))
    .all();
  for (const row of rows) {
    const bucket = rowsByDay.get(row.day);
    if (bucket === undefined) rowsByDay.set(row.day, [row]);
    else bucket.push(row);
  }

  // `daysBetween` is the single source of day arithmetic (domain/dates.ts) — never reimplemented.
  return daysBetween(fromDay, toDay).map((day) =>
    buildDayRecord(day, rowsByDay.get(day) ?? [], exemptDays.has(day))
  );
}

/**
 * The resolved record for a single day — the day-detail sheet's read.
 *
 * Identical semantics to {@link getDayRecords} over a one-day range.
 *
 * @param db - Database or transaction handle.
 * @param day - Prayer day (`YYYY-MM-DD`).
 * @param exemptDays - Days to resolve as exempt (only `day` is consulted).
 * @returns The record; all-`unlogged` when nothing is stored.
 * @throws RangeError if `day` is invalid.
 */
export function getDayRecord(
  db: SyncDatabase,
  day: PrayerDay,
  exemptDays: ReadonlySet<PrayerDay> = new Set()
): DayRecord {
  assertDay(day, 'day');
  const rows = db.select().from(prayerLogs).where(eq(prayerLogs.day, day)).all();
  return buildDayRecord(day, rows, exemptDays.has(day));
}

/**
 * Folds a day's rows (possibly none) into the resolved `DayRecord`.
 *
 * On an exempt day the resolution is **per prayer**, not per day: every slot defaults to
 * `exempt`, but a stored `prayed`/`late` row keeps its status, because an explicit "I prayed
 * this" outranks a day-level range that merely says no prayer was owed (spec-exemption
 * amendment 2 — the first and last day of a period come out right without the user touching
 * individual prayers). `missed` and absent rows resolve to `exempt`.
 */
function buildDayRecord(day: PrayerDay, rows: PrayerLogRow[], isExempt: boolean): DayRecord {
  const record = unloggedDayRecord(day);
  if (isExempt) {
    for (const prayer of PRAYERS) record.statuses[prayer] = 'exempt';
    record.isExempt = true;
    for (const row of rows) {
      if (!isPrayer(row.prayer)) continue;
      if (row.status !== 'prayed' && row.status !== 'late') continue;
      record.statuses[row.prayer] = row.status;
    }
    return record;
  }
  for (const row of rows) {
    if (!isPrayer(row.prayer)) continue;
    record.statuses[row.prayer] = row.status;
    if (row.madeUpAt !== null) record.madeUp[row.prayer] = true;
  }
  return record;
}

/**
 * The earliest day that has any log at all — the natural start of the "lifetime" stats window.
 *
 * @param db - Database or transaction handle.
 * @returns The earliest logged day, or `null` when nothing has ever been logged.
 */
export function firstLoggedDay(db: SyncDatabase): PrayerDay | null {
  const rows = db
    .select({ day: prayerLogs.day })
    .from(prayerLogs)
    .orderBy(asc(prayerLogs.day))
    .limit(1)
    .all();
  return rows[0]?.day ?? null;
}

/**
 * The latest day that has any log at all.
 *
 * @param db - Database or transaction handle.
 * @returns The latest logged day, or `null` when nothing has ever been logged.
 */
export function lastLoggedDay(db: SyncDatabase): PrayerDay | null {
  const rows = db
    .select({ day: prayerLogs.day })
    .from(prayerLogs)
    .orderBy(desc(prayerLogs.day))
    .limit(1)
    .all();
  return rows[0]?.day ?? null;
}

// ---------------------------------------------------------------------------
// Exempt periods
// ---------------------------------------------------------------------------

/**
 * Every stored exempt period, ascending by start day (then by id for stability).
 *
 * Persistence only: overlapping or adjacent periods are returned exactly as stored. Merge and
 * normalise them with `domain/exemptions.normalizePeriods` before use.
 *
 * @param db - Database or transaction handle.
 * @returns All periods; `endDay` is `null` for an ongoing one.
 */
export function listExemptPeriods(db: SyncDatabase): ExemptPeriod[] {
  return db
    .select()
    .from(exemptPeriods)
    .orderBy(asc(exemptPeriods.startDay), asc(exemptPeriods.id))
    .all()
    .map(toExemptPeriod);
}

/**
 * Inserts one exempt period.
 *
 * @param db - Database or transaction handle.
 * @param period - The period to store; any `id` on it is ignored (SQLite assigns one).
 * @returns The stored period, with its assigned `id`.
 * @throws RangeError if a day is malformed or `endDay` precedes `startDay`.
 */
export function insertExemptPeriod(db: SyncDatabase, period: ExemptPeriod): ExemptPeriod {
  assertDay(period.startDay, 'period.startDay');
  if (period.endDay !== null && period.endDay !== undefined) {
    assertDay(period.endDay, 'period.endDay');
    if (isBeforeDay(period.endDay, period.startDay)) {
      throw new RangeError(
        `Invalid exempt period: endDay ${period.endDay} precedes startDay ${period.startDay}`
      );
    }
  }
  const createdAt = assertInstant(period.createdAt, 'period.createdAt');

  const rows = db
    .insert(exemptPeriods)
    .values({ startDay: period.startDay, endDay: period.endDay ?? null, createdAt })
    .returning()
    .all();

  return toExemptPeriod(rows[0] as ExemptPeriodRow);
}

/**
 * Updates the days of one exempt period — typically closing an open one ("exempt until X").
 *
 * `createdAt` is immutable. Passing `endDay: null` reopens a closed period.
 *
 * @param db - Database or transaction handle.
 * @param id - Row id of the period.
 * @param patch - The days to change; omitted fields are left as they are.
 * @returns The updated period, or `null` when no period has that id.
 * @throws RangeError if `id` is not a positive integer, a patched day is malformed, or the
 *   resulting `endDay` would precede the resulting `startDay`.
 */
export function updateExemptPeriod(
  db: SyncDatabase,
  id: number,
  patch: ExemptPeriodPatch
): ExemptPeriod | null {
  assertId(id, 'id');
  if (patch.startDay !== undefined) assertDay(patch.startDay, 'patch.startDay');
  if (patch.endDay !== undefined && patch.endDay !== null) assertDay(patch.endDay, 'patch.endDay');

  return withTransaction(db, (tx) => {
    const existing = tx.select().from(exemptPeriods).where(eq(exemptPeriods.id, id)).limit(1).all();
    const current = existing[0];
    if (current === undefined) return null;

    const startDay = patch.startDay ?? current.startDay;
    const endDay = patch.endDay !== undefined ? patch.endDay : (current.endDay ?? null);
    if (endDay !== null && isBeforeDay(endDay, startDay)) {
      throw new RangeError(`Invalid exempt period: endDay ${endDay} precedes startDay ${startDay}`);
    }

    const rows = tx
      .update(exemptPeriods)
      .set({ startDay, endDay })
      .where(eq(exemptPeriods.id, id))
      .returning()
      .all();

    return toExemptPeriod(rows[0] as ExemptPeriodRow);
  });
}

/**
 * Deletes one exempt period.
 *
 * @param db - Database or transaction handle.
 * @param id - Row id of the period.
 * @returns `true` when a row was deleted, `false` when no period had that id.
 * @throws RangeError if `id` is not a positive integer.
 */
export function deleteExemptPeriod(db: SyncDatabase, id: number): boolean {
  assertId(id, 'id');
  const rows = db.delete(exemptPeriods).where(eq(exemptPeriods.id, id)).returning().all();
  return rows.length > 0;
}

/**
 * Atomically replaces the whole exempt-period table with `periods`.
 *
 * The counterpart to `domain/exemptions.startPeriod` / `endPeriod` / `normalizePeriods`, which
 * all return a complete, normalised array rather than a diff: compute the new array in the
 * domain, then persist it here in one transaction. Row ids are reassigned.
 *
 * @param db - Database or transaction handle.
 * @param periods - The complete desired set of periods.
 * @returns The stored periods with their new ids, in insertion order.
 * @throws RangeError if any period is malformed; nothing is written in that case.
 */
export function replaceExemptPeriods(
  db: SyncDatabase,
  periods: readonly ExemptPeriod[]
): ExemptPeriod[] {
  return withTransaction(db, (tx) => {
    tx.delete(exemptPeriods).run();
    return periods.map((period) => insertExemptPeriod(tx, period));
  });
}

// ---------------------------------------------------------------------------
// Qada — debts
// ---------------------------------------------------------------------------

/**
 * The current outstanding debt per prayer.
 *
 * Missing rows read as `0`, and every count is passed through
 * `domain/qada.normalizeDebts`, so the result is always a complete, non-negative-integer
 * `QadaDebts` even on a fresh install or a corrupt row.
 *
 * @param db - Database or transaction handle.
 * @returns All five counters.
 */
export function getQadaDebts(db: SyncDatabase): QadaDebts {
  const debts = emptyDebts();
  for (const row of db.select().from(qadaDebts).all()) {
    if (isPrayer(row.prayer)) debts[row.prayer] = row.count;
  }
  return normalizeDebts(debts);
}

/**
 * Writes all five debt counters, upserting on the prayer key.
 *
 * The debts are sanitised with `domain/qada.normalizeDebts` first, so a negative or fractional
 * count can never reach the database. Writing the whole record (rather than a delta) mirrors
 * the domain's pure `applyTick`/`applyMiss`/`forgive` functions, which each return complete
 * counters. Append the matching audit event with {@link appendQadaEvent}, inside
 * {@link withTransaction} so the two cannot diverge.
 *
 * @param db - Database or transaction handle.
 * @param debts - The complete new counters.
 * @param opts - Clock override for `updatedAt`.
 * @returns The sanitised counters as stored.
 */
export function setQadaDebts(
  db: SyncDatabase,
  debts: QadaDebts,
  opts: ClockOptions = {}
): QadaDebts {
  const normalized = normalizeDebts(debts);
  const now = assertInstant(opts.now ?? Date.now(), 'opts.now');

  withTransaction(db, (tx) => {
    for (const prayer of PRAYERS) {
      tx.insert(qadaDebts)
        .values({ prayer, count: normalized[prayer], updatedAt: now })
        .onConflictDoUpdate({
          target: qadaDebts.prayer,
          set: { count: normalized[prayer], updatedAt: now },
        })
        .run();
    }
  });

  return normalized;
}

// ---------------------------------------------------------------------------
// Qada — events
// ---------------------------------------------------------------------------

/**
 * Appends one entry to the append-only qada audit trail. Nothing here is ever updated or
 * deleted — the forgiveness archive and its 30-day undo are reconstructed from these rows.
 *
 * `meta` is JSON-encoded on the way in and decoded on the way out.
 *
 * @param db - Database or transaction handle.
 * @param event - The event to append; any `id` on it is ignored (SQLite assigns one).
 * @returns The stored event with its assigned `id`.
 * @throws RangeError if `type` is not a known event type, `prayer` is neither `null` nor a
 *   tracked prayer, `delta` is not an integer, or `at` is not a finite epoch-ms number.
 */
export function appendQadaEvent(db: SyncDatabase, event: QadaEvent): QadaEvent {
  if (!(QADA_EVENT_TYPES as readonly string[]).includes(event.type)) {
    throw new RangeError(`Invalid event.type: got ${String(event.type)}`);
  }
  if (event.prayer !== null && event.prayer !== undefined)
    assertPrayer(event.prayer, 'event.prayer');
  if (!Number.isInteger(event.delta)) {
    throw new RangeError(`Invalid event.delta: expected an integer, got ${String(event.delta)}`);
  }
  const at = assertInstant(event.at, 'event.at');

  const rows = db
    .insert(qadaEvents)
    .values({
      type: event.type,
      prayer: event.prayer ?? null,
      delta: event.delta,
      at,
      meta: event.meta === undefined ? null : JSON.stringify(event.meta),
    })
    .returning()
    .all();

  return toQadaEvent(rows[0] as QadaEventRow);
}

/**
 * Lists qada audit events, newest first (`at` descending, then `id` descending so events
 * sharing a timestamp keep insertion order reversed deterministically).
 *
 * Filters are ANDed. `sinceDay` compares against **local midnight** of that prayer day, via
 * `domain/dates.parseDay`, so a 23/25-hour DST day is still one day. An empty `types` array
 * matches nothing.
 *
 * @param db - Database or transaction handle.
 * @param opts - Optional `sinceDay`, `types` and `limit` filters.
 * @returns Matching events, newest first.
 * @throws RangeError if `sinceDay` is malformed, `types` contains an unknown type, or `limit`
 *   is not an integer ≥ 1.
 */
export function listQadaEvents(db: SyncDatabase, opts: ListQadaEventsOptions = {}): QadaEvent[] {
  const conditions: SQL[] = [];

  if (opts.sinceDay !== undefined) {
    assertDay(opts.sinceDay, 'opts.sinceDay');
    conditions.push(gte(qadaEvents.at, parseDay(opts.sinceDay).getTime()));
  }
  if (opts.types !== undefined) {
    for (const type of opts.types) {
      if (!(QADA_EVENT_TYPES as readonly string[]).includes(type)) {
        throw new RangeError(`Invalid opts.types entry: got ${String(type)}`);
      }
    }
    conditions.push(inArray(qadaEvents.type, [...opts.types]));
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new RangeError(`Invalid opts.limit: expected an integer >= 1, got ${String(opts.limit)}`);
  }

  const base = db
    .select()
    .from(qadaEvents)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(qadaEvents.at), desc(qadaEvents.id));

  const rows = opts.limit === undefined ? base.all() : base.limit(opts.limit).all();
  return rows.map(toQadaEvent);
}

/**
 * The most recent `forgive` event — the archive row the qada screen renders ("forgiven · date")
 * and the snapshot `domain/qada.undoForgive` restores from.
 *
 * Persistence only: whether the undo is still offered is
 * `domain/qada.canUndoForgive`'s decision, and whether it was *already* undone is decided by
 * the caller (look for a later `forgiveUndo` event).
 *
 * @param db - Database or transaction handle.
 * @returns The latest `forgive` event with its `meta` decoded, or `null` if there is none.
 */
export function latestForgiveEvent(db: SyncDatabase): QadaEvent | null {
  const rows = db
    .select()
    .from(qadaEvents)
    .where(eq(qadaEvents.type, 'forgive'))
    .orderBy(desc(qadaEvents.at), desc(qadaEvents.id))
    .limit(1)
    .all();
  const row = rows[0];
  return row === undefined ? null : toQadaEvent(row);
}
