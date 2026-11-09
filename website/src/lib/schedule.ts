/**
 * Today's five prayers, ready to render.
 *
 * The maths is the app's, vendored unchanged (see scripts/generate-domain.ts) — this module only
 * decides what the page says about each row. The three emphasis tiers are DESIGN.md's, minus the
 * seal: the website shows times, and marking a prayer is the app's job (D147).
 */
import type { AppStrings } from './appStrings.generated';
import { computeDayTimes, getNextPrayer, getCurrentPrayer } from './domain/prayerTimes';
import { formatHijri, toHijri } from './domain/hijri';
import { isJumuah } from './domain/prayerNames';
import type { CalculationSettings, Prayer } from './domain/types';
import { dateFormatter, fill, formatDuration, isArabicScript, type Locale, localeTag, timeFormatter, todayInZone } from './format';
import type { StoredLocation } from './location';

export const PRAYERS: readonly Prayer[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/**
 * What the site computes with.
 *
 * Not configurable here, deliberately. `auto` resolves the authority and the Asr from the country
 * code the way the app does (D10, D209) — Diyanet in Türkiye, ISNA in North America, the Hanafi Asr
 * in Pakistan, and so on — and anyone who needs a different madhab, a high-latitude rule or a
 * per-prayer offset needs the app. Saying that once,
 * plainly, is better than a settings panel on a page whose whole promise is that it is quick.
 */
export const WEB_SETTINGS: CalculationSettings = {
  method: 'auto',
  madhab: 'auto',
  highLatitudeRule: 'auto',
  offsets: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  hijriOffset: 0,
};

export type Tier = 'current' | 'next' | 'rest';

export interface Row {
  prayer: Prayer;
  /** Latin name, or the Jumu'ah form on a Friday, exactly as the app names it. */
  name: string;
  /** Arabic calligraphic name. Omitted on the Arabic page, where it would stutter. */
  arabicName: string;
  time: string;
  caption: string;
  /** True when the caption is a countdown or a deadline, which the design draws in accent gold. */
  captionIsLive: boolean;
  tier: Tier;
}

export interface Schedule {
  /** "17 Rabiʿ al-Awwal · 31 August" */
  dateLine: string;
  rows: Row[];
  sunrise: string;
  sunriseLabel: string;
  /** The resolved authority, e.g. "muslimWorldLeague" — the page names it. */
  method: string;
  /** When the page should recompute: the next boundary that changes anything on screen. */
  nextBoundary: Date;
  /** Milliseconds until the next prayer, for the live countdown. */
  msToNext: number;
  nextPrayer: Prayer;
}

/**
 * `strings` is handed in rather than imported: the generated table carries all three languages, and
 * importing it here would ship every one of them to every visitor. The page knows its own locale.
 */
export function buildSchedule(
  loc: StoredLocation,
  locale: Locale,
  s: AppStrings,
  now: Date = new Date()
): Schedule {
  const tag = localeTag(locale);
  const day = todayInZone(loc.tz, now);
  const where = { latitude: loc.lat, longitude: loc.lon, countryCode: loc.countryCode };

  const times = computeDayTimes(day, where, WEB_SETTINGS);
  const next = getNextPrayer(now, where, WEB_SETTINGS);
  const current = getCurrentPrayer(now, where, WEB_SETTINGS);

  const clock = timeFormatter(locale, loc.tz);
  const at = (d: Date) => clock.format(d);

  const hijri = formatHijri(toHijri(day, WEB_SETTINGS.hijriOffset), { style: 'dayMonth' });
  const hijriText = fill(s.hijriDayMonth, {
    day: new Intl.NumberFormat(tag).format(hijri.date.day),
    month: s.hijriMonths[hijri.monthKey.replace('hijri.months.', '')] ?? '',
  });
  const gregorian = dateFormatter(locale, loc.tz).format(now);

  const friday = isJumuah('dhuhr', day);

  /**
   * Whether a row *on this page* is the current one.
   *
   * Not the same as "a window contains now". Between midnight and Fajr the open window belongs to
   * yesterday's Isha (`getCurrentPrayer` reports the previous date, by design), which is not a row
   * here — so the page shows no CURRENT row, and Fajr should carry the NEXT ring. Testing
   * `current !== null` instead would leave those hours with nothing emphasised at all.
   */
  const currentIsOnScreen = current !== null && current.day === day;

  const rows: Row[] = PRAYERS.map((prayer) => {
    const start = times.times[prayer];
    const isCurrent = current?.prayer === prayer && current.day === day;
    // DESIGN.md gives the NEXT tier two triggers: the current prayer having been logged, or no
    // window containing now. The website has no log, so only the second can ever fire here. That
    // leaves at most one emphasised row at any moment — which is what the two tiers exist to
    // guarantee — and stops the ring appearing beside an open window, promising a reward this page
    // cannot give.
    const isNext = !currentIsOnScreen && next.prayer === prayer && next.day === day;

    let caption: string;
    let captionIsLive = false;

    if (isCurrent) {
      // The current window's caption is its deadline — the app's accent line, same words.
      captionIsLive = true;
      if (prayer === 'fajr') {
        const sunrise = times.times.sunrise;
        caption =
          now < sunrise
            ? fill(s.caption.dueUntilSunrise, { time: at(sunrise) })
            : s.caption.dueNow;
      } else {
        const ends = next.at;
        caption = fill(s.caption.dueUntil, { time: at(ends) });
      }
    } else if (isNext) {
      captionIsLive = true;
      caption = `${s.caption.next} · ${fill(s.time.countdown, {
        duration: formatDuration(next.at.getTime() - now.getTime(), locale, s.time, 'compact'),
      })}`;
    } else if (start.getTime() > now.getTime()) {
      caption = s.caption.upcoming;
    } else {
      // Already passed and not the current window. The app would say whether it was prayed; the
      // website has no log and must not imply one, so the row simply carries its time.
      caption = '';
    }

    return {
      prayer,
      name: friday && prayer === 'dhuhr' ? s.prayers.jumuah : s.prayers[prayer],
      arabicName: isArabicScript(locale) ? '' : s.prayersArabic[prayer],
      time: at(start),
      caption,
      captionIsLive,
      tier: isCurrent ? 'current' : isNext ? 'next' : 'rest',
    };
  });

  return {
    dateLine: fill(s.dateLine, { hijri: hijriText, gregorian }),
    rows,
    sunrise: at(times.times.sunrise),
    sunriseLabel: s.sunrise,
    method: times.method,
    nextBoundary: next.at,
    msToNext: next.msRemaining,
    nextPrayer: next.prayer,
  };
}
