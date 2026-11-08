/**
 * The Today dashboard's live qibla dial (D124) — the owner's explicit choice over a static bearing
 * card, so the costs that choice carries are what this file pins:
 *
 * 1. **The sensor is only ever on while the dial is.** The component is mounted only at expanded
 *    width, and it ANDs that with focus — a tablet parked on Settings must not be reading the
 *    magnetometer.
 * 2. **Alignment is never colour alone.** The caption says it in words.
 * 3. **It removes itself** rather than showing a dial that cannot turn, or one whose lettering
 *    would fall under the 10pt floor.
 */

import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { QiblaGlance, MINI_DIAL_SIZE } from '../QiblaGlance';
import { initI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';

configure({ defaultIncludeHiddenElements: true });

jest.mock('expo-router', () => ({
  router: { navigate: jest.fn() },
  useIsFocused: () => mockFocused,
}));

let mockFocused = true;

/** What `useHeading` reports, and whether it was asked to run. */
let mockHeading: {
  status: string;
  heading: number | null;
  hasFix: boolean;
};
const mockHeadingEnabled = jest.fn();

jest.mock('@/hooks/useHeading', () => ({
  useHeading: (options: { enabled: boolean }) => {
    mockHeadingEnabled(options.enabled);
    return {
      ...mockHeading,
      sharedHeading: { get: () => mockHeading.heading ?? 0, set: () => undefined, value: 0 },
      reference: 'true',
      isMagneticFallback: false,
      confidence: 'high',
      needsCalibration: false,
      permission: 'granted',
      canAskAgain: true,
      error: null,
      // iOS-shaped: the UI-thread needle is Android-only, and these tests drive the dial from
      // `sharedHeading` above.
      nativeNeedle: null,
    };
  },
}));

const ISTANBUL = {
  latitude: 41.0082,
  longitude: 28.9784,
  label: 'Istanbul',
  countryCode: 'TR',
  source: 'manual' as const,
  resolvedAt: 0,
};

/** Istanbul's qibla bearing, near enough for a test to aim at. */
const QIBLA_BEARING = 151.6;

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockHeading = { status: 'active', heading: 10, hasFix: true };
  useSettingsStore.getState().setLocation(ISTANBUL);
});

async function renderGlance() {
  const view = await render(<QiblaGlance />);
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
  return view;
}

describe('QiblaGlance', () => {
  it('draws the dial at the glance size', async () => {
    await renderGlance();

    const dial = screen.getByTestId('today-glance-qibla-dial');
    expect(JSON.stringify(dial.props.style)).toContain(`"width":${String(MINI_DIAL_SIZE)}`);
  });

  it('states the bearing in words while it is not aligned', async () => {
    mockHeading = { status: 'active', heading: 10, hasFix: true };
    await renderGlance();

    // 10° against a ~152° bearing is nowhere near aligned, so the caption is the bearing itself.
    expect(screen.getByTestId('today-glance-qibla-status')).toBeTruthy();
    expect(screen.queryByText('Facing the Qibla')).toBeNull();
  });

  it('says "facing the Qibla" in words, not only in green', async () => {
    mockHeading = { status: 'active', heading: QIBLA_BEARING, hasFix: true };
    await renderGlance();

    expect(screen.getByText('Facing the Qibla')).toBeTruthy();
  });

  it('runs the sensor while it is on screen', async () => {
    await renderGlance();
    expect(mockHeadingEnabled).toHaveBeenCalledWith(true);
  });

  it('does not run the sensor when the tab is not focused', async () => {
    mockFocused = false;
    await renderGlance();

    expect(mockHeadingEnabled).toHaveBeenCalledWith(false);
    expect(mockHeadingEnabled).not.toHaveBeenCalledWith(true);
  });

  it('renders nothing at all without a location', async () => {
    useSettingsStore.getState().setLocation(null);
    await renderGlance();

    expect(screen.queryByTestId('today-glance-qibla-card')).toBeNull();
    expect(screen.queryByTestId('today-glance-qibla-dial')).toBeNull();
  });

  it('renders nothing on a device whose compass the platform refuses', async () => {
    mockHeading = { status: 'unavailable', heading: null, hasFix: false };
    await renderGlance();

    expect(screen.queryByTestId('today-glance-qibla-card')).toBeNull();
  });

  it('carries its own divider when it draws', async () => {
    await renderGlance();
    expect(screen.getByText('◆')).toBeTruthy();
  });

  it('puts its rule before the card by default, for a block that follows something', async () => {
    await renderGlance();

    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered.indexOf('◆')).toBeLessThan(rendered.indexOf('today-glance-qibla-card'));
    expect(screen.getAllByText('◆')).toHaveLength(1);
  });

  it('puts its rule after the card when it leads the pane', async () => {
    await render(<QiblaGlance divider="trailing" />);

    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered.indexOf('◆')).toBeGreaterThan(rendered.indexOf('today-glance-qibla-card'));
    expect(screen.getAllByText('◆')).toHaveLength(1);
  });

  it('takes its divider with it when it omits itself, leaving no stranded rule', async () => {
    useSettingsStore.getState().setLocation(null);
    await renderGlance();

    expect(screen.queryByText('◆')).toBeNull();
  });

  it('opens the Qibla tab when pressed', async () => {
    await renderGlance();

    await act(async () => {
      fireEvent.press(screen.getByTestId('today-glance-qibla'));
    });
    expect(router.navigate).toHaveBeenCalledWith('/qibla');
  });

  it('is one accessibility element, and states the numbers', async () => {
    await renderGlance();

    const target = screen.getByTestId('today-glance-qibla');
    expect(target.props.accessibilityRole).toBe('button');
    expect(String(target.props.accessibilityLabel)).toContain('152');
    // The dial inside is hidden, so the numbers are not announced twice.
    expect(screen.queryByTestId('today-glance-qibla-dial', { includeHiddenElements: false })).toBeNull();
  });
});
