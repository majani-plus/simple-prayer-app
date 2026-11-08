/**
 * Database client — owns the lifecycle of the on-device SQLite connection.
 *
 * Responsibilities: opening (lazily) the expo-sqlite database, applying connection
 * pragmas, wrapping it with Drizzle, running the generated migrations at app start, and
 * closing/deleting the database for tests and diagnostics. It owns no queries — those
 * live in `src/db/queries.ts` — and no business rules.
 *
 * Native access is deliberately lazy: `expo-sqlite` is `require`d only when the database
 * is first opened, so importing this module (or anything that imports it) is safe under
 * Jest, where the native module does not exist. Tests exercise real SQL through
 * `src/db/__tests__/testDb.ts` (better-sqlite3 + the same schema/migrations) instead.
 *
 * Dependency rule: called from services/stores, never from components.
 */

import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate, useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { SQLiteDatabase } from 'expo-sqlite';

import migrations from './migrations/migrations';
import { schema, type Schema } from './schema';

/** File name of the SQLite database inside the app's SQLite directory. */
export const DATABASE_NAME = 'simple-prayer-times.db';

/** The Drizzle handle used everywhere in the app, typed against the full schema. */
export type AppDatabase = ExpoSQLiteDatabase<Schema> & { $client: SQLiteDatabase };

/**
 * Any synchronous Drizzle connection over our schema. The query layer should be typed
 * against this rather than {@link AppDatabase}, so the same functions run against
 * expo-sqlite in the app and better-sqlite3 in tests.
 */
export type SyncDatabase = BaseSQLiteDatabase<'sync', unknown, Schema>;

let nativeDatabase: SQLiteDatabase | null = null;
let database: AppDatabase | null = null;

/**
 * Loads `expo-sqlite` lazily so that merely importing this module never touches native code.
 * @throws if called in an environment without the native module (e.g. Jest).
 */
function requireExpoSqlite(): typeof import('expo-sqlite') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-sqlite') as typeof import('expo-sqlite');
}

/**
 * Opens the native database and applies connection pragmas.
 * WAL keeps reads non-blocking while a log is written; foreign keys are enabled for
 * forward compatibility with future relational tables.
 *
 * `synchronous = NORMAL` under WAL: the seal's write commits on the JS thread, synchronously,
 * inside the tap handler — and at SQLite's default (`FULL`) every commit also waits for the WAL
 * to reach the flash. Under WAL, `NORMAL` keeps the database consistent through an app crash;
 * only a power cut in the same instant can lose the last transaction, which for a prayer log is a
 * mark the person can make again. The change-listener hook was on for a `useLiveQuery` that
 * never came; nothing in `src/` subscribes, so it fired an update hook per row for no reader.
 */
function openNativeDatabase(): SQLiteDatabase {
  const { openDatabaseSync } = requireExpoSqlite();
  const opened = openDatabaseSync(DATABASE_NAME);
  opened.execSync('PRAGMA journal_mode = WAL;');
  opened.execSync('PRAGMA synchronous = NORMAL;');
  opened.execSync('PRAGMA foreign_keys = ON;');
  return opened;
}

/**
 * Returns the singleton Drizzle database, opening the underlying SQLite file on first call.
 * Safe to call repeatedly; the connection is reused.
 * @throws if the native `expo-sqlite` module is unavailable (e.g. under Jest).
 */
export function getDb(): AppDatabase {
  if (database === null) {
    nativeDatabase = openNativeDatabase();
    database = drizzle(nativeDatabase, { schema }) as AppDatabase;
  }
  return database;
}

/**
 * Returns the raw expo-sqlite handle, opening the database if needed.
 * Only for things Drizzle cannot express (pragmas, backups, integrity checks).
 */
export function getNativeDb(): SQLiteDatabase {
  getDb();
  // `getDb()` always assigns `nativeDatabase` before returning.
  return nativeDatabase as SQLiteDatabase;
}

/** Whether the database connection is currently open. */
export function isDatabaseOpen(): boolean {
  return database !== null;
}

/**
 * Applies every pending generated migration. Call once at app start, before any query.
 * Idempotent: already-applied migrations are skipped by Drizzle's `__drizzle_migrations`
 * bookkeeping table.
 * @throws if a migration fails; the caller decides how to surface that.
 */
export async function runMigrations(): Promise<void> {
  await migrate(getDb(), migrations);
}

/** Result of {@link useDatabaseMigrations}: `success` flips true once migrations finish. */
export interface MigrationState {
  success: boolean;
  error?: Error;
}

/**
 * React hook form of {@link runMigrations}, for gating the app's root layout on a
 * migrated database. Opens the database on first render.
 */
export function useDatabaseMigrations(): MigrationState {
  return useMigrations(getDb(), migrations);
}

/**
 * Closes the connection and drops the cached Drizzle instance; the next `getDb()` reopens.
 * For tests, teardown, and before deleting the database file.
 */
export function closeDatabase(): void {
  if (nativeDatabase !== null) {
    nativeDatabase.closeSync();
  }
  nativeDatabase = null;
  database = null;
}

/**
 * DESTRUCTIVE: closes the connection and deletes the database file, discarding every log,
 * exemption and qada record. Intended for tests and an explicit "reset all data" action.
 */
export function deleteDatabase(): void {
  closeDatabase();
  const { deleteDatabaseSync } = requireExpoSqlite();
  deleteDatabaseSync(DATABASE_NAME);
}
