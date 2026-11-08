/**
 * Tests for `services/widgets` — the edge that ships snapshots across the bridge.
 *
 * Everything is injected: a recording bridge, a literal settings snapshot, a fake tracking store.
 * What matters here is the *policy* — when to write, when to clear, when to stay quiet — not the
 * snapshot's content, which `widgetSnapshot.test.ts` owns.
 */

import { resetWidgetSyncMemory, syncWidgets, type SyncWidgetsOptions, type WidgetsBridge } from './widgets';
import { parseWidgetSnapshot, type WidgetSnapshot } from './widgetSnapshot';
import { createDefaultSettings } from '../stores/settingsStore';
import type { AppSettings, Prayer, PrayerDay, PrayerStatus } from '../domain/types';

const allUnlogged: Record<Prayer, PrayerStatus> = {
  fajr: 'unlogged',
  dhuhr: 'unlogged',
  asr: 'unlogged',
  maghrib: 'unlogged',
  isha: 'unlogged',
};

function recordingBridge(supported = true) {
  const calls: { kind: 'write' | 'clear'; json?: string }[] = [];
  const bridge: WidgetsBridge = {
    isSupported: () => supported,
    writeSnapshot: (json: string) => {
      calls.push({ kind: 'write', json });
      return Promise.resolve();
    },
    clearSnapshot: () => {
      calls.push({ kind: 'clear' });
      return Promise.resolve();
    },
  };
  return { bridge, calls };
}

function settingsWithLocation(): AppSettings {
  return {
    ...createDefaultSettings(),
    location: {
      latitude: 52.3676,
      longitude: 4.9041,
      label: 'Amsterdam',
      countryCode: 'NL',
      source: 'manual',
      resolvedAt: 1,
    },
  };
}

function fakeTracking(statuses: Partial<Record<PrayerDay, Record<Prayer, PrayerStatus>>> = {}) {
  return {
    hydrated: true,
    loadRange: () => [],
    dayRecordFor: (day: PrayerDay) => {
      const forDay = statuses[day];
      return forDay === undefined ? undefined : { statuses: forDay };
    },
    isExemptDay: () => false,
  };
}

function options(overrides: Partial<SyncWidgetsOptions> = {}): SyncWidgetsOptions {
  return {
    now: new Date('2026-08-25T12:00:00Z'),
    translate: (key) => key,
    settings: settingsWithLocation(),
    tracking: fakeTracking(),
    ...overrides,
  };
}

beforeEach(() => {
  resetWidgetSyncMemory();
});

describe('syncWidgets', () => {
  it('does nothing on a binary without the bridge', async () => {
    const { bridge, calls } = recordingBridge(false);

    await expect(syncWidgets(options({ bridge }))).resolves.toBe('unsupported');
    expect(calls).toEqual([]);
  });

  it('writes a parseable snapshot when there is a location and a hydrated store', async () => {
    const { bridge, calls } = recordingBridge();

    await expect(syncWidgets(options({ bridge }))).resolves.toBe('written');
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('write');
    expect(parseWidgetSnapshot(calls[0].json)).not.toBeNull();
  });

  it('skips the bridge entirely when nothing changed since the last write', async () => {
    const { bridge, calls } = recordingBridge();
    const base = options({ bridge });

    await syncWidgets(base);
    await expect(syncWidgets({ ...base, now: new Date('2026-08-25T12:05:00Z') })).resolves.toBe(
      'unchanged'
    );
    expect(calls).toHaveLength(1);
  });

  it('writes again when the system appearance flips under the "system" theme — a byte-identical snapshot still repaints', async () => {
    const { bridge, calls } = recordingBridge();
    const base = options({ bridge, colorScheme: 'light' });

    await syncWidgets(base);
    await expect(syncWidgets({ ...base, colorScheme: 'dark' })).resolves.toBe('written');
    expect(calls).toHaveLength(2);
    // Both writes carry the same content: the flip lives in the dedupe key, never the payload —
    // the native side reads the OS appearance at draw time.
    expect(calls[0].json).toBe(calls[1].json);
  });

  it('ignores an appearance flip when the in-app theme is pinned', async () => {
    const { bridge, calls } = recordingBridge();
    const settings = { ...settingsWithLocation(), theme: 'dark' as const };
    const base = options({ bridge, settings, colorScheme: 'light' });

    await syncWidgets(base);
    await expect(syncWidgets({ ...base, colorScheme: 'dark' })).resolves.toBe('unchanged');
    expect(calls).toHaveLength(1);
  });

  it('writes again when a status changed', async () => {
    const { bridge, calls } = recordingBridge();
    const base = options({ bridge });

    await syncWidgets(base);
    const marked = fakeTracking({ '2026-08-25': { ...allUnlogged, dhuhr: 'prayed' } });
    await expect(syncWidgets({ ...base, tracking: marked })).resolves.toBe('written');
    expect(calls).toHaveLength(2);
  });

  it('clears once when the location goes away, and stays quiet after', async () => {
    const { bridge, calls } = recordingBridge();
    const base = options({ bridge });

    await syncWidgets(base);
    const gone = { ...base, settings: { ...settingsWithLocation(), location: null } };
    await expect(syncWidgets(gone)).resolves.toBe('cleared');
    await expect(syncWidgets(gone)).resolves.toBe('unchanged');
    expect(calls.map((c) => c.kind)).toEqual(['write', 'clear']);
  });

  it('clears on the very first reconcile of a process with no location — a previous process may have shipped', async () => {
    const { bridge, calls } = recordingBridge();
    const gone = options({ bridge, settings: { ...settingsWithLocation(), location: null } });

    await expect(syncWidgets(gone)).resolves.toBe('cleared');
    await expect(syncWidgets(gone)).resolves.toBe('unchanged');
    expect(calls.map((c) => c.kind)).toEqual(['clear']);
  });

  it('never clears just because the store has not hydrated yet', async () => {
    const { bridge, calls } = recordingBridge();
    const base = options({ bridge });

    await syncWidgets(base);
    const early = { ...base, tracking: { ...fakeTracking(), hydrated: false } };
    await expect(syncWidgets(early)).resolves.toBe('unchanged');
    expect(calls.map((c) => c.kind)).toEqual(['write']);
  });

  it('reports what it built so a test can look inside', async () => {
    const { bridge } = recordingBridge();
    const built: unknown[] = [];

    await syncWidgets(options({ bridge, onBuilt: (snapshot) => built.push(snapshot) }));
    expect(built).toHaveLength(1);
    expect(built[0]).not.toBeNull();
  });
});

describe('tracking mode (D192)', () => {
  const LATE_FAJR: Record<Prayer, PrayerStatus> = {
    fajr: 'late',
    dhuhr: 'unlogged',
    asr: 'unlogged',
    maghrib: 'unlogged',
    isha: 'unlogged',
  };
  const everyDay = {
    ...fakeTracking(),
    dayRecordFor: () => ({ statuses: LATE_FAJR }),
  };

  async function build(settings: AppSettings): Promise<WidgetSnapshot> {
    resetWidgetSyncMemory();
    const built: (WidgetSnapshot | null)[] = [];
    await syncWidgets(
      options({
        bridge: recordingBridge().bridge,
        settings,
        tracking: everyDay,
        onBuilt: (snapshot) => built.push(snapshot),
      })
    );
    return built[0] as WidgetSnapshot;
  }

  it('ships the stored statuses in detailed mode', async () => {
    const snapshot = await build(settingsWithLocation());
    const first = snapshot.days[0];
    expect(first.prayers.map((p) => p.status)).toEqual(Object.values(LATE_FAJR));
  });

  it('ships what simple mode shows — late as prayed, a past unmarked prayer as missed', async () => {
    const detailed = await build(settingsWithLocation());
    const pastDay = detailed.days[0].day;
    const snapshot = await build({
      ...settingsWithLocation(),
      trackingMode: 'simple',
      simpleModeSince: pastDay,
    });
    const first = snapshot.days.find((d) => d.day === pastDay);
    expect(first?.prayers.map((p) => p.status)).toEqual([
      'prayed',
      'missed',
      'missed',
      'missed',
      'missed',
    ]);
    // A day ahead of today has no ended prayer, so nothing there is missed.
    const last = snapshot.days[snapshot.days.length - 1];
    expect(last.prayers.some((p) => p.status === 'missed')).toBe(false);
  });
});

