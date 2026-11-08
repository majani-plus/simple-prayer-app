/**
 * Drizzle schema — the single source of truth for the on-device SQLite database.
 *
 * This module owns the physical shape of the four persisted tables (`prayer_logs`,
 * `exempt_periods`, `qada_debts`, `qada_events`) and nothing else: no queries, no
 * connection handling, no business rules. It is imported both by the app (via
 * `client.ts`) and by `drizzle-kit` when generating migrations, so it must stay free
 * of React Native / Expo imports.
 *
 * Column values are stored **verbatim** as the domain values from `src/domain/types.ts`
 * (e.g. `status` holds `'prayed' | 'late' | 'missed' | 'exempt'`), so no translation
 * layer is needed between rows and domain objects. The string unions are derived from
 * the domain contract with `.$type<…>()` — never re-declared here.
 *
 * Invariants encoded in the schema (see docs/PRODUCT_SPEC.md §4–§7):
 * - `UNIQUE(day, prayer)` on `prayer_logs`: at most one log per prayer per prayer day.
 * - The absence of a `prayer_logs` row means `unlogged`; an `'unlogged'` status row is
 *   never written (this is enforced by the query layer and by the `LoggedPrayerStatus`
 *   type, which excludes it).
 * - `exempt_periods.end_day` is nullable — `null` means the period is still ongoing.
 * - Timestamps are epoch milliseconds stored as INTEGER; days are `YYYY-MM-DD` TEXT
 *   prayer days (Fajr→next Fajr), produced only by `src/domain/dates.ts`.
 */

import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import type { ExemptPeriod, Prayer, PrayerDay, PrayerLog, QadaEventType } from '../domain/types';

/** The statuses that can actually be persisted — `unlogged` is the absence of a row. */
export type LoggedPrayerStatus = PrayerLog['status'];

/**
 * One user-entered log for a single prayer on a single prayer day.
 * A missing row means `unlogged` and is never materialised.
 */
export const prayerLogs = sqliteTable(
  'prayer_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Prayer day as `YYYY-MM-DD` (Fajr→next Fajr). */
    day: text('day').$type<PrayerDay>().notNull(),
    /** One of the five tracked prayers. */
    prayer: text('prayer').$type<Prayer>().notNull(),
    /** `prayed` | `late` | `missed` | `exempt` — never `unlogged`. */
    status: text('status').$type<LoggedPrayerStatus>().notNull(),
    /** Epoch ms when a `missed` prayer was made up (qada), else `null`. */
    madeUpAt: integer('made_up_at'),
    /** Epoch ms the row was first written. */
    loggedAt: integer('logged_at').notNull(),
    /** Epoch ms of the last edit. */
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('prayer_logs_day_prayer_unique').on(table.day, table.prayer),
    index('prayer_logs_day_idx').on(table.day),
  ]
);

/**
 * A closed or open-ended range of exempt days (menstruation / postnatal).
 * Exempt days are excluded from stats denominators and bridge streaks.
 */
export const exemptPeriods = sqliteTable(
  'exempt_periods',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** First exempt prayer day, inclusive. */
    startDay: text('start_day').$type<PrayerDay>().notNull(),
    /** Last exempt prayer day, inclusive; `null` means the period is still ongoing. */
    endDay: text('end_day').$type<ExemptPeriod['endDay']>(),
    /** Epoch ms the period was created. */
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('exempt_periods_start_day_idx').on(table.startDay)]
);

/**
 * Current outstanding qada debt per prayer type. At most five rows exist; a missing
 * row is equivalent to a count of zero.
 */
export const qadaDebts = sqliteTable('qada_debts', {
  /** The prayer this debt belongs to — the natural primary key. */
  prayer: text('prayer').$type<Prayer>().primaryKey(),
  /** Outstanding count; never negative (enforced by the query layer). */
  count: integer('count').notNull().default(0),
  /** Epoch ms of the last change. */
  updatedAt: integer('updated_at').notNull(),
});

/**
 * Append-only audit trail of every change to the qada debts. The forgiveness archive
 * (and its 30-day undo window) is reconstructed from `forgive` / `forgiveUndo` events
 * plus their `meta` snapshots — nothing is ever deleted here.
 */
export const qadaEvents = sqliteTable(
  'qada_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `tick` | `add` | `estimateSet` | `manualSet` | `forgive` | `forgiveUndo`. */
    type: text('type').$type<QadaEventType>().notNull(),
    /** The affected prayer, or `null` for events that span all prayers. */
    prayer: text('prayer').$type<Prayer>(),
    /** Signed change applied to the debt (negative = paid off). */
    delta: integer('delta').notNull(),
    /** Epoch ms the event happened. */
    at: integer('at').notNull(),
    /** JSON-encoded snapshot payload, or `null`. Serialised by the query layer. */
    meta: text('meta'),
  },
  (table) => [index('qada_events_at_idx').on(table.at)]
);

/** Row shapes, for the query layer. `Insert` variants have optional defaulted columns. */
export type PrayerLogRow = typeof prayerLogs.$inferSelect;
export type PrayerLogInsert = typeof prayerLogs.$inferInsert;
export type ExemptPeriodRow = typeof exemptPeriods.$inferSelect;
export type ExemptPeriodInsert = typeof exemptPeriods.$inferInsert;
export type QadaDebtRow = typeof qadaDebts.$inferSelect;
export type QadaDebtInsert = typeof qadaDebts.$inferInsert;
export type QadaEventRow = typeof qadaEvents.$inferSelect;
export type QadaEventInsert = typeof qadaEvents.$inferInsert;

/** The full schema object passed to `drizzle()` so relational queries stay typed. */
export const schema = {
  prayerLogs,
  exemptPeriods,
  qadaDebts,
  qadaEvents,
};

export type Schema = typeof schema;
