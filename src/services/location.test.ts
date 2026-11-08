/**
 * Tests for the location service.
 *
 * `expo-location` is never imported here: every case runs the real service over
 * `createFakeLocationAdapter`, which is the same seam the app uses in production (with the
 * expo-backed adapter swapped in). The privacy-critical behaviours — never prompting unless
 * asked, degrading instead of failing when the geocoder is unavailable — are asserted
 * directly, because they are product requirements (PRODUCT_SPEC §10), not implementation
 * details.
 */

import {
  createFakeLocationAdapter,
  createLocationService,
  formatCoordinateLabel,
  formatPlaceLabel,
  isValidCoordinates,
  normalizeCountryCode,
  type GeocodedAddress,
  type LocationService,
} from './location';

const ISTANBUL = { latitude: 41.0082, longitude: 28.9784 };

const ANKARA_ADDRESS: GeocodedAddress = {
  city: 'Ankara',
  region: 'Ankara',
  country: 'Türkiye',
  isoCountryCode: 'tr',
  timezone: 'Europe/Istanbul',
};

const ISTANBUL_ADDRESS: GeocodedAddress = {
  city: 'Istanbul',
  district: 'Fatih',
  region: 'Istanbul',
  subregion: 'Fatih',
  country: 'Türkiye',
  isoCountryCode: 'tr',
  timezone: 'Europe/Istanbul',
  name: 'Sultanahmet',
};

const GRANTED = { status: 'granted' as const, granted: true, canAskAgain: false };
const DENIED = { status: 'denied' as const, granted: false, canAskAgain: false };
const UNDETERMINED = { status: 'undetermined' as const, granted: false, canAskAgain: true };

const NOW = 1_700_000_000_000;

function makeService(config: Parameters<typeof createFakeLocationAdapter>[0] = {}): {
  service: LocationService;
  adapter: ReturnType<typeof createFakeLocationAdapter>;
} {
  const adapter = createFakeLocationAdapter(config);
  const service = createLocationService(adapter, { now: () => NOW });
  return { service, adapter };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

describe('formatCoordinateLabel', () => {
  it('labels the northern/eastern hemispheres', () => {
    expect(formatCoordinateLabel(ISTANBUL)).toBe('41.01°N, 28.98°E');
  });

  it('labels the southern/western hemispheres', () => {
    expect(formatCoordinateLabel({ latitude: -33.8688, longitude: -70.6693 })).toBe(
      '33.87°S, 70.67°W'
    );
  });

  it('rounds to the coarse precision the app actually collects', () => {
    expect(formatCoordinateLabel({ latitude: 0, longitude: 0 })).toBe('0.00°N, 0.00°E');
  });
});

describe('formatPlaceLabel', () => {
  it('prefers "City, Region"', () => {
    expect(formatPlaceLabel(ISTANBUL_ADDRESS, ISTANBUL)).toBe('Istanbul, Türkiye');
  });

  it('does not repeat the city as its own region', () => {
    // `region` here equals the city, so the label falls through to the country.
    expect(
      formatPlaceLabel({ city: 'Kuwait City', region: 'Kuwait City', country: 'Kuwait' }, ISTANBUL)
    ).toBe('Kuwait City, Kuwait');
  });

  it('collapses a city-state to a single name', () => {
    expect(formatPlaceLabel({ city: 'Singapore', country: 'Singapore' }, ISTANBUL)).toBe(
      'Singapore'
    );
  });

  it('writes the Arabic comma between a place and its region', () => {
    // U+060C, not U+002C. An ASCII comma between two Arabic runs is the wrong mark and a
    // weak-direction character in the middle of an RTL line — «الفاتح, اسطنبول» against
    // «الفاتح، اسطنبول». The label is composed once and persisted, so it keeps the language it
    // was resolved in, exactly as the place name itself always has.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const i18n = (require('@/i18n') as { default: { language: string } }).default;
    const previous = i18n.language;
    (i18n as unknown as { language: string }).language = 'ar';
    try {
      expect(formatPlaceLabel({ city: 'الفاتح', region: 'اسطنبول' }, ISTANBUL)).toBe(
        'الفاتح\u060C اسطنبول'
      );
    } finally {
      (i18n as unknown as { language: string }).language = previous;
    }
  });

  it('falls back through district and subregion when there is no city', () => {
    expect(formatPlaceLabel({ district: 'Üsküdar', region: 'Istanbul' }, ISTANBUL)).toBe(
      'Üsküdar, Istanbul'
    );
    expect(formatPlaceLabel({ subregion: 'Kadıköy', country: 'Türkiye' }, ISTANBUL)).toBe(
      'Kadıköy, Türkiye'
    );
  });

  it('ignores blank strings from the geocoder', () => {
    expect(formatPlaceLabel({ city: '   ', region: '', country: 'Türkiye' }, ISTANBUL)).toBe(
      'Türkiye'
    );
  });

  it('falls back to coordinates when the address is empty or missing', () => {
    expect(formatPlaceLabel(null, ISTANBUL)).toBe('41.01°N, 28.98°E');
    expect(formatPlaceLabel({}, ISTANBUL)).toBe('41.01°N, 28.98°E');
  });

  it('prefers an explicit fallback label over coordinates', () => {
    expect(formatPlaceLabel(null, ISTANBUL, 'Istanbul')).toBe('Istanbul');
    expect(formatPlaceLabel(null, ISTANBUL, '   ')).toBe('41.01°N, 28.98°E');
  });
});

describe('normalizeCountryCode', () => {
  it('uppercases a 2-letter code', () => {
    expect(normalizeCountryCode('tr')).toBe('TR');
    expect(normalizeCountryCode(' us ')).toBe('US');
  });

  it('rejects anything that is not alpha-2', () => {
    expect(normalizeCountryCode(null)).toBeUndefined();
    expect(normalizeCountryCode(undefined)).toBeUndefined();
    expect(normalizeCountryCode('')).toBeUndefined();
    expect(normalizeCountryCode('TUR')).toBeUndefined();
    expect(normalizeCountryCode('9')).toBeUndefined();
  });
});

describe('isValidCoordinates', () => {
  it('accepts in-range pairs and rejects junk', () => {
    expect(isValidCoordinates(ISTANBUL)).toBe(true);
    expect(isValidCoordinates({ latitude: 0, longitude: 0 })).toBe(true);
    expect(isValidCoordinates(null)).toBe(false);
    expect(isValidCoordinates({ latitude: Number.NaN, longitude: 0 })).toBe(false);
    expect(isValidCoordinates({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidCoordinates({ latitude: 0, longitude: 181 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveAutoLocation
// ---------------------------------------------------------------------------

describe('resolveAutoLocation — permission granted', () => {
  it('returns a labelled, country-coded auto location', async () => {
    const { service, adapter } = makeService({
      permission: GRANTED,
      position: { ...ISTANBUL, accuracyMeters: 3000 },
      addresses: [ISTANBUL_ADDRESS],
    });

    const result = await service.resolveAutoLocation();

    expect(result).toEqual({
      ok: true,
      geocoded: true,
      permission: GRANTED,
      location: {
        latitude: ISTANBUL.latitude,
        longitude: ISTANBUL.longitude,
        label: 'Istanbul, Türkiye',
        countryCode: 'TR',
        timeZone: 'Europe/Istanbul',
        source: 'auto',
        resolvedAt: NOW,
      },
    });
    // Already granted: no prompt was shown.
    expect(adapter.calls.requestPermission).toBe(0);
  });

  it('omits countryCode and timeZone when the geocoder does not report them', async () => {
    const { service } = makeService({
      permission: GRANTED,
      position: ISTANBUL,
      addresses: [{ city: 'Nowhere', isoCountryCode: null, timezone: null }],
    });

    const result = await service.resolveAutoLocation();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.location.label).toBe('Nowhere');
    expect('countryCode' in result.location).toBe(false);
    expect('timeZone' in result.location).toBe(false);
  });
});

describe('resolveAutoLocation — permission not granted', () => {
  it('never prompts unless explicitly asked to (the launch path)', async () => {
    const { service, adapter } = makeService({
      permission: UNDETERMINED,
      position: ISTANBUL,
    });

    const result = await service.resolveAutoLocation();

    expect(result).toEqual({ ok: false, reason: 'permissionDenied', permission: UNDETERMINED });
    expect(adapter.calls.requestPermission).toBe(0);
    expect(adapter.calls.getCurrentPosition).toBe(0);
  });

  it('prompts once when asked and proceeds if the user allows', async () => {
    const { service, adapter } = makeService({
      permission: UNDETERMINED,
      permissionAfterRequest: GRANTED,
      position: ISTANBUL,
      addresses: [ISTANBUL_ADDRESS],
    });

    const result = await service.resolveAutoLocation({ prompt: true });

    expect(adapter.calls.requestPermission).toBe(1);
    expect(result.ok).toBe(true);
  });

  it('reports permissionDenied when the user refuses the prompt', async () => {
    const { service, adapter } = makeService({
      permission: UNDETERMINED,
      permissionAfterRequest: DENIED,
      position: ISTANBUL,
    });

    const result = await service.resolveAutoLocation({ prompt: true });

    expect(result).toEqual({ ok: false, reason: 'permissionDenied', permission: DENIED });
    expect(adapter.calls.getCurrentPosition).toBe(0);
  });

  it('does not re-prompt when the OS will not ask again', async () => {
    const { service, adapter } = makeService({ permission: DENIED, position: ISTANBUL });

    const result = await service.resolveAutoLocation({ prompt: true });

    expect(result).toEqual({ ok: false, reason: 'permissionDenied', permission: DENIED });
    expect(adapter.calls.requestPermission).toBe(0);
  });

  it('degrades instead of throwing when the platform module itself fails', async () => {
    const adapter = createFakeLocationAdapter({ permission: GRANTED, position: ISTANBUL });
    adapter.getPermission = () => Promise.reject(new Error('no native module'));
    adapter.requestPermission = () => Promise.reject(new Error('no native module'));
    const service = createLocationService(adapter, { now: () => NOW });

    const result = await service.resolveAutoLocation({ prompt: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The app falls back to manual city selection rather than crashing.
    expect(result.reason).toBe('permissionDenied');
  });
});

describe('resolveAutoLocation — position failures', () => {
  it('reports positionUnavailable when granted permission yields no fix', async () => {
    const { service } = makeService({ permission: GRANTED, position: null });

    const result = await service.resolveAutoLocation();

    expect(result).toEqual({ ok: false, reason: 'positionUnavailable', permission: GRANTED });
  });

  it('falls back to the last known fix before giving up', async () => {
    const { service, adapter } = makeService({
      permission: GRANTED,
      position: null,
      lastKnownPosition: ISTANBUL,
      addresses: [ISTANBUL_ADDRESS],
    });

    const result = await service.resolveAutoLocation();

    expect(adapter.calls.getLastKnownPosition).toBe(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.location.label).toBe('Istanbul, Türkiye');
  });

  it('rejects an out-of-range fix rather than storing nonsense', async () => {
    const { service } = makeService({
      permission: GRANTED,
      position: { latitude: 999, longitude: 0 },
    });

    const result = await service.resolveAutoLocation();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('positionUnavailable');
  });
});

describe('resolveAutoLocation — geocode fallback', () => {
  it('still returns the location, labelled with coordinates, when the geocoder throws', async () => {
    const { service } = makeService({
      permission: GRANTED,
      position: ISTANBUL,
      addresses: null,
    });

    const result = await service.resolveAutoLocation();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.geocoded).toBe(false);
    expect(result.location.label).toBe('41.01°N, 28.98°E');
    expect(result.location.countryCode).toBeUndefined();
    expect(result.location.latitude).toBe(ISTANBUL.latitude);
  });

  it('treats an empty geocoder answer the same way', async () => {
    const { service } = makeService({ permission: GRANTED, position: ISTANBUL, addresses: [] });

    const result = await service.resolveAutoLocation();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.geocoded).toBe(false);
    expect(result.location.label).toBe('41.01°N, 28.98°E');
  });
});

// ---------------------------------------------------------------------------
// searchCity
// ---------------------------------------------------------------------------

describe('searchCity', () => {
  it('returns manual candidates labelled from the reverse geocoder', async () => {
    const { service } = makeService({
      searchResults: [ISTANBUL],
      addresses: [ISTANBUL_ADDRESS],
    });

    const { results, error } = await service.searchCity('istanbul');

    expect(error).toBeNull();
    expect(results).toEqual([
      {
        latitude: ISTANBUL.latitude,
        longitude: ISTANBUL.longitude,
        label: 'Istanbul, Türkiye',
        countryCode: 'TR',
        timeZone: 'Europe/Istanbul',
        source: 'manual',
        resolvedAt: NOW,
      },
    ]);
  });

  it('labels a candidate with the typed query when reverse geocoding fails', async () => {
    const { service } = makeService({ searchResults: [ISTANBUL], addresses: null });

    const { results, error } = await service.searchCity('  Istanbul  ');

    expect(error).toBeNull();
    expect(results[0]?.label).toBe('Istanbul');
    expect(results[0]?.source).toBe('manual');
  });

  it('never calls the geocoder for a blank query', async () => {
    const { service, adapter } = makeService({ searchResults: [ISTANBUL] });

    expect(await service.searchCity('   ')).toEqual({ results: [], error: null });
    expect(adapter.calls.forwardGeocode).toBe(0);
  });

  it('reports noResults when the geocoder knows no such place', async () => {
    const { service } = makeService({ searchResults: [] });

    expect(await service.searchCity('zzzzzz')).toEqual({ results: [], error: 'noResults' });
  });

  it('reports geocodeUnavailable when the geocoder throws', async () => {
    const { service } = makeService({ searchResults: null });

    expect(await service.searchCity('istanbul')).toEqual({
      results: [],
      error: 'geocodeUnavailable',
    });
  });

  it('drops duplicate and invalid points, and honours the limit', async () => {
    const { service, adapter } = makeService({
      searchResults: [
        ISTANBUL,
        { latitude: 41.0083, longitude: 28.9785 }, // same ~1 km cell
        { latitude: Number.NaN, longitude: 0 },
        { latitude: 39.9334, longitude: 32.8597 },
        { latitude: 38.4237, longitude: 27.1428 },
      ],
      // Two genuinely different cities, so the two survivors are two distinguishable rows.
      addressSequence: [[ISTANBUL_ADDRESS], [ANKARA_ADDRESS]],
    });

    const { results } = await service.searchCity('turkey', { limit: 2 });

    expect(results).toHaveLength(2);
    expect(results[0]?.latitude).toBe(ISTANBUL.latitude);
    expect(results[1]?.latitude).toBe(39.9334);
    expect(adapter.calls.reverseGeocode).toBe(2);
  });

  /**
   * The coordinate pass can only collapse points inside one ~1 km cell, and it must stay that
   * coarse: two towns sharing a name are far apart and both have to survive, because the
   * "City, Region" label is what tells them apart. Points a few kilometres apart therefore reach
   * the reverse geocoder separately and can come back with the *same* name — and two rows reading
   * "Istanbul, Türkiye" are not a choice the user can make.
   */
  it('collapses candidates that would render as the same place', async () => {
    const { service } = makeService({
      searchResults: [
        ISTANBUL,
        { latitude: 41.05, longitude: 29.02 }, // ~5 km away: survives the coordinate pass…
      ],
      // …and then names itself identically, which is what the label pass is for.
      addressSequence: [[ISTANBUL_ADDRESS], [ISTANBUL_ADDRESS]],
    });

    const { results } = await service.searchCity('istanbul');

    expect(results).toHaveLength(1);
    expect(results[0]?.label).toBe('Istanbul, Türkiye');
    // The geocoder's own ranking decides which one survives: the first.
    expect(results[0]?.latitude).toBe(ISTANBUL.latitude);
  });

  it('keeps two different towns that share a name', async () => {
    const { service } = makeService({
      searchResults: [
        { latitude: 39.8, longitude: -89.65 },
        { latitude: 42.1, longitude: -72.55 },
      ],
      addressSequence: [
        [{ city: 'Springfield', region: 'Illinois', country: 'United States' }],
        [{ city: 'Springfield', region: 'Massachusetts', country: 'United States' }],
      ],
    });

    const { results } = await service.searchCity('springfield');

    expect(results.map((result) => result.label)).toEqual([
      'Springfield, Illinois',
      'Springfield, Massachusetts',
    ]);
  });
});
