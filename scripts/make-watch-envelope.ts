/**
 * Builds a REAL watch envelope — the same builders the app runs, the same translations — for
 * simulator seeding: smoke-testing the watch app and staging watch/Wear store screenshots
 * without driving the phone app first.
 *
 * Usage:
 *   bun --preload ./scripts/preload-native-mocks.ts scripts/make-watch-envelope.ts \
 *     [--lang en|ar|tr] [--lat 41.0082] [--lng 28.9784] [--h24] > envelope.json
 *
 * Past prayers of the current prayer day are marked `prayed` (the honest common case a
 * screenshot should show — CLAUDE.md's merciful default, not an audit).
 */
import { buildWatchEnvelope } from '../src/services/watchEnvelope';
import { buildWidgetSnapshot } from '../src/services/widgetSnapshot';
import type { CalculationSettings, Prayer, PrayerDay, PrayerStatus } from '../src/domain/types';
import { getCurrentPrayerDay, getCurrentPrayer } from '../src/domain/prayerTimes';

import en from '../src/i18n/locales/en.json';
import ar from '../src/i18n/locales/ar.json';
import tr from '../src/i18n/locales/tr.json';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const language = flag('lang') ?? 'en';
// Istanbul by default — the shipped screenshots' own city, chosen because it matches the host
// machine's timezone family (times render in the HOST zone; a mismatched city shows shifted clocks).
const latitude = Number(flag('lat') ?? 41.0082);
const longitude = Number(flag('lng') ?? 28.9784);
const tables: Record<string, unknown> = { en, ar, tr };
const table = tables[language] ?? en;

/** The app's i18next usage, minimally: dotted lookup + `{{param}}` interpolation. */
function translate(key: string, params: Record<string, unknown> = {}): string {
  let value: unknown = table;
  for (const part of key.split('.')) {
    if (value === null || typeof value !== 'object') break;
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value !== 'string') return key;
  return value.replace(/\{\{(\w+)[^}]*\}\}/g, (_, name: string) => String(params[name] ?? ''));
}

const now = new Date();
const location = { latitude, longitude };
// The store's own defaults, restated here because the store imports React Native and this tool
// cannot: `auto` picks the method by country, Shafi asr, no offsets (settingsStore mirrors this).
const calculation: CalculationSettings = {
  method: 'auto',
  madhab: 'shafi',
  highLatitudeRule: 'auto',
  offsets: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  hijriOffset: 0,
};

const today: PrayerDay = getCurrentPrayerDay(now, location, calculation);
const current = getCurrentPrayer(now, location, calculation);

const statuses: Record<Prayer, PrayerStatus> = {
  fajr: 'unlogged',
  dhuhr: 'unlogged',
  asr: 'unlogged',
  maghrib: 'unlogged',
  isha: 'unlogged',
};
const order: Prayer[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
if (current !== null) {
  for (const prayer of order) {
    if (prayer === current.prayer) break;
    statuses[prayer] = 'prayed';
  }
} else {
  // The sunrise gap: Fajr is behind us.
  statuses.fajr = 'prayed';
}

const snapshot = buildWidgetSnapshot(
  { now, location, calculation },
  {
    translate,
    language,
    // The app's own tag shape (src/i18n/numerals.numericLocale): arabic-indic digits
    // WITHOUT switching the calendar — 'ar-SA' defaults to Umm al-Qura and turned the
    // gregorian date line hijri.
    numericLocale: language === 'ar' ? 'ar-u-nu-arab' : language,
    rtl: language === 'ar',
    timeFormat: args.includes('--h24') ? '24h' : 'system',
    theme: 'system',
    hijriOffset: calculation.hijriOffset,
    statusesFor: (day) => (day === today ? statuses : undefined),
    isExemptDay: () => false,
  }
);

if (snapshot === null) {
  console.error('Could not build a snapshot for that location.');
  process.exit(1);
}

const adhanEnabled: Record<Prayer, boolean> = {
  fajr: true,
  dhuhr: true,
  asr: true,
  maghrib: true,
  isha: true,
};

const envelope = buildWatchEnvelope({ snapshot, now, location, adhanEnabled }, { translate });
console.log(JSON.stringify(envelope));
