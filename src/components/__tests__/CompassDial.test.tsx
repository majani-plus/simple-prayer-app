/**
 * The dial's contract (design 3a, PRODUCT_SPEC §9).
 *
 * Three things matter here and nowhere else:
 *
 * 1. **Every rotation comes from the shared value.** The ring turns by `−heading`, the needle by
 *    `bearing − heading`, and the cardinal letters and the Makkah label turn *back* by the same
 *    amount so they stay upright. If any of those is ever wired to React state instead, the
 *    numbers asserted below stop moving with the shared value and this file goes red.
 * 2. **The continuous heading is used as given.** A heading of 710° must produce the same picture
 *    as 350° without a wrap correction anywhere — that is what stops the ring spinning the long
 *    way round at north.
 * 3. **Alignment changes the glyph, not just the palette.** The Makkah badge's mosque becomes a
 *    check; the colour swap is the least of the signals.
 */

import { render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { getAnimatedStyle } from '@/testing/reanimated';
import type { TestInstance } from 'test-renderer';

import {
  CompassDial,
  DIAL_SIZE,
  DIAL_SIZE_MAX,
  dialSizeForWindow,
  type CompassDialProps,
} from '../CompassDial';
import { Icon, type IconName } from '../Icon';
import { initI18n } from '@/i18n';
import { maxContentWidth } from '@/theme';

/** Drives the dial the way the screen does: one shared value, updated outside React's render. */
function Harness({
  heading,
  ...props
}: { heading: number } & Omit<CompassDialProps, 'heading' | 'accessibilityLabel'>) {
  const shared = useSharedValue(heading);
  useEffect(() => {
    shared.set(heading);
  }, [heading, shared]);
  return <CompassDial heading={shared} accessibilityLabel="compass" {...props} />;
}

async function renderDial(heading: number, props: Partial<Omit<CompassDialProps, 'heading'>> = {}) {
  return render(<Harness heading={heading} bearing={58} {...props} />);
}

/** The `rotate` entry of a node's animated transform, e.g. `"-96deg"`. */
function rotationOf(testID: string): string | undefined {
  const style = getAnimatedStyle(screen.getByTestId(testID)) as {
    transform?: { rotate?: string }[];
  };
  return style.transform?.find((entry) => entry.rotate !== undefined)?.rotate;
}

/** Every string rendered under a node — for a badge, its icon glyph. */
function textIn(node: TestInstance): string[] {
  const found: string[] = [];
  const walk = (current: TestInstance) => {
    for (const child of current.children) {
      if (typeof child === 'string') found.push(child);
      else walk(child);
    }
  };
  walk(node);
  return found;
}

/** The glyph the shared `Icon` renders for a name, so no codepoint is duplicated here. */
async function glyphOf(name: IconName): Promise<string> {
  const view = await render(
    <View testID="glyph">
      <Icon name={name} />
    </View>
  );
  const glyph = textIn(view.getByTestId('glyph'))[0];
  await view.unmount();
  return glyph;
}

beforeAll(() => {
  initI18n();
});

describe('CompassDial', () => {
  it('draws the rose, the Makkah marker and one accessible image', async () => {
    await renderDial(0);

    for (const letter of ['N', 'E', 'S', 'W']) {
      expect(screen.getByText(letter)).toBeTruthy();
    }
    expect(screen.getByText('Makkah')).toBeTruthy();

    const dial = screen.getByTestId('compass-dial');
    expect(dial.props.accessibilityRole).toBe('image');
    expect(dial.props.accessibilityLabel).toBe('compass');
  });

  it('turns the ring against the heading and the needle by the difference', async () => {
    await renderDial(96, { bearing: 58 });

    // The world turns the other way from the phone…
    expect(rotationOf('compass-dial-ring')).toBe('-96deg');
    // …and the cardinal letters and the Makkah label turn back, so they stay upright.
    expect(rotationOf('compass-dial-cardinal-0')).toBe('96deg');
    expect(rotationOf('compass-dial-cardinal-2')).toBe(`${96 - 180}deg`);
    expect(rotationOf('compass-dial-badge-upright')).toBe(`${96 - 58}deg`);
    // The needle carries the difference, so it rests under the fixed pointer exactly when the
    // Makkah badge does.
    expect(rotationOf('compass-dial-needle')).toBe(`${58 - 96}deg`);
    // The rim never turns: a circle looks the same at every angle.
    expect(rotationOf('compass-dial-rim')).toBeUndefined();
  });

  it('keeps using the continuous heading, so the ring never unwinds at north', async () => {
    // 710° is 350° after two turns: the value the smoother hands over never wraps, and nothing
    // here may "fix" it — a corrected value is exactly what makes a needle spin the long way.
    await renderDial(710, { bearing: 5 });

    expect(rotationOf('compass-dial-ring')).toBe('-710deg');
    expect(rotationOf('compass-dial-needle')).toBe(`${5 - 710}deg`);
  });

  it('swaps the Makkah glyph — not only its colour — when aligned', async () => {
    const mosque = await glyphOf('mosque');
    const check = await glyphOf('check');
    expect(mosque).not.toBe(check);

    const view = await renderDial(0, { aligned: false });
    expect(textIn(screen.getByTestId('compass-dial-badge-face'))).toContain(mosque);
    await view.unmount();

    await renderDial(0, { aligned: true });
    expect(textIn(screen.getByTestId('compass-dial-badge-face'))).toContain(check);
  });

  // With no heading the ring is unrotated, so a needle drawn at `bearing − 0` lands exactly on
  // the Makkah badge — the picture of being aligned, while the pill and the guidance card say the
  // screen is still looking. Dimming it was not enough; it has to be absent.
  it('draws no needle until there is a fix, rather than pointing confidently', async () => {
    const view = await renderDial(0, { live: false });
    expect(screen.queryByTestId('compass-dial-needle')).toBeNull();
    await view.unmount();

    await renderDial(0, { live: true });
    expect(screen.getByTestId('compass-dial-needle')).toBeTruthy();
  });

  it('scales to the width it is given', async () => {
    await renderDial(0, { size: 240 });

    const style = screen.getByTestId('compass-dial').props.style;
    expect(JSON.stringify(style)).toContain('"width":240');
    expect(DIAL_SIZE).toBe(288);
  });
});

/**
 * The dial used to be capped shrink-only at the phone's 288pt, which left it marooned at that size
 * in the middle of a tablet's column (D125). The component itself already scaled correctly; these
 * pin the sizes the screen now asks it for.
 */
describe('dialSizeForWindow', () => {
  it('is the phone dial on a phone, and shrinks below it on a narrow one', () => {
    expect(dialSizeForWindow(390)).toBe(DIAL_SIZE);
    expect(dialSizeForWindow(320)).toBe(320 - 40);
  });

  it('grows to the raised cap once the window is wider than a phone', () => {
    expect(dialSizeForWindow(768)).toBe(DIAL_SIZE_MAX);
    expect(dialSizeForWindow(1194)).toBe(DIAL_SIZE_MAX);
    expect(DIAL_SIZE_MAX).toBeGreaterThan(DIAL_SIZE);
  });

  it('never outgrows the page it sits in', () => {
    // The column, not the window: 600 − 20pt padding either side.
    expect(dialSizeForWindow(1366)).toBeLessThanOrEqual(maxContentWidth - 40);
    // And in an expanded layout, the pane it was handed.
    expect(dialSizeForWindow(1194, 400)).toBe(400 - 40);
  });

  it('turns exactly at the medium breakpoint, so a large phone keeps the mockup', () => {
    expect(dialSizeForWindow(599)).toBe(DIAL_SIZE);
    expect(dialSizeForWindow(600)).toBe(DIAL_SIZE_MAX);
  });
});

/**
 * DESIGN.md's rule of record: no word-carrying text below 10pt. Every label on the dial is scaled
 * by `size / DIAL_SIZE`, so the glance dial (D124) would otherwise set the cardinals at 7pt and
 * "Makkah" at 6. A small dial sheds its lettering instead of shrinking it — the same way the mosque
 * mark sheds detail on its way down to 16pt — and keeps the ticks, the needle and the badge glyph,
 * which carry the meaning without words.
 */
describe('a dial too small to letter', () => {
  it('keeps every label at the full size', async () => {
    await renderDial(0);

    expect(screen.getByText('N')).toBeTruthy();
    expect(screen.getByText('Makkah')).toBeTruthy();
  });

  it('drops the cardinals and the Makkah word at the glance size', async () => {
    await renderDial(0, { size: 160 });

    expect(screen.queryByText('N')).toBeNull();
    expect(screen.queryByText('Makkah')).toBeNull();
  });

  it('still draws the dial itself, badge included, at the glance size', async () => {
    await renderDial(0, { size: 160 });

    expect(screen.getByTestId('compass-dial')).toBeTruthy();
    expect(screen.getByTestId('compass-dial-badge-face')).toBeTruthy();
    expect(screen.getByTestId('compass-dial-needle')).toBeTruthy();
  });
});

describe('CompassDial — reduce motion', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockImplementation(() => Promise.resolve(true));
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation((() => ({ remove: jest.fn() })) as unknown as
        typeof AccessibilityInfo.addEventListener);
  });

  it('skips the recalibrate pulse outright', async () => {
    // spec-accessibility §2.7: the pulse is pure flourish — the status pill announces the
    // recalibration in words — so under reduced motion the dial simply never leaves scale 1.
    const view = await render(<Harness heading={0} bearing={58} pulse={0} />);
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled();

    await view.rerender(<Harness heading={0} bearing={58} pulse={1} />);
    expect(getAnimatedStyle(screen.getByTestId('compass-dial'))).toMatchObject({
      transform: [{ scale: 1 }],
    });
  });

  it('cuts the alignment tint straight to its end state', async () => {
    // With motion allowed the border eases over ~200ms, so right after the flip it would still
    // sit at its starting colour; the jump-cut lands the end colour on the very next render.
    const view = await render(<Harness heading={0} bearing={58} aligned={false} />);
    const before = (getAnimatedStyle(screen.getByTestId('compass-dial-rim')) as {
      borderColor?: string;
    }).borderColor;

    await view.rerender(<Harness heading={0} bearing={58} aligned />);
    const after = (getAnimatedStyle(screen.getByTestId('compass-dial-rim')) as {
      borderColor?: string;
    }).borderColor;
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });
});
