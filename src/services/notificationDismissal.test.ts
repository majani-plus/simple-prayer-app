/**
 * The guard on `modules/notification-dismissal`'s one coupling to `expo-notifications`.
 *
 * That module takes a notification out of the tray at a future instant, with the app's process
 * gone, by calling plain Android:
 *
 * ```kotlin
 * NotificationManager.cancel(tag, id)
 * ```
 *
 * It can do that without the library's help only because of a convention in the library's own
 * Android source (`ExpoPresentationDelegate.kt`): every notification is posted with
 * **`tag` = the identifier we scheduled it under** and **`id` = `ANDROID_NOTIFICATION_ID`, the
 * constant `0`**. Get either half wrong and `cancel` addresses a notification that does not exist
 * — which Android treats as success. **Every dismissal would quietly do nothing**, the tray would
 * fill up again, and no test, log or crash would say why. That is the failure this file exists to
 * turn into a red build.
 *
 * It reads the installed library rather than trusting a comment, so an upgrade that moves the
 * convention fails here. If it does go red: read `ExpoPresentationDelegate.kt`, then fix
 * `PendingDismissals.kt` to match — never relax the assertions.
 *
 * The rest of the file checks the halves of the contract that live in TypeScript: the service
 * arms a dismissal for exactly the instant the plan computed, and gives one up when it cancels.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  createFakeNotificationAdapter,
  createNotificationService,
  type SyncInput,
} from './notifications';
import { notificationKey } from '../domain/notificationPlan';
import { PRAYERS } from '../domain/types';

import type {
  DayTimes,
  PrayerDay,
  PrayerReminderSettings,
  ReminderSettings,
  TimeMarker,
} from '../domain/types';

const ROOT = resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// The native coupling
// ---------------------------------------------------------------------------

describe('the (tag, id) convention we dismiss by', () => {
  const delegate = readFileSync(
    join(
      ROOT,
      'node_modules/expo-notifications/android/src/main/java/expo/modules/notifications',
      'service/delegates/ExpoPresentationDelegate.kt'
    ),
    'utf8'
  );

  it('still posts every notification under our own identifier as the tag', () => {
    // SDK 58: val tag = request.identifier; val id = getNotifyId(request); notify(tag, id, …)
    expect(delegate).toMatch(/val tag = request\.identifier\b/);
    expect(delegate).toMatch(/val id = getNotifyId\(request\)/);
    expect(delegate).toMatch(/notificationManager\.notify\(tag, id, androidNotification\)/);
  });

  it('still posts every notification under the constant id 0', () => {
    // `getNotifyId` returns ANDROID_NOTIFICATION_ID for every request — the id half of the pair.
    expect(delegate).toMatch(/getNotifyId\(request: NotificationRequest\?\): Int\s*\{\s*return\s+ANDROID_NOTIFICATION_ID/);
    expect(delegate).toMatch(/ANDROID_NOTIFICATION_ID\s*=\s*0\b/);
  });

  it('is the same id our module cancels with', () => {
    const kotlin = readFileSync(
      join(
        ROOT,
        'modules/notification-dismissal/android/src/main/java/expo/modules/notificationdismissal',
        'PendingDismissals.kt'
      ),
      'utf8'
    );
    expect(kotlin).toMatch(/const val EXPO_NOTIFICATION_ID\s*=\s*0\b/);
    // The identifier goes in as the tag, untransformed — the other half of the pair.
    expect(kotlin).toContain('manager.cancel(identifier, EXPO_NOTIFICATION_ID)');
  });
});

// ---------------------------------------------------------------------------
// The TypeScript half
// ---------------------------------------------------------------------------

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

function dayTimes(day: PrayerDay): DayTimes {
  const times = {} as Record<TimeMarker, Date>;
  for (const [marker, hour] of Object.entries(HOURS) as [TimeMarker, number][]) {
    times[marker] = new Date(`${day}T00:00:00.000Z`);
    times[marker].setUTCHours(hour);
  }
  return { day, times, method: 'muslimWorldLeague' };
}

const DAYS = ['2026-08-19', '2026-08-20', '2026-08-21'] as const;

const PRAYER_REMINDER: PrayerReminderSettings = {
  adhanEnabled: true,
  sound: 'system',
  preReminderEnabled: false,
  preReminderMinutes: 15,
  nudgeEnabled: true,
};

function syncInput(patch: Partial<SyncInput> = {}): SyncInput {
  return {
    now: new Date('2026-08-19T00:30:00.000Z'),
    days: DAYS.map(dayTimes),
    reminders: Object.fromEntries(
      PRAYERS.map((prayer) => [prayer, { ...PRAYER_REMINDER }])
    ) as ReminderSettings,
    statuses: {},
    exemptDays: new Set<PrayerDay>(),
    locale: 'en',
    // The setting ships off (D90); this suite is about the alarm a scheduled notification arms,
    // so the fixture asks for the one notification whose expiry is the interesting case.
    sunriseNoteEnabled: true,
    ...patch,
  };
}

function makeService(platform: 'android' | 'ios' = 'android') {
  const adapter = createFakeNotificationAdapter({ platform });
  return {
    adapter,
    service: createNotificationService(adapter, {
      translate: (key) => key,
      formatClock: (date) => date.toISOString().slice(11, 16),
    }),
  };
}

describe('arming a notification’s own dismissal', () => {
  it('arms one for every reminder, at the instant its window closes', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    // Dhuhr's window ends when Asr comes in at 16:00 — for its adhan and its last call alike.
    const end = new Date('2026-08-19T16:00:00.000Z').getTime();
    expect(adapter.dismissals.get(notificationKey('adhan', DAYS[0], 'dhuhr'))).toBe(end);
    expect(adapter.dismissals.get(notificationKey('nudge', DAYS[0], 'dhuhr'))).toBe(end);
    // Fajr's ends at SUNRISE (D71), not at Dhuhr.
    expect(adapter.dismissals.get(notificationKey('adhan', DAYS[0], 'fajr'))).toBe(
      new Date('2026-08-19T06:00:00.000Z').getTime()
    );
  });

  // The sunrise note exists to be read after the fact, so what retires it is Dhuhr arriving —
  // exactly the exception `selectStaleDelivered` makes when the app is the one sweeping.
  it('gives the sunrise note until Dhuhr rather than until sunrise', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());

    expect(adapter.dismissals.get(notificationKey('expiry', DAYS[0], 'fajr'))).toBe(
      new Date('2026-08-19T13:00:00.000Z').getTime()
    );
  });

  it('gives one up when the notification is cancelled', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput());
    const key = notificationKey('nudge', DAYS[0], 'dhuhr');
    expect(adapter.dismissals.has(key)).toBe(true);

    // Logging the prayer cancels its last call — and with it the alarm that would have dismissed
    // a notification that is never going to be posted.
    await service.sync(syncInput({ statuses: { [DAYS[0]]: { dhuhr: 'prayed' } } }));
    expect(adapter.dismissals.has(key)).toBe(false);
  });

  it('arms nothing on iOS, where no such mechanism exists', async () => {
    const { service, adapter } = makeService('ios');
    await service.sync(syncInput());

    expect(adapter.scheduled.size).toBeGreaterThan(0);
    expect(adapter.dismissals.size).toBe(0);
  });

  it('never arms one for the ongoing notification, which must not expire', async () => {
    const { service, adapter } = makeService();
    await service.sync(syncInput({ persistentNotification: true }));

    for (const identifier of adapter.dismissals.keys()) {
      expect(identifier).toMatch(/^(adhan|preReminder|nudge|expiry):/);
    }
  });
});
