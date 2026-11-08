/**
 * Exact alarms — the permission that decides whether a reminder arrives *on the minute*.
 *
 * The defect this covers was silent by construction. `expo-notifications` asks the OS
 * `canScheduleExactAlarms()` before every alarm it sets and quietly downgrades to
 * `setAndAllowWhileIdle` when the answer is no (`ExpoSchedulingDelegate.kt`), which Doze may batch
 * and delay. On Android 14+ the answer is **no by default** for an app targeting API 33 or higher,
 * and we target 36 — so a fresh install had every reminder inexact and nothing anywhere said so.
 *
 * What the tests below pin down is therefore mostly about *honesty*:
 *
 * 1. The state is read from the operating system, never guessed — and a build that cannot read it
 *    (an old dev client without the native module, or a call that throws) answers `'unknown'`
 *    rather than inventing a reassurance. The reliability screen shows no card at all for
 *    `'unknown'`, so a wrong green tick is impossible.
 * 2. **iOS is `'exact'`, and is never asked.** Local notifications there are held by the system and
 *    fire at the requested minute whatever the app is doing, so there is no permission, no
 *    downgrade, and nothing for a user to fix.
 * 3. The button that fixes it always reaches *somewhere*: the system's own "Alarms & reminders"
 *    screen first, this app's settings page when a ROM has no such screen, and an honest
 *    `'unavailable'` only when neither exists. A dead button on this screen is the worst outcome —
 *    it is pressed by someone who has already missed a prayer.
 */

import {
  openExactAlarmSettings,
  readExactAlarmState,
  setExactAlarmAdapter,
  type ExactAlarmAdapter,
} from './exactAlarms';

interface FakeAdapter extends ExactAlarmAdapter {
  readonly calls: { read: number; system: number; appSettings: number };
}

function fakeAdapter({
  platform = 'android' as ExactAlarmAdapter['platform'],
  /** What the native module answers: `true`/`false`, `null` for "not in this binary". */
  allowed = true as boolean | null,
  readThrows = false,
  /** Whether the system's exact-alarm screen exists on this ROM. */
  systemScreen = true,
  appSettingsFails = false,
}: {
  platform?: ExactAlarmAdapter['platform'];
  allowed?: boolean | null;
  readThrows?: boolean;
  systemScreen?: boolean;
  appSettingsFails?: boolean;
} = {}): FakeAdapter {
  const calls = { read: 0, system: 0, appSettings: 0 };
  return {
    platform,
    calls,
    async canScheduleExactAlarms() {
      calls.read += 1;
      if (readThrows) throw new Error('no such module');
      return allowed;
    },
    async openSystemScreen() {
      calls.system += 1;
      return systemScreen;
    },
    async openAppSettings() {
      calls.appSettings += 1;
      if (appSettingsFails) throw new Error('no settings');
    },
  };
}

afterEach(() => {
  setExactAlarmAdapter(null);
});

describe('readExactAlarmState', () => {
  it('reports exact when the phone allows alarms to the minute', async () => {
    setExactAlarmAdapter(fakeAdapter({ allowed: true }));
    await expect(readExactAlarmState()).resolves.toBe('exact');
  });

  it('reports inexact when the phone has not been asked, or was told no', async () => {
    setExactAlarmAdapter(fakeAdapter({ allowed: false }));
    await expect(readExactAlarmState()).resolves.toBe('inexact');
  });

  it('says unknown rather than guessing when the binary has no way to ask', async () => {
    // A dev client built before this module existed. `null` is the module's own "I am not here".
    setExactAlarmAdapter(fakeAdapter({ allowed: null }));
    await expect(readExactAlarmState()).resolves.toBe('unknown');
  });

  it('says unknown when the call fails', async () => {
    setExactAlarmAdapter(fakeAdapter({ readThrows: true }));
    await expect(readExactAlarmState()).resolves.toBe('unknown');
  });

  it('answers exact on iOS without asking anything', async () => {
    // Nothing holds an iOS local notification back: the system keeps it and fires it on time
    // even with the app force-quit. There is no permission there to be missing.
    const adapter = fakeAdapter({ platform: 'ios', allowed: false });
    setExactAlarmAdapter(adapter);
    await expect(readExactAlarmState()).resolves.toBe('exact');
    expect(adapter.calls.read).toBe(0);
  });
});

describe('openExactAlarmSettings', () => {
  it('opens the system’s own alarms-and-reminders screen', async () => {
    const adapter = fakeAdapter();
    setExactAlarmAdapter(adapter);

    await expect(openExactAlarmSettings()).resolves.toBe('opened');
    expect(adapter.calls.system).toBe(1);
    expect(adapter.calls.appSettings).toBe(0);
  });

  it('falls back to this app’s settings page when the ROM has no such screen', async () => {
    const adapter = fakeAdapter({ systemScreen: false });
    setExactAlarmAdapter(adapter);

    await expect(openExactAlarmSettings()).resolves.toBe('opened');
    expect(adapter.calls.appSettings).toBe(1);
  });

  it('reports unavailable when neither screen can be reached', async () => {
    const adapter = fakeAdapter({ systemScreen: false, appSettingsFails: true });
    setExactAlarmAdapter(adapter);

    await expect(openExactAlarmSettings()).resolves.toBe('unavailable');
  });

  it('does nothing at all on iOS', async () => {
    const adapter = fakeAdapter({ platform: 'ios' });
    setExactAlarmAdapter(adapter);

    await expect(openExactAlarmSettings()).resolves.toBe('unavailable');
    expect(adapter.calls.system).toBe(0);
    expect(adapter.calls.appSettings).toBe(0);
  });
});
