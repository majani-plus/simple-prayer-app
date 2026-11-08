/**
 * Upgrade-path tests: a database created by a build BEFORE congregation tracking was removed
 * (D75).
 *
 * D75 removed the `prayer_logs.jamaah` column by REWRITING the baseline migration rather than
 * adding an `ALTER`. A dev/beta install that already ran the old 0000 keeps the old table —
 * drizzle's `__drizzle_migrations` journal says 0000 is applied, so the rewritten SQL never
 * runs there. These tests pin the consequence: the query layer must keep working against a
 * table that still carries the extra nullable `jamaah` column and rows that hold values in it.
 *
 * Why this is safe in principle (and what these tests prove in practice):
 * - Drizzle always names its columns, in both SELECT (it enumerates the schema's columns) and
 *   INSERT/UPDATE (it lists the written columns), so an extra column is simply never touched.
 * - The column was nullable with no CHECK, so inserts that omit it succeed.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import {
  getDayRecord,
  getPrayerLog,
  listPrayerLogs,
  markMadeUp,
  setPrayerStatus,
} from '../queries';
import { schema, type Schema } from '../schema';
import { readMigrationStatements } from './testDb';

/** The pre-D75 `prayer_logs` DDL, verbatim from the old baseline migration. */
const LEGACY_PRAYER_LOGS = `CREATE TABLE \`prayer_logs\` (
\t\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
\t\`day\` text NOT NULL,
\t\`prayer\` text NOT NULL,
\t\`status\` text NOT NULL,
\t\`jamaah\` integer,
\t\`made_up_at\` integer,
\t\`logged_at\` integer NOT NULL,
\t\`updated_at\` integer NOT NULL
);`;

let sqlite: Database.Database;
let db: BetterSQLite3Database<Schema>;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const statement of readMigrationStatements()) {
    // Substitute the legacy table for the current one; everything else is unchanged.
    sqlite.exec(
      statement.startsWith('CREATE TABLE `prayer_logs`') ? LEGACY_PRAYER_LOGS : statement
    );
  }
  // A row written by the old build, congregation flag set.
  sqlite
    .prepare(
      `INSERT INTO prayer_logs (day, prayer, status, jamaah, made_up_at, logged_at, updated_at)
       VALUES ('2026-08-10', 'dhuhr', 'prayed', 1, NULL, 1754000000000, 1754000000000)`
    )
    .run();
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
});

describe('a database that still carries the removed jamaah column', () => {
  it('really has the legacy column (the fixture is honest)', () => {
    const columns = sqlite.prepare(`PRAGMA table_info(prayer_logs)`).all() as { name: string }[];
    expect(columns.map((column) => column.name)).toContain('jamaah');
  });

  it('reads a legacy row, ignoring the extra column', () => {
    const log = getPrayerLog(db, '2026-08-10', 'dhuhr');
    expect(log).toMatchObject({ day: '2026-08-10', prayer: 'dhuhr', status: 'prayed' });
    expect(log).not.toHaveProperty('jamaah');
  });

  it('inserts a new log without touching the legacy column', () => {
    const stored = setPrayerStatus(db, '2026-08-11', 'fajr', 'missed', { now: 1755000000000 });
    expect(stored?.status).toBe('missed');
    const raw = sqlite
      .prepare(`SELECT jamaah FROM prayer_logs WHERE day = '2026-08-11'`)
      .get() as { jamaah: number | null };
    expect(raw.jamaah).toBeNull();
  });

  it('upserts over the legacy row, preserving its jamaah value untouched', () => {
    setPrayerStatus(db, '2026-08-10', 'dhuhr', 'late', { now: 1755000000000 });
    expect(getPrayerLog(db, '2026-08-10', 'dhuhr')?.status).toBe('late');
    const raw = sqlite
      .prepare(`SELECT jamaah FROM prayer_logs WHERE day = '2026-08-10'`)
      .get() as { jamaah: number | null };
    // The upsert updates only the columns it names; the orphaned value is simply left behind.
    expect(raw.jamaah).toBe(1);
  });

  it('resolves day records and ranges normally', () => {
    setPrayerStatus(db, '2026-08-10', 'fajr', 'missed', { now: 1755000000000 });
    const record = getDayRecord(db, '2026-08-10');
    expect(record.statuses).toMatchObject({ dhuhr: 'prayed', fajr: 'missed' });
    expect(listPrayerLogs(db, '2026-08-01', '2026-08-31')).toHaveLength(2);
  });

  it('supports the made-up conversion on a legacy-table row', () => {
    setPrayerStatus(db, '2026-08-10', 'fajr', 'missed', { now: 1755000000000 });
    const converted = markMadeUp(db, '2026-08-10', 'fajr', 1755100000000);
    expect(converted?.madeUpAt).toBe(1755100000000);
  });
});
