/**
 * Where the visitor is, and how the page found out.
 *
 * Two ways in, both started by the visitor: the browser's geolocation, or a city picked from the
 * bundled list. Whichever it is, the answer is kept in `localStorage` and never sent anywhere —
 * `connect-src 'none'` means this page has no way to send it, which is the point (D147).
 *
 * The city list does three jobs so that it only has to be downloaded once: it answers the search,
 * it turns a raw coordinate into a city name and a country code, and it carries the IANA zone.
 * It is loaded with a dynamic `import()` — deliberately, because that is `script-src` and a
 * `fetch()` would be `connect-src`, which stays shut.
 */
import type { Locale } from './format';

export interface StoredLocation {
  /** Degrees. From the browser, or the city's own coordinates. */
  lat: number;
  lon: number;
  /** IANA zone. The times are rendered in this, not in the visitor's zone (D148). */
  tz: string;
  /** ISO 3166-1 alpha-2, uppercase. Resolves the calculation method (D10). */
  countryCode: string;
  /** What to show above the card, e.g. "Amsterdam, Netherlands". */
  label: string;
  /** The bare city name. Sentences read badly with the country in them: "These are Jakarta,
   *  Indonesia times." Kept separately rather than split off the label, because the separator
   *  differs by locale. */
  city: string;
  /**
   * Which locale `label` and `city` were written in.
   *
   * The name is stored, not re-derived, so the card can render instantly from storage without
   * waiting for a 50 KB city list. That leaves it in the language it was chosen in — so someone
   * who picks a city in English and then switches to Arabic would keep reading "Jakarta". The
   * page corrects it in the background when this does not match the page it is on.
   */
  labelLocale?: string;
  source: 'auto' | 'city';
}

const KEY = 'location';

export function loadLocation(): StoredLocation | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredLocation;
    // A stored value is only as good as its fields; a half-written one must not wedge the page.
    if (typeof v?.lat !== 'number' || typeof v?.lon !== 'number' || !v?.tz) return null;
    return v;
  } catch {
    // Private browsing, disabled storage, or something else wrote nonsense under our key.
    return null;
  }
}

export function saveLocation(value: StoredLocation): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage being unavailable costs the visitor a second prompt next time, and nothing else.
  }
}

export function clearLocation(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

export type GeolocationOutcome =
  | { ok: true; lat: number; lon: number }
  | { ok: false; reason: 'denied' | 'unavailable' | 'unsupported' };

/**
 * Ask the browser once, from a click.
 *
 * Never called on load. The page must be useful, or at least honest, before anyone is asked for
 * anything — and a permission prompt nobody invited is the fastest way to be dismissed.
 */
export function requestGeolocation(timeoutMs = 10_000): Promise<GeolocationOutcome> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ ok: true, lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) =>
        resolve({
          ok: false,
          reason: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable',
        }),
      // Coarse is all prayer times need, and a cached fix is a faster, colder answer than a GPS lock.
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 }
    );
  });
}

export interface City {
  name: string;
  /** Latin spelling, when it differs — so "Cairo" finds القاهرة on the Arabic page. */
  alias: string;
  countryCode: string;
  lat: number;
  lon: number;
  tz: string;
}

let cache: City[] | null = null;

/** Loads and parses the locale's city chunk. Cached: it is ~40 KB and never changes. */
export async function loadCities(locale: Locale): Promise<City[]> {
  if (cache) return cache;
  const mod =
    locale === 'ar'
      ? await import('./cities/ar')
      : locale === 'tr'
        ? await import('./cities/tr')
        : await import('./cities/en');
  const zones = mod.zones;
  cache = mod.packed.split('\n').map((line) => {
    const [name, alias, countryCode, lat, lon, zoneIndex] = line.split('\t');
    return {
      name,
      alias,
      countryCode,
      lat: Number(lat),
      lon: Number(lon),
      tz: zones[Number(zoneIndex)],
    };
  });
  return cache;
}

/**
 * Folds away the differences that stop a search matching: case, accents, and the Arabic marks a
 * keyboard may or may not produce. Someone typing "istanbul" must find "İstanbul", and someone
 * typing "القاهره" (with he, not ta marbuta) must find "القاهرة".
 */
function fold(value: string): string {
  return value
    .toLocaleLowerCase('en')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Latin combining accents
    .replace(/[\u064b-\u0652\u0670]/g, '') // Arabic harakat
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627') // alef forms -> bare alef
    .replace(/\u0629/g, '\u0647') // ta marbuta -> he
    .replace(/\u0649/g, '\u064a') // alef maksura -> ya
    .replace(/\u0131/g, 'i'); // Turkish dotless i
}

export function searchCities(cities: City[], query: string, limit = 8): City[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const starts: City[] = [];
  const contains: City[] = [];
  for (const city of cities) {
    const name = fold(city.name);
    const alias = city.alias ? fold(city.alias) : '';
    if (name.startsWith(q) || alias.startsWith(q)) starts.push(city);
    else if (name.includes(q) || alias.includes(q)) contains.push(city);
    // The list is ordered by population, so the first matches are the ones most people mean.
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * The nearest city to a coordinate — how a geolocated position gets a name, a country and a zone.
 *
 * Equirectangular distance, not great-circle: over the few hundred kilometres that could separate
 * someone from the nearest listed city it ranks identically, and this runs over 2,500 rows.
 */
export function nearestCity(cities: City[], lat: number, lon: number): City | null {
  let best: City | null = null;
  let bestScore = Infinity;
  const latRad = (lat * Math.PI) / 180;
  const cos = Math.cos(latRad);
  for (const city of cities) {
    const dLat = city.lat - lat;
    let dLon = city.lon - lon;
    if (dLon > 180) dLon -= 360;
    else if (dLon < -180) dLon += 360;
    const x = dLon * cos;
    const score = dLat * dLat + x * x;
    if (score < bestScore) {
      bestScore = score;
      best = city;
    }
  }
  return best;
}

/** "Amsterdam, Netherlands" — the country name comes from `Intl`, so we ship no country table. */
export function cityLabel(city: City, locale: Locale, tag: string): string {
  let country = city.countryCode;
  try {
    country = new Intl.DisplayNames([tag], { type: 'region' }).of(city.countryCode) ?? country;
  } catch {
    /* Intl.DisplayNames is old enough to rely on, but the code alone still reads fine. */
  }
  return locale === 'ar' ? `${city.name}، ${country}` : `${city.name}, ${country}`;
}
