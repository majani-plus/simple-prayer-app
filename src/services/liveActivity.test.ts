/**
 * Tests for `services/liveActivity` — when the prayer-window Activity exists.
 *
 * The bridge is a recorder; the times are real domain computations for a fixed place and
 * instant, so the "current window" answers are the app's own, not fixtures. The translator is
 * an echo, so assertions name keys.
 */

import {
  resetLiveActivityMemory,
  syncLiveActivity,
  type LiveActivityBridge,
  type SyncLiveActivityOptions,
} from './liveActivity';
import { createDefaultSettings } from '../stores/settingsStore';
import type { AppSettings, Prayer, PrayerDay, PrayerStatus } from '../domain/types';

/** Amsterdam on 2026-08-25: Dhuhr ≈ 13:40 local (11:40Z), Asr ≈ 17:25 local. 12:00Z is Dhuhr. */
const DHUHR_TIME = new Date('2026-08-25T12:00:00Z');
/** Between sunrise (~04:40Z) and Dhuhr — the daily no-current-prayer gap. */
const GAP_TIME = new Date('2026-08-25T08:00:00Z');

const allUnlogged: Record<Prayer, PrayerStatus> = {
  fajr: 'unlogged',
  dhuhr: 'unlogged',
  asr: 'unlogged',
  maghrib: 'unlogged',
  isha: 'unlogged',
};

function recordingBridge(supported = true) {
  const calls: { kind: 'start' | 'end'; payload?: Record<string, unknown> }[] = [];
  const bridge: LiveActivityBridge = {
    liveActivitiesSupported: () => supported,
    startPrayerWindowActivity: (payload) => {
      calls.push({ kind: 'start', payload: payload as unknown as Record<string, unknown> });
      return Promise.resolve();
    },
    endPrayerWindowActivities: () => {
      calls.push({ kind: 'end' });
      return Promise.resolve();
    },
  };
  return { bridge, calls };
}

function settings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    ...createDefaultSettings(),
    liveActivityEnabled: true,
    location: {
      latitude: 52.3676,
      longitude: 4.9041,
      label: 'Amsterdam',
      countryCode: 'NL',
      source: 'manual',
      resolvedAt: 1,
    },
    ...over,
  };
}

function tracking(statuses: Partial<Record<PrayerDay, Record<Prayer, PrayerStatus>>> = {}, exempt = false) {
  return {
    hydrated: true,
    dayRecordFor: (day: PrayerDay) => {
      const forDay = statuses[day];
      return forDay === undefined ? undefined : { statuses: forDay };
    },
    isExemptDay: () => exempt,
  };
}

function options(over: Partial<SyncLiveActivityOptions> = {}): SyncLiveActivityOptions {
  return {
    now: DHUHR_TIME,
    translate: (key, params) =>
      params === undefined || Object.keys(params).length === 0
        ? key
        : `${key}(${Object.values(params).join(',')})`,
    settings: settings(),
    tracking: tracking(),
    ...over,
  };
}

beforeEach(() => {
  resetLiveActivityMemory();
});

describe('syncLiveActivity', () => {
  it('does nothing where Activities cannot exist', async () => {
    const { bridge, calls } = recordingBridge(false);
    await expect(syncLiveActivity(options({ bridge }))).resolves.toBe('unsupported');
    expect(calls).toEqual([]);
  });

  it('starts a card for the open window, fully pre-rendered', async () => {
    const { bridge, calls } = recordingBridge();
    await expect(syncLiveActivity(options({ bridge }))).resolves.toBe('started');

    expect(calls).toHaveLength(1);
    const payload = calls[0].payload;
    expect(payload?.prayer).toBe('dhuhr');
    expect(payload?.name).toBe('prayers.dhuhr');
    expect(payload?.untilText).toContain('today.caption.dueUntil(');
    expect(payload?.leftToPray).toBe('widgets.leftToPray');
    expect(payload?.endAt as number).toBeGreaterThan(payload?.startAt as number);
    expect(payload?.endAt as number).toBeGreaterThan(DHUHR_TIME.getTime());
  });

  it('is quiet on a repeat of the same window', async () => {
    const { bridge, calls } = recordingBridge();
    const base = options({ bridge });
    await syncLiveActivity(base);
    await expect(
      syncLiveActivity({ ...base, now: new Date(DHUHR_TIME.getTime() + 5 * 60 * 1000) })
    ).resolves.toBe('unchanged');
    expect(calls).toHaveLength(1);
  });

  it('re-issues the card when the time format changes mid-window — the text is baked in', async () => {
    const { bridge, calls } = recordingBridge();
    const base = options({ bridge });
    await syncLiveActivity(base);
    await expect(
      syncLiveActivity({ ...base, settings: settings({ timeFormat: '24h' }) })
    ).resolves.toBe('started');
    expect(calls.map((c) => c.kind)).toEqual(['start', 'start']);
  });

  it('ends the card the moment the prayer is marked', async () => {
    const { bridge, calls } = recordingBridge();
    const base = options({ bridge });
    await syncLiveActivity(base);

    const marked = tracking({});
    const day = (calls[0].payload?.day as string) ?? '';
    marked.dayRecordFor = () => ({ statuses: { ...allUnlogged, dhuhr: 'prayed' } });
    await expect(syncLiveActivity({ ...base, tracking: marked })).resolves.toBe('ended');
    expect(day).not.toBe('');
    expect(calls.map((c) => c.kind)).toEqual(['start', 'end']);
  });

  it('never posts a countdown on an exempt day — nothing is owed (D64)', async () => {
    const { bridge, calls } = recordingBridge();
    await expect(syncLiveActivity(options({ bridge, tracking: tracking({}, true) }))).resolves.toBe(
      'ended'
    );
    expect(calls.map((c) => c.kind)).toEqual(['end']);
  });

  it('ends in the sunrise→Dhuhr gap: no window, no card', async () => {
    const { bridge, calls } = recordingBridge();
    await expect(syncLiveActivity(options({ bridge, now: GAP_TIME }))).resolves.toBe('ended');
    expect(calls.map((c) => c.kind)).toEqual(['end']);
  });

  it('ends when the toggle is off — even on the very first reconcile of the process', async () => {
    const { bridge, calls } = recordingBridge();
    const off = options({ bridge, settings: settings({ liveActivityEnabled: false }) });
    await expect(syncLiveActivity(off)).resolves.toBe('ended');
    await expect(syncLiveActivity(off)).resolves.toBe('unchanged');
    expect(calls.map((c) => c.kind)).toEqual(['end']);
  });

  it('names sunrise as Fajr\'s deadline', async () => {
    const { bridge, calls } = recordingBridge();
    // 03:30Z is inside Fajr's window in Amsterdam on this date (Fajr ≈ 03:0xZ, sunrise ≈ 04:40Z).
    await expect(
      syncLiveActivity(options({ bridge, now: new Date('2026-08-25T03:30:00Z') }))
    ).resolves.toBe('started');
    expect(calls[0].payload?.prayer).toBe('fajr');
    expect(calls[0].payload?.untilText).toContain('today.caption.dueUntilSunrise');
  });
});

describe('syncLiveActivity — the linger (D112)', () => {
  it('marks the due card with its face, its retirement instant and its seal target', async () => {
    const { bridge, calls } = recordingBridge();
    await syncLiveActivity(options({ bridge }));

    const payload = calls[0].payload;
    expect(payload?.status).toBe('due');
    expect(payload?.staleAt).toBe((payload?.startAt as number) + 30 * 60 * 1000);
    expect(payload?.markPrayer).toBe('dhuhr');
    expect(payload?.markDay).toBe(payload?.day);
    expect(payload?.prayedLabel).toBe('notifications.actions.prayed');
    expect(payload?.markedText).toContain('notifications.marked.title(');
  });

  it('goes quiet once the linger is spent, even though the window is still open', async () => {
    const { bridge, calls } = recordingBridge();
    // Dhuhr ≈ 11:40Z; forty minutes in is past the default thirty-minute linger, and Asr
    // (≈ 15:25Z) is hours from its lead.
    await expect(
      syncLiveActivity(options({ bridge, now: new Date('2026-08-25T12:20:00Z') }))
    ).resolves.toBe('ended');
    expect(calls.map((c) => c.kind)).toEqual(['end']);
  });

  it('follows the linger setting, not a constant', async () => {
    const { bridge, calls } = recordingBridge();
    await expect(
      syncLiveActivity(
        options({
          bridge,
          now: new Date('2026-08-25T12:20:00Z'),
          settings: settings({ liveActivityLingerMinutes: 60 }),
        })
      )
    ).resolves.toBe('started');
    expect(calls[0].payload?.status).toBe('due');
  });
});

describe('syncLiveActivity — the lead card (D112)', () => {
  /** Twenty minutes before Asr (≈ 15:25Z), with Dhuhr's linger long spent. */
  const BEFORE_ASR = new Date('2026-08-25T15:05:00Z');

  it('appears within the lead of the next prayer while the current one is unprayed', async () => {
    const { bridge, calls } = recordingBridge();
    await expect(syncLiveActivity(options({ bridge, now: BEFORE_ASR }))).resolves.toBe('started');

    const payload = calls[0].payload;
    expect(payload?.status).toBe('upcoming');
    expect(payload?.prayer).toBe('asr');
    expect(payload?.name).toBe('prayers.asr');
    // The countdown ends — and the card flips to Asr's due face — at Asr's own start.
    expect(payload?.staleAt).toBe(payload?.startAt);
    expect(payload?.startAt as number).toBeGreaterThan(BEFORE_ASR.getTime());
    expect(payload?.startsCaption).toContain('widgets.startsAt(');
    expect(payload?.untilStartLabel).toBe('widgets.untilItStarts');
    // Its whole reason: Dhuhr is still open, and the seal marks Dhuhr, not Asr.
    expect(payload?.stillToPray).toBe('widgets.stillToPray(prayers.dhuhr)');
    expect(payload?.markPrayer).toBe('dhuhr');
  });

  it('never appears once the current prayer is marked — the question is answered', async () => {
    const { bridge, calls } = recordingBridge();
    const marked = tracking({});
    marked.dayRecordFor = () => ({ statuses: { ...allUnlogged, dhuhr: 'prayed' } });
    await expect(
      syncLiveActivity(options({ bridge, now: BEFORE_ASR, tracking: marked }))
    ).resolves.toBe('ended');
    expect(calls.map((c) => c.kind)).toEqual(['end']);
  });

  it('follows the lead setting, not a constant', async () => {
    const { bridge, calls } = recordingBridge();
    await expect(
      syncLiveActivity(
        options({
          bridge,
          now: BEFORE_ASR,
          settings: settings({ liveActivityLeadMinutes: 5 }),
        })
      )
    ).resolves.toBe('ended');
    expect(calls.map((c) => c.kind)).toEqual(['end']);
  });

  it('re-issues when the face changes — the face is part of the card\'s identity', async () => {
    const { bridge, calls } = recordingBridge();
    const base = options({ bridge });
    await syncLiveActivity(base);
    await expect(syncLiveActivity({ ...base, now: BEFORE_ASR })).resolves.toBe('started');
    expect(calls.map((c) => c.kind)).toEqual(['start', 'start']);
    expect(calls.map((c) => c.payload?.status)).toEqual(['due', 'upcoming']);
  });
});
