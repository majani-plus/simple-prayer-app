/**
 * Type declaration for the drizzle-kit generated `migrations.js` bundle.
 *
 * `migrations.js` imports raw `.sql` files, which only babel-plugin-inline-import can
 * resolve; this declaration lets TypeScript type the bundle without following that
 * import. It shadows the generated `.js` file during module resolution, so regenerating
 * migrations never invalidates it. Keep it in sync with drizzle's `MigrationConfig`.
 */
declare const migrations: {
  journal: {
    entries: { idx: number; when: number; tag: string; breakpoints: boolean }[];
  };
  migrations: Record<string, string>;
};

export default migrations;
