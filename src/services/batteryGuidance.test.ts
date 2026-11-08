/**
 * Android battery-management guidance.
 *
 * Two things have to hold, and they pull in opposite directions:
 *
 * 1. **Reach the right screen.** The OEM auto-start activities are undocumented and version
 *    specific, so the module tries several and always has a fallback. Every branch of that
 *    ladder is exercised here, because the failure mode in the field is silent — a button that
 *    does nothing on the one phone that needed it.
 * 2. **Never claim to know the exemption state.** `modules/exact-alarms` can now read
 *    `PowerManager.isIgnoringBatteryOptimizations`, so the answer is usually real — but a build
 *    without the native module, a platform that has no such idea, and a probe that throws all have
 *    to come back `'unknown'`. A wrong green tick on the reliability screen would be worse than no
 *    screen at all (our market research).
 *
 * The manufacturer matcher gets its own block: it is what turns "some phones misbehave" into
 * "your Xiaomi does", which is the difference between advice a user follows and advice they
 * scroll past.
 */

import {
  AGGRESSIVE_OEMS,
  AUTO_START_TARGETS,
  BATTERY_OPTIMISATION_ACTION,
  currentOemFamily,
  detectOemFamily,
  hasAggressiveBatteryManager,
  openAutoStartSettings,
  openBatteryOptimisationSettings,
  readExemptionState,
  setBatteryGuidanceAdapter,
  setExemptionProbe,
  type AutoStartTarget,
  type BatteryGuidanceAdapter,
  type OemFamily,
} from './batteryGuidance';

/**
 * What the phone answers about the exemption. `null` is a build with no native module, which is
 * every Jest run and every dev client older than the call.
 */
let mockNativeExempt: boolean | null = null;
/** Whether the native call itself blows up, which the probe has to survive. */
let mockNativeThrows = false;

jest.mock('../../modules/exact-alarms', () => ({
  isIgnoringBatteryOptimizations: async () => {
    if (mockNativeThrows) throw new Error('binder died');
    return mockNativeExempt;
  },
}));

interface FakeAdapter extends BatteryGuidanceAdapter {
  readonly started: { action: string; params?: AutoStartTarget }[];
  appSettingsOpened: number;
}

function fakeAdapter({
  platform = 'android' as BatteryGuidanceAdapter['platform'],
  manufacturer = 'Xiaomi',
  brand = 'Redmi',
  /** Components that "exist"; anything else rejects the way a missing activity does. */
  resolvable = (_action: string, _params?: AutoStartTarget) => true,
  appSettingsFails = false,
}: {
  platform?: BatteryGuidanceAdapter['platform'];
  manufacturer?: string | null;
  brand?: string | null;
  resolvable?: (action: string, params?: AutoStartTarget) => boolean;
  appSettingsFails?: boolean;
} = {}): FakeAdapter {
  const started: { action: string; params?: AutoStartTarget }[] = [];
  const adapter: FakeAdapter = {
    platform,
    started,
    appSettingsOpened: 0,
    manufacturer: () => manufacturer,
    brand: () => brand,
    async startActivity(action, params) {
      started.push({ action, params });
      if (!resolvable(action, params)) throw new Error('ActivityNotFoundException');
    },
    async openAppSettings() {
      adapter.appSettingsOpened += 1;
      if (appSettingsFails) throw new Error('no settings');
    },
  };
  return adapter;
}

beforeEach(() => {
  mockNativeExempt = null;
  mockNativeThrows = false;
});

afterEach(() => {
  setBatteryGuidanceAdapter(null);
  setExemptionProbe(null);
});

describe('naming the manufacturer', () => {
  it.each<[string, string, OemFamily]>([
    ['Xiaomi', 'Redmi', 'xiaomi'],
    ['Xiaomi', 'POCO', 'xiaomi'],
    ['HUAWEI', 'HONOR', 'huawei'],
    ['OPPO', 'OPPO', 'oppo'],
    ['realme', 'realme', 'oppo'],
    ['OnePlus', 'OnePlus', 'oneplus'],
    ['vivo', 'iQOO', 'vivo'],
    ['samsung', 'samsung', 'samsung'],
    ['Google', 'google', 'other'],
    ['Fairphone', 'Fairphone', 'other'],
  ])('reads %s/%s as %s', (manufacturer, brand, expected) => {
    expect(detectOemFamily(manufacturer, brand)).toBe(expected);
  });

  it('matches on either field, since ROMs fill only one of them', () => {
    expect(detectOemFamily(null, 'Redmi')).toBe('xiaomi');
    expect(detectOemFamily('Samsung', null)).toBe('samsung');
  });

  it('answers "other" when the device says nothing', () => {
    expect(detectOemFamily(null, null)).toBe('other');
    expect(detectOemFamily('', '  ')).toBe('other');
  });

  it('only accuses the families that actually behave differently', () => {
    expect(hasAggressiveBatteryManager('xiaomi')).toBe(true);
    expect(hasAggressiveBatteryManager('other')).toBe(false);
    // Every accused family must have somewhere to send the user; a warning with no fix is noise.
    for (const family of AGGRESSIVE_OEMS) {
      expect(AUTO_START_TARGETS[family].length).toBeGreaterThan(0);
    }
  });

  it('reports "other" on iOS without reading the device at all', () => {
    const adapter = fakeAdapter({ platform: 'ios', manufacturer: 'Apple' });
    setBatteryGuidanceAdapter(adapter);

    expect(currentOemFamily()).toBe('other');
  });
});

describe('opening the battery screen', () => {
  it('uses the stock Android list', async () => {
    const adapter = fakeAdapter();
    setBatteryGuidanceAdapter(adapter);

    await expect(openBatteryOptimisationSettings()).resolves.toBe('opened');
    expect(adapter.started[0]?.action).toBe(BATTERY_OPTIMISATION_ACTION);
    expect(adapter.appSettingsOpened).toBe(0);
  });

  it('falls back to this app’s settings page when the ROM has no such screen', async () => {
    const adapter = fakeAdapter({ resolvable: () => false });
    setBatteryGuidanceAdapter(adapter);

    await expect(openBatteryOptimisationSettings()).resolves.toBe('opened');
    expect(adapter.appSettingsOpened).toBe(1);
  });

  it('reports unavailable rather than throwing when nothing opens', async () => {
    setBatteryGuidanceAdapter(fakeAdapter({ resolvable: () => false, appSettingsFails: true }));

    await expect(openBatteryOptimisationSettings()).resolves.toBe('unavailable');
  });

  it('does nothing on iOS', async () => {
    const adapter = fakeAdapter({ platform: 'ios' });
    setBatteryGuidanceAdapter(adapter);

    await expect(openBatteryOptimisationSettings()).resolves.toBe('unavailable');
    expect(adapter.started).toHaveLength(0);
  });
});

describe('opening the OEM auto-start screen', () => {
  it('launches the manufacturer’s own component', async () => {
    const adapter = fakeAdapter();
    setBatteryGuidanceAdapter(adapter);

    await expect(openAutoStartSettings('xiaomi')).resolves.toBe('opened');
    expect(adapter.started[0]?.params).toEqual(AUTO_START_TARGETS.xiaomi[0]);
  });

  it('tries every candidate before giving up on the OEM', async () => {
    // Huawei ships two known components and the first is gone on newer EMUI.
    const [first, second] = AUTO_START_TARGETS.huawei;
    const adapter = fakeAdapter({
      manufacturer: 'HUAWEI',
      resolvable: (_action, params) => params?.className === second.className,
    });
    setBatteryGuidanceAdapter(adapter);

    await expect(openAutoStartSettings('huawei')).resolves.toBe('opened');
    expect(adapter.started.map((entry) => entry.params?.className)).toEqual([
      first.className,
      second.className,
    ]);
  });

  it('falls through to the stock battery screen when no component resolves', async () => {
    const adapter = fakeAdapter({
      resolvable: (action) => action === BATTERY_OPTIMISATION_ACTION,
    });
    setBatteryGuidanceAdapter(adapter);

    await expect(openAutoStartSettings('xiaomi')).resolves.toBe('opened');
    expect(adapter.started.at(-1)?.action).toBe(BATTERY_OPTIMISATION_ACTION);
  });

  it('goes straight to the stock screen for a manufacturer with no known component', async () => {
    const adapter = fakeAdapter({ manufacturer: 'Google', brand: 'google' });
    setBatteryGuidanceAdapter(adapter);

    await expect(openAutoStartSettings('other')).resolves.toBe('opened');
    expect(adapter.started).toHaveLength(1);
    expect(adapter.started[0]?.action).toBe(BATTERY_OPTIMISATION_ACTION);
  });
});

describe('the exemption state', () => {
  it('reports the exemption when the OS says it is in place', async () => {
    setBatteryGuidanceAdapter(fakeAdapter());
    mockNativeExempt = true;

    await expect(readExemptionState()).resolves.toBe('exempt');
  });

  it('reports the restriction when it is not', async () => {
    setBatteryGuidanceAdapter(fakeAdapter());
    mockNativeExempt = false;

    await expect(readExemptionState()).resolves.toBe('restricted');
  });

  // A dev client built before `modules/exact-alarms` carried the call. `null` is not `false`: the
  // screen must not tell someone their reminders are restricted on the strength of a question
  // nobody asked.
  it('is unknown when the running binary cannot be asked', async () => {
    setBatteryGuidanceAdapter(fakeAdapter());
    mockNativeExempt = null;

    await expect(readExemptionState()).resolves.toBe('unknown');
  });

  it('uses an installed probe in preference to the real one', async () => {
    setBatteryGuidanceAdapter(fakeAdapter());
    mockNativeExempt = false;
    setExemptionProbe(async () => 'exempt');

    await expect(readExemptionState()).resolves.toBe('exempt');
  });

  it('stays unknown when the probe fails, rather than guessing', async () => {
    setBatteryGuidanceAdapter(fakeAdapter());
    setExemptionProbe(async () => {
      throw new Error('binder died');
    });

    await expect(readExemptionState()).resolves.toBe('unknown');
  });

  it('never asks the native module at all when the probe throws on import', async () => {
    setBatteryGuidanceAdapter(fakeAdapter());
    mockNativeThrows = true;

    await expect(readExemptionState()).resolves.toBe('unknown');
  });

  it('is unknown on iOS whatever the probe says', async () => {
    setBatteryGuidanceAdapter(fakeAdapter({ platform: 'ios' }));
    setExemptionProbe(async () => 'exempt');

    await expect(readExemptionState()).resolves.toBe('unknown');
  });
});
