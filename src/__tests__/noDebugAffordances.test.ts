import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * A guard against debug scaffolding reaching a release.
 *
 * This exists because it happened three times while the app was being built, and every instance
 * was invisible to the rest of the suite — the tests stayed green while the app was broken:
 *
 * - a FAKE heading service was wired into `services/heading.ts` so screenshots could be taken on a
 *   simulator with no magnetometer. It would have shipped a compass permanently pointing at a
 *   hardcoded bearing.
 * - `screenshotSeed.ts` was imported at module scope by the root layout, forcing a location,
 *   marking qada setup complete and disabling LogBox on every real launch.
 * - `app/(tabs)/index.tsx` was replaced by `export { default } from './settings'` — the trick used
 *   to photograph a screen the simulator cannot be tapped into — and never restored, so the app
 *   had no Today tab at all. A scroll-position hack and a hardcoded `return 'ar'` in the language
 *   resolver arrived the same way.
 *
 * The common shape is a deliberate, clearly-labelled, temporary edit to PRODUCTION code that its
 * author intended to revert and did not. Nothing else in the suite notices, because each one is
 * individually plausible code. So this file asserts the two things that catch the whole class:
 * the markers such edits carry, and the identity of the one file that has been clobbered twice.
 *
 * If a check here fires, do NOT relax it — find the temporary edit and revert it.
 */

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/** Every non-test source file under src/. Tests may legitimately fake and label things. */
function productionSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'migrations') continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      if (/\.test\.tsx?$/.test(entry)) continue;
      if (entry === 'testDb.ts') continue;
      out.push(full);
    }
  };
  walk(SRC);
  return out;
}

/**
 * Markers that a human wrote to remind themselves to undo something. Deliberately narrow: these
 * are words that appear when someone is *labelling a temporary edit*, not ordinary vocabulary.
 * `TEMP` is matched as a whole word so `template`, `temperature` and `attempt` are unaffected.
 */
const DEBUG_MARKERS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bTEMP\b|\bTEMPORARY\b/, why: 'a temporary edit that was meant to be reverted' },
  { pattern: /\bREVERT\b/, why: 'an edit labelled for reversion' },
  { pattern: /screenshotSeed/, why: 'the screenshot seeding module' },
  { pattern: /FAKE_HEADING|\[SCREENSHOT\]/, why: 'screenshot-capture scaffolding' },
];

describe('no debug affordances in production source', () => {
  const files = productionSources();

  it('scans a plausible number of files (the walker itself must not silently break)', () => {
    // A guard that scans nothing passes forever. Pin the floor.
    expect(files.length).toBeGreaterThan(60);
  });

  it.each(DEBUG_MARKERS)('contains no $why', ({ pattern }) => {
    const offenders = files
      .map((file) => ({ file: relative(ROOT, file), text: readFileSync(file, 'utf8') }))
      .filter(({ text }) => pattern.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('would catch each marker if one came back', () => {
    // The guard is only worth having if it can fail.
    const sample = 'const x = 1; // TEMP M10 screenshot capture — REVERT';
    expect(DEBUG_MARKERS.some(({ pattern }) => pattern.test(sample))).toBe(true);
    expect(DEBUG_MARKERS.some(({ pattern }) => pattern.test('attempt(() => template)'))).toBe(
      false
    );
  });
});

/**
 * `app/(tabs)/index.tsx` is the app's front door and has been overwritten twice by agents
 * photographing other screens. It is cheap to assert that it is still the Today screen.
 */
describe('the Today route is the Today screen', () => {
  const today = readFileSync(join(SRC, 'app', '(tabs)', 'index.tsx'), 'utf8');

  it('is not a bare re-export of another screen', () => {
    expect(today).not.toMatch(/^\s*export\s*\{\s*default\s*\}\s*from/m);
  });

  it('composes the components only the Today screen uses', () => {
    for (const component of ['PrayerRow', 'CountdownHero', 'TodayHeader', 'QadaCard']) {
      expect(today).toContain(component);
    }
  });
});

/**
 * Every service exposes a fake adapter for tests — that seam is the whole reason native modules
 * never load under Jest, so the fakes themselves are legitimate and must NOT be banned. What must
 * never happen is a singleton handing the fake to the real app, which is precisely how a compass
 * pinned to a hardcoded bearing nearly shipped.
 */
describe('singletons are built from real adapters', () => {
  const heading = readFileSync(join(SRC, 'services', 'heading.ts'), 'utf8');
  const factory = /export function getHeadingService\(\)[\s\S]*?\n}/.exec(heading)?.[0] ?? '';

  it('finds the heading singleton factory', () => {
    expect(factory).toContain('defaultService');
  });

  it('builds the heading service from the real sensor, never the fake', () => {
    expect(factory).toContain('createExpoHeadingAdapter');
    expect(factory).not.toContain('createFakeHeadingAdapter');
    // A fake emitting on a timer is what the screenshot pass installed here.
    expect(factory).not.toContain('setInterval');
  });
});

/**
 * The language resolver decides what every string on screen says. A hardcoded return here forces
 * the whole app into one language — which is exactly how a forced-Arabic line survived a session.
 */
describe('the language resolver still resolves', () => {
  const i18n = readFileSync(join(SRC, 'i18n', 'index.ts'), 'utf8');

  it('does not hardcode a language', () => {
    expect(i18n).not.toMatch(/return\s*['"](ar|tr|en)['"]\s*;/);
  });

  it('still reads the device locale', () => {
    expect(i18n).toContain('getLocales');
  });
});

/**
 * RevenueCat keys are pasted by hand into `app.json`, which makes them the one piece of shipping
 * configuration with no compiler and no review step behind it. Two mistakes are plausible and both
 * are silent:
 *
 * - a **secret** key (`sk_…`) pasted where a public SDK key belongs. Public keys are designed to
 *   ship inside a binary; secret keys grant server-side access to the account and must never leave
 *   a server. Anyone can read a key out of a shipped app.
 * - a **test-store** key (`test_…`) surviving into a release, where it shows fabricated products to
 *   real people and quietly makes tipping impossible.
 *
 * The test key is expected during development, so this cannot simply ban it — instead it is named
 * here, so that switching to production is a deliberate edit to a test that says why.
 */
describe('the RevenueCat key is the kind of key it should be', () => {
  const appJson = require('../../app.json') as {
    expo: { extra?: { revenueCat?: Record<string, string> } };
  };
  const keys = Object.entries(appJson.expo.extra?.revenueCat ?? {});

  it('has an entry per platform', () => {
    expect(keys.map(([platform]) => platform).sort()).toEqual(['android', 'ios']);
  });

  it('never ships a secret key', () => {
    // A secret key in a client is a credential leak, not a configuration mistake.
    const leaked = keys.filter(([, key]) => /^sk_/.test(key)).map(([platform]) => platform);
    expect(leaked).toEqual([]);
  });

  it('uses keys of a recognised shape', () => {
    // Empty is valid and means the tip jar is absent by design (D46).
    const malformed = keys
      .filter(([, key]) => key !== '' && !/^(test_|appl_|goog_)/.test(key))
      .map(([platform]) => platform);
    expect(malformed).toEqual([]);
  });

  it('is on the PRODUCTION store, with the right key per platform', () => {
    // Moved off the test store on 2026-08-19. Asserted per platform because the two prefixes are
    // not interchangeable: an `appl_` key on Android (or the reverse) fails at runtime, in the one
    // code path nobody exercises until a real person tries to tip.
    expect(Object.fromEntries(keys.map(([p, k]) => [p, k.slice(0, 5)]))).toEqual({
      ios: 'appl_',
      android: 'goog_',
    });
  });
});
