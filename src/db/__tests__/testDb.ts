/**
 * Test-only database harness.
 *
 * Owns the wiring that lets Jest exercise REAL SQL: expo-sqlite is native and cannot run
 * under Jest, so tests open an in-memory better-sqlite3 database and apply the very same
 * generated migration files (`src/db/migrations/*.sql`, in journal order) against the very
 * same `schema.ts`. Anything that passes here is running the SQL that ships to the device.
 *
 * Never imported by application code.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { schema, type Schema } from '../schema';

/** Absolute path of the committed migrations folder. */
export const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
}

/**
 * Reads the drizzle-kit journal, which lists every generated migration in apply order.
 * @throws if the journal is missing or unparseable.
 */
export function readMigrationJournal(): JournalEntry[] {
  const raw = readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8');
  const parsed = JSON.parse(raw) as { entries: JournalEntry[] };
  return [...parsed.entries].sort((a, b) => a.idx - b.idx);
}

/**
 * Returns every migration statement in apply order, split on drizzle's
 * `--> statement-breakpoint` markers and stripped of empty fragments.
 */
export function readMigrationStatements(): string[] {
  return readMigrationJournal().flatMap((entry) =>
    readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0)
  );
}

/** A disposable in-memory database plus its Drizzle wrapper. */
export interface TestDb {
  /** Drizzle handle typed against the app schema. */
  db: BetterSQLite3Database<Schema>;
  /** The raw better-sqlite3 handle, for pragmas and introspection. */
  sqlite: Database.Database;
  /** Closes the connection; call in `afterEach`. */
  close: () => void;
}

/**
 * Creates a fresh in-memory database with all committed migrations applied and foreign
 * keys enabled. Each call is fully isolated — no state leaks between tests.
 */
export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const statement of readMigrationStatements()) {
    sqlite.exec(statement);
  }
  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    close: () => {
      sqlite.close();
    },
  };
}
