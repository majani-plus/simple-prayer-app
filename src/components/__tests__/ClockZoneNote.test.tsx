/**
 * @jest-environment <rootDir>/src/testing/fixedTimezoneEnvironment.js
 * @jest-environment-options {"timezone": "Europe/Istanbul"}
 */

/**
 * Component test for the "shown on your phone's clock" note.
 *
 * The note is the app's *answer* to a known limitation rather than a decoration (see the
 * component's own header, and D39): prayer times are
 * always written on the device clock, so a city in another zone has to be labelled. What is worth
 * pinning is when it speaks and when it stays quiet — a note that fires for the user's own city
 * would damage exactly the credibility it exists to protect.
 *
 * The process timezone is pinned to Europe/Istanbul (UTC+3, no DST) so every expectation below is
 * a fixed number rather than whatever the machine running CI happens to be standing in.
 */

import { configure, render, screen } from '@testing-library/react-native';

import { ClockZoneNote, clockDifference, zoneOffsetMinutes } from '../ClockZoneNote';
import type { AppLocation } from '@/domain/types';
import { initI18n } from '@/i18n';

configure({ defaultIncludeHiddenElements: true });

/** Midwinter, so no northern DST is in play anywhere in the fixtures. */
const AT = new Date('2026-01-15T12:00:00.000Z');

function location(patch: Partial<AppLocation>): AppLocation {
  return {
    label: 'Somewhere',
    latitude: 0,
    longitude: 0,
    source: 'manual',
    resolvedAt: 1,
    ...patch,
  };
}

beforeAll(() => {
  initI18n();
});

describe('zoneOffsetMinutes', () => {
  it('reads a zone the platform knows', () => {
    expect(zoneOffsetMinutes('UTC', AT)).toBe(0);
    expect(zoneOffsetMinutes('Europe/Istanbul', AT)).toBe(180);
    expect(zoneOffsetMinutes('Asia/Jakarta', AT)).toBe(420);
    expect(zoneOffsetMinutes('America/New_York', AT)).toBe(-300);
  });

  it('handles the half-hour and quarter-hour zones', () => {
    expect(zoneOffsetMinutes('Asia/Kolkata', AT)).toBe(330);
    expect(zoneOffsetMinutes('Asia/Kathmandu', AT)).toBe(345);
  });

  it('follows daylight saving, because it asks about an instant', () => {
    const summer = new Date('2026-07-15T12:00:00.000Z');
    expect(zoneOffsetMinutes('Europe/London', AT)).toBe(0);
    expect(zoneOffsetMinutes('Europe/London', summer)).toBe(60);
  });

  it('answers null rather than throwing for an unusable zone', () => {
    expect(zoneOffsetMinutes('Not/AZone', AT)).toBeNull();
    expect(zoneOffsetMinutes('', AT)).toBeNull();
    expect(zoneOffsetMinutes('UTC', new Date(Number.NaN))).toBeNull();
  });
});

describe('clockDifference', () => {
  it('says nothing without a location', () => {
    expect(clockDifference(null, AT)).toBeNull();
    expect(clockDifference(undefined, AT)).toBeNull();
  });

  it('says nothing for a city in the device’s own zone', () => {
    expect(clockDifference(location({ timeZone: 'Europe/Istanbul' }), AT)).toBeNull();
  });

  it('reports an exact difference from the city’s IANA zone', () => {
    expect(clockDifference(location({ timeZone: 'Asia/Jakarta' }), AT)).toEqual({
      minutes: 240,
      exact: true,
    });
    expect(clockDifference(location({ timeZone: 'America/New_York' }), AT)).toEqual({
      minutes: -480,
      exact: true,
    });
  });

  it('falls back to solar time when the platform reported no zone', () => {
    // Jakarta's longitude, no zone id — as the Android geocoder leaves it.
    expect(clockDifference(location({ longitude: 106.85 }), AT)).toEqual({
      minutes: 240,
      exact: false,
    });
  });

  it('keeps quiet about an estimated gap a political zone could explain', () => {
    // Istanbul's own longitude estimates to UTC+2 while Türkiye keeps UTC+3. Announcing that as
    // "an hour behind your phone" to someone sitting in Istanbul is precisely the false positive
    // the higher estimated threshold exists to prevent.
    expect(clockDifference(location({ longitude: 28.98 }), AT)).toBeNull();
    // Cairo from an Istanbul phone: one real hour, and an estimate that cannot tell that apart
    // from Türkiye's own political offset. Silence is the honest answer; the times are right
    // either way, so a missed note costs nothing and a wrong one costs trust.
    expect(clockDifference(location({ longitude: 31.24 }), AT)).toBeNull();
  });

  it('still speaks for an estimated gap no political offset could explain', () => {
    // Tokyo (UTC+9) from an Istanbul phone: six real hours, and the solar estimate lands on the
    // same figure. No political offset is anywhere near that big, so the note is safe to show —
    // still labelled approximate, because the method cannot promise the last hour.
    expect(clockDifference(location({ longitude: 139.7 }), AT)).toEqual({
      minutes: 360,
      exact: false,
    });
  });

  it('never estimates for an automatic location — that is where the device already is', () => {
    expect(clockDifference(location({ longitude: 106.85, source: 'auto' }), AT)).toBeNull();
    // With a real zone from the geocoder it is still allowed to speak.
    expect(
      clockDifference(location({ source: 'auto', timeZone: 'Asia/Jakarta' }), AT)
    ).not.toBeNull();
  });
});

describe('rendering', () => {
  it('renders nothing when the clocks agree', async () => {
    await render(<ClockZoneNote location={location({ timeZone: 'Europe/Istanbul' })} at={AT} />);
    expect(screen.queryByTestId('clock-zone-note')).toBeNull();
  });

  it('names the city, the direction and the size of the difference', async () => {
    await render(
      <ClockZoneNote
        location={location({ label: 'Jakarta, Indonesia', timeZone: 'Asia/Jakarta' })}
        at={AT}
      />
    );
    expect(screen.getByTestId('clock-zone-note')).toBeTruthy();
    // "4 hours", localized by `formatDuration`, and the city by name.
    expect(screen.getByText(/Jakarta, Indonesia/)).toBeTruthy();
    expect(screen.getByText(/4 hours/)).toBeTruthy();
    expect(screen.getByText(/ahead/)).toBeTruthy();
  });

  it('uses the “behind” wording for a city to the west', async () => {
    await render(
      <ClockZoneNote
        location={location({ label: 'New York, NY', timeZone: 'America/New_York' })}
        at={AT}
      />
    );
    expect(screen.getByText(/behind/)).toBeTruthy();
  });

  it('marks an estimated difference as approximate', async () => {
    await render(<ClockZoneNote location={location({ longitude: 106.85 })} at={AT} />);
    expect(screen.getByText(/approximate/)).toBeTruthy();
  });

  it('does not call an exact difference approximate', async () => {
    await render(<ClockZoneNote location={location({ timeZone: 'Asia/Jakarta' })} at={AT} />);
    expect(screen.queryByText(/approximate/)).toBeNull();
  });
});
