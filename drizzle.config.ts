/**
 * drizzle-kit configuration.
 *
 * Owns migration *generation* only (`bunx drizzle-kit generate`). The Expo driver makes
 * drizzle-kit emit, alongside the `.sql` files, a `migrations.js` bundle + `meta/_journal.json`
 * that `drizzle-orm/expo-sqlite/migrator` consumes at runtime. Both are committed.
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  driver: 'expo',
});
