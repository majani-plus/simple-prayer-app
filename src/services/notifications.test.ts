/**
 * The notification service's contract, exercised against the in-memory adapter.
 *
 * What these tests are really guarding is the promise in PRODUCT_SPEC §11 and the reason it
 * exists (our market research): reminders that survive. Three properties matter more than any
 * individual assertion, and each has its own describe block:
 *
 * 1. **Minimal work.** A sync schedules only what is missing and cancels only what is stale.
 *    Never "cancel everything, then reschedule" — the window between those two is exactly how
 *    the competition loses notifications.
 * 2. **Idempotence.** Running sync twice with the same world makes zero platform calls the
 *    second time, which is what makes it safe on every foreground, every log and every setting.
 * 3. **Degradation.** No permission, no platform, a failing OS call: all of them return a
 *    result, never an exception.
 *
 * Everything is driven through `createFakeNotificationAdapter`, which also enforces the Android
 * rule that a channel's sound is immutable after creation — so no test here can "prove" a
 * behaviour the real platform would refuse.
 */

import {
  CHANNEL_VERSION,
  ONGOING_NOTIFICATION_ID,
  TEST_NOTIFICATION_ID,
  TODAY_ROUTE,
  buildContent,
  channelIdFor,
  channelSpecFor,
  createExpoNotificationAdapter,
  createFakeNotificationAdapter,
  createNotificationService,
  describeDelivery,
  foregroundPresentation,
  isStale,
  isStaleAdhanChannel,
  parsePayload,
  type FakeNotificationAdapter,
  type NotificationDelivery,
  type NotificationService,
  type SyncInput,
} from './notifications';
import { DEFAULT_ADHAN_VOICE, adhanSoundFile } from '../domain/adhanVoices';
import {
  DEFAULT_MAX_NOTIFICATIONS,
  IOS_NOTIFICATION_LIMIT,
  notificationKey,
} from '../domain/notificationPlan';
import { PRAYERS } from '../domain/types';

import type {
  DayTimes,
  Prayer,
  PrayerDay,
  PrayerReminderSettings,
  ReminderSettings,
  TimeMarker,
} from '../domain/types';

/**
 * Stands in for the real library so the bottom block of this file can read the object the adapter
 * hands it. Only the calls that block makes are implemented; everything above drives the in-memory
 * adapter and never reaches `expo-notifications` at all.
 */
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(async () => 'scheduled'),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The adhan file the default voice resolves to on Android — which is the platform the fake adapter
 * reports unless a test says otherwise. Derived rather than written out, so re-encoding a
 * recitation cannot leave this file asserting a filename the app no longer ships.
 */
const ADHAN_SOUND_FILE = adhanSoundFile(DEFAULT_ADHAN_VOICE, 'android');

/** Wall-clock hours of each marker, kept simple so expected instants can be read at a glance. */
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

/**
 * A day of times built from {@link HOURS}, shifted by `shiftMinutes` — the knob that simulates
 * "the user moved city" without pulling adhan into a service test.
 */
function dayTimes(day: PrayerDay, shiftMinutes = 0): DayTimes {
  const times = {} as Record<TimeMarker, Date>;
  for (const [marker, hour] of Object.entries(HOURS) as [TimeMarker, number][]) {
    times[marker] = new Date(`${day}T00:00:00.000Z`);
    times[marker].setUTCMinutes(hour * 60 + shiftMinutes);
  }
  return { day, times, method: 'muslimWorldLeague' };
}

const DAYS = ['2026-08-19', '2026-08-20', '2026-08-21'] as const;

function planDays(shiftMinutes = 0): DayTimes[] {
  return DAYS.map((day) => dayTimes(day, shiftMinutes));
}

const DEFAULT_PRAYER_REMINDER: PrayerReminderSettings = {
  adhanEnabled: true,
  sound: 'system',
  preReminderEnabled: false,
  preReminderMinutes: 15,
  nudgeEnabled: true,
};

function reminders(patch: Partial<PrayerReminderSettings> = {}): ReminderSettings {
  return Object.fromEntries(
    PRAYERS.map((prayer) => [prayer, { ...DEFAULT_PRAYER_REMINDER, ...patch }])
  ) as ReminderSettings;
}

/** Midnight before the first planned day, so every prayer of every day is still ahead. */
const NOW = new Date('2026-08-19T00:30:00.000Z');

function syncInput(patch: Partial<SyncInput> = {}): SyncInput {
  return {
    now: NOW,
    days: planDays(),
    reminders: reminders(),
    statuses: {},
    exemptDays: new Set<PrayerDay>(),
    locale: 'en',
    // On here, off in the app: the setting ships off (D90), but almost everything this suite
    // asserts about the sunrise note is about *delivering* it, so the fixture asks for it. The
    // gate itself is exercised in `domain/notificationPlan.test.ts` and once below.
    sunriseNoteEnabled: true,
    ...patch,
  };
}

/** A translate that echoes its key, so assertions can name the key rather than the copy. */
const echo = (key: string, params?: Record<string, unknown>): string =>
  params === undefined ? key : `${key}(${JSON.stringify(params)})`;

function makeService(
  adapter: FakeNotificationAdapter = createFakeNotificationAdapter()
): { service: NotificationService; adapter: FakeNotificationAdapter } {
  return {
    adapter,
    service: createNotificationService(adapter, {
      translate: echo,
      formatClock: (date) => date.toISOString().slice(11, 16),
    }),
  };
}

/** Keys the fake OS is currently holding, sorted. */
function heldKeys(adapter: FakeNotificationAdapter): string[] {
  return [...adapter.scheduled.keys()].sort();
}

// ---------------------------------------------------------------------------

describe('the fixture itself', () => {
  it('produces consecutive days with ascending prayer times', () => {
    const [first, second] = planDays();
    expect(first.day).toBe('2026-08-19');
    expect(second.day).toBe('2026-08-20');
    expect(first.times.fajr.getTime()).toBeLessThan(first.times.dhuhr.getTime());
    expect(first.times.isha.getTime()).toBeLessThan(second.times.fajr.getTime());
  });
});

describe('a first sync', () => {
  it('hands the whole plan to the OS', async () => {
    const { service, adapter } = makeService();

    const outcome = await service.sync(syncInput());

    expect(outcome.status).toBe('applied');
    expect(outcome.planned).toBe(outcome.scheduled.length);
    expect(outcome.cancelled).toEqual([]);
    // 3 days × (5 prayers × (adhan + nudge) + Fajr's expiry); pre-reminders are off in the
    // default fixture.
    expect(outcome.scheduled).toHaveLength(33);
    expect(heldKeys(adapter)).toHaveLength(33);
    expect(adapter.calls.cancel).toBe(0);
  });

  it('gives every request the key as its identifier, and its own fireAt in the payload', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const key = notificationKey('adhan', DAYS[0], 'dhuhr');
    const request = adapter.scheduled.get(key);
    expect(request).toBeDefined();
    expect(request?.identifier).toBe(key);
    expect(request?.data.key).toBe(key);
    expect(request?.data.fireAt).toBe(request?.fireAt.getTime());
    expect(request?.data.url).toBe(TODAY_ROUTE);
    expect(request?.fireAt.toISOString()).toBe('2026-08-19T13:00:00.000Z');
  });

  it('schedules nothing at or before now', async () => {
    const { service, adapter } = makeService();
    // Half past Dhuhr on the first day: Fajr and Dhuhr are behind us.
    await service.sync(syncInput({ now: new Date('2026-08-19T13:30:00.000Z') }));

    expect(heldKeys(adapter)).not.toContain(notificationKey('adhan', DAYS[0], 'fajr'));
    expect(heldKeys(adapter)).not.toContain(notificationKey('adhan', DAYS[0], 'dhuhr'));
    expect(heldKeys(adapter)).toContain(notificationKey('adhan', DAYS[0], 'asr'));
  });
});

describe('the diff', () => {
  it('is a no-op when nothing changed', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());
    const after = { ...adapter.calls };

    const outcome = await service.sync(syncInput());

    expect(outcome.scheduled).toEqual([]);
    expect(outcome.cancelled).toEqual([]);
    expect(outcome.unchanged).toHaveLength(33);
    expect(adapter.calls.schedule).toBe(after.schedule);
    expect(adapter.calls.cancel).toBe(0);
  });

  it('stays idempotent over many calls', async () => {
    const { service, adapter } = makeService();
    for (let round = 0; round < 5; round += 1) await service.sync(syncInput());

    expect(adapter.calls.schedule).toBe(33);
    expect(adapter.calls.cancel).toBe(0);
    expect(heldKeys(adapter)).toHaveLength(33);
  });

  it('schedules only what is missing', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());
    // The OS "lost" one notification, as an OEM task-killer or a reboot would.
    adapter.scheduled.delete(notificationKey('adhan', DAYS[1], 'asr'));
    adapter.calls.schedule = 0;

    const outcome = await service.sync(syncInput());

    expect(outcome.scheduled).toEqual([notificationKey('adhan', DAYS[1], 'asr')]);
    expect(outcome.cancelled).toEqual([]);
    expect(adapter.calls.schedule).toBe(1);
  });

  it('cancels only what is stale', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());
    // A leftover from a previous plan (yesterday's day, still held by the OS).
    const stale = notificationKey('adhan', '2026-08-18', 'isha');
    adapter.scheduled.set(stale, {
      identifier: stale,
      title: 'x',
      body: 'x',
      sound: null,
      fireAt: new Date('2026-08-18T21:00:00.000Z'),
      data: {
        key: stale,
        kind: 'adhan',
        prayer: 'isha',
        day: '2026-08-18',
        fireAt: new Date('2026-08-18T21:00:00.000Z').getTime(),
        sound: 'system',
        voice: DEFAULT_ADHAN_VOICE,
        lang: 'en',
        url: TODAY_ROUTE,
      },
    });

    const outcome = await service.sync(syncInput());

    expect(outcome.cancelled).toEqual([stale]);
    expect(outcome.scheduled).toEqual([]);
    expect(adapter.calls.cancel).toBe(1);
  });

  it('never cancels a notification it is about to reschedule unchanged', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    // Turning one prayer's adhan off must not disturb the other twenty-nine.
    const patched = reminders();
    patched.maghrib = { ...patched.maghrib, adhanEnabled: false };
    const outcome = await service.sync(syncInput({ reminders: patched }));

    expect(outcome.cancelled.sort()).toEqual(
      DAYS.map((day) => notificationKey('adhan', day, 'maghrib')).sort()
    );
    expect(outcome.scheduled).toEqual([]);
    expect(heldKeys(adapter)).toHaveLength(30);
  });
});

describe('a settings change', () => {
  it('schedules the pre-reminders it just enabled, and nothing else', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());
    adapter.calls.cancel = 0;

    const outcome = await service.sync(
      syncInput({ reminders: reminders({ preReminderEnabled: true, preReminderMinutes: 20 }) })
    );

    expect(outcome.scheduled).toHaveLength(15);
    expect(outcome.scheduled.every((key) => key.startsWith('preReminder:'))).toBe(true);
    expect(outcome.cancelled).toEqual([]);
    expect(adapter.calls.cancel).toBe(0);
    const fajrPre = adapter.scheduled.get(notificationKey('preReminder', DAYS[0], 'fajr'));
    expect(fajrPre?.fireAt.toISOString()).toBe('2026-08-19T04:40:00.000Z');
  });

  it('rewrites a notification whose sound changed, key and time unchanged', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const outcome = await service.sync(syncInput({ reminders: reminders({ sound: 'adhan' }) }));

    const adhanKeys = DAYS.flatMap((day) =>
      PRAYERS.map((prayer) => notificationKey('adhan', day, prayer))
    ).sort();
    expect(outcome.cancelled.sort()).toEqual(adhanKeys);
    expect(outcome.scheduled.sort()).toEqual(adhanKeys);
    expect(adapter.scheduled.get(adhanKeys[0])?.sound).toBe(ADHAN_SOUND_FILE);
    // The nudges keep the ancillary sound and are left alone entirely.
    expect(outcome.cancelled.some((key) => key.startsWith('nudge:'))).toBe(false);
  });

  it('rewrites everything when the app language changes', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const outcome = await service.sync(syncInput({ locale: 'ar' }));

    expect(outcome.cancelled).toHaveLength(33);
    expect(outcome.scheduled).toHaveLength(33);
    expect(adapter.scheduled.get(notificationKey('adhan', DAYS[0], 'asr'))?.data.lang).toBe('ar');
  });

  it('turns everything off when every reminder is disabled', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const silenced = reminders({ adhanEnabled: false, nudgeEnabled: false });
    const outcome = await service.sync(syncInput({ reminders: silenced }));

    // 30 of the 33: the three sunrise notes are not per-prayer reminders and no per-prayer switch
    // can reach them (D90), so they survive until their own setting is turned off.
    expect(outcome.cancelled).toHaveLength(30);
    expect(heldKeys(adapter)).toEqual(
      DAYS.map((day) => notificationKey('expiry', day, 'fajr'))
    );

    const andTheNote = await service.sync(
      syncInput({ reminders: silenced, sunriseNoteEnabled: false })
    );
    expect(andTheNote.cancelled).toHaveLength(3);
    expect(heldKeys(adapter)).toEqual([]);
  });
});

describe('a location change (the times move under a stable key)', () => {
  it('cancels and reschedules each moved notification, cancel first', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const order: string[] = [];
    const realCancel = adapter.cancel.bind(adapter);
    const realSchedule = adapter.schedule.bind(adapter);
    adapter.cancel = async (identifier) => {
      order.push(`cancel:${identifier}`);
      await realCancel(identifier);
    };
    adapter.schedule = async (request) => {
      order.push(`schedule:${request.identifier}`);
      await realSchedule(request);
    };

    const outcome = await service.sync(syncInput({ days: planDays(37) }));

    expect(outcome.cancelled).toHaveLength(33);
    expect(outcome.scheduled).toHaveLength(33);
    expect(heldKeys(adapter)).toHaveLength(33);
    expect(adapter.scheduled.get(notificationKey('adhan', DAYS[0], 'fajr'))?.fireAt.toISOString())
      .toBe('2026-08-19T05:37:00.000Z');
    // Every cancel precedes every schedule: the identifier is reused, and "replace" is not a
    // behaviour either platform documents.
    expect(order.filter((entry) => entry.startsWith('cancel:'))).toHaveLength(33);
    expect(order.findIndex((entry) => entry.startsWith('schedule:'))).toBe(33);
  });

  it('ignores a sub-second difference', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const nudged = planDays().map((day) => ({
      ...day,
      times: Object.fromEntries(
        Object.entries(day.times).map(([marker, at]) => [marker, new Date(at.getTime() + 400)])
      ) as Record<TimeMarker, Date>,
    }));
    const outcome = await service.sync(syncInput({ days: nudged }));

    expect(outcome.scheduled).toEqual([]);
    expect(outcome.cancelled).toEqual([]);
    expect(adapter.calls.cancel).toBe(0);
  });
});

describe('logging a prayer', () => {
  it('cancels exactly that nudge and nothing else', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const cancelled = await service.clearForPrayer(DAYS[0], 'asr');

    expect(cancelled).toBe(true);
    expect(adapter.scheduled.has(notificationKey('nudge', DAYS[0], 'asr'))).toBe(false);
    expect(adapter.scheduled.has(notificationKey('adhan', DAYS[0], 'asr'))).toBe(true);
    expect(adapter.scheduled.has(notificationKey('nudge', DAYS[1], 'asr'))).toBe(true);
    expect(heldKeys(adapter)).toHaveLength(32);
  });

  it('keeps the nudge cancelled on the next sync, and only that one', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());
    await service.clearForPrayer(DAYS[0], 'asr');
    adapter.calls.cancel = 0;

    const outcome = await service.sync(
      syncInput({ statuses: { [DAYS[0]]: { asr: 'prayed' } } })
    );

    expect(outcome.scheduled).toEqual([]);
    expect(outcome.cancelled).toEqual([]);
    expect(heldKeys(adapter)).toHaveLength(32);
  });

  it('cancels the nudge on sync even when the immediate cancel never ran', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const outcome = await service.sync(
      syncInput({ statuses: { [DAYS[0]]: { maghrib: 'late' } } })
    );

    expect(outcome.cancelled).toEqual([notificationKey('nudge', DAYS[0], 'maghrib')]);
    expect(adapter.scheduled.has(notificationKey('adhan', DAYS[0], 'maghrib'))).toBe(true);
  });

  it('leaves the adhan reminder alone for every status', async () => {
    for (const status of ['prayed', 'late', 'missed'] as const) {
      const { service, adapter } = makeService();
      await service.sync(syncInput());
      await service.sync(syncInput({ statuses: { [DAYS[0]]: { fajr: status } } }));
      expect(adapter.scheduled.has(notificationKey('adhan', DAYS[0], 'fajr'))).toBe(true);
      expect(adapter.scheduled.has(notificationKey('nudge', DAYS[0], 'fajr'))).toBe(false);
    }
  });

  /**
   * The commonest logging moment there is: the adhan buzzes, you pray, you mark it — a minute
   * later. Three separate things have to be true at once, and each of them is a bug someone has
   * shipped: the nudge must be gone, the adhan that ALREADY FIRED must not be handed back to the
   * OS (it would arrive a second time, out of nowhere), and no other prayer may be touched.
   */
  it('a minute after Maghrib: nudge gone, fired adhan not revived, nobody else touched', async () => {
    const { service, adapter } = makeService();
    // Maghrib is 19:00 in the fixture; sync while it is still ahead.
    const before = new Date('2026-08-19T18:00:00.000Z');
    await service.sync(syncInput({ now: before }));
    expect(adapter.scheduled.has(notificationKey('adhan', DAYS[0], 'maghrib'))).toBe(true);

    // 19:00: the OS delivers the Maghrib adhan and drops it from the pending list, as both
    // platforms do. The fake does not fire on its own, so the delivery is modelled here.
    adapter.scheduled.delete(notificationKey('adhan', DAYS[0], 'maghrib'));

    // 19:01: the user marks Maghrib. The fast path runs first (see `useNotificationSync`).
    const after = new Date('2026-08-19T19:01:00.000Z');
    await service.clearForPrayer(DAYS[0], 'maghrib');
    const untouched = [
      notificationKey('adhan', DAYS[0], 'isha'),
      notificationKey('nudge', DAYS[0], 'isha'),
      notificationKey('adhan', DAYS[1], 'maghrib'),
      notificationKey('nudge', DAYS[1], 'maghrib'),
    ];
    const beforeSync = untouched.map((key) => adapter.scheduled.get(key)?.fireAt.getTime());

    const outcome = await service.sync(
      syncInput({ now: after, statuses: { [DAYS[0]]: { maghrib: 'prayed' } } })
    );

    expect(adapter.scheduled.has(notificationKey('nudge', DAYS[0], 'maghrib'))).toBe(false);
    // The whole point: a notification whose instant has passed is never in the plan, so a sync
    // triggered by the log cannot resurrect the adhan the user just heard.
    expect(adapter.scheduled.has(notificationKey('adhan', DAYS[0], 'maghrib'))).toBe(false);
    expect(outcome.scheduled).not.toContain(notificationKey('adhan', DAYS[0], 'maghrib'));
    expect(outcome.cancelled).not.toContain(notificationKey('adhan', DAYS[0], 'maghrib'));

    // Everything still ahead is byte-for-byte where it was: no cancel, no reschedule, same instant.
    expect(untouched.map((key) => adapter.scheduled.get(key)?.fireAt.getTime())).toEqual(beforeSync);
    for (const key of untouched) {
      expect(outcome.scheduled).not.toContain(key);
      expect(outcome.cancelled).not.toContain(key);
    }
  });
});

describe('an exempt day', () => {
  it('schedules nothing at all on it (PRODUCT_SPEC §6)', async () => {
    const { service, adapter } = makeService();

    await service.sync(syncInput({ exemptDays: new Set([DAYS[1]]) }));

    expect(heldKeys(adapter).some((key) => key.includes(DAYS[1]))).toBe(false);
    expect(heldKeys(adapter)).toHaveLength(22);
  });

  it('takes down what was already scheduled when the day becomes exempt', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const outcome = await service.sync(syncInput({ exemptDays: new Set([DAYS[0]]) }));

    expect(outcome.cancelled).toHaveLength(11);
    expect(outcome.cancelled.every((key) => key.includes(DAYS[0]))).toBe(true);
    expect(heldKeys(adapter).some((key) => key.includes(DAYS[0]))).toBe(false);
  });
});

describe('the cap', () => {
  it('never hands the OS more than maxCount, keeping the earliest', async () => {
    const { service, adapter } = makeService();

    const outcome = await service.sync(
      syncInput({
        reminders: reminders({ preReminderEnabled: true }),
        maxCount: 7,
      })
    );

    expect(outcome.planned).toBe(7);
    expect(heldKeys(adapter)).toHaveLength(7);
    const fireTimes = [...adapter.scheduled.values()].map((request) => request.fireAt.getTime());
    expect(Math.max(...fireTimes)).toBeLessThan(new Date('2026-08-19T16:00:00.000Z').getTime());
  });

  it('defaults to a cap that leaves headroom under the iOS limit', async () => {
    const { service, adapter } = makeService();

    // Five days × five prayers × three kinds is 75 requests — more than the plan will allow.
    const days = ['2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'].map(
      (day) => dayTimes(day)
    );
    const outcome = await service.sync(
      syncInput({ days, reminders: reminders({ preReminderEnabled: true }) })
    );

    expect(outcome.planned).toBe(60);
    expect(heldKeys(adapter)).toHaveLength(60);
  });

  it.each([1, 3, 5, 8, 14])(
    'stays under the iOS limit with %i days of every prayer and every kind',
    async (dayCount) => {
      const { service, adapter } = makeService();
      const days = Array.from({ length: dayCount }, (_unused, index) => {
        const at = new Date(`2026-08-19T00:00:00.000Z`);
        at.setUTCDate(at.getUTCDate() + index);
        return dayTimes(at.toISOString().slice(0, 10));
      });

      // The maximal configuration a user can reach through the Reminders screen: all five prayers,
      // adhan + pre-reminder + nudge, nothing logged, nothing exempt. `maxCount` is deliberately
      // NOT passed — this is the value the app itself uses, and 64 is the number iOS enforces by
      // silently discarding whatever it likes.
      const outcome = await service.sync(
        syncInput({ days, reminders: reminders({ preReminderEnabled: true }) })
      );

      expect(outcome.planned).toBeLessThan(IOS_NOTIFICATION_LIMIT);
      expect(adapter.scheduled.size).toBeLessThan(IOS_NOTIFICATION_LIMIT);
      // The four free slots are what the test notification and the ongoing one live in.
      expect(adapter.scheduled.size).toBeLessThanOrEqual(DEFAULT_MAX_NOTIFICATIONS);
    }
  );
});

describe('permissions', () => {
  it('degrades without throwing when permission is denied', async () => {
    const adapter = createFakeNotificationAdapter({
      permission: { status: 'denied', granted: false, canAskAgain: false },
    });
    const { service } = makeService(adapter);

    const outcome = await service.sync(syncInput());

    expect(outcome.status).toBe('permissionDenied');
    expect(outcome.scheduled).toEqual([]);
    expect(outcome.cancelled).toEqual([]);
    expect(adapter.calls.schedule).toBe(0);
    expect(adapter.calls.getScheduled).toBe(0);
  });

  it('leaves an existing schedule alone when permission is revoked', async () => {
    const adapter = createFakeNotificationAdapter();
    const { service } = makeService(adapter);
    await service.sync(syncInput());

    adapter.config.permission = { status: 'denied', granted: false, canAskAgain: false };
    await service.sync(syncInput());

    expect(heldKeys(adapter)).toHaveLength(33);
  });

  it('creates a channel before prompting, so Android 13+ shows the dialog', async () => {
    const adapter = createFakeNotificationAdapter({
      permission: { status: 'undetermined', granted: false, canAskAgain: true },
      permissionAfterRequest: { status: 'granted', granted: true, canAskAgain: false },
    });
    const { service } = makeService(adapter);

    const permission = await service.requestPermission();

    expect(permission.granted).toBe(true);
    expect(adapter.channels.size).toBeGreaterThan(0);
    expect(adapter.calls.ensureChannel).toBeGreaterThan(0);
  });

  it('never prompts from getPermission', async () => {
    const { service, adapter } = makeService();
    await service.getPermission();
    expect(adapter.calls.requestPermission).toBe(0);
  });

  it('survives an adapter that throws on every call', async () => {
    const adapter = createFakeNotificationAdapter({
      failing: new Set(['getPermission', 'requestPermission'] as const),
    });
    const { service } = makeService(adapter);

    // The unknown answer says nothing about delivery either — every field null, so nothing
    // downstream can report a problem it never learned about.
    const unknown = {
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
      delivery: { soundEnabled: null, alertsEnabled: null, interruptionFilter: null },
    };
    await expect(service.getPermission()).resolves.toEqual(unknown);
    await expect(service.requestPermission()).resolves.toEqual(unknown);
  });
});

// ---------------------------------------------------------------------------
// What the OS says it will actually do
// ---------------------------------------------------------------------------

describe('describeDelivery', () => {
  const granted = (delivery: Partial<NotificationDelivery> = {}) => ({
    status: 'granted' as const,
    granted: true,
    canAskAgain: true,
    delivery: {
      soundEnabled: null,
      alertsEnabled: null,
      interruptionFilter: null,
      ...delivery,
    },
  });

  it('says nothing at all when the OS told us nothing', () => {
    expect(describeDelivery(granted())).toBeNull();
    expect(describeDelivery(null)).toBeNull();
  });

  it('never speaks for a permission that was not granted — that card says it already', () => {
    expect(
      describeDelivery({
        status: 'denied',
        granted: false,
        canAskAgain: false,
        delivery: { soundEnabled: false, alertsEnabled: false, interruptionFilter: 'none' },
      })
    ).toBeNull();
  });

  it('reports sound being off for the app', () => {
    expect(describeDelivery(granted({ soundEnabled: false }))).toBe('soundOff');
    expect(describeDelivery(granted({ soundEnabled: true }))).toBeNull();
  });

  it('puts alerts being off first, because nothing appears at all', () => {
    expect(describeDelivery(granted({ alertsEnabled: false, soundEnabled: false }))).toBe(
      'alertsOff'
    );
  });

  it('reports Do Not Disturb, and only while it is filtering something', () => {
    expect(describeDelivery(granted({ interruptionFilter: 'all' }))).toBeNull();
    for (const filter of ['priority', 'none', 'alarms'] as const) {
      expect(describeDelivery(granted({ interruptionFilter: filter }))).toBe('dndOn');
    }
  });

  it('lets the Android channel outrank the app-level answer, which cannot see it', () => {
    const permission = granted({ soundEnabled: true });
    expect(describeDelivery(permission, { importance: 'high', sound: 'default' })).toBeNull();
    // The user dropped the channel to silent in the system settings.
    expect(describeDelivery(permission, { importance: 'low', sound: 'default' })).toBe('soundOff');
    // Or cleared its sound while leaving the importance alone.
    expect(describeDelivery(permission, { importance: 'high', sound: null })).toBe('soundOff');
  });

  it('treats an unreadable channel as unknown rather than as a problem', () => {
    expect(describeDelivery(granted({ soundEnabled: true }), null)).toBeNull();
    expect(describeDelivery(granted(), undefined)).toBeNull();
  });
});

describe('checkDelivery', () => {
  it('inspects the channel the test notification will actually use', async () => {
    const adapter = createFakeNotificationAdapter();
    const { service } = makeService(adapter);
    await service.sync(syncInput({ reminders: reminders({ sound: 'adhan' }) }));

    // Android's own settings UI silences the channel, so that is what has to be read back.
    const channel = adapter.channels.get(channelIdFor('adhan', 'adhan'));
    expect(channel).toBeDefined();
    adapter.channels.set(channelIdFor('adhan', 'adhan'), { ...channel!, importance: 'low' });

    expect(await service.checkDelivery({ sound: 'adhan' })).toBe('soundOff');
    // A different sound is a different channel, and that one is untouched.
    expect(await service.checkDelivery({ sound: 'system' })).toBeNull();
  });

  it('degrades to silence when the platform refuses to answer', async () => {
    const adapter = createFakeNotificationAdapter({
      failing: new Set(['getChannel'] as const),
    });
    const { service } = makeService(adapter);

    expect(await service.checkDelivery()).toBeNull();
  });
});

describe('platform failures', () => {
  it('counts a failed schedule and keeps going', async () => {
    const adapter = createFakeNotificationAdapter({ failing: new Set(['schedule'] as const) });
    const { service } = makeService(adapter);

    const outcome = await service.sync(syncInput());

    expect(outcome.status).toBe('applied');
    expect(outcome.failures).toBe(33);
    expect(outcome.scheduled).toEqual([]);
  });

  it('touches nothing when the OS will not say what it holds', async () => {
    const adapter = createFakeNotificationAdapter({ failing: new Set(['getScheduled'] as const) });
    const { service } = makeService(adapter);

    const outcome = await service.sync(syncInput());

    expect(outcome.failures).toBe(1);
    expect(adapter.calls.schedule).toBe(0);
    expect(adapter.calls.cancel).toBe(0);
  });

  it('reports unsupported platforms instead of pretending', async () => {
    const adapter = createFakeNotificationAdapter({ platform: 'other' });
    const { service } = makeService(adapter);

    const outcome = await service.sync(syncInput());

    expect(outcome.status).toBe('unsupported');
    expect(adapter.calls.getPermission).toBe(0);
  });

  it('refuses to touch the OS when the day list is malformed', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const outcome = await service.sync(
      syncInput({ days: [dayTimes('2026-08-19'), dayTimes('2026-08-25')] })
    );

    expect(outcome.status).toBe('applied');
    expect(outcome.planned).toBe(0);
    expect(heldKeys(adapter)).toHaveLength(33);
  });
});

describe('concurrency', () => {
  it('serialises overlapping syncs instead of double-scheduling', async () => {
    const { service, adapter } = makeService();

    await Promise.all([service.sync(syncInput()), service.sync(syncInput())]);

    expect(adapter.calls.schedule).toBe(33);
    expect(heldKeys(adapter)).toHaveLength(33);
  });

  it('lets a cancel queued behind a sync still win', async () => {
    const { service, adapter } = makeService();

    const running = service.sync(syncInput());
    const cancelling = service.clearForPrayer(DAYS[0], 'isha');
    await Promise.all([running, cancelling]);

    expect(adapter.scheduled.has(notificationKey('nudge', DAYS[0], 'isha'))).toBe(false);
    expect(heldKeys(adapter)).toHaveLength(32);
  });
});

describe('android channels', () => {
  it('creates one channel per kind and sound actually in use', async () => {
    const { service, adapter } = makeService();

    await service.sync(syncInput());

    expect([...adapter.channels.keys()].sort()).toEqual(
      [
        channelIdFor('adhan', 'system'),
        channelIdFor('nudge', 'system'),
        // The sunrise note is always silent, so it always lands on the one silent channel —
        // whatever sound the prayer itself is set to.
        channelIdFor('expiry', 'silent'),
      ].sort()
    );
  });

  it('gives the sunrise note a low, silent, buzz-free channel', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const channel = adapter.channels.get(channelIdFor('expiry', 'silent'));
    expect(channel?.importance).toBe('low');
    expect(channel?.sound).toBeNull();
    expect(channel?.vibrate).toBe(false);
  });

  it('moves a prayer onto another channel rather than mutating its sound', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());
    await service.sync(syncInput({ reminders: reminders({ sound: 'adhan' }) }));

    expect(adapter.channels.get(channelIdFor('adhan', 'adhan'))?.sound).toBe(ADHAN_SOUND_FILE);
    // The original channel survives untouched — Android would not have changed its sound anyway.
    expect(adapter.channels.get(channelIdFor('adhan', 'system'))?.sound).toBe('default');
    expect(adapter.scheduled.get(notificationKey('adhan', DAYS[0], 'fajr'))?.channelId).toBe(
      channelIdFor('adhan', 'adhan')
    );
  });

  it('moves onto another channel when the recitation changes, not just the sound', async () => {
    const { service, adapter } = makeService();
    const adhan = reminders({ sound: 'adhan' });
    await service.sync(syncInput({ reminders: adhan, adhanVoice: 'makkah' }));

    await service.sync(syncInput({ reminders: adhan, adhanVoice: 'menk' }));

    // Android refuses to change a channel's sound after creation, so switching recitation is
    // exactly as impossible to do in place as switching from silent to the adhan. Get this wrong
    // and the sound simply never changes on the device — no error, no clue.
    const menk = channelIdFor('adhan', 'adhan', 'menk');
    expect(adapter.channels.get(menk)?.sound).toBe(adhanSoundFile('menk', 'android'));
    expect(adapter.scheduled.get(notificationKey('adhan', DAYS[0], 'fajr'))?.channelId).toBe(menk);
    expect(adapter.scheduled.get(notificationKey('adhan', DAYS[0], 'fajr'))?.sound).toBe(
      adhanSoundFile('menk', 'android')
    );
  });

  it('deletes the channels of recitations nobody is using any more', async () => {
    const { service, adapter } = makeService();
    const adhan = reminders({ sound: 'adhan' });
    await service.sync(syncInput({ reminders: adhan, adhanVoice: 'makkah' }));
    await service.sync(syncInput({ reminders: adhan, adhanVoice: 'menk' }));

    // Otherwise a user who auditioned all four ends up with four live rows in Android's
    // notification settings, and the one they open is very likely not the one ringing at Fajr.
    expect(adapter.channels.has(channelIdFor('adhan', 'adhan', 'makkah'))).toBe(false);
    expect(adapter.channels.has(channelIdFor('adhan', 'adhan', 'menk'))).toBe(true);
  });

  it('never deletes a silent or device-sound channel, whatever the recitation', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput({ reminders: reminders({ sound: 'system' }) }));
    const system = channelIdFor('adhan', 'system');
    expect(adapter.channels.has(system)).toBe(true);

    await service.sync(syncInput({ reminders: reminders({ sound: 'system' }), adhanVoice: 'menk' }));

    // These sound identical whichever recitation is chosen, so pruning them would throw away the
    // user's own per-channel tweaks for no audible reason.
    expect(adapter.channels.has(system)).toBe(true);
    expect(adapter.calls.deleteChannel).toBe(0);
  });

  it('deletes nothing on iOS, where channels do not exist', async () => {
    const adapter = createFakeNotificationAdapter({ platform: 'ios' });
    const { service } = makeService(adapter);

    await service.sync(syncInput({ reminders: reminders({ sound: 'adhan' }), adhanVoice: 'menk' }));

    expect(adapter.calls.listChannels).toBe(0);
    expect(adapter.calls.deleteChannel).toBe(0);
  });

  it('leaves the channels alone when it cannot read what exists', async () => {
    const adapter = createFakeNotificationAdapter({
      failing: new Set(['listChannels'] as const),
    });
    const { service } = makeService(adapter);

    const outcome = await service.sync(
      syncInput({ reminders: reminders({ sound: 'adhan' }), adhanVoice: 'menk' })
    );

    // Not knowing what exists is not a reason to delete anything — and the sound still changes,
    // because the new recitation's channel was created before the prune ran.
    expect(adapter.calls.deleteChannel).toBe(0);
    expect(adapter.channels.has(channelIdFor('adhan', 'adhan', 'menk'))).toBe(true);
    expect(outcome.failures).toBe(0);
  });

  it('knows which channel ids are its own stale adhan ones', () => {
    // Too eager and it deletes the live channel; too shy and the sound silently never changes.
    expect(isStaleAdhanChannel(channelIdFor('adhan', 'adhan', 'makkah'), 'menk')).toBe(true);
    expect(isStaleAdhanChannel(channelIdFor('preReminder', 'adhan', 'makkah'), 'menk')).toBe(true);
    expect(isStaleAdhanChannel(channelIdFor('adhan', 'adhan', 'menk'), 'menk')).toBe(false);
    // Silent and device-sound channels are not adhan channels at all.
    expect(isStaleAdhanChannel(channelIdFor('adhan', 'system'), 'menk')).toBe(false);
    expect(isStaleAdhanChannel(channelIdFor('adhan', 'silent'), 'menk')).toBe(false);
    // The voiceless form is what builds before the selector created; its sound file is not in
    // this bundle at all, so it is stale whatever the user has chosen.
    expect(isStaleAdhanChannel(`adhan-adhan-v${CHANNEL_VERSION}`, 'makkah')).toBe(true);
    // Anything we did not create is left strictly alone.
    expect(isStaleAdhanChannel('expo_notifications_fallback_notification_channel', 'menk')).toBe(
      false
    );
    expect(isStaleAdhanChannel('adhan-adhan-makkah-v999', 'menk')).toBe(false);
    // An adhan channel from an older version froze a sound this build replaced (D212): stale,
    // even for the voice in use. Older silent and system channels are still left alone.
    expect(isStaleAdhanChannel(`adhan-adhan-makkah-v${CHANNEL_VERSION - 1}`, 'makkah')).toBe(true);
    expect(isStaleAdhanChannel(`adhan-system-v${CHANNEL_VERSION - 1}`, 'makkah')).toBe(false);
    expect(isStaleAdhanChannel('', 'menk')).toBe(false);
  });

  it('keeps a created channel’s sound even if a later spec disagrees', async () => {
    const adapter = createFakeNotificationAdapter();
    await adapter.ensureChannel({
      id: channelIdFor('adhan', 'system'),
      name: 'old',
      description: 'old',
      importance: 'high',
      sound: 'default',
      vibrate: true,
      showBadge: false,
    });
    await adapter.ensureChannel({
      id: channelIdFor('adhan', 'system'),
      name: 'new',
      description: 'new',
      importance: 'low',
      sound: ADHAN_SOUND_FILE,
      vibrate: false,
      showBadge: true,
    });

    const channel = adapter.channels.get(channelIdFor('adhan', 'system'));
    expect(channel).toMatchObject({ name: 'new', description: 'new', sound: 'default' });
  });

  it('creates no channels on iOS', async () => {
    const adapter = createFakeNotificationAdapter({ platform: 'ios' });
    const { service } = makeService(adapter);

    await service.sync(syncInput());

    expect(adapter.channels.size).toBe(0);
    expect(adapter.calls.ensureChannel).toBe(0);
  });

  it('names the channel after its kind and its sound', () => {
    const spec = channelSpecFor('nudge', 'silent', DEFAULT_ADHAN_VOICE, (key: string) => key);
    expect(spec.id).toBe(`nudge-silent-v${CHANNEL_VERSION}`);
    expect(spec.sound).toBeNull();
    expect(spec.importance).toBe('default');
    expect(spec.name).toBe('notifications.channel.name');
  });
});

describe('content', () => {
  it('carries the prayer name, its Arabic name and the prayer time', () => {
    const content = buildContent(
      {
        key: 'adhan:2026-08-19:fajr',
        kind: 'adhan',
        prayer: 'fajr',
        day: '2026-08-19',
        fireAt: new Date('2026-08-19T05:00:00.000Z'),
        sound: 'system',
      },
      {
        translate: (key, params) => `${key}|${JSON.stringify(params ?? {})}`,
        formatClock: (date) => date.toISOString().slice(11, 16),
        prayerTime: new Date('2026-08-19T05:00:00.000Z'),
      }
    );

    expect(content.title).toContain('notifications.adhan.title');
    expect(content.title).toContain('prayers.fajr');
    expect(content.title).toContain('prayers.arabic.fajr');
    expect(content.body).toContain('05:00');
  });

  // D88: the pre-reminder names the prayer's own start time and no longer counts down to it. The
  // text is frozen at delivery, so "in 15 minutes" is only true for one minute of the hour it can
  // sit on the lock screen; "starts at 05:00" is true for all of it.
  it('gives the pre-reminder the prayer’s clock time, never a countdown', () => {
    const content = buildContent(
      {
        key: 'preReminder:2026-08-19:fajr',
        kind: 'preReminder',
        prayer: 'fajr',
        day: '2026-08-19',
        fireAt: new Date('2026-08-19T04:45:00.000Z'),
        sound: 'system',
      },
      {
        translate: (key, params) => `${key}|${JSON.stringify(params ?? {})}`,
        formatClock: () => '05:00',
        prayerTime: new Date('2026-08-19T05:00:00.000Z'),
      }
    );

    expect(content.body).toContain('notifications.preReminder.body');
    expect(content.body).toContain('"time":"05:00"');
    expect(content.body).not.toContain('"count"');
  });

  // D77: a notification names one *occurrence*, and on Friday the midday occurrence is
  // "Jumu'ah · Dhuhr" — both, because Jumu'ah replaces Dhuhr only for whoever prays it in
  // congregation. The identity never forks: the key, the payload and the diff stay `dhuhr`.
  it('names Friday’s midday prayer Jumu’ah without touching its identity', () => {
    const content = buildContent(
      {
        key: 'adhan:2026-08-21:dhuhr',
        kind: 'adhan',
        prayer: 'dhuhr',
        day: '2026-08-21', // A Friday.
        fireAt: new Date('2026-08-21T13:00:00.000Z'),
        sound: 'system',
      },
      {
        translate: (key, params) => `${key}|${JSON.stringify(params ?? {})}`,
        formatClock: () => '13:00',
        prayerTime: new Date('2026-08-21T13:00:00.000Z'),
      }
    );

    expect(content.title).toContain('prayers.jumuah');
    expect(content.title).toContain('prayers.arabic.jumuah');
    expect(content.title).not.toContain('prayers.dhuhr');
  });

  it('leaves the midday prayer alone on every other day', () => {
    const content = buildContent(
      {
        key: 'adhan:2026-08-20:dhuhr',
        kind: 'adhan',
        prayer: 'dhuhr',
        day: '2026-08-20', // A Thursday.
        fireAt: new Date('2026-08-20T13:00:00.000Z'),
        sound: 'system',
      },
      {
        translate: (key, params) => `${key}|${JSON.stringify(params ?? {})}`,
        formatClock: () => '13:00',
        prayerTime: new Date('2026-08-20T13:00:00.000Z'),
      }
    );

    expect(content.title).toContain('prayers.dhuhr');
    expect(content.title).not.toContain('jumuah');
  });

  it('names the prayer an expiry points forward to by that same day', () => {
    const content = buildContent(
      {
        key: 'expiry:2026-08-21:fajr',
        kind: 'expiry',
        prayer: 'fajr',
        day: '2026-08-21',
        fireAt: new Date('2026-08-21T06:30:00.000Z'),
        sound: 'system',
      },
      {
        translate: (key, params) => `${key}|${JSON.stringify(params ?? {})}`,
        formatClock: () => '13:00',
        prayerTime: new Date('2026-08-21T05:00:00.000Z'),
        nextPrayer: 'dhuhr',
        nextPrayerTime: new Date('2026-08-21T13:00:00.000Z'),
      }
    );

    // `nextPrayerFor` only looks within the notification's own day, so the forward half is a
    // Friday occurrence too and has to read the same way the Friday adhan does.
    expect(content.body).toContain('prayers.jumuah');
  });

  // `buildContent` runs outside the per-notification try in `sync`, so throwing on a name would
  // abandon every remaining notification in the plan.
  it('falls back to the prayer id rather than throwing on an unreadable day', () => {
    const content = buildContent(
      {
        key: 'adhan:nonsense:dhuhr',
        kind: 'adhan',
        prayer: 'dhuhr',
        day: 'nonsense',
        fireAt: new Date('2026-08-21T13:00:00.000Z'),
        sound: 'system',
      },
      {
        translate: (key, params) => `${key}|${JSON.stringify(params ?? {})}`,
        formatClock: () => '13:00',
        prayerTime: new Date('2026-08-21T13:00:00.000Z'),
      }
    );

    expect(content.title).toContain('prayers.dhuhr');
  });

  it('quotes the prayer time, not the fire time, on a nudge', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const nudge = adapter.scheduled.get(notificationKey('nudge', DAYS[0], 'dhuhr'));
    // Dhuhr is at 13:00 and its nudge fires 20 minutes before Asr — the copy names the prayer.
    expect(nudge?.fireAt.toISOString()).toBe('2026-08-19T15:40:00.000Z');
    expect(nudge?.title).toContain('prayers.dhuhr');
  });
});

describe('the ongoing android notification', () => {
  it('shows the next prayer when it is switched on', async () => {
    const { service, adapter } = makeService();

    await service.sync(syncInput({ persistentNotification: true }));

    const ongoing = adapter.presented.get(ONGOING_NOTIFICATION_ID);
    expect(ongoing?.ongoing).toBe(true);
    expect(ongoing?.sound).toBeNull();
    expect(ongoing?.title).toContain('prayers.fajr');
  });

  it('is taken down when it is switched off', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput({ persistentNotification: true }));

    await service.sync(syncInput({ persistentNotification: false }));

    expect(adapter.presented.has(ONGOING_NOTIFICATION_ID)).toBe(false);
  });

  it('never appears on iOS', async () => {
    const adapter = createFakeNotificationAdapter({ platform: 'ios' });
    const { service } = makeService(adapter);

    await service.sync(syncInput({ persistentNotification: true }));

    expect(adapter.presented.size).toBe(0);
  });

  it('names the prayer whose time is in, and advances once it is marked (D83)', async () => {
    const { service, adapter } = makeService();
    // Two in the afternoon: Dhuhr came in at one and Asr is at four.
    const afternoon = { now: new Date('2026-08-19T14:00:00.000Z'), persistentNotification: true };

    await service.sync(syncInput(afternoon));
    const due = adapter.presented.get(ONGOING_NOTIFICATION_ID);
    expect(due?.title).toContain('notifications.ongoing.titleNow');
    expect(due?.title).toContain('prayers.dhuhr');
    expect(due?.body).toContain('prayers.asr');

    await service.sync(
      syncInput({ ...afternoon, statuses: { '2026-08-19': { dhuhr: 'prayed' } } })
    );
    const advanced = adapter.presented.get(ONGOING_NOTIFICATION_ID);
    expect(advanced?.title).toContain('notifications.ongoing.title(');
    expect(advanced?.title).toContain('prayers.asr');
  });

  it('replaces itself rather than stacking, because its identifier never changes', async () => {
    const { service, adapter } = makeService();
    const afternoon = { now: new Date('2026-08-19T14:00:00.000Z'), persistentNotification: true };

    await service.sync(syncInput(afternoon));
    await service.sync(
      syncInput({ ...afternoon, statuses: { '2026-08-19': { dhuhr: 'prayed' } } })
    );

    // The one place in this app where "the new one overwrites the old" is actually reachable:
    // a fixed identifier, re-presented (PRODUCT_SPEC §11.5).
    expect([...adapter.presented.keys()]).toEqual([ONGOING_NOTIFICATION_ID]);
  });

  it('says nothing about a prayer on an exempt day', async () => {
    const { service, adapter } = makeService();

    await service.sync(
      syncInput({
        now: new Date('2026-08-19T14:00:00.000Z'),
        persistentNotification: true,
        exemptDays: new Set<PrayerDay>(['2026-08-19']),
      })
    );

    const ongoing = adapter.presented.get(ONGOING_NOTIFICATION_ID);
    expect(ongoing?.title).toContain('notifications.ongoing.title(');
    expect(ongoing?.title).toContain('prayers.asr');
  });

  it('retires each adhan half an hour in while it is up — the row it duplicates persists', async () => {
    const { service, adapter } = makeService();

    await service.sync(syncInput({ persistentNotification: true }));

    // Dhuhr at 13:00, window end 16:00 → the linger (30 min) wins; the nudge keeps the window end.
    const adhan = adapter.scheduled.get(notificationKey('adhan', DAYS[0], 'dhuhr'));
    expect(parsePayload(adhan?.data)?.expiresAt).toBe(
      new Date('2026-08-19T13:30:00.000Z').getTime()
    );
    const nudge = adapter.scheduled.get(notificationKey('nudge', DAYS[0], 'dhuhr'));
    expect(parsePayload(nudge?.data)?.expiresAt).toBe(
      new Date('2026-08-19T16:00:00.000Z').getTime()
    );
  });

  it('flipping the toggle rewrites the held adhans — expiry follows the setting, not the schedule date', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const before = adapter.scheduled.get(notificationKey('adhan', DAYS[0], 'dhuhr'));
    expect(parsePayload(before?.data)?.expiresAt).toBe(
      new Date('2026-08-19T16:00:00.000Z').getTime()
    );

    await service.sync(syncInput({ persistentNotification: true }));

    const after = adapter.scheduled.get(notificationKey('adhan', DAYS[0], 'dhuhr'));
    expect(parsePayload(after?.data)?.expiresAt).toBe(
      new Date('2026-08-19T13:30:00.000Z').getTime()
    );
  });

  it('leaves iOS adhans alone — there is no ongoing row to duplicate there', async () => {
    const adapter = createFakeNotificationAdapter({ platform: 'ios' });
    const { service } = makeService(adapter);

    await service.sync(syncInput({ persistentNotification: true }));

    const adhan = adapter.scheduled.get(notificationKey('adhan', DAYS[0], 'dhuhr'));
    expect(parsePayload(adhan?.data)?.expiresAt).toBe(
      new Date('2026-08-19T16:00:00.000Z').getTime()
    );
  });
});

describe('the reminder-health surface', () => {
  it('lists what the OS holds, with the payload parsed', async () => {
    const { service } = makeService();
    await service.sync(syncInput());

    const scheduled = await service.listScheduled();

    expect(scheduled).toHaveLength(33);
    const first = scheduled.find(
      (entry) => entry.identifier === notificationKey('adhan', DAYS[0], 'fajr')
    );
    expect(first?.payload?.prayer).toBe('fajr');
    expect(first?.fireAt?.toISOString()).toBe('2026-08-19T05:00:00.000Z');
  });

  it('sends a test notification through a real channel', async () => {
    const { service, adapter } = makeService();

    const sent = await service.sendTestNotification({ sound: 'adhan' });

    expect(sent).toBe(true);
    const test = adapter.presented.get(TEST_NOTIFICATION_ID);
    expect(test?.sound).toBe(ADHAN_SOUND_FILE);
    expect(test?.channelId).toBe(channelIdFor('adhan', 'adhan'));
    expect(adapter.channels.has(channelIdFor('adhan', 'adhan'))).toBe(true);
  });

  it('reports a failed test notification rather than throwing', async () => {
    const adapter = createFakeNotificationAdapter({ failing: new Set(['present'] as const) });
    const { service } = makeService(adapter);

    await expect(service.sendTestNotification()).resolves.toBe(false);
  });

  it('cancels every notification of ours and leaves foreign ones alone', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());
    adapter.scheduled.set('someone-elses', {
      identifier: 'someone-elses',
      title: 'x',
      body: 'x',
      sound: null,
      fireAt: new Date('2026-08-19T06:00:00.000Z'),
      data: { fireAt: 0 } as never,
    });

    await service.cancelAll();

    expect(heldKeys(adapter)).toEqual(['someone-elses']);
  });
});

/**
 * The regression this whole block exists for: `expo-notifications` presents **nothing** while the
 * app is in the foreground unless a handler says otherwise, and its default with no handler
 * installed is to drop the notification silently. That made "send a test notification" — pressed
 * from inside the app, by definition — appear to do nothing at all, on a screen whose entire job
 * is to prove reminders arrive.
 */
describe('a notification arriving while the app is open', () => {
  it('is shown, with its sound, and never badges', () => {
    expect(foregroundPresentation({ identifier: 'adhan:2026-08-19:fajr', data: {} })).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });

  it('stays silent for a prayer the user set to silent', () => {
    const behaviour = foregroundPresentation({
      identifier: 'adhan:2026-08-19:fajr',
      data: { sound: 'silent' },
    });

    // On Android the handler overrides the channel, so honouring the choice has to happen here
    // rather than being left to the channel the request was scheduled on.
    expect(behaviour.shouldPlaySound).toBe(false);
    expect(behaviour.shouldShowBanner).toBe(true);
  });

  it('plays the sound for the test notification, which carries its own choice', async () => {
    const { service, adapter } = makeService();

    await service.sendTestNotification({ sound: 'silent' });

    const test = adapter.presented.get(TEST_NOTIFICATION_ID);
    expect(foregroundPresentation({ identifier: TEST_NOTIFICATION_ID, data: test?.data }))
      .toMatchObject({ shouldPlaySound: false });

    await service.sendTestNotification({ sound: 'adhan' });
    expect(
      foregroundPresentation({
        identifier: TEST_NOTIFICATION_ID,
        data: adapter.presented.get(TEST_NOTIFICATION_ID)?.data,
      })
    ).toMatchObject({ shouldPlaySound: true });
  });

  it('keeps the ongoing notification out of the banner, where it would interrupt', () => {
    // It is re-presented several times a prayer window; a banner each time would be a fresh
    // interruption for the same unchanged fact.
    expect(foregroundPresentation({ identifier: ONGOING_NOTIFICATION_ID, data: {} })).toEqual({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });

  it('shows a notification whose payload it cannot read at all', () => {
    // Anything from an older build, or a request we did not write, still reaches the user.
    expect(foregroundPresentation({}).shouldShowBanner).toBe(true);
    expect(foregroundPresentation({ identifier: null, data: null }).shouldPlaySound).toBe(true);
  });
});

describe('tapping a notification', () => {
  it('reports the route to open, and stops when unsubscribed', async () => {
    const { service, adapter } = makeService();
    const seen: string[] = [];

    const stop = service.observeTaps((event) => seen.push(event.url));
    adapter.emitTap({ url: TODAY_ROUTE, payload: null });
    stop();
    adapter.emitTap({ url: '/somewhere-else', payload: null });

    expect(seen).toEqual([TODAY_ROUTE]);
    expect(adapter.calls.addResponseListener).toBe(1);
  });

  it('replays the tap that launched the app', async () => {
    const adapter = createFakeNotificationAdapter({
      lastResponse: { url: TODAY_ROUTE, payload: null },
    });
    const { service } = makeService(adapter);
    const seen: string[] = [];

    const stop = service.observeTaps((event) => seen.push(event.url));
    await Promise.resolve();
    await Promise.resolve();
    stop();

    expect(seen).toEqual([TODAY_ROUTE]);
  });

  it('never throws when the platform refuses to subscribe', () => {
    const adapter = createFakeNotificationAdapter({
      failing: new Set(['addResponseListener'] as const),
    });
    const { service } = makeService(adapter);

    expect(() => service.observeTaps(() => undefined)()).not.toThrow();
  });
});

describe('a notification arriving while the app is alive', () => {
  /** The payload of a real scheduled reminder, taken from what a sync actually wrote. */
  async function realPayload() {
    const { service, adapter } = makeService();
    await service.sync(syncInput());
    return parsePayload(adapter.scheduled.get(notificationKey('adhan', DAYS[0], 'fajr'))!.data)!;
  }

  it('reports our own reminders, and stops when unsubscribed', async () => {
    const { service, adapter } = makeService();
    const payload = await realPayload();
    const seen: string[] = [];

    const stop = service.observeReceived((event) => seen.push(event.payload.key));
    adapter.emitReceived({ payload });
    stop();
    adapter.emitReceived({ payload });

    expect(seen).toEqual([payload.key]);
    expect(adapter.calls.addReceivedListener).toBe(1);
  });

  it('ignores anything that is not one of our reminders', async () => {
    const { service, adapter } = makeService();
    const seen: string[] = [];

    service.observeReceived((event) => seen.push(event.payload.key));
    // The ongoing notification is the one that matters: the app posts it during a sync, so a
    // listener that saw it would sync again, post it again, and never stop.
    adapter.emitReceived({ payload: null });

    expect(seen).toEqual([]);
  });

  it('never throws when the platform refuses to subscribe', () => {
    const adapter = createFakeNotificationAdapter({
      failing: new Set(['addReceivedListener'] as const),
    });
    const { service } = makeService(adapter);

    expect(() => service.observeReceived(() => undefined)()).not.toThrow();
  });
});

describe('payload parsing', () => {
  it('round-trips what the service writes', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());
    const request = adapter.scheduled.get(notificationKey('nudge', DAYS[0], 'isha'));

    const payload = parsePayload(request?.data);

    expect(payload).toEqual({
      key: notificationKey('nudge', DAYS[0], 'isha'),
      kind: 'nudge',
      prayer: 'isha' as Prayer,
      day: DAYS[0],
      fireAt: new Date('2026-08-19T23:00:00.000Z').getTime(),
      sound: 'system',
      // Written on every request, not only the ones that play it — the setting is global, and a
      // payload that omitted it would read back as `null` and look like a pre-selector request.
      voice: DEFAULT_ADHAN_VOICE,
      lang: 'en',
      url: TODAY_ROUTE,
      // Isha's window ends at the next day's Fajr, so this last call stops being worth reading at
      // 05:00 tomorrow — which is what Android turns into the notification's own timeout (D88).
      expiresAt: new Date('2026-08-20T05:00:00.000Z').getTime(),
      // Stamped onto the Android notification itself by the patched builder (D146), and recorded
      // here so `isStale` can rebuild a reminder scheduled before we declared anything.
      androidCategory: 'reminder',
    });
  });

  it('rejects anything that is not ours', () => {
    expect(parsePayload(null)).toBeNull();
    expect(parsePayload('nope')).toBeNull();
    expect(parsePayload({})).toBeNull();
    expect(parsePayload({ key: 'k', kind: 'other', prayer: 'fajr', day: 'd', fireAt: 1 })).toBeNull();
    expect(parsePayload({ key: 'k', kind: 'adhan', prayer: 'witr', day: 'd', fireAt: 1 })).toBeNull();
    expect(
      parsePayload({ key: 'k', kind: 'adhan', prayer: 'fajr', day: 'd', fireAt: 'soon' })
    ).toBeNull();
  });

  it('defaults the fields a future version might not have written', () => {
    const payload = parsePayload({
      key: 'adhan:2026-08-19:fajr',
      kind: 'adhan',
      prayer: 'fajr',
      day: '2026-08-19',
      fireAt: 1,
    });
    expect(payload).toMatchObject({ sound: 'system', lang: '', url: TODAY_ROUTE });
  });
});

describe('staleness', () => {
  const wanted = {
    key: 'adhan:2026-08-19:fajr',
    kind: 'adhan' as const,
    prayer: 'fajr' as Prayer,
    day: '2026-08-19',
    fireAt: new Date('2026-08-19T05:00:00.000Z'),
    sound: 'system' as const,
  };
  const held = {
    identifier: wanted.key,
    fireAt: new Date('2026-08-19T05:00:00.000Z'),
    payload: {
      key: wanted.key,
      kind: 'adhan' as const,
      prayer: 'fajr' as Prayer,
      day: '2026-08-19',
      fireAt: wanted.fireAt.getTime(),
      sound: 'system' as const,
      voice: DEFAULT_ADHAN_VOICE,
      lang: 'en',
      url: TODAY_ROUTE,
    },
    title: null,
    body: null,
  };

  it('accepts an exact match', () => {
    expect(isStale(held, wanted, 'en')).toBe(false);
  });

  it('rejects a moved time, a changed sound and a changed language', () => {
    expect(isStale({ ...held, fireAt: new Date(wanted.fireAt.getTime() + 60_000) }, wanted, 'en')).toBe(
      true
    );
    expect(isStale({ ...held, payload: { ...held.payload, sound: 'adhan' } }, wanted, 'en')).toBe(true);
    expect(isStale(held, wanted, 'tr')).toBe(true);
  });

  it('rejects anything it cannot read a time from', () => {
    expect(isStale({ ...held, fireAt: null }, wanted, 'en')).toBe(true);
    expect(isStale({ ...held, payload: null }, wanted, 'en')).toBe(true);
  });

  // D146. The category is stamped at schedule time, so a reminder the OS is already holding from
  // a build that declared nothing would keep arriving undeclared for the whole plan window.
  it('rebuilds a reminder scheduled before we declared a category, then settles', () => {
    // The upgrade gap: held by an older build, wanted with 'reminder' now.
    expect(isStale(held, wanted, 'en', DEFAULT_ADHAN_VOICE, undefined, false, 'reminder')).toBe(true);

    const declared = { ...held, payload: { ...held.payload, androidCategory: 'reminder' } };
    expect(isStale(declared, wanted, 'en', DEFAULT_ADHAN_VOICE, undefined, false, 'reminder')).toBe(
      false
    );
  });

  it('does not churn off Android, where nothing is declared on either side', () => {
    expect(isStale(held, wanted, 'en', DEFAULT_ADHAN_VOICE, undefined, false, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// What the notifications say they are (D146)
// ---------------------------------------------------------------------------

describe('the declared android category', () => {
  it('calls every reminder a reminder', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const requests = [...adapter.scheduled.values()];
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.data.androidCategory).toBe('reminder');
    }
  });

  it('calls the ongoing row standing information, not an alert', async () => {
    const { service, adapter } = makeService();

    await service.sync(syncInput({ persistentNotification: true }));

    expect(adapter.presented.get(ONGOING_NOTIFICATION_ID)?.data.androidCategory).toBe('status');
    // And on the pre-scheduled swap too (D107) — the one the OS re-posts with no process awake,
    // which is exactly the case where nothing else can put the category on it.
    expect(adapter.scheduled.get(ONGOING_NOTIFICATION_ID)?.data.androidCategory).toBe('status');
  });

  it('makes the test notification a true dress rehearsal (D93)', async () => {
    const { service, adapter } = makeService();

    await service.sendTestNotification();

    expect(adapter.presented.get(TEST_NOTIFICATION_ID)?.data.androidCategory).toBe('reminder');
  });

  it('declares nothing on iOS, where the field means nothing', async () => {
    const adapter = createFakeNotificationAdapter({ platform: 'ios' });
    const { service } = makeService(adapter);

    await service.sync(syncInput());

    const requests = [...adapter.scheduled.values()];
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.data.androidCategory).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// The sunrise note, end to end through the service
// ---------------------------------------------------------------------------

describe('the sunrise note', () => {
  const key = notificationKey('expiry', DAYS[0], 'fajr');

  it('is scheduled at sunrise, silent, on its own channel, and never interrupts', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    const request = adapter.scheduled.get(key);
    expect(request?.fireAt.toISOString()).toBe('2026-08-19T06:00:00.000Z');
    expect(request?.sound).toBeNull();
    expect(request?.data.sound).toBe('silent');
    expect(request?.channelId).toBe(channelIdFor('expiry', 'silent'));
    // iOS: in Notification Center when the user looks, never a banner and never a sound.
    expect(request?.interruptionLevel).toBe('passive');
  });

  it('is not scheduled at all unless the setting asks for it (D90)', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput({ sunriseNoteEnabled: false }));

    expect(adapter.scheduled.has(key)).toBe(false);
    // Everything else about Fajr is untouched: this switch is the note's alone.
    expect(adapter.scheduled.has(notificationKey('nudge', DAYS[0], 'fajr'))).toBe(true);
    expect(adapter.scheduled.has(notificationKey('adhan', DAYS[0], 'fajr'))).toBe(true);
  });

  it('omits it when the caller has not been taught about the setting at all', async () => {
    const { service, adapter } = makeService();
    const { sunriseNoteEnabled: _ignored, ...withoutTheFlag } = syncInput();
    await service.sync(withoutTheFlag);

    expect(adapter.scheduled.has(key)).toBe(false);
  });

  it('points at the next prayer rather than saying anything about the user', () => {
    const content = buildContent(
      {
        key,
        kind: 'expiry',
        prayer: 'fajr',
        day: DAYS[0],
        fireAt: new Date('2026-08-19T06:00:00.000Z'),
        sound: 'silent',
      },
      {
        translate: (k, params) => `${k}|${JSON.stringify(params ?? {})}`,
        formatClock: (date) => date.toISOString().slice(11, 16),
        prayerTime: new Date('2026-08-19T05:00:00.000Z'),
        nextPrayer: 'dhuhr',
        nextPrayerTime: new Date('2026-08-19T13:00:00.000Z'),
      }
    );

    expect(content.title).toContain('notifications.expiry.title');
    expect(content.body).toContain('notifications.expiry.body');
    expect(content.body).toContain('prayers.dhuhr');
    // The time quoted is Dhuhr's, not Fajr's — the body is the forward half of the message.
    expect(content.body).toContain('13:00');
    expect(content.body).not.toContain('05:00');
  });

  it('falls back to the bare fact when there is no next prayer to name', () => {
    const content = buildContent(
      {
        key: notificationKey('expiry', DAYS[0], 'isha'),
        kind: 'expiry',
        prayer: 'isha',
        day: DAYS[0],
        fireAt: new Date('2026-08-20T05:00:00.000Z'),
        sound: 'silent',
      },
      {
        translate: (k) => k,
        formatClock: () => '05:00',
        prayerTime: new Date('2026-08-19T21:00:00.000Z'),
      }
    );

    expect(content.body).toBe('notifications.expiry.bodyAlone');
  });

  it('is kept out of the banner when it arrives while the app is open', () => {
    expect(foregroundPresentation({ identifier: key, data: { kind: 'expiry' } })).toEqual({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });
});

// ---------------------------------------------------------------------------
// The last call's copy
// ---------------------------------------------------------------------------

describe('the last call’s copy', () => {
  function nudgeBody(prayer: Prayer, windowEnd?: Date): string {
    return buildContent(
      {
        key: notificationKey('nudge', DAYS[0], prayer),
        kind: 'nudge',
        prayer,
        day: DAYS[0],
        fireAt: new Date('2026-08-19T06:00:00.000Z'),
        sound: 'system',
      },
      {
        translate: (k, params) => `${k}|${JSON.stringify(params ?? {})}`,
        formatClock: (date) => date.toISOString().slice(11, 16),
        prayerTime: new Date('2026-08-19T05:00:00.000Z'),
        windowEnd,
      }
    ).body;
  }

  // D88: a delivered notification's text never changes again, so a duration in it becomes false
  // while the user is reading it. The deadline is the fact that cannot.
  it('names the deadline itself, never a number of minutes', () => {
    const body = nudgeBody('fajr', new Date('2026-08-19T06:20:00.000Z'));
    expect(body).toContain('notifications.nudge.body');
    expect(body).toContain('"time":"06:20"');
    expect(body).not.toContain('"count"');
  });

  it('never quotes a time for Isha, whose deadline is dawn and whose last call is not', () => {
    // Isha's window runs to the next Fajr (D71) while its last call fires at Islamic midnight, so
    // the honest deadline is hours away and quoting it would read as permission to leave the
    // prayer until four in the morning.
    const body = nudgeBody('isha', new Date('2026-08-20T05:00:00.000Z'));
    expect(body).toContain('notifications.nudge.bodyIsha');
    expect(body).not.toContain('"time"');
  });

  it('falls back to the wordless copy rather than an empty deadline', () => {
    // Unreachable in the plan — a non-Isha nudge is computed *from* the window end — but the
    // content builder runs outside the per-notification try in `sync`.
    expect(nudgeBody('maghrib', undefined)).toContain('notifications.nudge.bodyIsha');
  });

  it('quotes the real window end through a real sync', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput({ nudgeLeadMinutes: 10 }));

    const request = adapter.scheduled.get(notificationKey('nudge', DAYS[0], 'dhuhr'));
    // Dhuhr's window ends when Asr comes in at 16:00 — that is the time in the body, whatever
    // lead the user picked, and ten minutes before it is when it fires.
    expect(request?.body).toContain('"time":"16:00"');
    expect(request?.fireAt.toISOString()).toBe('2026-08-19T15:50:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Clearing the tray
// ---------------------------------------------------------------------------

describe('clearing the tray', () => {
  /** Puts a notification in the fake OS's tray as though it had been delivered. */
  function deliver(
    adapter: FakeNotificationAdapter,
    kind: 'adhan' | 'nudge' | 'expiry',
    day: PrayerDay,
    prayer: Prayer,
    fireAt: string
  ): string {
    const key = notificationKey(kind, day, prayer);
    adapter.presented.set(key, {
      identifier: key,
      title: key,
      body: key,
      sound: null,
      data: {
        key,
        kind,
        prayer,
        day,
        fireAt: new Date(fireAt).getTime(),
        sound: 'system',
        lang: 'en',
        url: TODAY_ROUTE,
      },
    });
    return key;
  }

  it('dismisses what has gone stale and keeps what has not', async () => {
    const { service, adapter } = makeService();
    const stale = deliver(adapter, 'adhan', DAYS[0], 'fajr', '2026-08-19T05:00:00.000Z');
    const live = deliver(adapter, 'adhan', DAYS[0], 'asr', '2026-08-19T16:00:00.000Z');

    // Half past four: Fajr's window shut at sunrise, Asr's is open until Maghrib at 19:00.
    await service.sync(syncInput({ now: new Date('2026-08-19T16:30:00.000Z') }));

    expect([...adapter.presented.keys()]).toEqual([live]);
    expect(adapter.calls.dismiss).toBeGreaterThan(0);
    expect(stale).not.toBe(live);
  });

  it('leaves a notification without one of our payloads alone', async () => {
    const { service, adapter } = makeService();
    adapter.presented.set('someone-elses-notification', {
      identifier: 'someone-elses-notification',
      title: 'not ours',
      body: 'not ours',
      sound: null,
      data: { url: TODAY_ROUTE },
    });

    await service.sync(syncInput({ now: new Date('2026-08-19T23:59:00.000Z') }));

    expect(adapter.presented.has('someone-elses-notification')).toBe(true);
  });

  it('does not fail a sync when the tray cannot be read', async () => {
    const adapter = createFakeNotificationAdapter({
      failing: new Set(['getPresented'] as const),
    });
    const { service } = makeService(adapter);

    const outcome = await service.sync(syncInput());

    expect(outcome.status).toBe('applied');
    expect(outcome.failures).toBe(0);
    expect(outcome.scheduled).toHaveLength(33);
  });

  it('sweeps the tray even when the OS will not list its schedule (D165)', async () => {
    // The sweep used to be the last statement of a sync, behind every early return — so an OS
    // that could not answer `getScheduled` left the tray untouched as a side effect. On iOS the
    // sweep is the only thing that ever clears a delivered row, so it runs first, unconditionally.
    const adapter = createFakeNotificationAdapter({
      failing: new Set(['getScheduled'] as const),
    });
    const { service } = makeService(adapter);
    const stale = deliver(adapter, 'adhan', DAYS[0], 'fajr', '2026-08-19T05:00:00.000Z');
    const live = deliver(adapter, 'adhan', DAYS[0], 'asr', '2026-08-19T16:00:00.000Z');

    const outcome = await service.sync(syncInput({ now: new Date('2026-08-19T16:30:00.000Z') }));

    // The schedule could not be diffed — that failure is still reported — but the tray is right.
    expect(outcome.status).toBe('applied');
    expect(outcome.failures).toBe(1);
    expect([...adapter.presented.keys()]).toEqual([live]);
    expect(adapter.presented.has(stale)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Logging a prayer silences it everywhere
// ---------------------------------------------------------------------------

describe('clearForPrayer', () => {
  it('cancels the two phases that only exist while a prayer is unlogged', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    expect(await service.clearForPrayer(DAYS[0], 'fajr')).toBe(true);

    expect(adapter.scheduled.has(notificationKey('nudge', DAYS[0], 'fajr'))).toBe(false);
    expect(adapter.scheduled.has(notificationKey('expiry', DAYS[0], 'fajr'))).toBe(false);
    // The adhan is about the time arriving, not about the log being empty.
    expect(adapter.scheduled.has(notificationKey('adhan', DAYS[0], 'fajr'))).toBe(true);
    expect(adapter.scheduled.has(notificationKey('nudge', DAYS[1], 'fajr'))).toBe(true);
  });

  it('dismisses every phase of that prayer already sitting in the tray', async () => {
    const { service, adapter } = makeService();
    for (const kind of ['adhan', 'nudge'] as const) {
      const key = notificationKey(kind, DAYS[0], 'fajr');
      adapter.presented.set(key, {
        identifier: key,
        title: key,
        body: key,
        sound: null,
        data: { url: TODAY_ROUTE },
      });
    }
    const other = notificationKey('adhan', DAYS[0], 'dhuhr');
    adapter.presented.set(other, {
      identifier: other,
      title: other,
      body: other,
      sound: null,
      data: { url: TODAY_ROUTE },
    });

    await service.clearForPrayer(DAYS[0], 'fajr');

    expect([...adapter.presented.keys()]).toEqual([other]);
  });

  it('reports a platform failure without throwing', async () => {
    const adapter = createFakeNotificationAdapter({ failing: new Set(['dismiss'] as const) });
    const { service } = makeService(adapter);

    expect(await service.clearForPrayer(DAYS[0], 'fajr')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The real adapter, over a mocked expo-notifications
// ---------------------------------------------------------------------------

/**
 * Everything above drives `createFakeNotificationAdapter`, which is the right subject for policy
 * — but it is also why `interruptionLevel` was computed correctly for months and reached the
 * operating system never. The service handed the field to the adapter, the fake adapter recorded
 * it, the test read it back, and the real adapter dropped it on the floor while building the
 * `content` object. Nothing in the suite looked at that object.
 *
 * So this block asserts on the argument `scheduleNotificationAsync` is actually called with. It is
 * the only place in the file where the subject is the translation layer rather than the policy.
 */
describe('the expo-notifications adapter', () => {
  function loadAdapter() {
    const expo = jest.requireMock('expo-notifications') as {
      scheduleNotificationAsync: jest.Mock;
      setNotificationHandler: jest.Mock;
    };
    expo.scheduleNotificationAsync.mockClear();
    return { adapter: createExpoNotificationAdapter(), expo };
  }

  it('forwards the interruption level of a scheduled reminder to the OS', async () => {
    const { adapter, expo } = loadAdapter();

    await adapter.schedule({
      identifier: 'adhan:2026-08-19:fajr',
      title: 'Fajr',
      body: '5:00 am',
      data: {
        key: 'adhan:2026-08-19:fajr',
        kind: 'adhan',
        prayer: 'fajr',
        day: '2026-08-19',
        fireAt: Date.parse('2026-08-19T05:00:00.000Z'),
        sound: 'adhan',
        url: TODAY_ROUTE,
      },
      sound: ADHAN_SOUND_FILE,
      interruptionLevel: 'timeSensitive',
      fireAt: new Date('2026-08-19T05:00:00.000Z'),
    });

    expect(expo.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const request = expo.scheduleNotificationAsync.mock.calls[0][0] as {
      content: Record<string, unknown>;
    };
    expect(request.content.interruptionLevel).toBe('timeSensitive');
  });

  it('forwards `passive` for the quiet kinds too, which is what the sunrise note needs', async () => {
    const { adapter, expo } = loadAdapter();

    await adapter.schedule({
      identifier: 'expiry:2026-08-19:fajr',
      title: 'Fajr ended at sunrise',
      body: 'Next: Dhuhr',
      data: {
        key: 'expiry:2026-08-19:fajr',
        kind: 'expiry',
        prayer: 'fajr',
        day: '2026-08-19',
        fireAt: Date.parse('2026-08-19T06:00:00.000Z'),
        sound: 'silent',
        url: TODAY_ROUTE,
      },
      sound: null,
      interruptionLevel: 'passive',
      fireAt: new Date('2026-08-19T06:00:00.000Z'),
    });

    const request = expo.scheduleNotificationAsync.mock.calls[0][0] as {
      content: Record<string, unknown>;
    };
    expect(request.content.interruptionLevel).toBe('passive');
  });

  it('omits the key entirely when no level was asked for', async () => {
    const { adapter, expo } = loadAdapter();

    await adapter.schedule({
      identifier: 'ongoing',
      title: 'Dhuhr',
      body: 'Due now',
      data: { url: TODAY_ROUTE, fireAt: Date.parse('2026-08-19T13:00:00.000Z') },
      sound: null,
      fireAt: new Date('2026-08-19T13:00:00.000Z'),
    });

    const request = expo.scheduleNotificationAsync.mock.calls[0][0] as {
      content: Record<string, unknown>;
    };
    expect('interruptionLevel' in request.content).toBe(false);
  });

  it('forwards it on a presented notification as well, so the test is a real rehearsal', async () => {
    const { adapter, expo } = loadAdapter();

    await adapter.present({
      identifier: TEST_NOTIFICATION_ID,
      title: 'Test',
      body: 'This is what a reminder looks like',
      data: { url: TODAY_ROUTE, test: true },
      sound: 'default',
      interruptionLevel: 'timeSensitive',
    });

    const request = expo.scheduleNotificationAsync.mock.calls[0][0] as {
      content: Record<string, unknown>;
    };
    expect(request.content.interruptionLevel).toBe('timeSensitive');
  });
});

/**
 * And the policy half of the same fix, back on the fake adapter: which kinds ask for which level.
 * Splitting it this way keeps the assertion about *what the OS receives* separate from the
 * assertion about *what we decide to send*, which is the distinction the bug fell through.
 */
describe('the iOS interruption level', () => {
  it('asks to break through Focus for everything meant to interrupt', async () => {
    const { service, adapter } = makeService(createFakeNotificationAdapter({ platform: 'ios' }));

    await service.sync(
      syncInput({
        sunriseNoteEnabled: true,
        reminders: reminders({ preReminderEnabled: true }),
      })
    );

    const byKind = new Map<string, string | undefined>();
    for (const request of adapter.scheduled.values()) {
      byKind.set(String(request.data.kind), request.interruptionLevel);
    }
    expect(byKind.get('adhan')).toBe('timeSensitive');
    expect(byKind.get('preReminder')).toBe('timeSensitive');
    expect(byKind.get('nudge')).toBe('timeSensitive');
    // The sunrise note reports the sky; it must never light the screen up (D76).
    expect(byKind.get('expiry')).toBe('passive');
  });

  it('sends the test notification at the level a real adhan uses (D93)', async () => {
    const { service, adapter } = makeService(createFakeNotificationAdapter({ platform: 'ios' }));

    await service.sendTestNotification();

    expect(adapter.presented.get(TEST_NOTIFICATION_ID)?.interruptionLevel).toBe('timeSensitive');
  });
});
