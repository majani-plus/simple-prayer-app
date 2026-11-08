/**
 * Tests for `services/backgroundRefresh` — the headless run that keeps reminders, the tray, the
 * widgets and the watch true on a phone nobody has opened.
 *
 * What is worth pinning here is not the syncing (each of those has its own suite) but the three
 * properties this module alone owns, all of which fail silently if they regress:
 *
 * 1. **The task is defined at module scope.** On an Android headless launch there is no component
 *    tree, so a definition that moved into a hook or a route would simply never be reached, and the
 *    only symptom is reminders quietly running out on somebody's phone weeks later.
 * 2. **Every step is independent.** A missing widget bridge must not cost the user five days of
 *    reminders, so one throwing step may not stop the ones after it — and the run still reports
 *    success, because iOS schedules a task less generously the more often it fails.
 * 3. **Registration respects the status.** A `'restricted'` platform is told nothing; a `'restricted'`
 *    read must not become an exception out of the root layout.
 *
 * `expo-task-manager` and `expo-background-task` are mocked rather than left to `jest-expo`: the
 * preset mocks the *native* modules, whose functions answer `undefined`, which is neither an
 * observable `defineTask` nor a usable `BackgroundTaskStatus`. The mock below captures the defined
 * callback, which is the only way to run the task body the OS would run.
 */

import {
  BACKGROUND_REFRESH_INTERVAL_MINUTES,
  BACKGROUND_REFRESH_TASK,
  readBackgroundRefreshStatus,
  registerBackgroundRefresh,
  runBackgroundRefresh,
} from './backgroundRefresh';

// Every `jest.fn` is created INSIDE its factory, and the handles are picked up from
// `jest.requireMock` below. `jest.mock` is hoisted above the import, but a `const mockFn` is not —
// and the subject module calls `defineTask` while it is being imported, so a factory closing over
// one out here would read it in its temporal dead zone. `__tests__/rootLayout.test.tsx` hits the
// same wall with `initTelemetry` and solves it the same way.
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

jest.mock('expo-background-task', () => ({
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  getStatusAsync: jest.fn(() => Promise.resolve(2)),
  registerTaskAsync: jest.fn(() => Promise.resolve()),
}));

// The four syncs and the two startup steps. Mocked at the module boundary so the task body can be
// run without a database, a notification adapter or a widget bridge.
jest.mock('@/db/client', () => ({ runMigrations: jest.fn(() => Promise.resolve()) }));

jest.mock('@/hooks/useNotificationSync', () => ({
  syncNotificationsFromStores: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('@/services/widgets', () => ({
  syncWidgets: jest.fn(() => Promise.resolve('unchanged')),
}));

jest.mock('@/services/liveActivity', () => ({
  syncLiveActivity: jest.fn(() => Promise.resolve('unsupported')),
}));

jest.mock('@/services/watch', () => ({ syncWatch: jest.fn(() => Promise.resolve('unsupported')) }));

jest.mock('@/i18n', () => ({
  initI18n: jest.fn(),
  applyLanguage: jest.fn(() => Promise.resolve(false)),
  deviceLanguage: jest.fn(() => 'tr'),
}));

jest.mock('@/stores/trackingStore', () => ({
  getTrackingActions: jest.fn(() => ({ hydrate: jest.fn() })),
  useTrackingStore: { getState: jest.fn(() => ({ hydrated: false })) },
}));

jest.mock('@/stores/settingsStore', () => ({
  getSettingsSnapshot: jest.fn(() => ({ language: 'system' })),
}));

/** `BackgroundTaskStatus` / `BackgroundTaskResult`, as the mock above defines them. */
const RESTRICTED = 1;
const AVAILABLE = 2;
const SUCCESS = 1;
const FAILED = 2;

type Mock = jest.Mock;

const taskManager = jest.requireMock('expo-task-manager') as { defineTask: Mock };
const backgroundTask = jest.requireMock('expo-background-task') as {
  getStatusAsync: Mock;
  registerTaskAsync: Mock;
};
const dbClient = jest.requireMock('@/db/client') as { runMigrations: Mock };
const notificationSync = jest.requireMock('@/hooks/useNotificationSync') as {
  syncNotificationsFromStores: Mock;
};
const widgets = jest.requireMock('@/services/widgets') as { syncWidgets: Mock };
const liveActivity = jest.requireMock('@/services/liveActivity') as { syncLiveActivity: Mock };
const watch = jest.requireMock('@/services/watch') as { syncWatch: Mock };
const i18nModule = jest.requireMock('@/i18n') as { initI18n: Mock; applyLanguage: Mock };
const trackingStore = jest.requireMock('@/stores/trackingStore') as {
  getTrackingActions: Mock;
  useTrackingStore: { getState: Mock };
};
const settingsStore = jest.requireMock('@/stores/settingsStore') as { getSettingsSnapshot: Mock };

/** The store's `hydrate`, shared across calls so a test can count it. */
const hydrate = jest.fn();

beforeEach(() => {
  // Not `defineTask`: it was called once, at import, and that single call is what the first block
  // below asserts on.
  dbClient.runMigrations.mockClear().mockResolvedValue(undefined);
  notificationSync.syncNotificationsFromStores.mockClear().mockResolvedValue(null);
  widgets.syncWidgets.mockReset().mockResolvedValue('unchanged');
  liveActivity.syncLiveActivity.mockClear().mockResolvedValue('unsupported');
  watch.syncWatch.mockClear().mockResolvedValue('unsupported');
  i18nModule.applyLanguage.mockClear().mockResolvedValue(false);
  i18nModule.initI18n.mockClear();
  hydrate.mockClear();
  trackingStore.getTrackingActions.mockClear().mockReturnValue({ hydrate });
  trackingStore.useTrackingStore.getState.mockReturnValue({ hydrated: false });
  backgroundTask.getStatusAsync.mockReset().mockResolvedValue(AVAILABLE);
  backgroundTask.registerTaskAsync.mockReset().mockResolvedValue(undefined);
  settingsStore.getSettingsSnapshot.mockReturnValue({ language: 'system' });
});

describe('the task definition', () => {
  // The whole point of this module living outside `src/app/`: on a headless Android launch the
  // router never renders, so a definition reached only through a component would not exist.
  it('is registered with TaskManager at module scope', () => {
    expect(taskManager.defineTask).toHaveBeenCalledTimes(1);
    expect(taskManager.defineTask.mock.calls[0][0]).toBe(BACKGROUND_REFRESH_TASK);
    expect(typeof taskManager.defineTask.mock.calls[0][1]).toBe('function');
  });

  it('runs the whole refresh when the OS invokes it', async () => {
    const executor = taskManager.defineTask.mock.calls[0][1];

    await expect(executor()).resolves.toBe(SUCCESS);

    expect(notificationSync.syncNotificationsFromStores).toHaveBeenCalledTimes(1);
    expect(widgets.syncWidgets).toHaveBeenCalledTimes(1);
    expect(liveActivity.syncLiveActivity).toHaveBeenCalledTimes(1);
    expect(watch.syncWatch).toHaveBeenCalledTimes(1);
  });
});

describe('runBackgroundRefresh', () => {
  it('prepares the process and then runs every sync', async () => {
    const result = await runBackgroundRefresh();

    expect(result).toBe(SUCCESS);
    expect(dbClient.runMigrations).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(i18nModule.initI18n).toHaveBeenCalledTimes(1);
    expect(notificationSync.syncNotificationsFromStores).toHaveBeenCalledTimes(1);
    expect(widgets.syncWidgets).toHaveBeenCalledTimes(1);
    expect(liveActivity.syncLiveActivity).toHaveBeenCalledTimes(1);
    expect(watch.syncWatch).toHaveBeenCalledTimes(1);
  });

  // A run that lands while the app is already open must not throw away the day cache the user is
  // looking at, and must not pay for migrations that have already run.
  it('skips migrations and hydration when the store is already hydrated', async () => {
    trackingStore.useTrackingStore.getState.mockReturnValue({ hydrated: true });

    await runBackgroundRefresh();

    expect(dbClient.runMigrations).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
    expect(notificationSync.syncNotificationsFromStores).toHaveBeenCalledTimes(1);
  });

  // Every reminder carries the copy it was written with, and the root layout's language effect
  // never runs headlessly — so without this the next five days would be scheduled in the device's
  // language rather than the user's.
  it('applies the stored language, not the device one', async () => {
    settingsStore.getSettingsSnapshot.mockReturnValue({ language: 'ar' });

    await runBackgroundRefresh();

    expect(i18nModule.applyLanguage).toHaveBeenCalledWith('ar');
  });

  it('resolves "system" against the device language', async () => {
    settingsStore.getSettingsSnapshot.mockReturnValue({ language: 'system' });

    await runBackgroundRefresh();

    expect(i18nModule.applyLanguage).toHaveBeenCalledWith('tr');
  });

  // The independence property. A widget bridge that is missing must not cost the user reminders.
  it('keeps going when a step throws, and still reports success', async () => {
    widgets.syncWidgets.mockRejectedValue(new Error('no widget bridge'));

    const result = await runBackgroundRefresh();

    expect(result).toBe(SUCCESS);
    expect(liveActivity.syncLiveActivity).toHaveBeenCalledTimes(1);
    expect(watch.syncWatch).toHaveBeenCalledTimes(1);
  });

  it('keeps syncing when the database will not open', async () => {
    dbClient.runMigrations.mockRejectedValue(new Error('disk is full'));

    const result = await runBackgroundRefresh();

    expect(result).toBe(SUCCESS);
    expect(notificationSync.syncNotificationsFromStores).toHaveBeenCalledTimes(1);
  });

  // The watch and the widgets say the same thing about the same fourteen days, so the snapshot the
  // widget sync built is handed on rather than built twice — exactly as `useWidgetSync` does it.
  it('hands the widget snapshot on to the watch', async () => {
    const snapshot = { generatedAt: 1 };
    widgets.syncWidgets.mockImplementation(async (options) => {
      options?.onBuilt?.(snapshot);
      return 'written';
    });

    await runBackgroundRefresh();

    expect(watch.syncWatch).toHaveBeenCalledWith({ snapshot });
  });

  it('leaves the watch to build its own when the widgets never got that far', async () => {
    await runBackgroundRefresh();

    expect(watch.syncWatch).toHaveBeenCalledWith({ snapshot: undefined });
  });

  it('reports failure only when every step failed', async () => {
    const boom = () => Promise.reject(new Error('no'));
    const result = await runBackgroundRefresh({
      prepareStore: boom,
      prepareLanguage: boom,
      syncNotifications: boom,
      syncWidgetSnapshot: boom,
      syncActivity: boom,
      syncWatchEnvelope: boom,
    });

    expect(result).toBe(FAILED);
  });
});

describe('readBackgroundRefreshStatus', () => {
  it('maps the platform answers', async () => {
    backgroundTask.getStatusAsync.mockResolvedValue(AVAILABLE);
    await expect(readBackgroundRefreshStatus()).resolves.toBe('available');

    backgroundTask.getStatusAsync.mockResolvedValue(RESTRICTED);
    await expect(readBackgroundRefreshStatus()).resolves.toBe('restricted');
  });

  // Same policy as `exactAlarms`: a build with no native module gets an honest "cannot tell", and
  // the reliability screen renders no card at all for it.
  it('answers "unknown" rather than throwing when nothing can be asked', async () => {
    backgroundTask.getStatusAsync.mockRejectedValue(new Error('no native module'));
    await expect(readBackgroundRefreshStatus()).resolves.toBe('unknown');

    backgroundTask.getStatusAsync.mockResolvedValue(undefined as unknown as number);
    await expect(readBackgroundRefreshStatus()).resolves.toBe('unknown');
  });
});

describe('registerBackgroundRefresh', () => {
  it('registers the task with the chosen interval', async () => {
    await expect(registerBackgroundRefresh()).resolves.toBe('registered');

    expect(backgroundTask.registerTaskAsync).toHaveBeenCalledWith(BACKGROUND_REFRESH_TASK, {
      minimumInterval: BACKGROUND_REFRESH_INTERVAL_MINUTES,
    });
  });

  it('asks for an hour, comfortably above WorkManager’s fifteen-minute floor', () => {
    expect(BACKGROUND_REFRESH_INTERVAL_MINUTES).toBe(60);
  });

  // The user switching background work off is a choice, not an error, and it must not reach the
  // OS as a failed registration.
  it('does nothing when the platform is restricted', async () => {
    backgroundTask.getStatusAsync.mockResolvedValue(RESTRICTED);

    await expect(registerBackgroundRefresh()).resolves.toBe('restricted');
    expect(backgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('does nothing when the status cannot be read', async () => {
    backgroundTask.getStatusAsync.mockRejectedValue(new Error('no native module'));

    await expect(registerBackgroundRefresh()).resolves.toBe('unavailable');
    expect(backgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('never throws when the platform refuses the registration', async () => {
    backgroundTask.registerTaskAsync.mockRejectedValue(new Error('not configured'));

    await expect(registerBackgroundRefresh()).resolves.toBe('unavailable');
  });
});
