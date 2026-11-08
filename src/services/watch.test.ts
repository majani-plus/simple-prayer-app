/**
 * Tests for `services/watch` — the edge that ships envelopes toward the watch.
 *
 * Everything is injected, mirroring `widgets.test.ts`: a recording bridge, a literal settings
 * snapshot, a fake tracking store. The policy is what matters — write, clear, stay quiet — not
 * the envelope's content, which `watchEnvelope.test.ts` owns.
 */

import { resetWatchSyncMemory, syncWatch, type SyncWatchOptions, type WatchBridge } from './watch';
import { parseWatchEnvelope, type WatchEnvelope } from './watchEnvelope';
import { createDefaultSettings } from '../stores/settingsStore';
import type { AppSettings, Prayer, PrayerDay, PrayerStatus } from '../domain/types';

function recordingBridge(supported = true) {
  const calls: { kind: 'push' | 'clear'; json?: string }[] = [];
  const bridge: WatchBridge = {
    isSupported: () => supported,
    pushEnvelope: (json: string) => {
      calls.push({ kind: 'push', json });
      return Promise.resolve();
    },
    clearEnvelope: () => {
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

function options(overrides: Partial<SyncWatchOptions> = {}): SyncWatchOptions {
  return {
    now: new Date('2026-08-25T12:00:00Z'),
    translate: (key) => key,
    settings: settingsWithLocation(),
    tracking: fakeTracking(),
    ...overrides,
  };
}

beforeEach(() => {
  resetWatchSyncMemory();
});

describe('syncWatch', () => {
  it('does nothing on a binary without the bridge', async () => {
    const { bridge, calls } = recordingBridge(false);

    await expect(syncWatch(options({ bridge }))).resolves.toBe('unsupported');
    expect(calls).toEqual([]);
  });

  it('pushes a parseable envelope when there is a location and a hydrated store', async () => {
    const { bridge, calls } = recordingBridge();

    await expect(syncWatch(options({ bridge }))).resolves.toBe('written');
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('push');
    const envelope = parseWatchEnvelope(calls[0].json);
    expect(envelope).not.toBeNull();
    expect(envelope?.qibla).not.toBeNull();
    // Default settings carry the adhan on for every prayer, so the plan has future entries.
    expect(envelope?.alerts.entries.length).toBeGreaterThan(0);
    expect(envelope?.alerts.entries.every((entry) => entry.at > Date.parse('2026-08-25T12:00:00Z'))).toBe(true);
  });

  it('skips the bridge entirely when nothing changed since the last push', async () => {
    const { bridge, calls } = recordingBridge();
    const base = options({ bridge });

    await syncWatch(base);
    await expect(syncWatch({ ...base, now: new Date('2026-08-25T12:00:30Z') })).resolves.toBe(
      'unchanged'
    );
    expect(calls).toHaveLength(1);
  });

  it('clears once with no location, then stays quiet', async () => {
    const { bridge, calls } = recordingBridge();
    const settings = { ...createDefaultSettings(), location: null };
    const base = options({ bridge, settings });

    await expect(syncWatch(base)).resolves.toBe('cleared');
    await expect(syncWatch(base)).resolves.toBe('unchanged');
    expect(calls).toEqual([{ kind: 'clear' }]);
  });

  it('leaves a good envelope alone while the store is still hydrating', async () => {
    const { bridge, calls } = recordingBridge();
    const tracking = { ...fakeTracking(), hydrated: false };

    await expect(syncWatch(options({ bridge, tracking }))).resolves.toBe('unchanged');
    expect(calls).toEqual([]);
  });

  it('wraps a snapshot handed in instead of building the same one again', async () => {
    // `useWidgetSync` builds the 14 days once and gives the widgets' copy to the watch; the
    // envelope must carry that exact snapshot, and the days it needed must not be re-read.
    const { bridge } = recordingBridge();
    const first: (WatchEnvelope | null)[] = [];
    await syncWatch(options({ bridge, onBuilt: (envelope) => void first.push(envelope) }));
    const shared = first[0]?.snapshot ?? null;
    expect(shared).not.toBeNull();

    const loads: string[] = [];
    const tracking = {
      ...fakeTracking(),
      loadRange: (from: PrayerDay, to: PrayerDay) => {
        loads.push(`${from}..${to}`);
        return [];
      },
    };
    const second: (WatchEnvelope | null)[] = [];
    await syncWatch(
      options({
        bridge,
        tracking,
        snapshot: shared,
        onBuilt: (envelope) => void second.push(envelope),
      })
    );

    expect(second[0]?.snapshot).toBe(shared);
    expect(loads).toEqual([]);
  });

  it('clears when the handed-in snapshot is null — the sky it describes is unresolvable', async () => {
    const { bridge, calls } = recordingBridge();

    await expect(syncWatch(options({ bridge, snapshot: null }))).resolves.toBe('cleared');
    expect(calls).toEqual([{ kind: 'clear' }]);
  });

  it('pushes again when a status changes — the seals on the watch must match', async () => {
    const { bridge, calls } = recordingBridge();
    const base = options({ bridge });

    await syncWatch(base);
    await expect(
      syncWatch(
        options({
          bridge,
          tracking: fakeTracking({
            '2026-08-25': {
              fajr: 'prayed',
              dhuhr: 'unlogged',
              asr: 'unlogged',
              maghrib: 'unlogged',
              isha: 'unlogged',
            },
          }),
        })
      )
    ).resolves.toBe('written');
    expect(calls).toHaveLength(2);
  });
});
