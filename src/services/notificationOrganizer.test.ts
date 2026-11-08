/**
 * Android's notification organizer (D146).
 *
 * Two things have to hold:
 *
 * 1. **Only show the guidance where the feature can exist.** The organizer arrived in Android 16.
 *    A card about it on an Android 14 phone — or on iOS — is noise on a screen whose whole value
 *    is that everything on it might be the user's actual problem.
 * 2. **Always land somewhere.** There is no public intent for the organizer screen itself, and not
 *    every ROM ships the stock Notifications screen, so the ladder must end at a page that always
 *    exists. A dead button on the one phone that needed it is the silent failure here.
 */

import {
  NOTIFICATION_SETTINGS_ACTION,
  ORGANIZER_MIN_SDK,
  openNotificationSettings,
  setNotificationOrganizerAdapter,
  supportsNotificationOrganizer,
  type NotificationOrganizerAdapter,
} from './notificationOrganizer';

interface FakeAdapter extends NotificationOrganizerAdapter {
  readonly started: string[];
  appSettingsOpened: number;
}

function fakeAdapter({
  platform = 'android' as NotificationOrganizerAdapter['platform'],
  sdk = ORGANIZER_MIN_SDK,
  /** Whether the stock Notifications screen "exists"; otherwise it rejects like a missing one. */
  settingsScreenExists = true,
  appSettingsFails = false,
  sdkThrows = false,
}: {
  platform?: NotificationOrganizerAdapter['platform'];
  sdk?: number;
  settingsScreenExists?: boolean;
  appSettingsFails?: boolean;
  sdkThrows?: boolean;
} = {}): FakeAdapter {
  const started: string[] = [];
  return {
    platform,
    started,
    appSettingsOpened: 0,
    sdkVersion() {
      if (sdkThrows) throw new Error('no version');
      return sdk;
    },
    async startActivity(action) {
      if (!settingsScreenExists) throw new Error('no activity found');
      started.push(action);
    },
    async openAppSettings() {
      if (appSettingsFails) throw new Error('nope');
      this.appSettingsOpened += 1;
    },
  };
}

afterEach(() => {
  setNotificationOrganizerAdapter(null);
});

describe('whether the guidance is worth showing', () => {
  it('shows on Android 16 and later', () => {
    setNotificationOrganizerAdapter(fakeAdapter({ sdk: ORGANIZER_MIN_SDK }));
    expect(supportsNotificationOrganizer()).toBe(true);

    setNotificationOrganizerAdapter(fakeAdapter({ sdk: ORGANIZER_MIN_SDK + 2 }));
    expect(supportsNotificationOrganizer()).toBe(true);
  });

  it('stays out of the way on older Android, where the feature does not exist', () => {
    setNotificationOrganizerAdapter(fakeAdapter({ sdk: ORGANIZER_MIN_SDK - 1 }));

    expect(supportsNotificationOrganizer()).toBe(false);
  });

  it('never shows on iOS or anywhere else', () => {
    setNotificationOrganizerAdapter(fakeAdapter({ platform: 'ios', sdk: 99 }));
    expect(supportsNotificationOrganizer()).toBe(false);

    setNotificationOrganizerAdapter(fakeAdapter({ platform: 'other', sdk: 99 }));
    expect(supportsNotificationOrganizer()).toBe(false);
  });

  it('says no rather than throwing when the version cannot be read', () => {
    setNotificationOrganizerAdapter(fakeAdapter({ sdkThrows: true }));

    expect(() => supportsNotificationOrganizer()).not.toThrow();
    expect(supportsNotificationOrganizer()).toBe(false);
  });
});

describe('getting the user to the setting', () => {
  it('opens the system Notifications screen, which is where the organizer lives', async () => {
    const adapter = fakeAdapter();
    setNotificationOrganizerAdapter(adapter);

    await expect(openNotificationSettings()).resolves.toBe('opened');
    expect(adapter.started).toEqual([NOTIFICATION_SETTINGS_ACTION]);
    // The fallback is not spent when the real screen answered.
    expect(adapter.appSettingsOpened).toBe(0);
  });

  it('falls back to this app’s settings page on a ROM without that screen', async () => {
    const adapter = fakeAdapter({ settingsScreenExists: false });
    setNotificationOrganizerAdapter(adapter);

    await expect(openNotificationSettings()).resolves.toBe('opened');
    expect(adapter.appSettingsOpened).toBe(1);
  });

  it('reports that nothing could be shown rather than throwing', async () => {
    setNotificationOrganizerAdapter(
      fakeAdapter({ settingsScreenExists: false, appSettingsFails: true })
    );

    await expect(openNotificationSettings()).resolves.toBe('unavailable');
  });

  it('does nothing off Android', async () => {
    const adapter = fakeAdapter({ platform: 'ios' });
    setNotificationOrganizerAdapter(adapter);

    await expect(openNotificationSettings()).resolves.toBe('unavailable');
    expect(adapter.started).toEqual([]);
    expect(adapter.appSettingsOpened).toBe(0);
  });
});
