/**
 * What mirrors, and what must not.
 *
 * `direction.test.ts` covers the flag and `rtlLayout.test.tsx` covers the flex/edge layout React
 * Native mirrors for us. This file is the third category: the things RN leaves entirely alone —
 * **glyphs and transforms** — where every case has to be decided one at a time, and where getting
 * it wrong is invisible in English.
 *
 * The line the app draws:
 *
 * - A drawing of the **page** mirrors: a disclosure chevron, an undo arrow, a progress gauge.
 * - A drawing of the **world** does not: the compass rose, the Qibla needle, "turn left".
 * - A drawing of a **clock** does not either: the History calendar's five-prayer ring runs Fajr →
 *   Isha from twelve o'clock, and a day does not run backwards in Arabic.
 *
 * The compass and the qada ring sit on opposite sides of that line while looking almost identical
 * in the source — a circle with things placed around it — which is exactly why both are pinned
 * here rather than left to the next reader's judgement.
 */

import { render, screen } from '@testing-library/react-native';
import { I18nManager, View, type ViewStyle } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { initI18n } from '../index';
import { CALENDAR_RING_SIZE, CalendarMonth, segmentPath } from '@/components/CalendarMonth';
import { CompassDial } from '@/components/CompassDial';
import { Icon } from '@/components/Icon';
import { QiblaGuidance } from '@/components/QiblaGuidance';

import type { TestInstance } from 'test-renderer';

jest.mock('react-native-mmkv', () => {
  const values = new Map<string, string>();
  return {
    createMMKV: () => ({
      set: (key: string, value: string) => void values.set(key, value),
      getString: (key: string) => values.get(key),
      remove: (key: string) => void values.delete(key),
    }),
  };
});

/** Material Symbols codepoints (components/Icon.tsx). */
const CHEVRON_RIGHT = String.fromCodePoint(0xe5cc);
const CHEVRON_LEFT = String.fromCodePoint(0xe5cb);
const TURN_LEFT = String.fromCodePoint(0xeba6);
const UNDO = String.fromCodePoint(0xe166);

const DIRECTIONS = ['ltr', 'rtl'] as const;
const originalIsRTL = I18nManager.isRTL;

/** Stands in for "this session booted mirrored" — `isRTL` is fixed when the bundle initialises. */
function bootedAs(direction: 'ltr' | 'rtl'): void {
  Object.defineProperty(I18nManager, 'isRTL', {
    value: direction === 'rtl',
    configurable: true,
  });
}

/** Flattens a node's style, whatever shape the `style` prop arrived in. */
function styleOf(node: TestInstance): ViewStyle {
  const flatten = (value: unknown): ViewStyle =>
    Array.isArray(value)
      ? (Object.assign({}, ...value.map(flatten)) as ViewStyle)
      : ((value ?? {}) as ViewStyle);
  return flatten(node.props.style);
}

/**
 * The horizontal-mirror entries of a node's transform — and only those. Every icon also carries
 * `Icon`'s optical centring translate (a vertical font-metric correction, nothing to do with
 * reading direction), which this file must see straight through.
 */
function mirrorsOf(node: TestInstance): unknown[] {
  const transform = styleOf(node).transform;
  if (!Array.isArray(transform)) return [];
  return transform.filter((part) => typeof part === 'object' && 'scaleX' in part);
}

/** The dial, driven by a shared value exactly as the Qibla screen drives it. */
function Dial() {
  const heading = useSharedValue(0);
  return <CompassDial heading={heading} bearing={58} accessibilityLabel="compass" testID="dial" />;
}

beforeAll(() => {
  initI18n();
});

afterEach(() => {
  bootedAs(originalIsRTL ? 'rtl' : 'ltr');
});

describe('glyphs that draw the page', () => {
  it.each([
    ['ltr', []],
    ['rtl', [{ scaleX: -1 }]],
  ] as const)('mirrors an undo arrow in %s', async (direction, mirror) => {
    // "Undo" is an arrow curving *backwards through what you just did*. Backwards points the other
    // way in Arabic, and an unmirrored undo arrow reads as "redo".
    bootedAs(direction);
    await render(<Icon name="undo" />);
    expect(mirrorsOf(screen.getByText(UNDO))).toEqual(mirror);
  });

  it.each(DIRECTIONS)('never mirrors a glyph the app chooses by name, in %s', async (direction) => {
    // Chevrons are selected as `chevron_left`/`chevron_right` at every call site (see
    // `direction.backChevron`). `Icon` mirroring them as well would flip every back button twice.
    bootedAs(direction);
    await render(
      <View>
        <Icon name="chevron_left" />
        <Icon name="chevron_right" />
      </View>
    );
    expect(mirrorsOf(screen.getByText(CHEVRON_LEFT))).toEqual([]);
    expect(mirrorsOf(screen.getByText(CHEVRON_RIGHT))).toEqual([]);
  });
});

describe('drawings of the world, which never mirror', () => {
  it('pins the compass dial to a left-to-right frame of its own', async () => {
    bootedAs('rtl');
    await render(<Dial />);

    // Every offset inside the dial is a symmetric centring today, so RN's `left` → `start` rewrite
    // happens to be a no-op — but "happens to be" is not a guarantee. Declaring the direction on
    // the dial itself makes north-is-up structural rather than lucky.
    expect(styleOf(screen.getByTestId('dial')).direction).toBe('ltr');
  });

  it.each(DIRECTIONS)('leaves "turn left" pointing left in %s', async (direction) => {
    bootedAs(direction);
    await render(<QiblaGuidance delta={-40} aligned={false} toleranceDeg={5} testID="guide" />);

    // An instruction about the user's body, not about the page: turn left means turn left in
    // Arabic too. No mirror in either direction.
    expect(mirrorsOf(screen.getByText(TURN_LEFT))).toEqual([]);
  });
});

describe('drawings of a clock, which never mirror either', () => {
  const props = {
    year: 2026,
    monthIndex0: 6,
    records: {},
    today: '2026-07-02' as const,
    canGoNext: false,
    onPreviousMonth: () => undefined,
    onNextMonth: () => undefined,
    onSelectDay: () => undefined,
  };

  it.each(DIRECTIONS)("keeps the calendar day's five-prayer ring put in %s", async (direction) => {
    // Fajr at twelve o'clock, running through the day — a clock face, not a progress bar. The one
    // ring in the app that deliberately does *not* follow the qada ring's lead.
    bootedAs(direction);
    await render(<CalendarMonth {...props} testID="calendar" />);

    expect(screen.getByTestId('calendar-segment-2026-07-01-fajr').props.d).toBe(
      segmentPath(0, CALENDAR_RING_SIZE)
    );
    expect(screen.getByTestId('calendar-segment-2026-07-01-isha').props.d).toBe(
      segmentPath(4, CALENDAR_RING_SIZE)
    );
  });
});
