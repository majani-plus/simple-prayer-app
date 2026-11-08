import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { TrackingModeDemo } from '../TrackingModeDemo';
import { __resetReduceMotionForTests } from '@/hooks/useReduceMotion';
import { initI18n } from '@/i18n';

let reduceMotion = false;

beforeAll(async () => {
  await initI18n().changeLanguage('en');
});

beforeEach(() => {
  jest.useFakeTimers();
  __resetReduceMotionForTests();
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => Promise.resolve(reduceMotion));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const faceLabel = (id: string) =>
  String(screen.getByTestId(id, { includeHiddenElements: true }).props.accessibilityLabel);

describe('TrackingModeDemo', () => {
  it('loops the simple seal between prayed and missed, hidden from screen readers', async () => {
    reduceMotion = false;
    await render(<TrackingModeDemo testID="demo" mode="simple" />);
    await act(async () => {
      await Promise.resolve();
    });

    const root = screen.getByTestId('demo', { includeHiddenElements: true });
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(faceLabel('demo-seal-face')).toMatch(/prayed/);

    await act(async () => {
      jest.advanceTimersByTime(1600);
    });
    expect(faceLabel('demo-seal-face')).toMatch(/missed/);

    await act(async () => {
      jest.advanceTimersByTime(1600);
    });
    expect(faceLabel('demo-seal-face')).toMatch(/prayed/);
  });

  it('stands the states side by side, still, under reduce motion', async () => {
    reduceMotion = true;
    await render(<TrackingModeDemo testID="demo" mode="detailed" />);
    await act(async () => {
      await Promise.resolve();
    });

    for (const status of ['prayed', 'late', 'missed']) {
      expect(
        screen.getByTestId(`demo-seal-${status}`, { includeHiddenElements: true })
      ).toBeTruthy();
    }
    expect(screen.queryByTestId('demo-seal', { includeHiddenElements: true })).toBeNull();
  });
});
