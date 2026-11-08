/**
 * The layering guard.
 *
 * ARCHITECTURE.md draws the dependency arrows; nothing enforces them at build time, because
 * TypeScript is perfectly happy to let a component `import { getDb }` and open SQLite from inside a
 * render. These tests read the source tree and fail when an arrow is drawn backwards.
 *
 * Five rules, each one a bug that would otherwise be found months later:
 *
 * 1. **`src/domain` is pure.** No React, no React Native, no Expo, no store, no database. It is the
 *    only reason the domain suite runs in milliseconds and can be reasoned about at all.
 * 2. **The database has exactly one door.** UI code talks to `stores/trackingStore`; only the
 *    stores (and the app's composition root, which runs the migrations) may touch `src/db`.
 * 3. **No component computes prayer times.** `adhan` is a domain dependency; a component importing
 *    it is a business rule escaping into the view layer.
 * 4. **No hardcoded colours outside the theme.** Every colour is a token from `useTheme()`, or the
 *    night palette silently keeps a daylight paper colour.
 * 5. **No stray `console` calls** outside the one deliberate startup failure log.
 *
 * The checks are textual on purpose: a lint rule would be better, but this costs nothing, runs in
 * the same suite as everything else, and names the offending file and line.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const SRC = join(__dirname, '..');

interface SourceFile {
  /** Path relative to `src/`, always with forward slashes. */
  path: string;
  text: string;
}

/** Every non-test TypeScript file under `src/`, excluding generated migrations. */
function sourceFiles(dir = SRC): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'migrations' || entry === 'node_modules') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry) || /\.d\.ts$/.test(entry)) continue;
    out.push({ path: relative(SRC, full).split(sep).join('/'), text: readFileSync(full, 'utf8') });
  }
  return out;
}

const FILES = sourceFiles();

/** Module specifiers of every static `import`/`export … from` and dynamic `import()`. */
function importsOf(file: SourceFile): string[] {
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s[^;]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((pattern) => [...file.text.matchAll(pattern)].map((match) => match[1]));
}

function under(prefix: string): SourceFile[] {
  return FILES.filter((file) => file.path.startsWith(prefix));
}

/** `'../db/queries'` seen from `stores/trackingStore.ts` → `db/queries`. Aliases resolve too. */
function resolvesInto(file: SourceFile, specifier: string, area: string): boolean {
  if (specifier.startsWith('@/')) return specifier.slice(2).startsWith(area);
  if (!specifier.startsWith('.')) return false;
  const dir = file.path.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') dir.pop();
    else dir.push(segment);
  }
  return dir.join('/').startsWith(area);
}

function offenders(
  files: SourceFile[],
  predicate: (file: SourceFile, specifier: string) => boolean
): string[] {
  return files.flatMap((file) =>
    importsOf(file)
      .filter((specifier) => predicate(file, specifier))
      .map((specifier) => `${file.path} → ${specifier}`)
  );
}

describe('the source tree', () => {
  it('is actually being scanned', () => {
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES.map((file) => file.path)).toContain('app/(tabs)/index.tsx');
  });
});

describe('domain purity', () => {
  const FORBIDDEN = ['react', 'react-native', 'react-dom', 'react-i18next', 'i18next', 'zustand'];

  it('imports no UI or platform module', () => {
    expect(
      offenders(
        under('domain/'),
        (_file, specifier) =>
          FORBIDDEN.includes(specifier) ||
          specifier.startsWith('react-native/') ||
          specifier.startsWith('expo')
      )
    ).toEqual([]);
  });

  it('imports no store, database, component or theme', () => {
    expect(
      offenders(under('domain/'), (file, specifier) =>
        ['stores', 'db', 'components', 'theme', 'i18n', 'app', 'hooks', 'services'].some((area) =>
          resolvesInto(file, specifier, area)
        )
      )
    ).toEqual([]);
  });
});

describe('the database has one door', () => {
  /**
   * The composition root runs the migrations before the first screen mounts. Every other importer
   * of `src/db` must be a store — or one of the three files below, which ARCHITECTURE.md permits
   * ("`db` is called from services/stores, never from components"):
   *
   * - `app/_layout.tsx`, the composition root itself.
   * - `services/backgroundRefresh.ts` is the *second* composition root, and the only one that can
   *   exist without a screen: a headless launch mounts nothing, so the task has to migrate and
   *   hydrate for itself before it can plan a single reminder. It is the same two calls the root
   *   layout makes, in the same order, and it skips both when a live process has already made them.
   * - `services/export.ts` reads the *whole* record — every log, every exempt period and the
   *   entire qada audit trail — a window of days at a time. Routing that through the tracking
   *   store would pour years of history through a cache built to hold the month History is
   *   showing, and the store exposes no read for the audit trail at all. It only ever reads.
   */
  const ALLOWED = new Set([
    'app/_layout.tsx',
    'services/backgroundRefresh.ts',
    'services/export.ts',
  ]);

  it('is opened only by the stores and the app root', () => {
    const bad = FILES.filter(
      (file) => !file.path.startsWith('db/') && !file.path.startsWith('stores/')
    )
      .filter((file) => !ALLOWED.has(file.path))
      .flatMap((file) =>
        importsOf(file)
          .filter(
            (specifier) =>
              resolvesInto(file, specifier, 'db') ||
              specifier === 'drizzle-orm' ||
              specifier.startsWith('drizzle-orm/') ||
              specifier === 'expo-sqlite' ||
              specifier.startsWith('expo-sqlite/')
          )
          .map((specifier) => `${file.path} → ${specifier}`)
      );
    expect(bad).toEqual([]);
  });
});

describe('business rules stay in the domain', () => {
  it('keeps the prayer-time engine out of the view layer', () => {
    expect(
      offenders(
        FILES.filter((file) => !file.path.startsWith('domain/')),
        (_file, specifier) => specifier === 'adhan' || specifier.startsWith('adhan/')
      )
    ).toEqual([]);
  });

  it('keeps persistence primitives out of the view layer', () => {
    expect(
      offenders(
        FILES.filter((file) => !file.path.startsWith('stores/')),
        (_file, specifier) => specifier === 'react-native-mmkv'
      )
    ).toEqual([]);
  });
});

describe('colour lives in the theme', () => {
  /** `#fff`, `#ffffff`, `#ffffffcc` — but not a `#region` marker or a URL fragment. */
  const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{1,5})?\b/;
  const FUNCTIONAL = /\brgba?\(\s*\d|\bhsla?\(\s*\d/;

  /**
   * Blanks out comments, keeping line numbers intact. Components quote the mockup's CSS in their
   * docs (`0 2px 10px -4px rgba(138,100,32,.3)`) precisely so the token can be traced back to the
   * design — that is documentation, not a colour the app renders. `https://` survives, so a hex
   * hiding after a URL on the same line is still caught.
   */
  function withoutComments(text: string): string {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
      .split('\n')
      .map((line) => {
        const at = line.search(/(^|[^:])\/\//);
        return at === -1 ? line : line.slice(0, at);
      })
      .join('\n');
  }

  function scan(pattern: RegExp): string[] {
    const bad: string[] = [];
    for (const file of FILES) {
      if (file.path.startsWith('theme/')) continue;
      withoutComments(file.text)
        .split('\n')
        .forEach((line, index) => {
          if (pattern.test(line)) bad.push(`${file.path}:${index + 1} ${line.trim()}`);
        });
    }
    return bad;
  }

  it('has no hardcoded hex outside src/theme', () => {
    expect(scan(HEX)).toEqual([]);
  });

  it('has no rgb()/hsl() literal outside src/theme', () => {
    expect(scan(FUNCTIONAL)).toEqual([]);
  });

  it('would catch a hex if one were introduced', () => {
    expect(HEX.test('backgroundColor: "#f4ecd8"')).toBe(true);
    expect(FUNCTIONAL.test('boxShadow: "0 2px 8px rgba(0,0,0,.2)"')).toBe(true);
    expect(withoutComments('// rgba(1,2,3,.4)\nconst a = 1;')).toBe('\nconst a = 1;');
    expect(withoutComments('const u = "https://x/#fff";')).toContain('#fff');
  });
});

describe('logging', () => {
  /**
   * The one place a failure has to be visible before any UI exists to show it, and the opt-in
   * timing marks (D191), which are off unless the build sets `EXPO_PUBLIC_PERF_MARKS=1`.
   */
  const ALLOWED = new Set(['app/_layout.tsx', 'utils/perfMarks.ts']);

  it('has no stray console call', () => {
    const bad: string[] = [];
    for (const file of FILES) {
      if (ALLOWED.has(file.path)) continue;
      file.text.split('\n').forEach((line, index) => {
        if (/\bconsole\.(log|warn|error|debug|info)\(/.test(line)) {
          bad.push(`${file.path}:${index + 1}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});
