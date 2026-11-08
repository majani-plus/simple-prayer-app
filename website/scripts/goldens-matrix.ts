/**
 * The matrix the goldens cover, shared by the generator and the check so they cannot drift.
 *
 * City × season × method, following the app's own golden test (src/domain/prayerTimes.golden.test.ts),
 * plus the two high-latitude cases that exist specifically to exercise `repairAsr` — adhan's `tan()`
 * Asr fails above roughly 66° in deep winter, and that is the defect our patch repairs (D121).
 */
import type { CalculationSettings, Madhab, PrayerDay, TimeMarker } from '../src/lib/domain/types';

export interface GoldenCase {
  city: string;
  location: { latitude: number; longitude: number; countryCode?: string };
  zone: string;
}

export const CASES: GoldenCase[] = [
  { city: 'Istanbul', location: { latitude: 41.0082, longitude: 28.9784, countryCode: 'TR' }, zone: 'Europe/Istanbul' },
  { city: 'New York', location: { latitude: 40.7128, longitude: -74.006, countryCode: 'US' }, zone: 'America/New_York' },
  { city: 'Mecca', location: { latitude: 21.4225, longitude: 39.8262, countryCode: 'SA' }, zone: 'Asia/Riyadh' },
  { city: 'Karachi', location: { latitude: 24.8607, longitude: 67.0011, countryCode: 'PK' }, zone: 'Asia/Karachi' },
  { city: 'Cairo', location: { latitude: 30.0444, longitude: 31.2357, countryCode: 'EG' }, zone: 'Africa/Cairo' },
  { city: 'London', location: { latitude: 51.5074, longitude: -0.1278, countryCode: 'GB' }, zone: 'Europe/London' },
  { city: 'Jakarta', location: { latitude: -6.2088, longitude: 106.8456, countryCode: 'ID' }, zone: 'Asia/Jakarta' },
  { city: 'Tehran', location: { latitude: 35.6892, longitude: 51.389, countryCode: 'IR' }, zone: 'Asia/Tehran' },
  { city: 'Dubai', location: { latitude: 25.2048, longitude: 55.2708, countryCode: 'AE' }, zone: 'Asia/Dubai' },
  { city: 'Sydney', location: { latitude: -33.8688, longitude: 151.2093, countryCode: 'AU' }, zone: 'Australia/Sydney' },
  { city: 'Cape Town', location: { latitude: -33.9249, longitude: 18.4241, countryCode: 'ZA' }, zone: 'Africa/Johannesburg' },
  { city: 'Tromso', location: { latitude: 69.6492, longitude: 18.9553, countryCode: 'NO' }, zone: 'Europe/Oslo' },
  { city: 'Reykjavik', location: { latitude: 64.1466, longitude: -21.9426, countryCode: 'IS' }, zone: 'Atlantic/Reykjavik' },
];

export const DAYS: PrayerDay[] = [
  '2026-01-15',
  '2026-06-21',
  '2026-08-19',
  '2026-12-21',
  '2050-06-21',
  '2100-01-15',
];

export const MADHABS: Madhab[] = ['shafi', 'hanafi'];

export const MARKERS: TimeMarker[] = [
  'fajr',
  'sunrise',
  'dhuhr',
  'asr',
  'maghrib',
  'isha',
  'middleOfTheNight',
  'lastThirdOfTheNight',
];

export function settingsFor(madhab: Madhab): CalculationSettings {
  return {
    method: 'auto',
    madhab,
    highLatitudeRule: 'auto',
    offsets: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
    hijriOffset: 0,
  };
}

export const key = (city: string, day: string, madhab: string) => `${city}|${day}|${madhab}`;
