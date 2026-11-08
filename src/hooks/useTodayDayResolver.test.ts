/**
 * @jest-environment <rootDir>/src/testing/fixedTimezoneEnvironment.js
 * @jest-environment-options {"timezone": "Europe/Istanbul"}
 *
 * Tests for `useTodayDayResolver` — the contract that makes the tracking store agree with the
 * screens about what day it is.
 *
 * Between midnight and Fajr the prayer day and the calendar date are different days
 * (PRODUCT_SPEC §3), and everything the store derives from "today" — which day a write is filed
 * under, whether a day is a locked future day, the window streaks and stats are measured over —
 * is wrong for those hours unless the store is told. This file pins that it *is* told, that the
 * answer rolls over at Fajr on its own, that a screen mounting or unmounting can neither install
 * nor remove it (the regression that moved this out of the Today tab), and that with no location
 * the store keeps its own safe fallback.
 *
 * The store's own fallback (`resolvePrayerDay`) already answers correctly, so simply reading
 * `todayDay()` back would pass whether or not anything was wired up. Every test therefore
 * installs a SENTINEL resolver first: the store answers with an impossible day until something
 * displaces it, which makes "the hook installed its resolver" observable rather than assumed. The
 * value it installs agreeing with the fallback is the *point* — one boundary, two derivations
 * that can never drift.
 *
 * The fixture is exact: Istanbul, 2026-08-18, Fajr 04:34 local, clock at 00:30 — so the prayer
 * day is 2026-08-17. That only means anything with a known timezone, so the docblock above runs
 * this file in one (see `src/testing/fixedTimezoneEnvironment.js`).
 */

import { act, render, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { parseDay } from '@/domain/dates';
import { computeDayTimes, getCurrentPrayerDay } from '@/domain/prayerTimes';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTrackingStore } from '@/stores/trackingStore';

import { usePrayerDay } from './usePrayerDay';
import { useTodayDayResolver } from './useTodayDayResolver';

import type { AppLocation, PrayerDay } from '@/domain/types';

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
        clearAll: () => void store.clear(),
      };
    },
  };
});

// The real engine, counted. `getCurrentPrayerDay` is 2-3 adhan computations, and the store asks
// for "today" far more often than it looks (every selector's memo KEY), so how many times the
// installed resolver actually reaches for it is a property worth pinning.
jest.mock('@/domain/prayerTimes', () => {
  const actual = jest.requireActual<typeof import('@/domain/prayerTimes')>('@/domain/prayerTimes');
  return { ...actual, __esModule: true, getCurrentPrayerDay: jest.fn(actual.getCurrentPrayerDay) };
});

// Resolving a prayer day touches no data. Mocking the client keeps that a guarantee rather than
// an accident: a regression that reaches for SQL from here fails loudly.
jest.mock('@/db/client', () => ({
  getDb: () => {
    throw new Error('the prayer-day resolver must not touch the database');
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
/** A day nothing else in this suite can produce. */
const SENTINEL: PrayerDay = '1999-01-01';

/** Fajr of the calendar date, per the app's own engine. */
function fajr(): Date {
  return computeDayTimes(CALENDAR_DAY, ISTANBUL, useSettingsStore.getState().calculation).times
    .fajr;
}

/** What the tracking store currently believes the prayer day is. */
function storeToday(): PrayerDay {
  return useTrackingStore.getState().todayDay();
}

/** How many times the installed resolver has reached for the prayer-time engine. */
const engine = jest.mocked(getCurrentPrayerDay);

beforeEach(() => {
  engine.mockClear();
  jest.useFakeTimers();
  // 00:30 local on the calendar date.
  jest.setSystemTime(new Date(parseDay(CALENDAR_DAY).getTime() + 30 * 60 * 1000));
  useSettingsStore.getState().setLocation(ISTANBUL);
  useTrackingStore.getState().setTodayDayResolver(() => SENTINEL);
});

afterEach(() => {
  useTrackingStore.getState().setTodayDayResolver(null);
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

describe('useTodayDayResolver', () => {
  it('installs its resolver on mount, displacing whatever answered before', async () => {
    expect(storeToday()).toBe(SENTINEL);

    const { unmount } = await renderHook(() => useTodayDayResolver());

    expect(storeToday()).toBe(OPEN_DAY);
    unmount();
  });

  it('installs a LIVE resolver, so the store rolls over at Fajr with no render', async () => {
    const { unmount } = await renderHook(() => useTodayDayResolver());
    expect(storeToday()).toBe(OPEN_DAY);

    // No timer fires, no effect re-runs, nothing re-renders — the resolver reads the clock.
    jest.setSystemTime(fajr());
    expect(storeToday()).toBe(CALENDAR_DAY);

    unmount();
  });

  it('cannot go stale while the app sits in the background', async () => {
    const { unmount } = await renderHook(() => useTodayDayResolver());

    // Backgrounded across Fajr: OS timers do not fire and no foreground resync has happened.
    jest.setSystemTime(new Date(fajr().getTime() + 6 * 60 * 60 * 1000));

    // A resolver frozen at the day last rendered would leave the real today looking like a
    // FUTURE day, which `setStatus` refuses — the user would be locked out of logging the Fajr
    // they just prayed.
    expect(storeToday()).toBe(CALENDAR_DAY);

    unmount();
  });

  it('releases on unmount, handing the job back to the store', async () => {
    const { unmount } = await renderHook(() => useTodayDayResolver());
    expect(storeToday()).toBe(OPEN_DAY);

    unmount();

    // The store's own resolver answers again — same rule, same answers, still moving.
    expect(storeToday()).toBe(OPEN_DAY);
    jest.setSystemTime(fajr());
    expect(storeToday()).toBe(CALENDAR_DAY);
  });

  it('installs nothing when there is no location to derive a boundary from', async () => {
    useSettingsStore.getState().setLocation(null);

    const { unmount } = await renderHook(() => useTodayDayResolver());

    // Nothing to compute a Fajr from, so the store keeps whatever was answering — installing a
    // resolver that could only throw would be worse than the fallback (PRODUCT_SPEC §10).
    expect(storeToday()).toBe(SENTINEL);

    unmount();
    useTrackingStore.getState().setTodayDayResolver(null);
    expect(storeToday()).toBe(CALENDAR_DAY);
  });

  it('answers within one minute from a memo, and recomputes in the next', async () => {
    const { unmount } = await renderHook(() => useTodayDayResolver());

    // A minute the resolver has not seen; installing already answered for 00:30.
    jest.setSystemTime(new Date(Date.now() + 60 * 1000));
    engine.mockClear();

    expect(storeToday()).toBe(OPEN_DAY);
    expect(storeToday()).toBe(OPEN_DAY);
    expect(storeToday()).toBe(OPEN_DAY);
    // Every store `set` asks for "today" around nine times — `streakSummary`, `statsFor` and
    // `qadaProgress` each build their memo KEY from it before the memo is consulted, and
    // `setStatus` guards on it — so an unmemoised resolver put ~20 adhan computations
    // (2-3 per call) on the path of a single seal tap.
    expect(engine).toHaveBeenCalledTimes(1);

    // The clock is still read on every call, so the answer is never older than the minute.
    jest.setSystemTime(new Date(Date.now() + 60 * 1000));
    expect(storeToday()).toBe(OPEN_DAY);
    expect(engine).toHaveBeenCalledTimes(2);

    // And the rollover itself, which is the property the memo must not cost us.
    jest.setSystemTime(fajr());
    expect(storeToday()).toBe(CALENDAR_DAY);

    unmount();
  });

  it('follows a location change without being re-installed by hand', async () => {
    const { unmount } = await renderHook(() => useTodayDayResolver());
    expect(storeToday()).toBe(OPEN_DAY);

    // Kiritimati (+14): 00:30 Istanbul is already past Fajr there, so the same instant belongs to
    // a different prayer day — the resolver must be re-derived from the new location, not cached.
    await act(async () => {
      useSettingsStore.getState().setLocation({
        latitude: 1.87,
        longitude: -157.4,
        label: 'Kiritimati',
        countryCode: 'KI',
        source: 'manual',
        resolvedAt: 0,
      });
    });

    expect(storeToday()).not.toBe(SENTINEL);
    unmount();
  });
});

/** A screen that reads the prayer day — the Today tab, in miniature. */
function Screen(): ReactNode {
  usePrayerDay();
  return null;
}

/** The app: the root layout installs the resolver, and a screen may or may not be under it. */
function Root({ withScreen }: { withScreen: boolean }): ReactNode {
  useTodayDayResolver();
  return withScreen ? createElement(Screen) : null;
}

/**
 * The regression this hoist exists for (internal notes, Known Issues).
 *
 * The install used to live in `usePrayerDay`, i.e. in the Today tab. It worked only because the
 * tab navigator keeps Today mounted; a route reached without it — a notification deep link into
 * Settings, a standalone modal, a tab unmounted under memory pressure — silently dropped the
 * store back to the calendar day for the midnight→Fajr hours. Installed at the root, no screen
 * can give it or take it away.
 */
describe('the resolver belongs to the app, not to a screen', () => {
  it('answers correctly on a route where the Today tab never mounts', async () => {
    const { unmount } = await renderHook(() => useTodayDayResolver());

    // Nothing else is mounted: this is Settings (or a deep link) at 00:30.
    expect(storeToday()).toBe(OPEN_DAY);
    unmount();
  });

  it('is not taken away when a screen using the prayer day unmounts', async () => {
    // One tree, as the app has it: the root layout holds the resolver and a screen comes and
    // goes underneath it. Rendering the screen as a second root would test two apps, not this.
    const view = await render(createElement(Root, { withScreen: true }));

    expect(storeToday()).toBe(OPEN_DAY);

    // The screen unmounts — a tab switch, a modal dismissed, a deep link elsewhere.
    await view.rerender(createElement(Root, { withScreen: false }));

    expect(storeToday()).toBe(OPEN_DAY);
    jest.setSystemTime(fajr());
    expect(storeToday()).toBe(CALENDAR_DAY);

    view.unmount();
  });

  it('is not installed by a screen — the root layout is the only installer', async () => {
    const { unmount } = await renderHook(() => usePrayerDay());

    // The sentinel still answers: mounting the Today screen must not wire the store up itself,
    // or the two installers could disagree about which one is in charge.
    expect(storeToday()).toBe(SENTINEL);
    unmount();
  });
});
