/**
 * Guards the one property of `client.ts` that Jest can actually check: importing it (and
 * therefore importing anything that imports it) must never touch the native expo-sqlite
 * module. Opening/closing a real connection is only exercisable on a device.
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as client from '../client';
import type { AppDatabase, SyncDatabase } from '../client';
import type { Schema } from '../schema';

/** Compile-time proof that both drivers satisfy the `SyncDatabase` the query layer targets. */
type IsAssignable<TSource, TTarget> = TSource extends TTarget ? true : false;
const expoDriverIsSyncDatabase: IsAssignable<AppDatabase, SyncDatabase> = true;
const betterSqliteDriverIsSyncDatabase: IsAssignable<
  BetterSQLite3Database<Schema>,
  SyncDatabase
> = true;

describe('db client', () => {
  it('types both drivers as a SyncDatabase', () => {
    expect(expoDriverIsSyncDatabase && betterSqliteDriverIsSyncDatabase).toBe(true);
  });

  it('imports without touching native code', () => {
    expect(client.isDatabaseOpen()).toBe(false);
    expect(client.DATABASE_NAME).toBe('simple-prayer-times.db');
  });

  it('exposes the app-start surface', () => {
    expect(typeof client.getDb).toBe('function');
    expect(typeof client.getNativeDb).toBe('function');
    expect(typeof client.runMigrations).toBe('function');
    expect(typeof client.useDatabaseMigrations).toBe('function');
    expect(typeof client.closeDatabase).toBe('function');
    expect(typeof client.deleteDatabase).toBe('function');
  });

  it('closing a database that was never opened is a no-op', () => {
    expect(() => {
      client.closeDatabase();
    }).not.toThrow();
    expect(client.isDatabaseOpen()).toBe(false);
  });
});
