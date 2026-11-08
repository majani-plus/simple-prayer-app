/**
 * Tests for the notification side of the "Prayed" button (D92): the two action categories, which
 * reminders carry one, and what a press must NOT do.
 *
 * It lives apart from `notifications.test.ts` for one reason: everything here depends on
 * `modules/prayer-marks` reporting that the native halves exist, which under Jest they never do.
 * Mocking that module is a file-wide decision, and the rest of the notification suite must keep
 * running against the honest answer — `false` — because that is what a build without the module
 * behaves like, and the button must be absent there rather than present and inert.
 */

import { PRAYERS, type DayTimes, type PrayerDay, type ReminderSettings, type TimeMarker } from '../domain/types';
import {
  createFakeNotificationAdapter,
  createNotificationService,
  foregroundPresentation,
  type FakeNotificationAdapter,
  type SyncInput,
} from './notifications';

let mockSupported = true;

jest.mock('../../modules/prayer-marks', () => {
  const actual = jest.requireActual('../../modules/prayer-marks');
  return { ...actual, isSupported: () => mockSupported };
});

let mockPauseSupported = true;

jest.mock('../../modules/audio-pause', () => {
  const actual = jest.requireActual('../../modules/audio-pause');
  return { ...actual, isSupported: () => mockPauseSupported };
});

/** Midnight before the first planned day, so every prayer of every day is still ahead. */
const NOW = new Date('2026-08-19T00:30:00.000Z');

/** Wall-clock hours of each marker; the same hand-built shape `notifications.test.ts` uses. */
const HOURS: Record<TimeMarker, number> = {
  fajr: 5,
  sunrise: 6,
  dhuhr: 13,
  asr: 16,
  maghrib: 19,
  isha: 21,
  middleOfTheNight: 23,
  lastThirdOfTheNight: 1,
};

function planDays(): DayTimes[] {
  return (['2026-08-19', '2026-08-20'] as PrayerDay[]).map((day) => {
    const times = {} as Record<TimeMarker, Date>;
    for (const [marker, hour] of Object.entries(HOURS) as [TimeMarker, number][]) {
      times[marker] = new Date(`${day}T00:00:00.000Z`);
      times[marker].setUTCMinutes(hour * 60);
    }
    return { day, times, method: 'muslimWorldLeague' };
  });
}

function reminders(): ReminderSettings {
  return Object.fromEntries(
    PRAYERS.map((prayer) => [
      prayer,
      {
        adhanEnabled: true,
        sound: 'system' as const,
        preReminderEnabled: true,
        preReminderMinutes: 15,
        nudgeEnabled: true,
      },
    ])
  ) as ReminderSettings;
}

function syncInput(): SyncInput {
  return {
    now: NOW,
    days: planDays(),
    reminders: reminders(),
    statuses: {},
    exemptDays: new Set<PrayerDay>(),
    locale: 'en',
    sunriseNoteEnabled: true,
  };
}

/** A translate that echoes its key, so assertions can name the key rather than the copy. */
const echo = (key: string): string => key;

function makeService(adapter: FakeNotificationAdapter = createFakeNotificationAdapter()) {
  return {
    adapter,
    service: createNotificationService(adapter, {
      translate: echo,
      formatClock: (date: Date) => date.toISOString().slice(11, 16),
    }),
  };
}

beforeEach(() => {
  mockSupported = true;
  mockPauseSupported = true;
});

describe('the action categories', () => {
  it('registers a Prayed button and an Undo button on every sync', async () => {
    const { service, adapter } = makeService();

    await service.sync(syncInput());

    expect([...adapter.categories.keys()].sort()).toEqual([
      'prayerAdhan',
      'prayerMarkConfirmation',
    ]);
    expect(adapter.categories.get('prayerAdhan')?.actions).toEqual([
      { identifier: 'prayed', title: 'notifications.actions.prayed' },
    ]);
    expect(adapter.categories.get('prayerMarkConfirmation')?.actions).toEqual([
      { identifier: 'undo', title: 'notifications.actions.undo' },
    ]);
  });

  it('offers exactly one action on a reminder — D58: an open window cannot be late or missed', async () => {
    const { service, adapter } = makeService();

    await service.sync(syncInput());

    expect(adapter.categories.get('prayerAdhan')?.actions).toHaveLength(1);
  });

  it('re-registers on every sync, which is how a language change reaches buttons already on screen', async () => {
    const { service, adapter } = makeService();

    await service.sync(syncInput());
    await service.sync(syncInput());

    expect(adapter.calls.ensureCategory).toBe(4);
  });

  it('registers nothing when the build has no native halves to answer a press', async () => {
    mockSupported = false;
    const { service, adapter } = makeService();

    await service.sync(syncInput());

    expect(adapter.categories.size).toBe(0);
    expect(adapter.calls.ensureCategory).toBe(0);
  });

  it('reports a failed registration without abandoning the schedule', async () => {
    const adapter = createFakeNotificationAdapter({
      failing: new Set(['ensureCategory'] as const),
    });
    const { service } = makeService(adapter);

    const outcome = await service.sync(syncInput());

    expect(outcome.failures).toBeGreaterThan(0);
    expect(outcome.scheduled.length).toBeGreaterThan(0);
  });
});

describe('which reminders carry the button', () => {
  it('puts it on the adhan and on nothing else', async () => {
    const { service, adapter } = makeService();

    await service.sync(syncInput());

    const withButton = new Set<string>();
    const without = new Set<string>();
    for (const request of adapter.scheduled.values()) {
      const kind = request.data.kind;
      if (typeof kind !== 'string') continue; // the ongoing swap carries no kind, on purpose
      (request.categoryId === 'prayerAdhan' ? withButton : without).add(kind);
    }

    expect([...withButton]).toEqual(['adhan']);
    // The pre-reminder arrives before the prayer's time, so the button would invite a claim about
    // a prayer that cannot have happened; the last call and the sunrise note are quieter things.
    expect([...without].sort()).toEqual(['expiry', 'nudge', 'preReminder']);
  });

  it('leaves the adhan bare when the build cannot answer a press', async () => {
    mockSupported = false;
    const { service, adapter } = makeService();

    await service.sync(syncInput());

    for (const request of adapter.scheduled.values()) {
      expect(request.categoryId).toBeUndefined();
    }
  });
});

describe('the upgrade path — a held reminder scheduled before the button existed', () => {
  it('rebuilds a held adhan that was scheduled without the button', async () => {
    const { service, adapter } = makeService();

    // First sync: the build the user is upgrading FROM — no native halves, so no category.
    mockSupported = false;
    await service.sync(syncInput());
    for (const request of adapter.scheduled.values()) {
      expect(request.categoryId).toBeUndefined();
    }

    // Second sync: the new build. The adhans must be cancelled and re-scheduled with the button;
    // nothing else about them changed, so without the category check they would sit "unchanged"
    // for the whole plan window, firing button-less.
    mockSupported = true;
    const outcome = await service.sync(syncInput());

    const adhanKeys = [...adapter.scheduled.values()]
      .filter((request) => request.data.kind === 'adhan')
      .map((request) => request.data.key)
      .sort();
    expect(outcome.scheduled.sort()).toEqual(adhanKeys);
    for (const request of adapter.scheduled.values()) {
      if (request.data.kind === 'adhan') {
        expect(request.categoryId).toBe('prayerAdhan');
        expect(request.data.category).toBe('prayerAdhan');
      } else {
        expect(request.categoryId).toBeUndefined();
      }
    }
  });

  it('strips the button when the native halves are gone, rather than leaving one that queues nothing', async () => {
    const { service, adapter } = makeService();

    await service.sync(syncInput());
    mockSupported = false;
    const outcome = await service.sync(syncInput());

    expect(outcome.scheduled.length).toBeGreaterThan(0);
    for (const request of adapter.scheduled.values()) {
      expect(request.categoryId).toBeUndefined();
    }
  });

  it('is a one-time repair: the sync after it schedules nothing', async () => {
    const { service } = makeService();

    mockSupported = false;
    await service.sync(syncInput());
    mockSupported = true;
    await service.sync(syncInput());
    const outcome = await service.sync(syncInput());

    expect(outcome.scheduled).toEqual([]);
    expect(outcome.cancelled).toEqual([]);
  });
});

describe('the test notification is a dress rehearsal (D93)', () => {
  it('carries the Prayed button and the test flag, so a press proves the loop and records nothing', async () => {
    const { service, adapter } = makeService();

    await service.sendTestNotification();

    const test = adapter.presented.get('test');
    expect(test?.categoryId).toBe('prayerAdhan');
    expect(test?.data.test).toBe(true);
    // No prayer on purpose: the native handler's test branch answers before the prayer guard,
    // and a test payload naming a real prayer would be one bug away from marking it.
    expect(test?.data.prayer).toBeUndefined();
  });

  it('stays bare when the build cannot answer a press', async () => {
    mockSupported = false;
    const { service, adapter } = makeService();

    await service.sendTestNotification();

    expect(adapter.presented.get('test')?.categoryId).toBeUndefined();
  });
});

describe('the ongoing notification carries the button while a prayer is due (D95)', () => {
  /** Half past one on the first planned day: Dhuhr (13:00) is in, Asr (16:00) has not begun. */
  const DUE_NOW = new Date('2026-08-19T13:30:00.000Z');

  /** Echoes the key and any prayer param, so the after-content's subject is assertable. */
  const echoWithPrayer = (key: string, params?: Record<string, unknown>): string =>
    typeof params?.prayer === 'string' ? `${key}[${params.prayer}]` : key;

  function androidService() {
    const adapter = createFakeNotificationAdapter({ platform: 'android' });
    return {
      adapter,
      service: createNotificationService(adapter, {
        translate: echoWithPrayer,
        formatClock: (date: Date) => date.toISOString().slice(11, 16),
      }),
    };
  }

  it('presents it with Prayed, the due prayer, and the pre-baked after-content', async () => {
    const { service, adapter } = androidService();

    await service.sync({ ...syncInput(), now: DUE_NOW, persistentNotification: true });

    const ongoing = adapter.presented.get('ongoing');
    expect(ongoing?.categoryId).toBe('prayerAdhan');
    expect(ongoing?.data.ongoing).toBe(true);
    expect(ongoing?.data.prayer).toBe('dhuhr');
    expect(ongoing?.data.day).toBe('2026-08-19');
    expect(ongoing?.data.channelId).toBe(ongoing?.channelId);
    // The swap content is the *upcoming* phase as if Dhuhr were already marked — it names Asr,
    // because that is exactly what the app itself would draw on its next foreground.
    expect(ongoing?.data.afterTitle).toBe('notifications.ongoing.title[prayers.asr]');
    expect(typeof ongoing?.data.afterBody).toBe('string');
  });

  it('is plain furniture while no prayer is due', async () => {
    const { service, adapter } = androidService();

    // Midnight before the first day: everything is upcoming, nothing can be marked yet.
    await service.sync({ ...syncInput(), persistentNotification: true });

    const ongoing = adapter.presented.get('ongoing');
    expect(ongoing).toBeDefined();
    expect(ongoing?.categoryId).toBeUndefined();
    expect(ongoing?.data.ongoing).toBeUndefined();
  });

  it('is plain furniture when the build cannot answer a press', async () => {
    mockSupported = false;
    const { service, adapter } = androidService();

    await service.sync({ ...syncInput(), now: DUE_NOW, persistentNotification: true });

    const ongoing = adapter.presented.get('ongoing');
    expect(ongoing).toBeDefined();
    expect(ongoing?.categoryId).toBeUndefined();
    expect(ongoing?.data.ongoing).toBeUndefined();
  });
});

describe('the ongoing notification advances with the app asleep (D95 extended)', () => {
  /** Half past one on the first planned day: Dhuhr (13:00) is in, Asr (16:00) has not begun. */
  const DUE_NOW = new Date('2026-08-19T13:30:00.000Z');

  const echoWithPrayer = (key: string, params?: Record<string, unknown>): string =>
    typeof params?.prayer === 'string' ? `${key}[${params.prayer}]` : key;

  function androidService() {
    const adapter = createFakeNotificationAdapter({ platform: 'android' });
    return {
      adapter,
      service: createNotificationService(adapter, {
        translate: echoWithPrayer,
        formatClock: (date: Date) => date.toISOString().slice(11, 16),
      }),
    };
  }

  it('pre-schedules the next redraw: the OS swaps to the NEXT due prayer, button included', async () => {
    const { service, adapter } = androidService();

    await service.sync({ ...syncInput(), now: DUE_NOW, persistentNotification: true });

    // Dhuhr's window shuts when Asr begins (16:00); the swap fires a beat past it and shows
    // Asr's own due phase — with the button, because at that instant Asr can be marked.
    const swap = adapter.scheduled.get('ongoing');
    expect(swap).toBeDefined();
    expect(swap?.fireAt.toISOString()).toBe('2026-08-19T16:00:01.000Z');
    expect(swap?.title).toBe('notifications.ongoing.titleNow[prayers.asr]');
    expect(swap?.categoryId).toBe('prayerAdhan');
    expect(swap?.ongoing).toBe(true);
    expect(swap?.sound).toBeNull();
    expect(swap?.data.prayer).toBe('asr');
  });

  it('the swap payload is invisible to the diff-sync, so reminders never fight over it', async () => {
    const { service, adapter } = androidService();

    await service.sync({ ...syncInput(), now: DUE_NOW, persistentNotification: true });
    const swap = adapter.scheduled.get('ongoing');
    expect(swap).toBeDefined();
    // No `kind` means parsePayload rejects it — the property the whole design rests on.
    expect(swap?.data.kind).toBeUndefined();

    // A steady-state sync neither cancels it as unwanted nor counts it as a reminder.
    const outcome = await service.sync({ ...syncInput(), now: DUE_NOW, persistentNotification: true });
    expect(outcome.cancelled).toEqual([]);
    expect(adapter.scheduled.get('ongoing')).toBeDefined();
  });

  it('an upcoming prayer swaps into its own due phase at its start', async () => {
    const { service, adapter } = androidService();

    // Midnight: Fajr (05:00) is upcoming; the notification has no button yet — but the moment
    // Fajr comes in, the swap gives it one without the app waking. The owner's missing button.
    await service.sync({ ...syncInput(), persistentNotification: true });

    expect(adapter.presented.get('ongoing')?.categoryId).toBeUndefined();
    const swap = adapter.scheduled.get('ongoing');
    expect(swap?.fireAt.toISOString()).toBe('2026-08-19T05:00:01.000Z');
    expect(swap?.title).toBe('notifications.ongoing.titleNow[prayers.fajr]');
    expect(swap?.categoryId).toBe('prayerAdhan');
    expect(swap?.data.prayer).toBe('fajr');
  });

  it('turning the setting off takes the pending swap down with the notification', async () => {
    const { service, adapter } = androidService();

    await service.sync({ ...syncInput(), now: DUE_NOW, persistentNotification: true });
    expect(adapter.scheduled.get('ongoing')).toBeDefined();

    await service.sync({ ...syncInput(), now: DUE_NOW });

    expect(adapter.scheduled.get('ongoing')).toBeUndefined();
    expect(adapter.presented.has('ongoing')).toBe(false);
  });

  it('schedules no button on a build that cannot answer a press', async () => {
    mockSupported = false;
    const { service, adapter } = androidService();

    await service.sync({ ...syncInput(), now: DUE_NOW, persistentNotification: true });

    const swap = adapter.scheduled.get('ongoing');
    expect(swap).toBeDefined();
    expect(swap?.categoryId).toBeUndefined();
  });
});

describe('pause what is playing (D96)', () => {
  it('marks every adhan request, and nothing else, when the setting is on', async () => {
    const { service, adapter } = makeService();

    await service.sync({ ...syncInput(), pauseAudioAtAdhan: true });

    for (const request of adapter.scheduled.values()) {
      if (request.data.kind === 'adhan') {
        expect(request.data.pauseAudio).toBe(true);
      } else {
        expect(request.data.pauseAudio).toBeUndefined();
      }
    }
  });

  it('reaches reminders the OS is already holding when the setting flips', async () => {
    const { service, adapter } = makeService();

    await service.sync(syncInput());
    const outcome = await service.sync({ ...syncInput(), pauseAudioAtAdhan: true });

    // Only the adhans changed, and every one of them was rebuilt.
    const adhanKeys = [...adapter.scheduled.values()]
      .filter((request) => request.data.kind === 'adhan')
      .map((request) => request.data.key)
      .sort();
    expect(outcome.scheduled.sort()).toEqual(adhanKeys);

    // And back off again: one more rebuild, then steady state.
    const off = await service.sync(syncInput());
    expect(off.scheduled.sort()).toEqual(adhanKeys);
    expect((await service.sync(syncInput())).scheduled).toEqual([]);
  });

  it('never marks anything on a build without the native module', async () => {
    mockPauseSupported = false;
    const { service, adapter } = makeService();

    await service.sync({ ...syncInput(), pauseAudioAtAdhan: true });

    for (const request of adapter.scheduled.values()) {
      expect(request.data.pauseAudio).toBeUndefined();
    }
  });
});

describe('a press is not a tap', () => {
  it('leaves the adhan behaving like every other notification in the foreground', () => {
    // The category changes what the notification offers, never how it arrives.
    expect(
      foregroundPresentation({ identifier: 'x', data: { kind: 'adhan', sound: 'system' } })
    ).toMatchObject({ shouldShowBanner: true, shouldPlaySound: true });
  });
});
