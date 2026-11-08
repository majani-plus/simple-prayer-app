/**
 * Proves the committed migration files are real, complete and consistent with `schema.ts`
 * by applying them to an in-memory better-sqlite3 database and inspecting the result.
 */

import { PRAYERS, QADA_EVENT_TYPES } from '../../domain/types';
import migrationBundle from '../migrations/migrations';
import { exemptPeriods, prayerLogs, qadaDebts, qadaEvents } from '../schema';
import { createTestDb, readMigrationJournal, readMigrationStatements, type TestDb } from './testDb';

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  dflt_value: string | null;
}

interface IndexListRow {
  name: string;
  unique: number;
}

let harness: TestDb;

beforeEach(() => {
  harness = createTestDb();
});

afterEach(() => {
  harness.close();
});

function tableNames(): string[] {
  const rows = harness.sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

function columns(table: string): TableInfoRow[] {
  return harness.sqlite.pragma(`table_info(${table})`) as TableInfoRow[];
}

function indexes(table: string): IndexListRow[] {
  return harness.sqlite.pragma(`index_list(${table})`) as IndexListRow[];
}

describe('generated migrations', () => {
  it('has a journal whose entries all have a matching .sql file', () => {
    const journal = readMigrationJournal();
    expect(journal.length).toBeGreaterThan(0);
    expect(readMigrationStatements().length).toBeGreaterThan(0);
  });

  it('creates every table in the data model', () => {
    expect(tableNames()).toEqual(
      expect.arrayContaining(['exempt_periods', 'prayer_logs', 'qada_debts', 'qada_events'])
    );
  });

  it('exposes the migration bundle the Expo migrator consumes', () => {
    const journal = readMigrationJournal();
    expect(migrationBundle.journal.entries).toHaveLength(journal.length);
    for (const entry of journal) {
      const key = `m${entry.idx.toString().padStart(4, '0')}`;
      expect(typeof migrationBundle.migrations[key]).toBe('string');
      expect(migrationBundle.migrations[key]).toContain('CREATE TABLE');
    }
  });
});

describe('prayer_logs', () => {
  it('has exactly the columns of the data model, with the right nullability', () => {
    const byName = new Map(columns('prayer_logs').map((column) => [column.name, column]));
    expect([...byName.keys()].sort()).toEqual([
      'day',
      'id',
      'logged_at',
      'made_up_at',
      'prayer',
      'status',
      'updated_at',
    ]);
    expect(byName.get('id')?.pk).toBe(1);
    for (const required of ['day', 'prayer', 'status', 'logged_at', 'updated_at']) {
      expect(byName.get(required)?.notnull).toBe(1);
    }
    expect(byName.get('made_up_at')?.notnull).toBe(0);
  });

  it('has a UNIQUE index on (day, prayer) and a plain index on day', () => {
    const list = indexes('prayer_logs');
    const unique = list.find((index) => index.name === 'prayer_logs_day_prayer_unique');
    expect(unique).toBeDefined();
    expect(unique?.unique).toBe(1);

    const dayIndex = list.find((index) => index.name === 'prayer_logs_day_idx');
    expect(dayIndex).toBeDefined();
    expect(dayIndex?.unique).toBe(0);

    const uniqueColumns = (
      harness.sqlite.pragma('index_info(prayer_logs_day_prayer_unique)') as { name: string }[]
    ).map((row) => row.name);
    expect(uniqueColumns).toEqual(['day', 'prayer']);
  });

  it('rejects a second log for the same day and prayer', () => {
    const row = {
      day: '2026-08-19',
      prayer: 'fajr' as const,
      status: 'prayed' as const,
      loggedAt: 1,
      updatedAt: 1,
    };
    harness.db.insert(prayerLogs).values(row).run();
    expect(() => harness.db.insert(prayerLogs).values(row).run()).toThrow(/UNIQUE/i);
  });

  it('allows the same prayer on different days and different prayers on one day', () => {
    for (const prayer of PRAYERS) {
      harness.db
        .insert(prayerLogs)
        .values({ day: '2026-08-19', prayer, status: 'prayed', loggedAt: 1, updatedAt: 1 })
        .run();
    }
    harness.db
      .insert(prayerLogs)
      .values({ day: '2026-08-20', prayer: 'fajr', status: 'late', loggedAt: 1, updatedAt: 1 })
      .run();
    expect(harness.db.select().from(prayerLogs).all()).toHaveLength(PRAYERS.length + 1);
  });

  it('round-trips domain values verbatim, including the nullable columns', () => {
    harness.db
      .insert(prayerLogs)
      .values({
        day: '2026-08-19',
        prayer: 'maghrib',
        status: 'missed',
        madeUpAt: 1_760_000_000_000,
        loggedAt: 1_759_000_000_000,
        updatedAt: 1_759_000_000_001,
      })
      .run();
    const [stored] = harness.db.select().from(prayerLogs).all();
    expect(stored).toMatchObject({
      day: '2026-08-19',
      prayer: 'maghrib',
      status: 'missed',
      madeUpAt: 1_760_000_000_000,
      loggedAt: 1_759_000_000_000,
      updatedAt: 1_759_000_000_001,
    });

    harness.db
      .insert(prayerLogs)
      .values({ day: '2026-08-20', prayer: 'isha', status: 'exempt', loggedAt: 2, updatedAt: 2 })
      .run();
    const exempt = harness.db.select().from(prayerLogs).all()[1];
    expect(exempt.madeUpAt).toBeNull();
  });
});

describe('exempt_periods', () => {
  it('stores an open-ended period as a null end_day', () => {
    harness.db
      .insert(exemptPeriods)
      .values({ startDay: '2026-08-10', endDay: null, createdAt: 5 })
      .run();
    harness.db
      .insert(exemptPeriods)
      .values({ startDay: '2026-07-01', endDay: '2026-07-06', createdAt: 4 })
      .run();
    const rows = harness.db.select().from(exemptPeriods).all();
    expect(rows.map((row) => row.endDay)).toEqual([null, '2026-07-06']);
    expect(rows.every((row) => typeof row.id === 'number')).toBe(true);
  });

  it('requires a start day', () => {
    expect(() =>
      harness.sqlite
        .prepare(`INSERT INTO exempt_periods (start_day, created_at) VALUES (NULL, 1)`)
        .run()
    ).toThrow(/NOT NULL/i);
  });
});

describe('qada_debts', () => {
  it('uses prayer as the primary key and defaults count to 0', () => {
    const byName = new Map(columns('qada_debts').map((column) => [column.name, column]));
    expect(byName.get('prayer')?.pk).toBe(1);
    expect(byName.get('count')?.dflt_value).toBe('0');

    harness.sqlite.prepare(`INSERT INTO qada_debts (prayer, updated_at) VALUES ('fajr', 1)`).run();
    expect(harness.db.select().from(qadaDebts).all()).toEqual([
      { prayer: 'fajr', count: 0, updatedAt: 1 },
    ]);
  });

  it('rejects a duplicate prayer row', () => {
    harness.db.insert(qadaDebts).values({ prayer: 'asr', count: 12, updatedAt: 1 }).run();
    expect(() =>
      harness.db.insert(qadaDebts).values({ prayer: 'asr', count: 3, updatedAt: 2 }).run()
    ).toThrow(/UNIQUE|PRIMARY/i);
  });
});

describe('qada_events', () => {
  it('accepts every domain event type, a null prayer and JSON meta', () => {
    for (const type of QADA_EVENT_TYPES) {
      harness.db
        .insert(qadaEvents)
        .values({ type, prayer: null, delta: -1, at: 100, meta: JSON.stringify({ type }) })
        .run();
    }
    const rows = harness.db.select().from(qadaEvents).all();
    expect(rows).toHaveLength(QADA_EVENT_TYPES.length);
    expect(rows.map((row) => row.type)).toEqual([...QADA_EVENT_TYPES]);
    expect(rows.every((row) => row.prayer === null)).toBe(true);
    expect(JSON.parse(rows[0].meta ?? '{}')).toEqual({ type: QADA_EVENT_TYPES[0] });
  });

  it('keeps a negative delta as-is and indexes by time', () => {
    harness.db
      .insert(qadaEvents)
      .values({ type: 'tick', prayer: 'dhuhr', delta: -1, at: 42 })
      .run();
    const [row] = harness.db.select().from(qadaEvents).all();
    expect(row.delta).toBe(-1);
    expect(row.meta).toBeNull();
    expect(indexes('qada_events').map((index) => index.name)).toContain('qada_events_at_idx');
  });
});
