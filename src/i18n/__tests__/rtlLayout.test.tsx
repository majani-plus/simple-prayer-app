/**
 * The direction audit, rendered.
 *
 * A layout test in Jest cannot see pixels, so this file asserts the two things that actually
 * determine whether Arabic looks right on a device — and they are *opposites*, which is why both
 * halves matter:
 *
 * 1. **What React Native mirrors for us, we must not mirror again.** With
 *    `doLeftAndRightSwapInRTL` (RN's default, still true in 0.86) Fabric rewrites `left`/`right`,
 *    `margin`/`padding-left|right`, the physical border radii and even
 *    `textAlign: 'left' | 'right'` to their start/end twins on an RTL surface, and Yoga flips
 *    `flexDirection: 'row'`. A component that "helpfully" swaps those itself on `isRTL` lands them
 *    back on the wrong edge. So: the trailing value keeps `textAlign: 'right'`, the calendar keeps
 *    a plain `'row'` and its columns keep Sunday first.
 * 2. **What React Native does NOT mirror, we must.** Transforms and glyph *choice* are untouched,
 *    so a chevron has to pick its own direction — and, conversely, the compass dial and the Qibla
 *    needle stay put, because a compass is a map and geography does not mirror (DESIGN.md §RTL).
 *
 * Each case is rendered twice, once per direction, from the same props.
 */

import { act, configure, render, screen, within } from '@testing-library/react-native';
import { Dimensions, I18nManager, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { useEffect } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { getAnimatedStyle } from '@/testing/reanimated';

import { AppText } from '@/components/AppText';
import { CalendarMonth } from '@/components/CalendarMonth';
import { CompassDial, DIAL_SIZE } from '@/components/CompassDial';
import { PrayerRow } from '@/components/PrayerRow';
import { PrayerSeal } from '@/components/PrayerSeal';
import { SettingNavigationRow } from '@/components/SettingRow';
import { TwoPaneLayout } from '@/components/TwoPaneLayout';
import { VerticalDivider } from '@/components/VerticalDivider';
import { unloggedDayRecord } from '@/domain/streaks';
import { initI18n } from '@/i18n';

import type { DayRecord, PrayerDay } from '@/domain/types';

jest.mock('react-native-mmkv', () => {
  const values = new Map<string, string>();
  return {
    createMMKV: () => ({
      set: (key: string, value: string) => void values.set(key, value),
      getString: (key: string) => values.get(key),
      remove: (key: string) => void values.delete(key),
      clearAll: () => values.clear(),
    }),
  };
});

configure({ defaultIncludeHiddenElements: true });

/** Material Symbols codepoints (see components/Icon.tsx). */
const CHEVRON_LEFT = String.fromCodePoint(0xe5cb);
const CHEVRON_RIGHT = String.fromCodePoint(0xe5cc);

const originalIsRTL = I18nManager.isRTL;

/**
 * Stands in for "this session booted mirrored".
 *
 * `I18nManager.isRTL` is a constant captured from native constants when the bundle initialises, so
 * this is the only way to render both directions in one process — which is also exactly why the
 * real app needs a reload to change direction (see `../direction`).
 */
function bootedAs(direction: 'ltr' | 'rtl'): void {
  Object.defineProperty(I18nManager, 'isRTL', {
    value: direction === 'rtl',
    configurable: true,
    writable: true,
  });
}

const DIRECTIONS = ['ltr', 'rtl'] as const;

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  // `LiveCountdown` mounts a one-second interval inside the prayer row. Without fake timers it
  // keeps the Jest worker alive after the suite finishes.
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  // Dynamic Type, stated rather than inherited (the trap `PrayerSeal.test.tsx` documents):
  // `jest-expo`'s `Dimensions` mock answers `fontScale: 2`, which is that fake screen's *pixel*
  // ratio and not a text-size setting. This file is about direction, not size, and a settings
  // row stacks its value under its label past 1.5x — so left alone these tests would assert the
  // two-column layout against a stacked one.
  jest
    .spyOn(Dimensions, 'get')
    .mockImplementation(() => ({ width: 390, height: 844, scale: 3, fontScale: 1 }));
});

afterEach(() => {
  bootedAs(originalIsRTL ? 'rtl' : 'ltr');
  jest.useRealTimers();
});

/**
 * Tears the tree down inside `act`.
 *
 * Several of these cases render twice in one test — once per direction — because
 * `I18nManager.isRTL` is read at render time. Unmounting the first tree while its effects are
 * still settling leaves React with an unbalanced `act` scope, and every *later* test in the file
 * then fails with "overlapping act() calls" while passing in isolation. Awaiting the teardown is
 * what keeps a direction-pair test from poisoning the file.
 */
async function unmount(): Promise<void> {
  await act(async () => {
    screen.unmount();
  });
}

/** Flattened style of a node, whatever shape its `style` prop arrived in. */
function styleOf(testID: string): ViewStyle & TextStyle {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style) as ViewStyle & TextStyle;
}

/** Every `style` object in the rendered tree, flattened. */
function allStyles(): (ViewStyle & TextStyle)[] {
  const out: (ViewStyle & TextStyle)[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    // `toJSON()` returns an array when the component renders more than one root node — a fragment,
    // which several of these components do. Walking it as an element would silently find nothing.
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const element = node as { props?: { style?: unknown }; children?: unknown[] };
    if (element.props?.style !== undefined) {
      out.push(StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle);
    }
    for (const child of element.children ?? []) walk(child);
  };
  walk(screen.toJSON());
  return out;
}

/**
 * Styles that name one physical side without naming the other.
 *
 * A *symmetric* inset (`left: 0, right: 0` on a full-bleed overlay, equal horizontal padding) is
 * direction-neutral and perfectly fine. An asymmetric one is the bug: it pins content to a side
 * that Arabic needs on the other, and it is what `start`/`end` exist to prevent.
 */
function asymmetricEdges(): (ViewStyle & TextStyle)[] {
  return allStyles().filter(
    (style) =>
      style.marginLeft !== style.marginRight ||
      style.paddingLeft !== style.paddingRight ||
      style.left !== style.right
  );
}

/* --------------------------------------------------------------- the prayer row and its seal */

const MAGHRIB = new Date(2026, 6, 2, 20, 47, 0);
const NOW = new Date(2026, 6, 2, 18, 39, 0);

function renderRow() {
  return render(
    <PrayerRow
      testID="row"
      prayer="maghrib"
      name="Maghrib"
      arabicName="المغرب"
      time={MAGHRIB}
      status="unlogged"
      isNext
      msRemaining={MAGHRIB.getTime() - NOW.getTime()}
      isOpen={false}
      onToggleOpen={jest.fn()}
      onPick={jest.fn()}
    />
  );
}

describe('the prayer row', () => {
  it.each(DIRECTIONS)('lays itself out with a plain flex row in %s', async (direction) => {
    bootedAs(direction);
    await renderRow();

    // `row`, never `row-reverse`. Yoga mirrors a row against the resolved direction; reversing it
    // ourselves would mirror it a second time and put the seal back on the wrong edge.
    expect(styleOf('row').flexDirection).toBe('row');
  });

  it.each(DIRECTIONS)('pins nothing to a physical edge in %s', async (direction) => {
    bootedAs(direction);
    await renderRow();

    // The seal is pushed to the row's trailing edge with `marginStart: 'auto'`, and nothing in the
    // tree names one physical side without naming the other. A *symmetric* inset
    // (`left: 0, right: 0`, the emphasised card's full-bleed ring) is direction-neutral and
    // allowed; an asymmetric one would pin content to a side that Arabic needs on the other.
    expect(asymmetricEdges()).toEqual([]);
    expect(allStyles().some((style) => style.marginStart === 'auto')).toBe(true);
  });

  it('renders the same row content in both directions', async () => {
    bootedAs('ltr');
    await renderRow();
    const ltr = screen.getByText('Maghrib');
    expect(ltr).toBeTruthy();
    expect(screen.getByText('المغرب')).toBeTruthy();
    await unmount();

    bootedAs('rtl');
    await renderRow();
    // Mirroring is the *layout's* job, not the content's: nothing is reordered in the tree.
    expect(screen.getByText('Maghrib')).toBeTruthy();
    expect(screen.getByText('المغرب')).toBeTruthy();
  });
});

describe('the seal', () => {
  it.each(DIRECTIONS)('anchors its face and its options logically in %s', async (direction) => {
    bootedAs(direction);
    await render(
      <PrayerSeal
        testID="seal"
        prayer="maghrib"
        prayerName="Maghrib"
        status="prayed"
        isOpen
        onToggleOpen={jest.fn()}
        onPick={jest.fn()}
      />
    );

    // The pill morphs open from the row's outer edge. `start` is what makes that edge the right
    // one in Arabic; `left` would grow the pill the wrong way, out of the row instead of into it.
    const styles = allStyles();
    expect(styles.some((style) => style.start === 0)).toBe(true);
    expect(asymmetricEdges()).toEqual([]);
    // The three options run in prayer order along the pill; `row` mirrors, `row-reverse` would not.
    expect(styles.every((style) => style.flexDirection !== 'row-reverse')).toBe(true);
  });
});

/* ------------------------------------------------------------------------------- the calendar */

const TODAY: PrayerDay = '2026-08-19';
const RECORDS: Record<PrayerDay, DayRecord | undefined> = {
  [TODAY]: unloggedDayRecord(TODAY),
};

function renderCalendar() {
  return render(
    <CalendarMonth
      testID="calendar"
      year={2026}
      monthIndex0={7}
      records={RECORDS}
      today={TODAY}
      canGoNext={false}
      onPreviousMonth={jest.fn()}
      onNextMonth={jest.fn()}
      onSelectDay={jest.fn()}
      weekStartsOn={0}
    />
  );
}

describe('the calendar', () => {
  it.each(DIRECTIONS)('keeps Sunday in column one of the array in %s', async (direction) => {
    bootedAs(direction);
    await renderCalendar();

    // The *visual* week order mirrors because the row is a flex row — so the array must NOT be
    // reversed here. Reversing it would cancel the mirror out and put Saturday under "S(unday)".
    const row = screen.getByTestId('calendar-row-0');
    expect((StyleSheet.flatten(row.props.style as ViewStyle) ?? {}).flexDirection).toBe('row');

    // 2026-08-01 is a Saturday, so a Sunday-first August starts with six blanks and the 1st last.
    const firstRow = within(row);
    expect(firstRow.getByTestId(`calendar-day-2026-08-01`)).toBeTruthy();
  });

  it('turns the month arrows around, because a glyph is not mirrored for us', async () => {
    bootedAs('ltr');
    await renderCalendar();
    expect(within(screen.getByTestId('calendar-previous')).getByText(CHEVRON_LEFT)).toBeTruthy();
    expect(within(screen.getByTestId('calendar-next')).getByText(CHEVRON_RIGHT)).toBeTruthy();
    await unmount();

    bootedAs('rtl');
    await renderCalendar();
    // "Previous" points against the reading direction in both languages.
    expect(within(screen.getByTestId('calendar-previous')).getByText(CHEVRON_RIGHT)).toBeTruthy();
    expect(within(screen.getByTestId('calendar-next')).getByText(CHEVRON_LEFT)).toBeTruthy();
  });

  it.each(DIRECTIONS)(
    'centres its weekday initials rather than edging them in %s',
    async (direction) => {
      bootedAs(direction);
      await renderCalendar();
      // `center` is direction-neutral, which is what a fixed-width column wants. Anything else here
      // would have to be justified against the writing direction.
      const centred = allStyles().filter((style) => style.textAlign === 'center');
      expect(centred.length).toBeGreaterThan(0);
    }
  );
});

/* --------------------------------------------------------------------------- a settings row */

describe('a settings row', () => {
  it('turns its disclosure chevron around', async () => {
    bootedAs('ltr');
    await render(
      <SettingNavigationRow testID="setting" label="Location" value="Doha" onPress={jest.fn()} />
    );
    expect(screen.getByText(CHEVRON_RIGHT)).toBeTruthy();
    await unmount();

    bootedAs('rtl');
    await render(
      <SettingNavigationRow testID="setting" label="Location" value="Doha" onPress={jest.fn()} />
    );
    // The glyph itself is not flipped by the platform; the row mirrors it with a `scaleX`
    // transform, which is also untouched by the auto-swap and so has to be asked for explicitly.
    const chevron = screen.getByText(CHEVRON_RIGHT);
    const transform = (StyleSheet.flatten(chevron.props.style as TextStyle) ?? {}).transform;
    expect(transform).toEqual([{ scaleX: -1 }]);
  });

  it('leaves the row itself un-mirrored in LTR', async () => {
    bootedAs('ltr');
    await render(
      <SettingNavigationRow testID="setting" label="Location" value="Doha" onPress={jest.fn()} />
    );
    const chevron = screen.getByText(CHEVRON_RIGHT);
    expect((StyleSheet.flatten(chevron.props.style as TextStyle) ?? {}).transform).toEqual([{ scaleX: 1 }]);
  });

  it.each(DIRECTIONS)('keeps the trailing value on textAlign "right" in %s', async (direction) => {
    bootedAs(direction);
    await render(
      <SettingNavigationRow testID="setting" label="Location" value="Doha" onPress={jest.fn()} />
    );

    // NOT a bug, and the single easiest thing to "fix" wrongly. RN swaps `left`/`right` for text
    // on both platforms when the surface is RTL (iOS: RCTAttributedTextUtils.mm; Android:
    // TextAttributeProps.kt), so `'right'` already means *end*. Flipping it on `isRTL` would swap
    // it twice and strand the value in the middle of the row.
    const value = StyleSheet.flatten(screen.getByText('Doha').props.style as TextStyle) ?? {};
    expect(value.textAlign).toBe('right');
  });

  it.each(DIRECTIONS)('reserves its gutter with a plain row in %s', async (direction) => {
    bootedAs(direction);
    await render(
      <SettingNavigationRow
        testID="setting"
        icon="location_on"
        label="Location"
        onPress={jest.fn()}
      />
    );
    const rows = allStyles().filter((style) => style.flexDirection !== undefined);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((style) => style.flexDirection === 'row')).toBe(true);
  });
});

/* ------------------------------------------------------- what must NOT mirror: the compass */

/** Drives the dial the way the Qibla screen does: one shared value, set outside render. */
function DialHarness({ heading, bearing }: { heading: number; bearing: number }) {
  const shared = useSharedValue(heading);
  useEffect(() => {
    shared.set(heading);
  }, [heading, shared]);
  return (
    <CompassDial testID="dial" heading={shared} bearing={bearing} accessibilityLabel="compass" />
  );
}

/** The `rotate` entry of an animated node's transform, e.g. `"-96deg"`. */
function rotationOf(testID: string): string | undefined {
  const style = getAnimatedStyle(screen.getByTestId(testID)) as {
    transform?: { rotate?: string }[];
  };
  return style.transform?.find((entry) => entry.rotate !== undefined)?.rotate;
}

describe('the compass dial', () => {
  /**
   * DESIGN.md §RTL is explicit: the dial is never mirrored. A compass is a *map*, and north is
   * north in every language — mirroring it would put east on the left and send the user the wrong
   * way round the room. The same goes for the Qibla needle, which points at an actual place.
   *
   * Nothing in RN would mirror a `rotate` transform for us, so what these assertions really guard
   * is a future "fix" that adds a `scaleX: isRTL ? -1 : 1` to the dial by analogy with the
   * chevrons. The two look alike and are opposites.
   */
  it('turns by exactly the same angles in both directions', async () => {
    const rotations: Record<string, (string | undefined)[]> = {
      ring: [],
      needle: [],
      cardinal: [],
      badge: [],
    };

    for (const direction of DIRECTIONS) {
      bootedAs(direction);
      await render(<DialHarness heading={96} bearing={58} />);
      rotations.ring.push(rotationOf('dial-ring'));
      rotations.needle.push(rotationOf('dial-needle'));
      rotations.cardinal.push(rotationOf('dial-cardinal-0'));
      rotations.badge.push(rotationOf('dial-badge-upright'));
      await unmount();
    }

    for (const [name, [ltr, rtl]] of Object.entries(rotations)) {
      expect(ltr).toBeDefined();
      // Not merely "both are defined": the *same* angle. A mirrored dial would negate it.
      expect({ name, angle: rtl }).toEqual({ name, angle: ltr });
    }
  });

  it('places every fixed part by centring it, so the auto-swap cannot move it', async () => {
    bootedAs('rtl');
    await render(<DialHarness heading={0} bearing={58} />);

    // The dial positions its pin, its pointer, its cardinal boxes and the Makkah column with
    // `left: size / 2 - box / 2` — a *centring*, not an edge. RN rewrites `left` to `start` on an
    // RTL surface, and for a centred box that is a no-op: `2 × left + width === size`.
    //
    // That identity is the whole reason the dial needs no RTL special-casing. If someone ever
    // anchors a dial element to one side, this fails and tells them to reach for a transform
    // instead of an edge.
    const positioned = allStyles().filter(
      (style) => style.position === 'absolute' && typeof style.left === 'number'
    );
    expect(positioned.length).toBeGreaterThan(0);

    for (const style of positioned) {
      if (typeof style.width !== 'number') {
        // No width means a full-bleed overlay (`StyleSheet.absoluteFill`), which is symmetric by
        // construction: it names both sides and both are zero.
        expect(style.right).toBe(style.left);
        continue;
      }
      expect({ left: style.left, width: style.width }).toEqual({
        left: (DIAL_SIZE - style.width) / 2,
        width: style.width,
      });
    }
  });

  it('keeps its cardinal letters in geographic order', async () => {
    for (const direction of DIRECTIONS) {
      bootedAs(direction);
      await render(<DialHarness heading={0} bearing={58} />);
      // Quarter 0 is north and is the emphasised one, whichever way the UI reads.
      expect(screen.getByTestId('dial-cardinal-0')).toBeTruthy();
      expect(screen.getByTestId('dial-cardinal-3')).toBeTruthy();
      await unmount();
    }
  });
});

/* ------------------------------------------------------------------------------ the pane seam */

/**
 * The expanded-width spread (D124/D125).
 *
 * A two-pane layout is the easiest place in the app to mirror by hand and get wrong, so what is
 * pinned here is that it does not try: the panes sit in a plain logical row, the seam names no
 * physical side, and Arabic gets its mirroring from the platform rather than from us.
 */
describe('the pane seam', () => {
  async function renderPanes() {
    return render(
      <TwoPaneLayout
        testID="panes"
        start={<AppText>start</AppText>}
        end={<AppText>end</AppText>}
      />
    );
  }

  it('lays the panes in a logical row in both directions', async () => {
    for (const direction of DIRECTIONS) {
      bootedAs(direction);
      await renderPanes();

      // A plain 'row' — never 'row-reverse', which in Arabic would mirror twice and cancel out.
      expect(allStyles().some((style) => style.flexDirection === 'row')).toBe(true);
      expect(allStyles().every((style) => style.flexDirection !== 'row-reverse')).toBe(true);
      await unmount();
    }
  });

  it('names no physical edge, in either direction', async () => {
    for (const direction of DIRECTIONS) {
      bootedAs(direction);
      await renderPanes();

      expect(asymmetricEdges()).toEqual([]);
      await unmount();
    }
  });

  it('keeps the leading pane leading, whichever way the page reads', async () => {
    for (const direction of DIRECTIONS) {
      bootedAs(direction);
      await renderPanes();

      // The order in the tree is the reading order; the platform turns it into left and right.
      expect(within(screen.getByTestId('panes-start')).getByText('start')).toBeTruthy();
      expect(within(screen.getByTestId('panes-end')).getByText('end')).toBeTruthy();
      await unmount();
    }
  });

  it('draws its rule as a decorative column, hidden from assistive technology', async () => {
    for (const direction of DIRECTIONS) {
      bootedAs(direction);
      await render(<VerticalDivider testID="seam" />);

      const seam = screen.getByTestId('seam');
      expect(seam.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(asymmetricEdges()).toEqual([]);
      await unmount();
    }
  });
});
