/**
 * Location service — the only place the app talks to the device geolocation/geocoder.
 *
 * It turns two coarse capabilities of `expo-location` into the app's own vocabulary:
 *
 *  1. **Where am I, roughly?** — {@link LocationService.resolveAutoLocation} asks for
 *     foreground permission (only when explicitly told to prompt), reads a *coarse* position
 *     and reverse-geocodes it into an `AppLocation` with a `"City, Region"` label and an
 *     uppercase ISO-3166 alpha-2 `countryCode` (which `domain/methods.resolveMethod` needs for
 *     the "Auto (Diyanet)" style calculation default).
 *  2. **Which city did the user type?** — {@link LocationService.searchCity} forward-geocodes a
 *     query into candidate `AppLocation`s the Settings screen can offer as a manual choice.
 *
 * ## Privacy posture (PRODUCT_SPEC §10 — this is a product differentiator, not a detail)
 *
 * - **Coarse only.** Positions are requested at `Accuracy.Lowest` (~3 km), which is all prayer
 *   times and the qibla bearing need. Android ships with `ACCESS_COARSE_LOCATION` only and
 *   `ACCESS_FINE_LOCATION` blocklisted (see `app.json`).
 * - **Never background.** Only `requestForegroundPermissionsAsync` is ever called; there is no
 *   code path to "Always" permission and no `NSLocationAlwaysAndWhenInUseUsageDescription`.
 * - **Never at launch.** Nothing here prompts unless the caller passes `prompt: true`, which
 *   only happens from an explicit user action ("Use my location"). A cold start with no
 *   permission resolves to `permissionDenied` silently and the app keeps working from a
 *   manually chosen city.
 * - **No API keys, no network of our own.** Geocoding is the OS geocoder via expo-location.
 *   Note what that does *not* say: the geocoder is not free of the network. `reverseGeocodeAsync`
 *   is `CLGeocoder` on iOS and `android.location.Geocoder` on Android, both of which resolve
 *   against Apple's and Google's servers — so calling {@link LocationService.resolveAutoLocation}
 *   does send the coarse position off the device, to the platform's map service. It never reaches
 *   *us*, because there is no server of ours anywhere in this app, and that distinction is exactly
 *   what the pledge copy has to make. Any UI string claiming the position "never leaves your
 *   device" is false; `src/__tests__/privacyClaims.test.ts` fails the build if one reappears.
 *
 * ## Failure model
 *
 * Nothing here throws for an expected failure. Every entry point returns a discriminated
 * result ({@link ResolveLocationResult}, {@link CitySearchResult}), because "the user said no"
 * and "the geocoder is offline" are ordinary states the UI must render, not exceptions. In
 * particular a **reverse-geocode failure degrades**: we still return a usable `AppLocation`
 * with a coordinate label such as `41.01°N, 28.98°E`, since coordinates alone are enough to
 * compute prayer times. Losing the label must never lose the location.
 *
 * ## Why the adapter is injectable
 *
 * `expo-location` is a native module: importing it eagerly breaks plain Jest runs and node
 * scripts. Everything goes through {@link LocationAdapter}; the app uses
 * {@link createExpoLocationAdapter} (which `require`s the native module lazily, on first use),
 * and tests pass an in-memory fake.
 *
 * Dependency rule: `services → domain`. No React, no React Native, no zustand, and no
 * user-facing strings — the only strings produced here are place names from the OS geocoder
 * and locale-neutral coordinates, both of which are persisted data rather than UI copy.
 */

import type { AppLocation, Coordinates } from '../domain/types';
import { scriptFamilyFor } from '../i18n/script';

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

/** Permission states we distinguish. Mirrors expo's `PermissionStatus`. */
export type LocationPermissionStatus = 'granted' | 'denied' | 'undetermined';

/** A permission answer, normalised away from the platform response shape. */
export interface PermissionState {
  status: LocationPermissionStatus;
  granted: boolean;
  /** `false` once the OS will no longer show a prompt — the UI must send users to Settings. */
  canAskAgain: boolean;
}

/** A coarse fix. Accuracy is carried for diagnostics only; nothing branches on it. */
export interface CoarsePosition extends Coordinates {
  /** Radius of uncertainty in metres, when the platform reports one. */
  accuracyMeters?: number | null;
  /** Epoch ms the fix was taken. */
  timestamp?: number;
}

/**
 * The subset of `Location.LocationGeocodedAddress` we consume. Every field is optional and
 * nullable because the platforms disagree about which ones they fill in (`timezone` is iOS
 * only, `district`/`subregion` are patchy everywhere).
 */
export interface GeocodedAddress {
  city?: string | null;
  district?: string | null;
  subregion?: string | null;
  region?: string | null;
  country?: string | null;
  /** ISO 3166-1 alpha-2, in whatever case the platform used. */
  isoCountryCode?: string | null;
  /** IANA timezone id. @platform ios */
  timezone?: string | null;
  /** Point-of-interest name ("Tower Bridge"); only used as a last-resort label. */
  name?: string | null;
}

/**
 * Everything the service needs from the platform. Implemented for real by
 * {@link createExpoLocationAdapter} and by an in-memory fake in the tests.
 */
export interface LocationAdapter {
  /** Reads the current foreground permission. MUST NOT prompt. */
  getPermission(): Promise<PermissionState>;
  /** Prompts for foreground ("when in use") permission. Never "Always". */
  requestPermission(): Promise<PermissionState>;
  /** A fresh coarse fix. */
  getCurrentPosition(): Promise<CoarsePosition>;
  /** A cached fix, used only as a fallback when {@link getCurrentPosition} fails. */
  getLastKnownPosition?(): Promise<CoarsePosition | null>;
  /** Coordinates → addresses. May legitimately return `[]` (ocean, no geocoder). */
  reverseGeocode(coords: Coordinates): Promise<GeocodedAddress[]>;
  /** A typed place name → candidate coordinates. */
  forwardGeocode(query: string): Promise<Coordinates[]>;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Machine-readable failure reasons. The UI maps these onto localized copy. */
export const LOCATION_ERRORS = [
  /** Permission is not granted (and we either could not, or were told not to, prompt). */
  'permissionDenied',
  /** Permission is granted but no fix could be obtained (services off, indoors, airplane…). */
  'positionUnavailable',
  /** The OS geocoder threw or is unavailable on this device. */
  'geocodeUnavailable',
  /** The geocoder worked but knows no such place. */
  'noResults',
] as const;
export type LocationErrorCode = (typeof LOCATION_ERRORS)[number];

/** Outcome of {@link LocationService.resolveAutoLocation}. */
export type ResolveLocationResult =
  | {
      ok: true;
      location: AppLocation;
      /** `false` when the label had to fall back to coordinates. */
      geocoded: boolean;
      permission: PermissionState;
    }
  | {
      ok: false;
      reason: LocationErrorCode;
      /** Best knowledge of the permission at the time of failure. */
      permission: PermissionState;
    };

/** Outcome of {@link LocationService.searchCity}. `error` is `null` on success. */
export interface CitySearchResult {
  results: AppLocation[];
  error: LocationErrorCode | null;
}

/** Options for {@link LocationService.resolveAutoLocation}. */
export interface ResolveOptions {
  /**
   * Whether the OS permission dialog may be shown. **Defaults to `false`**: prompting is only
   * ever allowed from an explicit user action (PRODUCT_SPEC §10).
   */
  prompt?: boolean;
}

/** Options for {@link LocationService.searchCity}. */
export interface SearchOptions {
  /** Maximum candidates to return; defaults to {@link MAX_CITY_RESULTS}. */
  limit?: number;
}

/** The service surface consumed by `stores/locationStore.ts`. */
export interface LocationService {
  /** Current permission, without prompting. Never throws. */
  getPermission(): Promise<PermissionState>;
  /** Prompts for foreground permission. Never throws. */
  requestPermission(): Promise<PermissionState>;
  /** Coarse position + reverse geocode → an `auto` {@link AppLocation}. */
  resolveAutoLocation(options?: ResolveOptions): Promise<ResolveLocationResult>;
  /** Forward geocode a typed city name → `manual` {@link AppLocation} candidates. */
  searchCity(query: string, options?: SearchOptions): Promise<CitySearchResult>;
}

/**
 * Default cap on city-search candidates.
 *
 * **This is a ceiling, not a target, and it is almost never the binding constraint** — read this
 * before raising it in the belief that more rows will appear:
 *
 * - **Android returns exactly one candidate, always.** `expo-location`'s Kotlin module calls
 *   `Geocoder.getFromLocationName(address, 1)` with the max-results argument hardcoded to `1`
 *   (verified in the installed `expo-location/android/.../LocationModule.kt`). Nothing this
 *   module does can produce a second row there.
 * - **iOS returns whatever `CLGeocoder.geocodeAddressString` gives**, which for a bare city name
 *   is usually one placemark and occasionally a few.
 *
 * So the honest description of the feature is "up to five", and the way to get more would be a
 * geocoding *service* — which D02/D09 rule out (no network dependency for core features, no API
 * key, no bundled database). Raising this constant on its own changes nothing.
 */
export const MAX_CITY_RESULTS = 5;

/**
 * How old a cached fix may be before {@link createExpoLocationAdapter}'s fallback rejects it.
 * Ten minutes: stale enough to still be the same city, fresh enough not to be last week's trip.
 */
export const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

/** Used when the platform could not even tell us what the permission is. */
const UNKNOWN_PERMISSION: PermissionState = {
  status: 'undetermined',
  granted: false,
  canAskAgain: true,
};

// ---------------------------------------------------------------------------
// Formatting helpers (pure)
// ---------------------------------------------------------------------------

function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = trimmedOrNull(value);
    if (trimmed !== null) return trimmed;
  }
  return null;
}

function sameName(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
}

/** `true` for a usable WGS84 pair. Guards against `NaN` and out-of-range geocoder junk. */
export function isValidCoordinates(value: Partial<Coordinates> | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const { latitude, longitude } = value;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) return false;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) return false;
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

/**
 * Formats coordinates as a human-readable, language-neutral label — the fallback when the OS
 * geocoder gives us nothing.
 *
 * Two decimals (~1.1 km) is deliberate: it matches the coarse accuracy we asked for, and it
 * keeps the persisted label from implying a precision the app never collected.
 *
 * @param coords - Any valid WGS84 pair.
 * @returns e.g. `"41.01°N, 28.98°E"`.
 */
export function formatCoordinateLabel(coords: Coordinates): string {
  const lat = `${Math.abs(coords.latitude).toFixed(2)}°${coords.latitude < 0 ? 'S' : 'N'}`;
  const lng = `${Math.abs(coords.longitude).toFixed(2)}°${coords.longitude < 0 ? 'W' : 'E'}`;
  return `${lat}, ${lng}`;
}

/**
 * Builds the `"City, Region"` label from a geocoded address.
 *
 * The primary part walks city → district → subregion → point-of-interest name → region →
 * country, because the platforms fill these in inconsistently (a Turkish `ilçe` arrives as
 * `district` on Android and `city` on iOS). The secondary part is the region, or the country
 * when the region is missing or is simply the primary repeated — which is what keeps
 * city-states ("Singapore") and same-named provinces ("Istanbul, Türkiye" rather than
 * "Istanbul, Istanbul") from stuttering.
 *
 * @param address - The best address from the geocoder, or `null`/`undefined` when it failed.
 * @param coords - Fallback source when the address carries no usable name.
 * @param fallbackLabel - Preferred fallback (e.g. the text the user typed); coordinates are
 * used when it is absent or blank.
 * @returns A non-empty label, always.
 */
/**
 * The comma between a place and its region.
 *
 * Arabic writes U+060C, and an ASCII comma sitting between two Arabic runs is both the wrong mark
 * and a weak-direction character in the middle of an RTL line. The label is composed once, when
 * the place is resolved, and persisted — so it keeps whatever language was active at that moment,
 * which is the same behaviour the label itself has always had.
 */
function placeSeparator(): string {
  try {
    // Lazily, and defensively: this module carries a single *type* import by design, and the
    // label must still compose if the i18n singleton is not up yet (it is built during a location
    // resolve, which can race startup). The same lazy-require shape `services/notifications` uses.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const language = (require('@/i18n').default as { language?: string }).language ?? '';
    return scriptFamilyFor(language) === 'latin' ? ', ' : '\u060C ';
  } catch {
    return ', ';
  }
}

export function formatPlaceLabel(
  address: GeocodedAddress | null | undefined,
  coords: Coordinates,
  fallbackLabel?: string | null
): string {
  const primary = firstNonEmpty(
    address?.city,
    address?.district,
    address?.subregion,
    address?.name,
    address?.region,
    address?.country
  );
  if (primary === null) {
    return firstNonEmpty(fallbackLabel) ?? formatCoordinateLabel(coords);
  }
  const secondary = [address?.region, address?.country]
    .map(trimmedOrNull)
    .find((candidate) => candidate !== null && !sameName(candidate, primary));
  return secondary ? `${primary}${placeSeparator()}${secondary}` : primary;
}

/**
 * Normalises a country code for `domain/methods.resolveMethod`.
 *
 * @param raw - Whatever the geocoder reported (`"tr"`, `"TR"`, `" us "`, `null`…).
 * @returns Uppercase ISO 3166-1 alpha-2, or `undefined` when the value is not a 2-letter code.
 */
export function normalizeCountryCode(raw: string | null | undefined): string | undefined {
  const trimmed = trimmedOrNull(raw);
  if (trimmed === null || !/^[A-Za-z]{2}$/.test(trimmed)) return undefined;
  return trimmed.toUpperCase();
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Construction-time dependencies of {@link createLocationService}. */
export interface LocationServiceOptions {
  /** Epoch-ms clock, injected so tests can pin `resolvedAt`. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Builds a {@link LocationService} over an adapter.
 *
 * @param adapter - Platform access; the app passes {@link createExpoLocationAdapter}.
 * @param options - See {@link LocationServiceOptions}.
 * @returns A service whose methods never throw for expected failures.
 */
export function createLocationService(
  adapter: LocationAdapter,
  options: LocationServiceOptions = {}
): LocationService {
  const now = options.now ?? (() => Date.now());

  /** Reverse geocode, best effort. `null` means "no label available", never an error. */
  async function safeReverseGeocode(coords: Coordinates): Promise<GeocodedAddress | null> {
    try {
      const addresses = await adapter.reverseGeocode(coords);
      if (!Array.isArray(addresses) || addresses.length === 0) return null;
      return addresses[0] ?? null;
    } catch {
      return null;
    }
  }

  function toAppLocation(
    coords: Coordinates,
    address: GeocodedAddress | null,
    source: AppLocation['source'],
    fallbackLabel?: string | null
  ): AppLocation {
    const location: AppLocation = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      label: formatPlaceLabel(address, coords, fallbackLabel),
      source,
      resolvedAt: now(),
    };
    const countryCode = normalizeCountryCode(address?.isoCountryCode);
    if (countryCode !== undefined) location.countryCode = countryCode;
    const timeZone = trimmedOrNull(address?.timezone);
    if (timeZone !== null) location.timeZone = timeZone;
    return location;
  }

  async function getPermission(): Promise<PermissionState> {
    try {
      return await adapter.getPermission();
    } catch {
      return UNKNOWN_PERMISSION;
    }
  }

  async function requestPermission(): Promise<PermissionState> {
    try {
      return await adapter.requestPermission();
    } catch {
      return UNKNOWN_PERMISSION;
    }
  }

  /** Fresh fix, falling back to the platform's cached one. `null` when neither is available. */
  async function readPosition(): Promise<CoarsePosition | null> {
    try {
      const position = await adapter.getCurrentPosition();
      if (isValidCoordinates(position)) return position;
    } catch {
      // Fall through to the cached fix below.
    }
    if (adapter.getLastKnownPosition === undefined) return null;
    try {
      const cached = await adapter.getLastKnownPosition();
      return isValidCoordinates(cached) ? cached : null;
    } catch {
      return null;
    }
  }

  return {
    getPermission,
    requestPermission,

    async resolveAutoLocation({ prompt = false }: ResolveOptions = {}) {
      let permission = await getPermission();
      if (!permission.granted) {
        // The one and only place a prompt can happen, and only when the caller — i.e. a user
        // tap — asked for it. Launch code passes `prompt: false` and gets a silent refusal.
        if (!prompt || !permission.canAskAgain) {
          return { ok: false, reason: 'permissionDenied', permission };
        }
        permission = await requestPermission();
        if (!permission.granted) {
          return { ok: false, reason: 'permissionDenied', permission };
        }
      }

      const position = await readPosition();
      if (position === null) {
        return { ok: false, reason: 'positionUnavailable', permission };
      }

      const coords: Coordinates = {
        latitude: position.latitude,
        longitude: position.longitude,
      };
      const address = await safeReverseGeocode(coords);
      return {
        ok: true,
        // A failed reverse geocode costs us the city name, never the location itself.
        location: toAppLocation(coords, address, 'auto'),
        geocoded: address !== null,
        permission,
      };
    },

    async searchCity(query, { limit = MAX_CITY_RESULTS }: SearchOptions = {}) {
      const trimmed = typeof query === 'string' ? query.trim() : '';
      if (trimmed.length === 0) return { results: [], error: null };

      let points: Coordinates[];
      try {
        points = await adapter.forwardGeocode(trimmed);
      } catch {
        return { results: [], error: 'geocodeUnavailable' };
      }
      if (!Array.isArray(points)) return { results: [], error: 'geocodeUnavailable' };

      // Geocoders happily return the same town three times (different postal centroids), so
      // collapse anything that rounds to the same ~1 km cell before spending a lookup on it.
      const seen = new Set<string>();
      const unique: Coordinates[] = [];
      for (const point of points) {
        if (!isValidCoordinates(point)) continue;
        const key = `${point.latitude.toFixed(2)},${point.longitude.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push({ latitude: point.latitude, longitude: point.longitude });
        if (unique.length >= Math.max(1, limit)) break;
      }
      if (unique.length === 0) return { results: [], error: 'noResults' };

      const named = await Promise.all(
        unique.map(async (point) => {
          const address = await safeReverseGeocode(point);
          // Naming the candidate after what the user typed beats showing them raw degrees.
          return toAppLocation(point, address, 'manual', trimmed);
        })
      );

      // The coordinate pass above can only collapse points inside the same ~1 km cell, which is
      // the right bar for it: two genuinely different towns of the same name are hundreds of
      // kilometres apart and must both survive, because "City, Region" is exactly what tells
      // them apart. But cells 2 km apart routinely reverse-geocode to the SAME label, and two
      // rows reading "Istanbul, Türkiye" are not a choice — they are a coin toss the user cannot
      // reason about. So the label is the last word: first one wins (the geocoder's own ranking),
      // and anything that would render as a duplicate is dropped rather than shown.
      const labels = new Set<string>();
      const results = named.filter((candidate) => {
        const key = candidate.label.toLocaleLowerCase();
        if (labels.has(key)) return false;
        labels.add(key);
        return true;
      });
      return { results, error: null };
    },
  };
}

// ---------------------------------------------------------------------------
// expo-location adapter
// ---------------------------------------------------------------------------

type ExpoLocationModule = typeof import('expo-location');

function toPermissionState(response: {
  status: string;
  granted: boolean;
  canAskAgain: boolean;
}): PermissionState {
  const status: LocationPermissionStatus =
    response.status === 'granted'
      ? 'granted'
      : response.status === 'denied'
        ? 'denied'
        : 'undetermined';
  return {
    status,
    granted: response.granted === true || status === 'granted',
    canAskAgain: response.canAskAgain !== false,
  };
}

/**
 * The real adapter, over `expo-location`.
 *
 * The native module is `require`d lazily on first use (the same trick `settingsStore` uses for
 * MMKV), so importing this file stays safe under Jest and in node scripts.
 *
 * Every call is deliberately conservative: `Accuracy.Lowest` (~3 km) rather than a GPS fix,
 * foreground permissions only, and `mayShowUserSettingsDialog: false` so Android never nags the
 * user to turn on high-accuracy mode we do not want (PRODUCT_SPEC §10 — "no dark patterns").
 *
 * @returns A {@link LocationAdapter} bound to the device.
 */
export function createExpoLocationAdapter(): LocationAdapter {
  let module: ExpoLocationModule | null = null;
  const load = (): ExpoLocationModule => {
    if (module === null) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      module = require('expo-location') as ExpoLocationModule;
    }
    return module;
  };

  return {
    async getPermission() {
      return toPermissionState(await load().getForegroundPermissionsAsync());
    },
    async requestPermission() {
      // Foreground ("when in use") only. There is no Always/background request in this app.
      return toPermissionState(await load().requestForegroundPermissionsAsync());
    },
    async getCurrentPosition() {
      const Location = load();
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Lowest,
        mayShowUserSettingsDialog: false,
      });
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        timestamp: position.timestamp,
      };
    },
    async getLastKnownPosition() {
      const position = await load().getLastKnownPositionAsync({
        maxAge: LAST_KNOWN_MAX_AGE_MS,
      });
      if (position === null) return null;
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        timestamp: position.timestamp,
      };
    },
    async reverseGeocode(coords) {
      return await load().reverseGeocodeAsync(coords);
    },
    async forwardGeocode(query) {
      const points = await load().geocodeAsync(query);
      return points.map((point) => ({ latitude: point.latitude, longitude: point.longitude }));
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory adapter (tests, and any environment without a geolocation provider)
// ---------------------------------------------------------------------------

/**
 * Scripted behaviour for {@link createFakeLocationAdapter}. Every field is mutable on the
 * returned adapter, so a test can flip "permission granted" or "geocoder now fails" midway.
 */
export interface FakeLocationConfig {
  /** What {@link LocationAdapter.getPermission} answers. */
  permission?: Partial<PermissionState>;
  /** What {@link LocationAdapter.requestPermission} answers; defaults to `permission`. */
  permissionAfterRequest?: Partial<PermissionState>;
  /** The fresh fix; `null` makes `getCurrentPosition` reject, as the real one does. */
  position?: CoarsePosition | null;
  /** The cached fix used as a fallback; `null` means "none". */
  lastKnownPosition?: CoarsePosition | null;
  /** Reverse-geocode answer; `null` makes it reject, `[]` means "no address found". */
  addresses?: GeocodedAddress[] | null;
  /**
   * Per-call reverse-geocode answers, consumed in order; {@link addresses} serves any call past
   * the end of the list.
   *
   * A city search reverse-geocodes every candidate, and a fake that answers every one of them
   * with the same address makes five different coordinates look like five copies of one town —
   * which is precisely the shape of the bug the label de-duplication in `searchCity` exists to
   * catch. This is how a test says "Istanbul, then Ankara".
   */
  addressSequence?: (GeocodedAddress[] | null)[];
  /** Forward-geocode answer; `null` makes it reject, `[]` means "no such place". */
  searchResults?: Coordinates[] | null;
}

/** A {@link LocationAdapter} whose behaviour is scripted, plus call counters. */
export interface FakeLocationAdapter extends LocationAdapter {
  config: FakeLocationConfig;
  calls: {
    getPermission: number;
    requestPermission: number;
    getCurrentPosition: number;
    getLastKnownPosition: number;
    reverseGeocode: number;
    forwardGeocode: number;
  };
}

const DEFAULT_FAKE_PERMISSION: PermissionState = {
  status: 'undetermined',
  granted: false,
  canAskAgain: true,
};

/**
 * Builds an in-memory {@link LocationAdapter}.
 *
 * This is the test double for the whole location layer (and a usable stand-in on platforms
 * with no geolocation provider). It is exported from the production module for the same reason
 * `createMemorySettingsStorage` is: the seam has to be reachable without importing a test file.
 *
 * @param config - Initial scripted behaviour; mutable afterwards via `adapter.config`.
 * @returns A fake adapter with call counters.
 */
export function createFakeLocationAdapter(config: FakeLocationConfig = {}): FakeLocationAdapter {
  const adapter: FakeLocationAdapter = {
    config: { ...config },
    calls: {
      getPermission: 0,
      requestPermission: 0,
      getCurrentPosition: 0,
      getLastKnownPosition: 0,
      reverseGeocode: 0,
      forwardGeocode: 0,
    },
    async getPermission() {
      adapter.calls.getPermission += 1;
      return { ...DEFAULT_FAKE_PERMISSION, ...adapter.config.permission };
    },
    async requestPermission() {
      adapter.calls.requestPermission += 1;
      return {
        ...DEFAULT_FAKE_PERMISSION,
        ...(adapter.config.permissionAfterRequest ?? adapter.config.permission),
      };
    },
    async getCurrentPosition() {
      adapter.calls.getCurrentPosition += 1;
      const position = adapter.config.position;
      if (position === null || position === undefined) throw new Error('position unavailable');
      return position;
    },
    async getLastKnownPosition() {
      adapter.calls.getLastKnownPosition += 1;
      return adapter.config.lastKnownPosition ?? null;
    },
    async reverseGeocode() {
      const call = adapter.calls.reverseGeocode;
      adapter.calls.reverseGeocode += 1;
      const scripted = adapter.config.addressSequence?.[call];
      const addresses = scripted === undefined ? adapter.config.addresses : scripted;
      if (addresses === null) throw new Error('geocoder unavailable');
      return addresses ?? [];
    },
    async forwardGeocode() {
      adapter.calls.forwardGeocode += 1;
      const results = adapter.config.searchResults;
      if (results === null) throw new Error('geocoder unavailable');
      return results ?? [];
    },
  };
  return adapter;
}

let defaultService: LocationService | null = null;

/**
 * The app-wide service, created on first use so that no native module is touched at import.
 *
 * @returns The singleton {@link LocationService} backed by {@link createExpoLocationAdapter}.
 */
export function getLocationService(): LocationService {
  if (defaultService === null) {
    defaultService = createLocationService(createExpoLocationAdapter());
  }
  return defaultService;
}

/**
 * Resolves the device's coarse location. See {@link LocationService.resolveAutoLocation}.
 *
 * @param options - Pass `{ prompt: true }` **only** from an explicit user action.
 * @returns The resolved `auto` location, or a typed reason.
 */
export function resolveAutoLocation(options?: ResolveOptions): Promise<ResolveLocationResult> {
  return getLocationService().resolveAutoLocation(options);
}

/**
 * Forward-geocodes a typed city name. See {@link LocationService.searchCity}.
 *
 * @param query - What the user typed; blank queries resolve to an empty, error-free result.
 * @param options - See {@link SearchOptions}.
 * @returns Candidate `manual` locations, or a typed reason.
 */
export function searchCity(query: string, options?: SearchOptions): Promise<CitySearchResult> {
  return getLocationService().searchCity(query, options);
}
