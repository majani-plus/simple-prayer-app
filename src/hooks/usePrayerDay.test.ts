/**
 * @jest-environment <rootDir>/src/testing/fixedTimezoneEnvironment.js
 * @jest-environment-options {"timezone": "Europe/Istanbul"}
 *
 * Tests for `usePrayerDay` — specifically the contract that makes the rest of the app agree with
 * the screen about what day it is.
 *
 * The hook's own arithmetic belongs to `domain/prayerTimes` and is tested there; what cannot be
 * tested there is the wiring. Between midnight and Fajr the prayer day and the calendar date are
 * different days (PRODUCT_SPEC §3), and a screen that reports the calendar date for those hours
 * files Isha under the wrong day. This file pins that the hook reports the prayer day, and that
 * it rolls over when Fajr actually arrives.
 *
 * The matching contract for the tracking STORE — which is told the prayer day by the root layout
 * — lives in `useTodayDayResolver.test.ts`.
 *
 * The fixture is exact: Istanbul, 2026-08-18, Fajr 04:34 local, clock at 00:30 — so the prayer
 * day is 2026-08-17. That only means anything with a known timezone, so the docblock above runs
 * this file in one. It has to be the environment rather than a `beforeAll`: Jest gives the sandbox
 * a *copy* of `process.env`, so assigning `TZ` from inside a test sets a string and leaves `Date`
 * in whatever zone the machine started in — the pin reads as working while the suite silently
 * measures the CI box. See `src/testing/fixedTimezoneEnvironment.js`.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { parseDay } from '@/domain/dates';
import { computeDayTimes } from '@/domain/prayerTimes';
import type { AppLocation, PrayerDay } from '@/domain/types';
import { useSettingsStore } from '@/stores/settingsStore';

import { usePrayerDay } from './usePrayerDay';

jest.mock('react-native-mmkv', () => {
  const instances = new Map<string, Map<string, string>>();
  return {
    createMMKV: ({ id }: { id: string }) => {
      let values = instances.get(id);
      if (values === undefined) {
        values = new Map();
        instances.set(id, values);
      }
      const store = values;
      return {
        id,
        set: (key: string, value: string) => void store.set(key, value),
        getString: (key: string) => store.get(key),
        getBoolean: () => undefined,
        getNumber: () => undefined,
        remove: (key: string) => void store.delete(key),
        delete: (key: string) => void store.delete(key),
        clearAll: () => void store.clear(),
      };
    },
  };
});

// The database is never opened here: `loadDay` is gated on the tracking store being hydrated,
// and this suite deliberately leaves it un-hydrated. Mocking the client keeps that a guarantee
// rather than an accident, so a regression that reaches for SQL from a render fails loudly.
jest.mock('@/db/client', () => ({
  getDb: () => {
    throw new Error('usePrayerDay must not touch the database');
  },
  runMigrations: async () => undefined,
}));

const ISTANBUL: AppLocation = {
  latitude: 41.0082,
  longitude: 28.9784,
  label: 'Istanbul',
  countryCode: 'TR',
  source: 'manual',
  resolvedAt: 0,
};

/** The prayer day the user is still standing in at 00:30. */
const OPEN_DAY: PrayerDay = '2026-08-17';
/** The calendar date the clock already shows; its Fajr is four hours away. */
const CALENDAR_DAY: PrayerDay = '2026-08-18';

/** Fajr of the calendar date, per the app's own engine. */
function fajr(): Date {
  return computeDayTimes(CALENDAR_DAY, ISTANBUL, useSettingsStore.getState().calculation).times
    .fajr;
}

/** Sunrise of the calendar date — where Fajr's window ends (`domain/windows.ts`). */
function sunrise(): Date {
  return computeDayTimes(CALENDAR_DAY, ISTANBUL, useSettingsStore.getState().calculation).times
    .sunrise;
}

let appStateListeners: ((state: AppStateStatus) => void)[] = [];

beforeEach(() => {
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    const listener = handler as (state: AppStateStatus) => void;
    appStateListeners.push(listener);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((entry) => entry !== listener);
      },
    } as NativeEventSubscription;
  });

  jest.useFakeTimers();
  // 00:30 local on the calendar date.
  jest.setSystemTime(new Date(parseDay(CALENDAR_DAY).getTime() + 30 * 60 * 1000));
  useSettingsStore.getState().setLocation(ISTANBUL);
});

afterEach(() => {
  useSettingsStore.getState().setLocation(null);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('the fixture', () => {
  it('really is 00:30 with Fajr at 04:34', () => {
    expect([new Date().getHours(), new Date().getMinutes()]).toEqual([0, 30]);
    expect([fajr().getHours(), fajr().getMinutes()]).toEqual([4, 34]);
  });
});

describe('usePrayerDay reports the prayer day, not the calendar date', () => {
  it('is still yesterday at 00:30', async () => {
    const { result } = await renderHook(() => usePrayerDay());

    expect(result.current.day).toBe(OPEN_DAY);
  });

  it('rolls over to the calendar date once Fajr arrives', async () => {
    const { result } = await renderHook(() => usePrayerDay());
    expect(result.current.day).toBe(OPEN_DAY);

    // Past Fajr, with room for the rollover timer's grace and its 10-minute chunking.
    await act(async () => {
      jest.advanceTimersByTime(fajr().getTime() - Date.now() + 60 * 1000);
    });

    expect(result.current.day).toBe(CALENDAR_DAY);
  });
});

describe('a lost rollover timer', () => {
  it('still rolls over at Fajr when the timer never fires (the 30 s net)', async () => {
    // A held-back timer is modelled by moving the clock without running due timers: the
    // 10-minute chunk armed at 00:30 stays pending, exactly as on a phone that deferred it.
    const { result } = await renderHook(() => usePrayerDay());
    expect(result.current.day).toBe(OPEN_DAY);

    jest.setSystemTime(fajr().getTime() + 5 * 1000);
    expect(result.current.day).toBe(OPEN_DAY);

    await act(async () => {
      jest.advanceTimersByTime(30 * 1000);
    });

    expect(result.current.day).toBe(CALENDAR_DAY);
    expect(result.current.isCurrent('fajr')).toBe(true);
  });
});

describe('isCurrent — the prayer whose window contains now', () => {
  it('answers Isha at 00:30: the window that turns the night state legible', async () => {
    // Isha's window runs to next Fajr, so past midnight the current prayer is yesterday's Isha —
    // the row the user can still log (spec-today-interaction §1).
    const { result } = await renderHook(() => usePrayerDay());

    expect(result.current.isCurrent('isha')).toBe(true);
    for (const prayer of ['fajr', 'dhuhr', 'asr', 'maghrib'] as const) {
      expect(result.current.isCurrent(prayer)).toBe(false);
    }
    // The same boundary clock as the rest of the snapshot, exposed for co-located markers.
    expect(result.current.asOf).toBe(Date.now());
  });

  it('moves to Fajr on the same rollover tick that opens the new day', async () => {
    const { result } = await renderHook(() => usePrayerDay());
    expect(result.current.isCurrent('isha')).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(fajr().getTime() - Date.now() + 60 * 1000);
    });

    // Exactly one current prayer, and it is the one whose adhan just went.
    expect(result.current.isCurrent('fajr')).toBe(true);
    expect(result.current.isCurrent('isha')).toBe(false);
  });

  it('RETIRES FAJR AT SUNRISE without waiting for Dhuhr, on a screen left open since dawn', async () => {
    // The regression this guards: sunrise is the only window end that is not also a prayer start,
    // so a rollover timer armed on `next.at` alone would sleep through it and the app would still
    // be calling Fajr "current" — bright row, one-tap seal, "now · until …" — at ten in the
    // morning. Nothing here is user interaction: the screen is simply left open.
    const { result } = await renderHook(() => usePrayerDay());

    await act(async () => {
      jest.advanceTimersByTime(fajr().getTime() - Date.now() + 60 * 1000);
    });
    expect(result.current.isCurrent('fajr')).toBe(true);

    // A minute past sunrise, still hours before Dhuhr.
    await act(async () => {
      jest.advanceTimersByTime(sunrise().getTime() - Date.now() + 60 * 1000);
    });

    expect(result.current.isCurrent('fajr')).toBe(false);
    // …and nothing else has taken over: between sunrise and Dhuhr nothing is due at all.
    for (const prayer of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
      expect(result.current.isCurrent(prayer)).toBe(false);
    }
    // The day itself has not moved — only the window shut.
    expect(result.current.day).toBe(CALENDAR_DAY);
    expect(result.current.next?.prayer).toBe('dhuhr');
  });

  it('keeps Fajr’s window ending at sunrise, not at the next prayer', async () => {
    const { result } = await renderHook(() => usePrayerDay());
    await act(async () => {
      jest.advanceTimersByTime(fajr().getTime() - Date.now() + 60 * 1000);
    });

    const fajrWindow = result.current.windows.find((window) => window.prayer === 'fajr');
    expect(fajrWindow?.end.getTime()).toBe(sunrise().getTime());
  });
});

// The prayer-day resolver the tracking store runs used to be installed HERE, by this hook. It
// moved to the root layout (`hooks/useTodayDayResolver`), because a screen-scoped install
// disappears with the screen; the tests that pin that contract moved with it, to
// `useTodayDayResolver.test.ts`.
