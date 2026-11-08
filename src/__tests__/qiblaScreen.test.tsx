/**
 * Screen test for the Qibla tab (`src/app/(tabs)/qibla.tsx`).
 *
 * The dial's *motion* lives on the UI thread and is covered by `CompassDial.test.tsx`; what is
 * asserted here is everything a user reads and feels, which is where a compass actually goes
 * wrong:
 *
 * 1. the aligned and not-aligned states differ in **words and icons**, not only in colour;
 * 2. the turn instruction takes the short way round — heading 350° with the Qibla at 1° is
 *    "turn right 11°", never "turn left 349°";
 * 3. the bearing, its cardinal and the distance are the domain's figures, localized;
 * 4. poor accuracy raises the figure-8 prompt, and dismissing it puts it away;
 * 5. no location falls back to the one shared prompt card rather than a second empty state;
 * 6. the alignment haptic fires **once per entry**, not once per sensor sample near the boundary.
 *
 * The heading hook is mocked — it owns a real magnetometer subscription — and so is MMKV, which
 * the settings singleton hydrates from at import. Everything else (the domain, the settings and
 * location stores, i18n, the components) is the real thing.
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, Dimensions } from 'react-native';
import type { TestInstance } from 'test-renderer';

import QiblaScreen from '../app/(tabs)/qibla';
import { DIAL_SIZE_MAX } from '../components/CompassDial';
import { KAABA, cardinalKey, distanceToKaabaKm, qiblaBearing } from '../domain/qibla';
import { initI18n } from '../i18n';
import { useLocationStore } from '../stores/locationStore';
import { useSettingsStore } from '../stores/settingsStore';

import type { HeadingView } from '../hooks/useHeading';

jest.mock('react-native-mmkv', () => {
  const instances = new Map<string, Map<string, string>>();
  return {
    createMMKV: ({ id }: { id: string }) => {
      let values = instances.get(id);
      if (values === undefined) {
        values = new Map();
        instances.set(id, values);
      }
      const store = values;
      return {
        id,
        set: (key: string, value: string) => void store.set(key, value),
        getString: (key: string) => store.get(key),
        remove: (key: string) => void store.delete(key),
        clearAll: () => store.clear(),
      };
    },
  };
});

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

// The safe-area provider and the navigator are installed by expo-router, which this test does not
// mount; the screen only needs the insets and "am I the visible tab".
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

/** Whether the tab is the visible one. The screen must hand this straight to `useHeading`. */
const mockFocused = { current: true };
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused.current }));

/** Every option object the screen passed to `useHeading`, newest last. */
const mockHeadingOptions: { enabled?: boolean }[] = [];

/** The mutable heading the mocked hook reports; each test writes the state it needs. */
const mockCompass: { current: Omit<HeadingView, 'sharedHeading'> } = {
  current: {
    status: 'active',
    heading: 0,
    reference: 'true',
    isMagneticFallback: false,
    confidence: 'high',
    needsCalibration: false,
    hasFix: true,
    permission: 'granted',
    canAskAgain: true,
    error: null,
    // The screen never mounts the UI-thread needle in these tests: the mocked hook has no sensor
    // to gate, and `CompassDial` is driven from the shared value the mock provides.
    nativeNeedle: null,
  },
};

jest.mock('../hooks/useHeading', () => {
  // Required lazily: a `jest.mock` factory may not close over an import (nor name a type).
  const reanimated =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native-reanimated') as typeof import('react-native-reanimated');
  const { useSharedValue } = reanimated;
  return {
    useHeading: (options: { enabled?: boolean } = {}) => {
      mockHeadingOptions.push(options);
      return { ...mockCompass.current, sharedHeading: useSharedValue(0) };
    },
  };
});

/** Every option object the screen passed to `useTilt`, newest last. */
const mockTiltOptions: { enabled?: boolean }[] = [];

/** The mutable tilt view the mocked hook reports; each test writes the state it needs. */
const mockTilt: { current: { isTilted: boolean; isFaceDown: boolean; available: boolean } } = {
  current: { isTilted: false, isFaceDown: false, available: true },
};

jest.mock('../hooks/useTilt', () => ({
  useTilt: (options: { enabled?: boolean } = {}) => {
    mockTiltOptions.push(options);
    return { ...mockTilt.current };
  },
}));

const haptics = jest.requireMock('expo-haptics') as { impactAsync: jest.Mock };

/** Brooklyn, as in the mockup: Qibla ≈ 58.5° (NE), ≈ 10,304 km away. */
const LOCATION = {
  latitude: 40.6782,
  longitude: -73.9442,
  label: 'Brooklyn, NY',
  countryCode: 'US',
  source: 'auto' as const,
  resolvedAt: 0,
};

/** Dar es Salaam: the Qibla is ≈ 1.2°, so a heading of 350° straddles the 0/360 wrap. */
const ACROSS_THE_WRAP = {
  latitude: -6.7924,
  longitude: 39.2083,
  label: 'Dar es Salaam',
  countryCode: 'TZ',
  source: 'auto' as const,
  resolvedAt: 0,
};

const BEARING = qiblaBearing(LOCATION);

async function renderScreen(heading: number | null = 0) {
  mockCompass.current = { ...mockCompass.current, heading, hasFix: heading !== null };
  const view = await render(<QiblaScreen />);
  // Let the alignment effect (and its haptic) run.
  await act(async () => {});
  return view;
}

/** Re-renders with a new heading, the way a sensor sample would. */
async function turnTo(rerender: (element: React.ReactElement) => unknown, heading: number) {
  mockCompass.current = { ...mockCompass.current, heading, hasFix: true };
  await act(async () => {
    await rerender(<QiblaScreen />);
  });
}

/** Every string rendered under a node, joined — the text a user actually sees there. */
function contentOf(testID: string): string {
  const parts: string[] = [];
  const walk = (node: TestInstance) => {
    for (const child of node.children) {
      if (typeof child === 'string') parts.push(child);
      else walk(child);
    }
  };
  walk(screen.getByTestId(testID));
  return parts.join('');
}

/** Asserts a node contains a phrase, ignoring the icon glyphs sharing the node with it. */
function expectContent(testID: string, text: string) {
  expect(contentOf(testID)).toContain(text);
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused.current = true;
  mockHeadingOptions.length = 0;
  mockTiltOptions.length = 0;
  mockTilt.current = { isTilted: false, isFaceDown: false, available: true };
  mockCompass.current = {
    status: 'active',
    heading: 0,
    reference: 'true',
    isMagneticFallback: false,
    confidence: 'high',
    needsCalibration: false,
    hasFix: true,
    permission: 'granted',
    canAskAgain: true,
    error: null,
    // The screen never mounts the UI-thread needle in these tests: the mocked hook has no sensor
    // to gate, and `CompassDial` is driven from the shared value the mock provides.
    nativeNeedle: null,
  };
  useSettingsStore.getState().setLocation(LOCATION);
  useLocationStore.setState({ status: 'ready', error: null, canAskAgain: true });
});

describe('Qibla screen', () => {
  it('names the city, sets the calligraphy and asks you to turn', async () => {
    await renderScreen(0);

    expectContent('qibla-header', 'Qibla · Brooklyn, NY');
    expect(screen.getByText('القِبلة')).toBeTruthy();
    expectContent('qibla-status', 'Turn to find the Qibla');
    expectContent('qibla-guidance', 'Turn 59° to the right');
    expectContent('qibla-footer', 'lay the phone flat for best accuracy');
  });

  it('renders the bearing, its cardinal and the distance from the domain', async () => {
    await renderScreen(0);

    const expectedBearing = `${Math.round(BEARING)}° NE`;
    expect(cardinalKey(BEARING)).toBe('qibla.cardinal.ne');
    expectContent('qibla-info-bearing', expectedBearing);
    expectContent(
      'qibla-info-distance',
      `${new Intl.NumberFormat('en').format(Math.round(distanceToKaabaKm(LOCATION)))} km`
    );
    expectContent('qibla-info-heading', '0°');
  });

  it('changes word and icon — not only colour — when the Qibla is found', async () => {
    const { rerender } = await renderScreen(0);
    const notAligned = screen.getByTestId('qibla-status').props.accessibilityLabel;

    await turnTo(rerender, BEARING);

    expectContent('qibla-status', 'Facing the Qibla');
    expect(screen.getByTestId('qibla-status').props.accessibilityLabel).not.toBe(notAligned);
    expectContent('qibla-guidance', 'Aligned — you may begin');
    // The release band, not the entry one — the number has to be true wherever it is shown (D86).
    expectContent('qibla-guidance', 'Within 6° of the Kaaba');
  });

  it('turns the short way round the 0/360 wrap', async () => {
    useSettingsStore.getState().setLocation(ACROSS_THE_WRAP);
    await renderScreen(350);

    // The Qibla is at ~1°: 11° clockwise away, not 349° anticlockwise.
    expectContent('qibla-guidance', 'Turn 11° to the right');
    expect(contentOf('qibla-guidance')).not.toContain('left');
  });

  it('reports the turn direction on both sides of the bearing', async () => {
    const { rerender } = await renderScreen(BEARING - 30);
    expectContent('qibla-guidance', 'Turn 30° to the right');

    await turnTo(rerender, BEARING + 30);
    expectContent('qibla-guidance', 'Turn 30° to the left');
  });

  it('lets the sensor run only while the tab is the visible one', async () => {
    const { rerender } = await renderScreen(0);
    expect(mockHeadingOptions.at(-1)?.enabled).toBe(true);

    // Leaving the tab (and, inside the hook, backgrounding the app) has to stop the magnetometer:
    // a compass left watching is the battery complaint every competitor collects.
    mockFocused.current = false;
    await act(async () => {
      await rerender(<QiblaScreen />);
    });

    expect(mockHeadingOptions.at(-1)?.enabled).toBe(false);
  });

  it('engages at exactly five degrees off, and not at six', async () => {
    // PRODUCT_SPEC §9: aligned "when (≤5°)" — the boundary itself is inside the window.
    const { rerender } = await renderScreen(BEARING - 5);
    expectContent('qibla-status', 'Facing the Qibla');
    expectContent('qibla-guidance', 'Aligned — you may begin');

    // Turning away past the release window and coming back to 6° off must NOT engage it.
    await turnTo(rerender, BEARING + 40);
    expectContent('qibla-status', 'Turn to find the Qibla');
    await turnTo(rerender, BEARING - 6);
    expectContent('qibla-status', 'Turn to find the Qibla');
    expectContent('qibla-guidance', 'Turn 6° to the right');

    // The other side of the bearing behaves identically.
    await turnTo(rerender, BEARING + 5);
    expectContent('qibla-status', 'Facing the Qibla');
  });

  it('lets go just past six degrees, and says the number it means (D86)', async () => {
    // A user reported both halves of this. The release band was 8°, so the card went on saying
    // "Within 5° of the Kaaba" while they stood 8° off — a sentence that was simply false — and
    // because the heading is published in whole degrees, the first correction they ever saw
    // jumped to "Turn 9°": 6, 7 and 8 never appeared. The band is 6° now, and the card is told
    // the figure the band actually uses, so the claim is true at every degree it is shown at.
    const { rerender } = await renderScreen(BEARING);
    expectContent('qibla-status', 'Facing the Qibla');
    expectContent('qibla-guidance', 'Within 6° of the Kaaba');

    // Inside the release band it holds, exactly as the hysteresis intends.
    await turnTo(rerender, BEARING + 6);
    expectContent('qibla-status', 'Facing the Qibla');

    // One degree further and it lets go, with a number that follows on from where it let go
    // rather than skipping three degrees to reach the user.
    await turnTo(rerender, BEARING + 7);
    expectContent('qibla-status', 'Turn to find the Qibla');
    expectContent('qibla-guidance', 'Turn 7° to the left');
  });

  it('says out loud when it locks on, and when it lets go', async () => {
    // The one moment on this screen that a blind user cannot be looking for: the phone is moving,
    // so their VoiceOver focus is nowhere near the pill that changed — and the pill's
    // `accessibilityLiveRegion` is Android-only in React Native, which left iOS silent. The
    // hysteresis that keeps the pill from chattering keeps this from chattering too.
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);

    // Arriving already facing the Qibla is confirmed, exactly as the haptic confirms it — the
    // alignment settles a render after mount, so it was not in what the reader read.
    const { rerender } = await renderScreen(BEARING);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Facing the Qibla');

    await turnTo(rerender, BEARING + 40);
    expect(announce).toHaveBeenLastCalledWith('Turn to find the Qibla');

    await turnTo(rerender, BEARING);
    expect(announce).toHaveBeenLastCalledWith('Facing the Qibla');

    // Sensor noise inside the engage window is not an event, and must not be spoken as one.
    const spokenSoFar = announce.mock.calls.length;
    await turnTo(rerender, BEARING + 2);
    await turnTo(rerender, BEARING - 3);
    await turnTo(rerender, BEARING + 4);
    expect(announce).toHaveBeenCalledTimes(spokenSoFar);

    announce.mockRestore();
  });

  it('turns the short way from the southern hemisphere too', async () => {
    // Sydney: the Qibla is ≈277.5°, i.e. a little north of west. From due north that is 83° to
    // the LEFT — a screen that subtracted the two angles would send the user 277° to the right.
    const SYDNEY = {
      latitude: -33.8688,
      longitude: 151.2093,
      label: 'Sydney',
      countryCode: 'AU',
      source: 'auto' as const,
      resolvedAt: 0,
    };
    useSettingsStore.getState().setLocation(SYDNEY);
    const bearing = qiblaBearing(SYDNEY);
    expect(Math.round(bearing)).toBe(277);

    const { rerender } = await renderScreen(0);
    expectContent('qibla-guidance', 'Turn 83° to the left');
    expectContent('qibla-info-bearing', '277° W');

    await turnTo(rerender, 200);
    expectContent('qibla-guidance', 'Turn 77° to the right');
    await turnTo(rerender, bearing);
    expectContent('qibla-status', 'Facing the Qibla');
  });

  it('still answers a few kilometres from the Kaaba', async () => {
    // Mina, ~7 km east of the Kaaba: the bearing is real, the distance is small, and neither the
    // dial nor the guidance may collapse into a "—".
    const MINA = {
      latitude: 21.4133,
      longitude: 39.8933,
      label: 'Mina',
      countryCode: 'SA',
      source: 'auto' as const,
      resolvedAt: 0,
    };
    useSettingsStore.getState().setLocation(MINA);
    await renderScreen(0);

    expect(screen.getByTestId('qibla-dial')).toBeTruthy();
    expectContent('qibla-info-distance', '7 km');
    expectContent('qibla-info-bearing', '278° W');
    expectContent('qibla-guidance', 'Turn 82° to the left');
  });

  it('does not break down standing on the Kaaba itself', async () => {
    useSettingsStore.getState().setLocation({
      latitude: KAABA.latitude,
      longitude: KAABA.longitude,
      label: 'Makkah',
      countryCode: 'SA',
      source: 'auto' as const,
      resolvedAt: 0,
    });
    await renderScreen(0);

    // Zero distance, a finite bearing, and a screen that still renders its dial rather than the
    // no-location prompt.
    expectContent('qibla-info-distance', '0 km');
    expect(screen.getByTestId('qibla-dial')).toBeTruthy();
    expect(screen.queryByTestId('qibla-location-prompt')).toBeNull();
    expect(contentOf('qibla-info-bearing')).not.toContain('NaN');
  });

  it('raises the figure-8 prompt on low accuracy, and puts it away when dismissed', async () => {
    mockCompass.current = { ...mockCompass.current, confidence: 'low', needsCalibration: true };
    await renderScreen(0);

    expect(screen.getByTestId('qibla-calibration')).toBeTruthy();
    expectContent('qibla-accuracy', 'Low');

    await act(async () => {
      fireEvent.press(screen.getByTestId('qibla-calibration-dismiss'));
    });

    expect(screen.queryByTestId('qibla-calibration')).toBeNull();
  });

  it('keeps quiet about calibration while the reading is good', async () => {
    await renderScreen(0);

    expect(screen.queryByTestId('qibla-calibration')).toBeNull();
    expectContent('qibla-accuracy', 'High');
    expect(screen.queryByTestId('qibla-accuracy-magnetic')).toBeNull();
  });

  it('honours the hook’s grace period: low accuracy alone does not flash the card', async () => {
    // Inside the 1.5 s grace the hook reports `low` with `needsCalibration` still false —
    // Android delivers its first sample before its first onAccuracyChanged. The screen once
    // re-added `|| confidence === 'low'` and flashed the card on every open; it must trust
    // the hysteresis it was handed instead.
    mockCompass.current = { ...mockCompass.current, confidence: 'low', needsCalibration: false };
    await renderScreen(0);

    expect(screen.queryByTestId('qibla-calibration')).toBeNull();
    expectContent('qibla-accuracy', 'Low');
  });

  it('asks for a flatter phone while the tilt hook says the posture is steep', async () => {
    mockTilt.current = { isTilted: true, isFaceDown: false, available: true };
    await renderScreen(0);

    expect(screen.getByTestId('qibla-tilt-hint')).toBeTruthy();
    expectContent('qibla-tilt-hint', 'Hold your phone flatter');
    // The needle stays: the hint advises, it never punishes (B-2).
    expect(screen.getByTestId('qibla-dial')).toBeTruthy();
  });

  it('says nothing about tilt while the phone is held reasonably', async () => {
    await renderScreen(0);
    expect(screen.queryByTestId('qibla-tilt-hint')).toBeNull();
    expect(screen.queryByTestId('qibla-face-down-hint')).toBeNull();
  });

  it('asks for the phone to be turned over while the screen faces the floor (D172)', async () => {
    mockTilt.current = { isTilted: true, isFaceDown: true, available: true };
    await renderScreen(0);

    expect(screen.getByTestId('qibla-face-down-hint')).toBeTruthy();
    expectContent('qibla-face-down-hint', 'turn the phone over');
    // One posture hint at a time, and face-down is the one that matters more.
    expect(screen.queryByTestId('qibla-tilt-hint')).toBeNull();
    // The needle stays, as with the tilt hint: the warning advises, never punishes.
    expect(screen.getByTestId('qibla-dial')).toBeTruthy();
  });

  it('runs the accelerometer only while there is a live needle to advise on', async () => {
    await renderScreen(0);
    expect(mockTiltOptions.at(-1)?.enabled).toBe(true);

    mockCompass.current = { ...mockCompass.current, status: 'permissionRequired' };
    await renderScreen(0);
    expect(mockTiltOptions.at(-1)?.enabled).toBe(false);
  });

  it('keeps the accelerometer off with no location at all', async () => {
    useSettingsStore.getState().setLocation(null);
    await renderScreen(null);
    expect(mockTiltOptions.at(-1)?.enabled).toBe(false);
  });

  it('brings the calibration instructions back when Recalibrate is tapped', async () => {
    await renderScreen(0);
    expect(screen.queryByTestId('qibla-calibration')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qibla-recalibrate'));
    });

    expect(screen.getByTestId('qibla-calibration')).toBeTruthy();
  });

  it('says so when only a magnetic heading is available', async () => {
    mockCompass.current = {
      ...mockCompass.current,
      reference: 'magnetic',
      isMagneticFallback: true,
    };
    await renderScreen(0);

    expect(screen.getByTestId('qibla-accuracy-magnetic')).toBeTruthy();
  });

  it('offers the permission card, not a confident dial, when the compass may not run', async () => {
    mockCompass.current = {
      ...mockCompass.current,
      status: 'permissionRequired',
      permission: 'denied',
      hasFix: false,
      heading: null,
    };
    await renderScreen(null);

    expect(screen.getByTestId('qibla-compass-permission')).toBeTruthy();
    expect(screen.queryByTestId('qibla-accuracy')).toBeNull();
    // The bearing and the distance are properties of the place, so they stay on screen.
    expect(screen.getByTestId('qibla-info-bearing')).toBeTruthy();
  });

  it('says outright when the device has no compass', async () => {
    mockCompass.current = {
      ...mockCompass.current,
      status: 'unavailable',
      error: 'sensorUnavailable',
      hasFix: false,
      heading: null,
    };
    await renderScreen(null);

    expectContent('qibla-no-compass', 'This device has no compass');
    expect(screen.getByTestId('qibla-info-bearing')).toBeTruthy();
  });

  it('shows the shared location prompt instead of a dial when there is no location', async () => {
    useSettingsStore.getState().setLocation(null);
    await renderScreen(0);

    expect(screen.getByTestId('qibla-location-prompt')).toBeTruthy();
    expect(screen.queryByTestId('qibla-dial')).toBeNull();
    expect(screen.queryByTestId('qibla-info-bearing')).toBeNull();
    // No status pill either. Without a location there is no bearing, so "turn to find the Qibla"
    // would be telling the user to do something that cannot succeed — and sitting right above the
    // card asking for their location, it reads as though the compass were already working.
    expect(screen.queryByTestId('qibla-status')).toBeNull();
    // The screen still says what it is, and still gives its one hint.
    expect(screen.getByText('القِبلة')).toBeTruthy();
    expect(screen.getByTestId('qibla-footer')).toBeTruthy();
  });

  it('shows the status pill again as soon as there is a location', async () => {
    // The other half: the pill is suppressed for want of a bearing, not removed.
    await renderScreen(0);
    expect(screen.getByTestId('qibla-status')).toBeTruthy();
  });

  it('waits for a heading rather than pretending to have one', async () => {
    mockCompass.current = { ...mockCompass.current, status: 'starting', hasFix: false };
    await renderScreen(null);

    expectContent('qibla-info-heading', '—');
    expectContent('qibla-guidance', 'Looking for your heading');
    expect(haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('fires the alignment haptic once per entry, not once per sample', async () => {
    const { rerender } = await renderScreen(0);
    expect(haptics.impactAsync).not.toHaveBeenCalled();

    await turnTo(rerender, BEARING);
    expect(haptics.impactAsync).toHaveBeenCalledTimes(1);

    // Hovering around the boundary: inside the 5° entry window, and out to the 6° release window,
    // must not re-fire — a hand is never still, and a stuttering haptic is unbearable.
    await turnTo(rerender, BEARING + 4);
    await turnTo(rerender, BEARING - 6);
    await turnTo(rerender, BEARING + 6);
    expect(haptics.impactAsync).toHaveBeenCalledTimes(1);
    expectContent('qibla-status', 'Facing the Qibla');

    // Genuinely turning away releases it…
    await turnTo(rerender, BEARING + 40);
    expectContent('qibla-status', 'Turn to find the Qibla');
    expect(haptics.impactAsync).toHaveBeenCalledTimes(1);

    // …and coming back is a new entry, so it taps again.
    await turnTo(rerender, BEARING);
    expect(haptics.impactAsync).toHaveBeenCalledTimes(2);
  });
});

/**
 * The expanded layout (D124): the instrument takes the leading pane and its readings the trailing
 * one, so the dial can grow into the room a landscape tablet actually has.
 *
 * The suite above runs at the ambient 750pt — a *medium* window — and therefore still covers the
 * single column. Nothing about the sensor, the hysteresis or the haptic changes here; that is the
 * point of the split being a layout change and nothing more.
 */
describe('at expanded width', () => {
  beforeEach(() => {
    jest
      .spyOn(Dimensions, 'get')
      .mockImplementation(() => ({ width: 1194, height: 834, scale: 2, fontScale: 1 }));
  });

  it('puts the dial in the leading pane and the readings in the trailing one — LANDSCAPE only (owner, 2026-08-28)', async () => {
    await renderScreen(BEARING);

    const start = within(screen.getByTestId('qibla-panes-start'));
    const end = within(screen.getByTestId('qibla-panes-end'));
    expect(start.getByTestId('qibla-dial')).toBeTruthy();
    expect(start.getByTestId('qibla-header')).toBeTruthy();
    expect(start.getByTestId('qibla-status')).toBeTruthy();
    expect(end.getByTestId('qibla-footer')).toBeTruthy();
    expect(end.queryByTestId('qibla-dial')).toBeNull();
  });

  it('keeps one centred column in PORTRAIT, however wide (owner, 2026-08-28)', async () => {
    jest
      .spyOn(Dimensions, 'get')
      .mockImplementation(() => ({ width: 1024, height: 1366, scale: 2, fontScale: 1 }));
    await renderScreen(BEARING);

    expect(screen.queryByTestId('qibla-panes-start')).toBeNull();
    const scroll = within(screen.getByTestId('qibla-scroll'));
    expect(scroll.getByTestId('qibla-dial')).toBeTruthy();
    expect(scroll.getByTestId('qibla-footer')).toBeTruthy();
  });

  it('grows the dial into its pane, without outgrowing the cap', async () => {
    await renderScreen(BEARING);

    const style = JSON.stringify(screen.getByTestId('qibla-dial').props.style);
    expect(style).toContain(`"width":${String(DIAL_SIZE_MAX)}`);
  });

  it('keeps the sensor gated on focus, exactly as in one column', async () => {
    await renderScreen(BEARING);
    expect(mockHeadingOptions.at(-1)?.enabled).toBe(true);
  });

  it('still says everything alignment says, in words and glyphs', async () => {
    await renderScreen(BEARING);
    expectContent('qibla-status', 'Facing the Qibla');
  });

  it('stays a single column while there is no location to point from', async () => {
    useSettingsStore.getState().setLocation(null);
    await renderScreen(BEARING);

    // One calm card asking for a place is not something to spread across two panes.
    expect(screen.queryByTestId('qibla-panes-start')).toBeNull();
    expect(screen.getByTestId('qibla-location-prompt')).toBeTruthy();
  });
});
