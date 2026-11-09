/**
 * The privacy-claim guard (decision D31, PRODUCT_SPEC §10 and §12).
 *
 * The pledge is the whole brand, and the category's open wound is a prayer app that said one thing
 * about location and did another (our market research). So the rule this file enforces is
 * narrow and absolute: **no claim in the app may be more generous than the code**.
 *
 * The claim that has to stay honest is about location. `services/location.ts` resolves an
 * `auto` location by taking a coarse fix and calling `reverseGeocode` on it — which is
 * `expo-location`'s `reverseGeocodeAsync`, i.e. `CLGeocoder` on iOS and `android.location.Geocoder`
 * on Android. Both are *network* services run by Apple and Google. The approximate position
 * therefore leaves the phone, on the default path (`useAutoLocation` ships `true`), and every
 * sentence the app shows about it has to say so. What remains true — and is what the copy now says
 * — is that it never reaches *us*: there is no server of ours anywhere in this app.
 *
 * Three surfaces carry that claim and are checked here:
 *
 * 1. the pledge card's footnote (`settings.pledge.footnote`),
 * 2. the Settings → Location footer and the Today prompt's note,
 * 3. the iOS permission strings in `locales/*.json`, which is the sentence the OS itself shows.
 *
 * Plus the native configuration behind them: the app must not even *carry* an "Always" location
 * usage string, because a string in `Info.plist` is what makes an Always prompt possible, and this
 * app has no code path to one (`services/location.ts` only ever calls
 * `requestForegroundPermissionsAsync`).
 *
 * The second claim is about **the tip jar**, and it is the one that can rot without anybody
 * touching code — see "the pledge and the tip jar" below. The third is **crash reporting**: a
 * Sentry DSN in `app.json` (`extra.sentryDsn`) means diagnostics leave the phone, and the pledge
 * and the published policy must both say so — see "the pledge and crash reporting" below.
 *
 * These are string assertions on purpose. A privacy promise is copy; the only way to keep copy
 * true is to fail a build when it stops being true.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import appJson from '../../app.json';
import { BUDDY_COLORS, BUDDY_ICONS } from '../domain/buddies';
import ar from '../i18n/locales/ar.json';
import en from '../i18n/locales/en.json';
import tr from '../i18n/locales/tr.json';
import ur from '../i18n/locales/ur.json';
import { SUPPORTED_LANGUAGES, type AppLanguage } from '../i18n';
import { buildOutbox } from '../services/buddyOutbox';
import { tipJarApiKey } from '../services/purchases';
import { sentryDsn } from '../services/telemetry';

const ROOT = join(__dirname, '..', '..');

const BUNDLES: Record<AppLanguage, typeof en> = {
  en,
  ar: ar as typeof en,
  tr: tr as typeof en,
  ur: ur as typeof en,
};

/**
 * Words that only appear in a sentence acknowledging that the *device position* — not merely a
 * typed city name — is looked up somewhere. Authored per language rather than machine-mirrored,
 * so each is a phrase a reader of that language would actually recognise.
 */
const POSITION_MARKERS: Record<AppLanguage, RegExp> = {
  en: /approximate position|device's location|device’s location/i,
  ar: /موقع(ك)?\s+(ال)?تقريبي|موقع جهازك/,
  tr: /yaklaşık konum/i,
  ur: /اندازاً مقام|اندازے سے مقام|فون کا مقام/,
};

/**
 * Phrasings that would be a lie, in two families per language: "it never leaves the device"
 * (about the position), and — since crash reporting ships — the broader "nothing at all leaves
 * this phone", which stopped being true the day a Sentry DSN was configured. The pledge may still
 * say the PRAYER LOG never leaves, because it never does; what no surface may claim is silence
 * about everything.
 */
const OVERCLAIMS: Record<AppLanguage, RegExp> = {
  en: /never leaves (your|the|this) (device|phone)|stays on (it|your phone|this phone)\b(?!\s*(for the prayer log|[—–,-]\s*unless))|never sent anywhere|nothing (about you )?(ever )?leaves (your|the|this) (device|phone)/i,
  ar: /لا يغادر جهازك|لا يُرسل إلى أي جهة|لا شيء يغادر (هذا )?(الهاتف|الجهاز|جهازك|هاتفك)/,
  tr: /cihaz[ıi]n[ıi]zdan asla (ayrılmaz|çıkmaz)|cihazından asla (ayrılmaz|çıkmaz)|hiçbir yere gönderilmiyor|hiçbir şey[^.!?]*(çıkmaz|ayrılmaz)/i,
  ur: /(فون|آلے) سے (کبھی )?باہر نہیں (جاتا|جاتی|نکلتا)|کبھی کہیں نہیں بھیجا|کچھ بھی[^۔.!؟]*باہر نہیں/,
};

function value(language: AppLanguage, key: string): string {
  const found = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      BUNDLES[language]
    );
  if (typeof found !== 'string') throw new Error(`missing ${language}:${key}`);
  return found;
}

// ---------------------------------------------------------------------------

describe('the premise', () => {
  it('still reverse-geocodes the device position, which is what all of this is about', () => {
    const source = readFileSync(join(ROOT, 'src', 'services', 'location.ts'), 'utf8');
    // If this ever stops being true the claims below may be *relaxed* — but only deliberately,
    // and this is the line that forces the conversation.
    expect(source).toMatch(/safeReverseGeocode\(coords\)/);
    expect(source).toMatch(/reverseGeocodeAsync/);
  });

  it('never asks for background or precise location', () => {
    const source = readFileSync(join(ROOT, 'src', 'services', 'location.ts'), 'utf8');
    expect(source).not.toMatch(/requestBackgroundPermissionsAsync|startLocationUpdatesAsync/);
    expect(source).toMatch(/requestForegroundPermissionsAsync/);
    expect(source).toMatch(/Accuracy\.Lowest/);
  });
});

describe('the pledge footnote', () => {
  it.each(SUPPORTED_LANGUAGES)('%s names the device-position lookup, not only a typed city', (language) => {
    const footnote = value(language, 'settings.pledge.footnote');
    expect(footnote).toMatch(POSITION_MARKERS[language]);
  });

  it.each(SUPPORTED_LANGUAGES)('%s claims nothing the geocoder contradicts', (language) => {
    expect(value(language, 'settings.pledge.footnote')).not.toMatch(OVERCLAIMS[language]);
  });
});

// ---------------------------------------------------------------------------
// The tip jar
// ---------------------------------------------------------------------------

/**
 * The footnote's shape is "the ONE thing that ever leaves the phone is the city lookup". That is
 * true of the app as it ships, and it stops being true the moment tipping is switched on:
 * `react-native-purchases` is a client for **RevenueCat's servers**, and a purchase sends a
 * receipt, an anonymous app-user id and device metadata to a company that is neither the user's
 * phone nor its map service. Nothing in `docs/TIP_JAR_RUNBOOK.md`'s switch-on procedure touches a
 * line of code — it is a key pasted into `app.json` — so without this guard the pledge would
 * quietly become an overclaim in a release whose diff contained no copy at all.
 *
 * So the invariant is a *coupling*, not a ban: no key, and the footnote may stay as it is; a key
 * on either platform, and every language's footnote has to name the purchase path too.
 */
const PURCHASE_MARKERS: Record<AppLanguage, RegExp> = {
  en: /tip|purchase|app store|play store/i,
  ar: /إكرامية|المتجر|الشراء/,
  tr: /bahşiş|mağaza|satın al/i,
  ur: /ٹپ|خریداری|اسٹور|App Store|Google Play/,
};

/**
 * @param language - Which bundle the footnote came from.
 * @param configuredPlatforms - Platforms with a RevenueCat public key.
 * @param footnote - The pledge footnote as it currently reads.
 * @returns Whether the footnote is honest for that configuration.
 */
function footnoteCoversPurchases(
  language: AppLanguage,
  configuredPlatforms: readonly string[],
  footnote: string
): boolean {
  if (configuredPlatforms.length === 0) return true;
  return PURCHASE_MARKERS[language].test(footnote);
}

describe('the pledge and the tip jar', () => {
  const extra = (appJson.expo as { extra?: unknown }).extra;
  const configuredPlatforms = (['ios', 'android'] as const).filter(
    (platform) => tipJarApiKey(platform, { extra, env: {} }) !== null
  );

  it.each(SUPPORTED_LANGUAGES)(
    '%s footnote stays honest about what a tip sends off the phone',
    (language) => {
      expect(
        footnoteCoversPurchases(
          language,
          configuredPlatforms,
          value(language, 'settings.pledge.footnote')
        )
      ).toBe(true);
    }
  );

  it('would fire the day a key is configured without the copy changing', () => {
    // The guard is only worth having if it can fail, and the failure it exists to catch is
    // precisely "someone pasted a key into app.json and shipped".
    const asShipped = 'The one thing that ever leaves it is the city lookup.';
    expect(footnoteCoversPurchases('en', ['ios'], asShipped)).toBe(false);
    expect(
      footnoteCoversPurchases(
        'en',
        ['ios'],
        'The one thing that ever leaves it is the city lookup — and a tip, which goes through the App Store.'
      )
    ).toBe(true);
  });

  it('opens a socket from exactly one module, and that module is the buddy relay', () => {
    // Everything else under `services/` talks to the OS or to a vendor SDK; none of it opens a
    // socket itself. Until buddy mode (D174/D175) nothing here did, and the pledge said so.
    //
    // Buddy mode is the deliberate exception, and this is the narrowest way to write it down: ONE
    // named file may call `fetch`, and it may only reach the relay. A second file appearing in this
    // list is not a merge conflict to resolve — it means the app has grown a network call nobody
    // declared, and the pledge, the privacy policy and both stores' data-safety answers are now
    // wrong. Fix the code, or change all four together.
    // The whole of `src/`, not only `services/`. The narrower scan was the shape of the app when it
    // had no network module at all, and it would wave through a `fetch` in a screen, a hook or a
    // component — which is where one would actually appear now that the door is open.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, 'src', dir), { withFileTypes: true })) {
        const relative = dir === '' ? entry.name : `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === '__tests__') continue;
          walk(relative);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          files.push(relative);
        }
      }
    };
    walk('');
    expect(files.length).toBeGreaterThan(100);

    // Written against the identifier, not against `fetch(` — the call-shaped version missed
    // `const doFetch = options.fetchImpl ?? fetch`, which is exactly how a network call arrives in
    // a codebase that has decided not to have any. Comments are stripped first so that *writing*
    // about the rule does not break it.
    const offenders = files.filter((name) => {
      const source = readFileSync(join(ROOT, 'src', name), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return /\b(fetch|XMLHttpRequest|WebSocket|axios)\b/.test(source);
    });
    expect(offenders).toEqual(['services/buddyRelay.ts']);
  });

  it('lets the buddy relay reach one host and no other', () => {
    const source = readFileSync(join(ROOT, 'src', 'services', 'buddyRelay.ts'), 'utf8');
    const hosts = [...source.matchAll(/https?:\/\/[^'"`\s)]+/g)]
      .map((match) => new URL(match[0]).origin)
      // The source link to the relay's public repository is documentation, not a destination.
      .filter((origin) => origin !== 'https://github.com');
    expect([...new Set(hosts)]).toEqual(['https://relay.simpleprayer.app']);
    expect(source).toContain('https://relay.simpleprayer.app');
  });

  it('never sends a status a buddy has no business knowing', () => {
    // The wire vocabulary is two words. This is the same fence `domain/buddies.test.ts` pins from
    // the inside, asserted here because it is a *privacy claim*: the policy tells people that a
    // buddy learns only that they prayed, and this is the line of code that has to keep it true.
    const source = readFileSync(join(ROOT, 'src', 'domain', 'buddies.ts'), 'utf8');
    const states = /export const MARK_STATES = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
    expect(states.replace(/\s|'/g, '').split(',').filter(Boolean)).toEqual(['prayed', 'cleared']);
  });

  it('keeps buddy state off the watch, which never carries it', () => {
    // D177 narrowed D174: the LARGE HOME-SCREEN widget may show buddy avatars, because reaching a
    // home screen means unlocking the phone — the same bar as opening the app. D101's rule is about
    // *lock* screens, "visible without unlocking", and that is untouched. The watch is likewise
    // untouched: nothing buddy-shaped may reach the envelope, so this stays absolute.
    const envelope = readFileSync(join(ROOT, 'src', 'services', 'watchEnvelope.ts'), 'utf8');
    expect(envelope).not.toMatch(/buddy|buddies/i);
  });

  it('carries no buddy NAME to any widget, only a face the viewer chose', () => {
    // A widget is read at arm's length by whoever is in the room. The colour, the letters and the
    // glyph were all chosen on this phone; the nickname never crosses into the snapshot, and the
    // `WidgetBuddy` type is what keeps that true by having nowhere to put one.
    const snapshot = readFileSync(join(ROOT, 'src', 'services', 'widgetSnapshot.ts'), 'utf8');
    const body = /export interface WidgetBuddy \{([\s\S]*?)\n\}/.exec(snapshot)?.[1] ?? '';
    // The FIELDS, not the prose around them — the docblocks say "name" while describing what is
    // deliberately absent, and a guard that trips on its own explanation teaches nothing.
    const fields = [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((match) => match[1]);
    expect(fields.sort()).toEqual(['color', 'initials']);
  });
});

describe('no screen claims that nothing leaves the phone', () => {
  // The onboarding welcome once promised "Nothing leaves your phone" in every language, long after
  // crash reports and buddy marks made it false. Scanning only the screens someone remembered to
  // list is how it survived, so this reads every string in every bundle.
  const flatten = (node: unknown, prefix = ''): [string, string][] =>
    typeof node === 'string'
      ? [[prefix, node]]
      : Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
          flatten(child, prefix === '' ? key : `${prefix}.${key}`)
        );

  it.each(SUPPORTED_LANGUAGES)('%s', (language) => {
    const offenders = flatten(BUNDLES[language])
      .filter(([, text]) => OVERCLAIMS[language].test(text))
      .map(([key, text]) => `${key}: ${text}`);
    expect(offenders).toEqual([]);
  });
});

describe('the location screens', () => {
  const KEYS = ['location.privacyNote', 'settings.location.auto.footer', 'settings.home.location.auto'];

  it.each(SUPPORTED_LANGUAGES)('%s never says the position stays on the device', (language) => {
    for (const key of KEYS) {
      expect(`${key}: ${value(language, key)}`).not.toMatch(OVERCLAIMS[language]);
    }
  });

  it.each(SUPPORTED_LANGUAGES)('%s still says the position is only ever approximate', (language) => {
    expect(value(language, 'settings.location.auto.footer')).toMatch(POSITION_MARKERS[language]);
  });
});

describe('the iOS permission string', () => {
  const nativeLocale = (language: AppLanguage): string => {
    const file = JSON.parse(
      readFileSync(join(ROOT, 'locales', `${language}.json`), 'utf8')
    ) as { ios: Record<string, string> };
    return file.ios.NSLocationWhenInUseUsageDescription;
  };

  it.each(SUPPORTED_LANGUAGES)('%s exists and claims nothing untrue', (language) => {
    const text = nativeLocale(language);
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toMatch(OVERCLAIMS[language]);
  });

  it('is owned by the expo-location plugin, so there is one source of truth', () => {
    const infoPlist = (appJson.expo.ios as { infoPlist?: Record<string, unknown> }).infoPlist ?? {};
    expect(Object.keys(infoPlist).some((key) => key.startsWith('NSLocation'))).toBe(false);
  });
});

describe('the native location configuration', () => {
  const plugin = (appJson.expo.plugins as unknown[]).find(
    (entry): entry is [string, Record<string, unknown>] =>
      Array.isArray(entry) && entry[0] === 'expo-location'
  );

  it('is configured explicitly rather than left to the autolinked defaults', () => {
    expect(plugin).toBeDefined();
  });

  it('ships no "Always" usage string, so iOS can never offer an Always prompt', () => {
    // Omitting the key is the only real guarantee: with the string present, any future call to
    // `requestBackgroundPermissionsAsync` would silently start working.
    expect(plugin?.[1].locationAlwaysPermission).toBe(false);
    expect(plugin?.[1].locationAlwaysAndWhenInUsePermission).toBe(false);
  });

  it('enables no background location on either platform', () => {
    expect(plugin?.[1].isIosBackgroundLocationEnabled).toBe(false);
    expect(plugin?.[1].isAndroidBackgroundLocationEnabled).toBe(false);
    expect(plugin?.[1].isAndroidForegroundServiceEnabled).toBe(false);
  });

  it('keeps precise location blocked on Android', () => {
    const android = appJson.expo.android as {
      permissions: string[];
      blockedPermissions: string[];
    };
    expect(android.permissions).not.toContain('android.permission.ACCESS_FINE_LOCATION');
    expect(android.blockedPermissions).toContain('android.permission.ACCESS_FINE_LOCATION');
  });
});

// ---------------------------------------------------------------------------
// Over-the-air updates
// ---------------------------------------------------------------------------

/**
 * The same coupling failure as the tip jar, from a different direction.
 *
 * Turning `expo.updates.enabled` on is a config-only change — no source diff, no copy diff — but it
 * makes every launch contact `u.expo.dev` carrying the platform, the runtime version, the channel
 * and a persistent per-install id. That is a third party the user was never told about, and both
 * stores require it to be declared.
 *
 * The pledge footnote survives either way, because it is scoped to what leaves the phone *about
 * you* rather than to network silence. What must NOT drift is the disclosure: while updates are
 * enabled, the published privacy policy has to name the update check and who runs it. This guard
 * couples the two, so the day someone flips the flag — or deletes the section as boilerplate — the
 * build says so instead of a release quietly shipping an undisclosed network call.
 */
const UPDATE_DISCLOSURE = /update (check|service)|checking for an app update|u\.expo\.dev/i;

describe('the pledge and over-the-air updates', () => {
  const updates = (appJson.expo as { updates?: { enabled?: boolean } }).updates;
  const updatesEnabled = updates?.enabled === true;
  const policy = readFileSync(join(ROOT, 'docs', 'PRIVACY_POLICY.md'), 'utf8');

  it('discloses the update check in the privacy policy while updates are enabled', () => {
    if (!updatesEnabled) return;
    expect(policy).toMatch(UPDATE_DISCLOSURE);
    // Naming the operator is the part a reader can act on, and the part a trimmed-down rewrite
    // tends to lose first.
    expect(policy).toMatch(/expo/i);
  });

  it('would fire if the disclosure were removed while the flag stayed on', () => {
    // The guard is only worth having if it can fail.
    const withoutDisclosure = 'We collect nothing. Your prayer log stays on your phone.';
    expect(UPDATE_DISCLOSURE.test(withoutDisclosure)).toBe(false);
    expect(UPDATE_DISCLOSURE.test(policy)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Crash reporting
// ---------------------------------------------------------------------------

/**
 * The third coupling, sibling to the tip jar and the update check.
 *
 * `app.json` carries a Sentry DSN (`extra.sentryDsn`). While one is configured, a launch with the
 * Settings toggle on — its default — can send Sentry a crash report and an anonymous session
 * marker. That is a third party receiving diagnostics off the device, and two surfaces must own
 * up to it for as long as it is true: the pledge footnote in every language (it enumerates what
 * ever leaves the phone, so an entry missing from that list is a lie by omission), and the
 * published privacy policy, which must name crash reports and the company that processes them.
 * The DSN is one pasted string; deleting the disclosure is one careless rewrite. This couples
 * them, so either change alone fails the build.
 */
const CRASH_MARKERS: Record<AppLanguage, RegExp> = {
  en: /crash report/i,
  ar: /تقرير عطل|تقرير (ال)?أعطال|تقارير (ال)?أعطال/,
  tr: /çökme rapor/i,
  ur: /کریش رپورٹ/,
};

/**
 * @param language - Which bundle the footnote came from.
 * @param dsnConfigured - Whether a usable Sentry DSN ships in the build.
 * @param footnote - The pledge footnote as it currently reads.
 * @returns Whether the footnote is honest for that configuration.
 */
function footnoteCoversCrashReports(
  language: AppLanguage,
  dsnConfigured: boolean,
  footnote: string
): boolean {
  if (!dsnConfigured) return true;
  return CRASH_MARKERS[language].test(footnote);
}

describe('the pledge and crash reporting', () => {
  // Configured means app.json ships a DSN (`extra.sentryDsn`); a FOSS build strips it.
  const dsnConfigured = /^https:\/\/\w+@\S+\.ingest\.\S*sentry\.io\/\d+$/.test(
    sentryDsn(appJson.expo.extra) ?? ''
  );
  const policy = readFileSync(join(ROOT, 'docs', 'PRIVACY_POLICY.md'), 'utf8');

  it('recognises the DSN as configured (if Sentry was removed, retire this block deliberately)', () => {
    // Like the reverse-geocode premise above: if this stops matching, the claims below may be
    // *relaxed* — but only on purpose, and this line forces that conversation.
    expect(dsnConfigured).toBe(true);
  });

  it.each(SUPPORTED_LANGUAGES)(
    '%s footnote owns up to crash reports while a DSN is configured',
    (language) => {
      expect(
        footnoteCoversCrashReports(
          language,
          dsnConfigured,
          value(language, 'settings.pledge.footnote')
        )
      ).toBe(true);
    }
  );

  it('discloses crash reporting in the privacy policy, and names who processes it', () => {
    if (!dsnConfigured) return;
    expect(policy).toMatch(/crash report/i);
    // Naming the processor is the part a reader can act on — and the part a rewrite loses first.
    expect(policy).toMatch(/sentry/i);
    // The off switch is the pledge's strongest honest claim; the policy must keep advertising it.
    expect(policy).toMatch(/switch (this|it|that) off|turn (it|this|that) off|turned off/i);
  });

  it('would fire the day a DSN shipped without the copy changing', () => {
    // The guard is only worth having if it can fail — and the failure it exists to catch is
    // precisely the pre-Sentry footnote surviving into a build that has a DSN.
    const asItWas =
      "The one thing about you that ever leaves it is the city lookup — a city name you type, or your approximate position when you use your device's location.";
    expect(footnoteCoversCrashReports('en', true, asItWas)).toBe(false);
    expect(footnoteCoversCrashReports('en', false, asItWas)).toBe(true);
    for (const language of SUPPORTED_LANGUAGES) {
      expect(
        footnoteCoversCrashReports(language, true, value(language, 'settings.pledge.footnote'))
      ).toBe(true);
    }
  });

  it('the strengthened overclaim patterns would catch "nothing ever leaves this phone"', () => {
    // The broad claim was true before Sentry and is not any more; the patterns have to see it in
    // all three languages or the pledge could quietly regress to the bigger, false promise.
    expect(OVERCLAIMS.en.test('Nothing ever leaves this phone.')).toBe(true);
    expect(OVERCLAIMS.ar.test('لا شيء يغادر هذا الهاتف أبدًا.')).toBe(true);
    expect(OVERCLAIMS.tr.test('Bu telefondan hiçbir şey çıkmaz.')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Buddy mode
// ---------------------------------------------------------------------------

/**
 * The fourth coupling, and the largest.
 *
 * Buddy mode (D174/D175) is the first time anything a person records about their worship leaves
 * their phone at all. It is opt-in and off by default, but the pledge footnote enumerates
 * *everything* that can ever leave — so while the capability ships, that list has to name it, in
 * every language, or the pledge is a lie by omission for the people who do turn it on.
 *
 * The capability is detected from the code rather than from a flag: `services/buddyRelay.ts`
 * existing, with a relay host in it, is what makes this true. Delete the feature and this block
 * should be retired deliberately, exactly like the Sentry one above.
 */
const BUDDY_MARKERS: Record<AppLanguage, RegExp> = {
  en: /buddy/i,
  ar: /رفيق|رفاق/,
  tr: /arkadaş/i,
  ur: /ساتھی/,
};

/** "Three things" was true until buddy mode; a footnote still saying it has not been updated. */
const STALE_COUNT: Record<AppLanguage, RegExp> = {
  en: /\bthree things\b/i,
  ar: /ثلاثة أشياء/,
  tr: /üç şey/i,
  ur: /تین چیزیں/,
};

describe('the pledge and buddy mode', () => {
  const relayShips = (() => {
    try {
      const source = readFileSync(join(ROOT, 'src', 'services', 'buddyRelay.ts'), 'utf8');
      return /relay\.simpleprayer\.app/.test(source);
    } catch {
      return false;
    }
  })();
  const policy = readFileSync(join(ROOT, 'docs', 'PRIVACY_POLICY.md'), 'utf8');

  it('recognises that the feature ships (if it were removed, retire this block deliberately)', () => {
    expect(relayShips).toBe(true);
  });

  it.each(SUPPORTED_LANGUAGES)('%s footnote names buddy mode while it ships', (language) => {
    const footnote = value(language, 'settings.pledge.footnote');
    expect(BUDDY_MARKERS[language].test(footnote)).toBe(true);
  });

  it.each(SUPPORTED_LANGUAGES)('%s footnote no longer says "three things"', (language) => {
    // The count is load-bearing: PRODUCT_SPEC §14a used it to kill an in-app feedback form, on the
    // grounds that a form would make it four. Buddy mode made it four, and the number moved.
    expect(STALE_COUNT[language].test(value(language, 'settings.pledge.footnote'))).toBe(false);
  });

  it.each(SUPPORTED_LANGUAGES)('%s still promises the log stays put for everyone else', (language) => {
    // The promise is not withdrawn, it is qualified: somebody who never adds a buddy is owed the
    // sentence they were given, and the device line still carries it.
    const device = value(language, 'settings.pledge.points.device');
    expect(device.length).toBeGreaterThan(0);
    expect(BUDDY_MARKERS[language].test(device)).toBe(true);
  });

  it('discloses buddy mode in the privacy policy, and says what the relay keeps', () => {
    expect(/buddy/i.test(policy)).toBe(true);
    // The two claims the design rests on: it is deleted on delivery, and it holds nothing that
    // identifies anybody.
    expect(/24 hours|delete/i.test(policy)).toBe(true);
  });

  it('still says there is no account, because there still is not one', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(value(language, 'settings.pledge.points.account').length).toBeGreaterThan(0);
    }
  });

  it('never lets a nickname reach the relay client', () => {
    // The nickname, the icon and the colour of a buddy are chosen by the person looking at them and
    // have never crossed a network (D174). `buddyRelay.ts` is the ONE module allowed to fetch, so
    // a nickname appearing anywhere in it is the whole claim failing — including as the innocent
    // convenience it would arrive as, a name added to a notification "so it reads better".
    const source = readFileSync(join(ROOT, 'src', 'services', 'buddyRelay.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(/nickname/i.test(code)).toBe(false);
  });

  it('never lets a nickname into the widget outbox', () => {
    // The outbox is what a widget tap reads in order to tell the buddies by itself (D180), and it
    // is the one drawer of the bridge that carries sentences. The sentences are addressed to a
    // buddy and written in their language; what they must never carry is what this phone calls
    // them. That name was chosen here, is used here, and goes nowhere (D174) — the notification
    // that reads "Leen prayed Dhuhr" is assembled on the receiving phone, from the hole in
    // `titleNamed`, and this is the pin that keeps the shortcut from ever being taken.
    const pairs = [
      {
        pairId: 'a'.repeat(32),
        icon: BUDDY_ICONS[0],
        color: BUDDY_COLORS[0],
        nickname: 'Leen',
        lang: 'ar',
        notify: true,
        pending: false,
        addedAt: 0,
      },
      {
        pairId: 'b'.repeat(32),
        icon: BUDDY_ICONS[1],
        color: BUDDY_COLORS[1],
        nickname: 'Yusuf',
        lang: 'en',
        notify: false,
        pending: false,
        addedAt: 0,
      },
    ];
    const json = JSON.stringify(
      buildOutbox({
        pairs,
        lang: 'en',
        notify: true,
        compose: () => ({ title: 'Your buddy prayed Dhuhr', titleNamed: '{} prayed Dhuhr' }),
      })
    );

    expect(json.toLowerCase()).not.toContain('nickname');
    for (const pair of pairs) {
      expect(json).not.toContain(pair.nickname);
    }
  });

  it('keeps the bridge module a mailbox, with nothing of the app behind it', () => {
    // `modules/buddy-nicknames` hands things to processes that run when no JS can. It may carry a
    // prayer and a day now — the outbox and the widget's ledger both name one — but it must stay a
    // mailbox: it reads no store, derives nothing, and decides nothing. An import of the tracking
    // store here would be buddy history, and the prayer log itself, living one step outside the
    // app that owns them.
    const source = readFileSync(join(ROOT, 'modules', 'buddy-nicknames', 'index.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const imported = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    expect(imported).toEqual(['expo']);
  });

  it('would fire the day buddy mode shipped without the copy changing', () => {
    const asItWas =
      'Three things can ever leave this phone. The city lookup, anonymous crash reporting, and a tip.';
    expect(BUDDY_MARKERS.en.test(asItWas)).toBe(false);
    expect(STALE_COUNT.en.test(asItWas)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The footnote a build without Sentry shows
// ---------------------------------------------------------------------------

/**
 * A FOSS build (or a fork) has no Sentry DSN, so `PledgeCard` shows
 * `settings.pledge.footnoteWithoutCrashReports` instead. It drops the crash-report sentence and
 * nothing else: every other thing that can leave the phone must still be named.
 */
describe('the footnote without crash reports', () => {
  it.each(SUPPORTED_LANGUAGES)('%s names everything except crash reports', (language) => {
    const footnote = value(language, 'settings.pledge.footnoteWithoutCrashReports');
    expect(footnote).toMatch(POSITION_MARKERS[language]);
    expect(footnote).toMatch(BUDDY_MARKERS[language]);
    expect(footnote).not.toMatch(CRASH_MARKERS[language]);
    expect(footnote).not.toMatch(OVERCLAIMS[language]);
    expect(footnoteCoversPurchases(language, ['ios', 'android'], footnote)).toBe(true);
  });
});
