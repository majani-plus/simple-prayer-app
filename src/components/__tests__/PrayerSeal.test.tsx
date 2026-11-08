/**
 * The seal is the app's signature interaction, so its contract is pinned down here in full:
 * what each of the five statuses looks like and announces, how the pill opens, what a pick
 * reports (set vs clear), and the two states that must refuse a tap (a future prayer and an
 * exempt day).
 *
 * Two testing notes:
 * - RNTL honours `pointerEvents`, so "inert while invisible" is asserted by firing a press and
 *   expecting nothing to happen — exactly what a finger would find.
 * - Icons render a private-use glyph from the Material Symbols font, so instead of hardcoding
 *   codepoints the tests render the reference `Icon` and compare the two strings.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, Dimensions, StyleSheet, View, type ViewStyle } from 'react-native';

import { getAnimatedStyle } from '@/testing/reanimated';
import type { TestInstance } from 'test-renderer';

import { Icon, type IconName } from '../Icon';
import {
  PrayerSeal,
  SEAL_OPEN_WIDTH,
  SEAL_SIZE,
  sealPillMetrics,
  type PrayerSealProps,
} from '../PrayerSeal';
import type { PrayerStatus } from '@/domain/types';
import { initI18n } from '@/i18n';
import { arabicTypeScale, maxContentWidth, paperLight } from '@/theme';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

const onToggleOpen = jest.fn();
const onPick = jest.fn();

/**
 * The three `AccessibilityInfo` entry points the seal touches are stubbed for the whole file
 * (re-installed per test rather than restored — restoring the host mock leaves the module
 * without an implementation, and the seal's mount-time probe would then blow up).
 */
let reduceMotionEnabled = false;
let reduceMotionListener: ((enabled: boolean) => void) | undefined;
const removeSubscription = jest.fn();
const announce = jest.fn();
const focusOn = jest.fn();

/**
 * Dynamic Type, as the seal actually reads it (the same trap `TipJar.test.tsx` documents):
 * `jest-expo`'s `Dimensions` mock answers `fontScale: 2`, which is that fake screen's *pixel*
 * ratio and not a text-size setting. Left alone, every test in this file would silently exercise
 * the 200% layout, so the scale is stated — 1 by default, and per test where the point is size.
 */
const SCREEN_WIDTH = 390;
function setFontScale(fontScale: number): void {
  jest
    .spyOn(Dimensions, 'get')
    .mockImplementation(() => ({ width: SCREEN_WIDTH, height: 844, scale: 3, fontScale }));
}

async function renderSeal(props: Partial<PrayerSealProps> = {}) {
  return render(
    <PrayerSeal
      prayer="maghrib"
      prayerName="Maghrib"
      status="unlogged"
      isOpen={false}
      onToggleOpen={onToggleOpen}
      onPick={onPick}
      {...props}
    />
  );
}

/** Every string rendered underneath a node, in order — for a seal face, its glyph(s). */
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

/** The glyph the shared `Icon` component renders for a name, so no codepoint is duplicated here. */
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

/**
 * RNTL hides elements that are hidden from the accessibility tree, which is exactly what the
 * seal does to whichever of its two layers is invisible. The queries below therefore opt back
 * in — the tests that care about a11y visibility assert it explicitly instead.
 */
const HIDDEN = { includeHiddenElements: true } as const;
const byId = (testID: string) => screen.getByTestId(testID, HIDDEN);

function styleOf(testID: string): ViewStyle {
  return StyleSheet.flatten(byId(testID).props.style) as ViewStyle;
}

const face = () => byId('seal-maghrib-face');
const option = (status: 'prayed' | 'late' | 'missed') => byId(`seal-maghrib-option-${status}`);

beforeAll(async () => {
  await initI18n().changeLanguage('en');
});

beforeEach(() => {
  onToggleOpen.mockClear();
  onPick.mockClear();
  removeSubscription.mockClear();
  announce.mockClear();
  focusOn.mockClear();
  reduceMotionEnabled = false;
  reduceMotionListener = undefined;
  setFontScale(1);

  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => Promise.resolve(reduceMotionEnabled));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
    event: string,
    handler: unknown
  ) => {
    if (event === 'reduceMotionChanged') {
      reduceMotionListener = handler as (enabled: boolean) => void;
    }
    return { remove: removeSubscription };
  }) as unknown as typeof AccessibilityInfo.addEventListener);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(announce);
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(focusOn);
});

describe('PrayerSeal — the collapsed face', () => {
  it('gives every status its own glyph', async () => {
    const expected: Record<PrayerStatus, IconName> = {
      prayed: 'check',
      late: 'schedule',
      missed: 'close',
      unlogged: 'circle',
      // The crescent: distinct by shape from all four others, and it reads as rest — never as
      // the prohibition bar the old `remove` glyph risked (spec-exemption amendment 2b).
      exempt: 'bedtime',
    };
    const rendered: string[] = [];

    for (const status of Object.keys(expected) as PrayerStatus[]) {
      const view = await renderSeal({ status });
      const glyph = textIn(view.getByTestId('seal-maghrib-face', HIDDEN))[0];
      expect(glyph).toBe(await glyphOf(expected[status]));
      rendered.push(glyph);
      await view.unmount();
    }

    // Status is never conveyed by colour alone: five statuses, five different marks.
    expect(new Set(rendered).size).toBe(5);
  });

  it('announces the prayer and its status in words', async () => {
    const labels: Record<PrayerStatus, string> = {
      prayed: 'Maghrib, prayed',
      late: 'Maghrib, prayed late',
      missed: 'Maghrib, missed',
      unlogged: 'Maghrib, not marked',
      exempt: 'Maghrib, not required',
    };

    for (const [status, label] of Object.entries(labels)) {
      const view = await renderSeal({ status: status as PrayerStatus });
      expect(view.getByLabelText(label)).toBeTruthy();
      await view.unmount();
    }
  });

  it('paints prayed as a filled gold seal with the soft glow', async () => {
    await renderSeal({ status: 'prayed' });
    expect(styleOf('seal-maghrib-face')).toMatchObject({
      backgroundColor: paperLight.accent,
      borderColor: 'transparent',
    });
    expect(styleOf('seal-maghrib-face').boxShadow).toEqual([
      { offsetX: 0, offsetY: 2, blurRadius: 8, spreadDistance: -2, color: paperLight.shadowGold },
    ]);
  });

  it('paints late as a filled burnt-orange seal', async () => {
    await renderSeal({ status: 'late' });
    expect(styleOf('seal-maghrib-face')).toMatchObject({ backgroundColor: paperLight.late });
  });

  it('outlines missed solid and unlogged dashed', async () => {
    const view = await renderSeal({ status: 'missed' });
    expect(styleOf('seal-maghrib-face')).toMatchObject({
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: paperLight.missed,
    });
    expect(styleOf('seal-maghrib-face').borderStyle).toBeUndefined();

    await view.rerender(
      <PrayerSeal
        prayer="maghrib"
        prayerName="Maghrib"
        status="unlogged"
        isOpen={false}
        onToggleOpen={onToggleOpen}
        onPick={onPick}
      />
    );
    expect(styleOf('seal-maghrib-face')).toMatchObject({
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: paperLight.unlogged,
      borderStyle: 'dashed',
    });
  });

  it('wears the “tap to complete” skin while its window is open: dashed accent ring, ghosted check', async () => {
    // The dashed ring is the exclusive mark of "awaiting your hand"; on the current prayer it
    // turns accent and carries a hollow check — structurally distinct from prayed (filled gold
    // disc) and from past-unlogged (muted dot), never hue alone (spec-today-interaction §2).
    const check = await glyphOf('check');
    await renderSeal({ status: 'unlogged', isCurrent: true });
    expect(styleOf('seal-maghrib-face')).toMatchObject({
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: paperLight.accent,
      borderStyle: 'dashed',
    });
    expect(textIn(face())[0]).toBe(check);
    expect(StyleSheet.flatten(within(face()).getByText(check, HIDDEN).props.style)).toMatchObject({
      color: paperLight.accent,
    });
  });

  it('goes dormant for a future prayer: thin solid faint ring, small dot — never the dashed ring', async () => {
    // Owner item D: a future seal must not be pixel-identical to an actionable unlogged one.
    // Border style, weight and glyph size all differ; the caption's word carries the state.
    const dot = await glyphOf('circle');
    await renderSeal({ status: 'unlogged', isFuture: true });
    const style = styleOf('seal-maghrib-face');
    expect(style).toMatchObject({
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: paperLight.borderMid,
    });
    expect(style.borderStyle).toBeUndefined();
    expect(textIn(face())[0]).toBe(dot);
    expect(StyleSheet.flatten(within(face()).getByText(dot, HIDDEN).props.style)).toMatchObject({
      fontSize: 10,
      color: paperLight.soft,
    });
  });

  it('keeps a logged status’s skin verbatim even while current', async () => {
    await renderSeal({ status: 'prayed', isCurrent: true });
    expect(styleOf('seal-maghrib-face')).toMatchObject({ backgroundColor: paperLight.accent });
  });

  it('renders exempt as a calm neutral, never as a miss', async () => {
    await renderSeal({ status: 'exempt' });
    const style = styleOf('seal-maghrib-face');
    expect(style).toMatchObject({
      backgroundColor: paperLight.cardElevated,
      borderWidth: 1,
      borderColor: paperLight.borderMid,
    });
    expect(style.borderColor).not.toBe(paperLight.missed);
    expect(face().props.accessibilityHint).toBe('This day is exempt — there is nothing to mark');
  });
});

describe('PrayerSeal — opening (pill mode: every seal without `directPick`)', () => {
  it('asks the parent to open when the face is tapped', async () => {
    await renderSeal();
    await fireEvent.press(face());
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('does not build the three options until the pill first opens', async () => {
    // Today mounts five seals; fifteen invisible buttons laid out at first paint were a cost
    // paid on every cold start for pills that mostly never open.
    await renderSeal();
    expect(screen.queryByTestId('seal-maghrib-options', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('seal-maghrib-option-prayed', { includeHiddenElements: true })).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('keeps the three options inert once collapsed again', async () => {
    const view = await renderSeal({ isOpen: true });
    await view.rerender(
      <PrayerSeal
        prayer="maghrib"
        prayerName="Maghrib"
        status="unlogged"
        isOpen={false}
        onToggleOpen={onToggleOpen}
        onPick={onPick}
      />
    );
    // Still mounted (a re-open is the same cross-fade), but a finger cannot reach them…
    expect(byId('seal-maghrib-options').props.pointerEvents).toBe('none');
    await fireEvent.press(
      screen.getByTestId('seal-maghrib-option-prayed', { includeHiddenElements: true })
    );
    expect(onPick).not.toHaveBeenCalled();
    // …and a screen reader does not meet them either.
    expect(screen.queryByTestId('seal-maghrib-option-prayed')).toBeNull();
  });

  it('reveals three labelled options when open', async () => {
    await renderSeal({ isOpen: true });

    expect(screen.getByText('Prayed')).toBeTruthy();
    expect(screen.getByText('Late')).toBeTruthy();
    expect(screen.getByText('Missed')).toBeTruthy();
    expect(screen.getByLabelText('Mark Maghrib as prayed')).toBeTruthy();
    expect(screen.getByLabelText('Mark Maghrib as prayed late')).toBeTruthy();
    expect(screen.getByLabelText('Mark Maghrib as missed')).toBeTruthy();
    expect(byId('seal-maghrib-options').props.pointerEvents).toBe('auto');
  });

  it('lets the option labels grow to full Dynamic Type (2.0×, spec-accessibility §2.4)', async () => {
    await renderSeal({ isOpen: true });
    for (const label of ['Prayed', 'Late', 'Missed']) {
      expect(screen.getByText(label).props.maxFontSizeMultiplier).toBe(2);
    }
  });

  it('sizes the three targets and the pill from the mockup at the default text size', async () => {
    await renderSeal({ isOpen: true });
    expect(styleOf('seal-maghrib-option-prayed')).toMatchObject({ width: 50, height: 44 });
    expect(styleOf('seal-maghrib-options')).toMatchObject({ width: SEAL_OPEN_WIDTH });
  });

  it('morphs the pill from 48 to 160 and back', async () => {
    const view = await renderSeal();
    expect(getAnimatedStyle(byId('seal-maghrib'))).toMatchObject({
      width: SEAL_SIZE,
    });

    await view.rerender(
      <PrayerSeal
        prayer="maghrib"
        prayerName="Maghrib"
        status="unlogged"
        isOpen
        onToggleOpen={onToggleOpen}
        onPick={onPick}
      />
    );
    await waitFor(() => {
      expect(getAnimatedStyle(byId('seal-maghrib'))).toMatchObject({
        width: SEAL_OPEN_WIDTH,
      });
    });
    await waitFor(() => {
      expect(getAnimatedStyle(byId('seal-maghrib-options'))).toMatchObject({
        opacity: 1,
      });
    });
    expect(getAnimatedStyle(byId('seal-maghrib-shell'))).toMatchObject({
      opacity: 1,
    });

    await view.rerender(
      <PrayerSeal
        prayer="maghrib"
        prayerName="Maghrib"
        status="unlogged"
        isOpen={false}
        onToggleOpen={onToggleOpen}
        onPick={onPick}
      />
    );
    await waitFor(() => {
      expect(getAnimatedStyle(byId('seal-maghrib'))).toMatchObject({
        width: SEAL_SIZE,
      });
    });
  });

  it('starts the morph from the tap itself, before the parent re-renders', async () => {
    // The parent here never flips `isOpen`, standing in for a screen still re-rendering: the pill
    // must already be on its way, because the tap is what the user is waiting on.
    await renderSeal();
    await act(async () => {
      fireEvent.press(face());
    });
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(getAnimatedStyle(byId('seal-maghrib'))).toMatchObject({
        width: SEAL_OPEN_WIDTH,
      });
    });
  });

  it('hides the face and its glow while the pill is open', async () => {
    await renderSeal({ isOpen: true });

    await waitFor(() => {
      expect(getAnimatedStyle(face().parent!)).toMatchObject({ opacity: 0 });
    });
    // Inert while invisible: neither a finger nor a screen reader finds the vanished face.
    await fireEvent.press(face());
    expect(onToggleOpen).not.toHaveBeenCalled();
    expect(screen.queryByTestId('seal-maghrib-face')).toBeNull();
    expect(styleOf('seal-maghrib')).toMatchObject({
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 3,
          blurRadius: 12,
          spreadDistance: -4,
          color: paperLight.shadowGold,
        },
      ],
    });
  });

  it('closes with no change when the open pill is tapped outside its options', async () => {
    await renderSeal({ isOpen: true });
    await fireEvent.press(byId('seal-maghrib-dismiss'));
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('announces opening and closing, but says nothing on mount', async () => {
    const view = await renderSeal({ isOpen: false });
    expect(announce).not.toHaveBeenCalled();

    const props = {
      prayer: 'maghrib',
      prayerName: 'Maghrib',
      status: 'unlogged',
      onToggleOpen,
      onPick,
    } as const;
    await view.rerender(<PrayerSeal {...props} isOpen />);
    expect(announce).toHaveBeenCalledWith('Maghrib choices open');

    await view.rerender(<PrayerSeal {...props} isOpen={false} />);
    expect(announce).toHaveBeenCalledWith('Choices closed');
  });
});

/**
 * The seal's three words as the shipped faces actually set them, in ems of the label's own font
 * size. Measured by summing `hmtx` advances in the exact files the app bundles
 * (`Lora_600SemiBold.ttf`, `Amiri_700Bold.ttf` — the label asks for weight 600, and Arabic under
 * 13px takes the Bold file, D54). The Arabic figure sums the *isolated* forms, so it is an upper
 * bound on what shaping produces; its harakat carry zero advance, as they do on screen.
 *
 * Only the widest word of each language is listed, because the option target is one size for all
 * three: en "Missed" 3.358 (·"Prayed" 3.292), tr "Kılındı" 3.162, ar صُلِّيت 3.505.
 */
const WIDEST_LABEL_EM = { en: 3.358, tr: 3.162, ar: 3.505 } as const;

describe('PrayerSeal — the pill grows with the type (Apple’s 200% bar)', () => {
  // The defect this suite exists for: the pill was pinned at 48×160 with 50×44 options, so at 2×
  // the words truncated horizontally AND overflowed the 48pt `overflow: hidden` clip vertically.

  const LABEL_SIZE = 10;
  const LABEL_LINE = LABEL_SIZE + 2;
  const ICON = 17;
  const ICON_CAP = 1.4;

  it('is the mockup, to the point, at the default text size — in every language', () => {
    for (const optical of [1, arabicTypeScale]) {
      expect(sealPillMetrics(1, optical)).toEqual({
        width: SEAL_OPEN_WIDTH,
        height: SEAL_SIZE,
        optionWidth: 50,
        optionHeight: 44,
      });
    }
  });

  it('never shrinks below the mockup when the type is set smaller', () => {
    expect(sealPillMetrics(0.8)).toEqual(sealPillMetrics(1));
    expect(sealPillMetrics(0.5, arabicTypeScale)).toEqual(sealPillMetrics(1));
  });

  it.each([
    ['en', 1],
    ['tr', 1],
    ['ar', arabicTypeScale],
  ] as const)(
    'holds %s’s longest word unclipped, at the default size and at 2×',
    (language, optical) => {
      for (const scale of [1, 2]) {
        const metrics = sealPillMetrics(scale, optical, SCREEN_WIDTH * 0.78);

        // Horizontally: the word must fit its target instead of ellipsizing inside it.
        const labelWidth = WIDEST_LABEL_EM[language] * LABEL_SIZE * scale * optical;
        expect(labelWidth).toBeLessThan(metrics.optionWidth);

        // Vertically: icon + gap + line box must sit inside the clip, which is the pill's height.
        const stack = ICON * Math.min(scale, ICON_CAP) + 1 + LABEL_LINE * scale * optical;
        expect(stack).toBeLessThan(metrics.height);
        // …and inside its own target, which is what centres it.
        expect(stack).toBeLessThanOrEqual(metrics.optionHeight);
      }
    }
  );

  it('grows the clip too, so nothing is cut off on the way up', () => {
    // The old geometry kept `height: 48` and clipped: 23.8 + 1 + 24 = 48.8 had nowhere to go.
    expect(sealPillMetrics(2).height).toBeGreaterThan(SEAL_SIZE);
    expect(sealPillMetrics(2).width).toBeGreaterThan(SEAL_OPEN_WIDTH);
    // Growth is monotonic and bounded by the label's own 2.0 cap — past it nothing more is due.
    expect(sealPillMetrics(1.5).width).toBeLessThan(sealPillMetrics(2).width);
    expect(sealPillMetrics(3)).toEqual(sealPillMetrics(2));
  });

  it('stops growing before it pushes its own third option off a narrow screen', () => {
    const narrow = 320 * 0.78;
    const metrics = sealPillMetrics(2, arabicTypeScale, narrow);
    expect(metrics.width).toBeLessThanOrEqual(narrow);
    // Clamped, never collapsed: the target keeps at least the size the mockup gave it.
    expect(metrics.optionWidth).toBeGreaterThanOrEqual(50);
  });

  it('renders at the size it computed', async () => {
    setFontScale(2);
    const expected = sealPillMetrics(2, 1, SCREEN_WIDTH * 0.78);
    await renderSeal({ isOpen: true });

    expect(styleOf('seal-maghrib-option-prayed')).toMatchObject({
      width: expected.optionWidth,
      height: expected.optionHeight,
    });
    expect(styleOf('seal-maghrib-options')).toMatchObject({ width: expected.width });
    await waitFor(() => {
      expect(getAnimatedStyle(byId('seal-maghrib'))).toMatchObject({
        width: expected.width,
        height: expected.height,
      });
    });
  });

  it('keeps the collapsed seal a 48pt circle however big the type is', async () => {
    setFontScale(2);
    await renderSeal({ isOpen: false });
    expect(getAnimatedStyle(byId('seal-maghrib'))).toMatchObject({
      width: SEAL_SIZE,
      height: SEAL_SIZE,
    });
    expect(styleOf('seal-maghrib-face')).toMatchObject({ width: SEAL_SIZE, height: SEAL_SIZE });
  });

  /**
   * The ceiling is a share of the row the pill sits in, and on a tablet that row is bounded by the
   * 600pt page rather than by the glass (D123) — 78% of an iPad's width would be a pill wider than
   * the prayer it belongs to.
   */
  it('measures its ceiling against the content column on a tablet window', async () => {
    jest
      .spyOn(Dimensions, 'get')
      .mockImplementation(() => ({ width: 1024, height: 1366, scale: 2, fontScale: 2 }));
    await renderSeal({ isOpen: true });

    const expected = sealPillMetrics(2, 1, maxContentWidth * 0.78);
    expect(styleOf('seal-maghrib-options')).toMatchObject({ width: expected.width });
    expect(expected.width).toBeLessThanOrEqual(maxContentWidth * 0.78);
  });
});

describe('PrayerSeal — picking', () => {
  it('reports each choice with the status it sets', async () => {
    await renderSeal({ isOpen: true });

    await fireEvent.press(option('prayed'));
    expect(onPick).toHaveBeenLastCalledWith('prayed', { clears: false, next: 'prayed', direct: false });

    await fireEvent.press(option('late'));
    expect(onPick).toHaveBeenLastCalledWith('late', { clears: false, next: 'late', direct: false });

    await fireEvent.press(option('missed'));
    expect(onPick).toHaveBeenLastCalledWith('missed', { clears: false, next: 'missed', direct: false });

    expect(onPick).toHaveBeenCalledTimes(3);
    // The seal never collapses itself — closing is the parent's half of the same state update.
    expect(onToggleOpen).not.toHaveBeenCalled();
  });

  it('signals a clear when the current status is picked again', async () => {
    await renderSeal({ isOpen: true, status: 'late' });

    await fireEvent.press(option('late'));
    expect(onPick).toHaveBeenCalledWith('late', { clears: true, next: 'unlogged', direct: false });

    expect(screen.getByLabelText('Clear “prayed late” for Maghrib')).toBeTruthy();
    expect(option('late').props.accessibilityState).toMatchObject({ selected: true });
    expect(option('prayed').props.accessibilityState).toMatchObject({ selected: false });
  });

  it('says what it recorded, instead of only that the pill shut', async () => {
    // The app's whole reward loop, and it used to be silent: a blind user tapped "Prayed" and
    // heard "Choices closed" — the housekeeping, never the thing that was written down.
    const props = {
      prayer: 'maghrib',
      prayerName: 'Maghrib',
      status: 'unlogged',
      onToggleOpen,
      onPick,
    } as const;
    const view = await render(<PrayerSeal {...props} isOpen />);
    announce.mockClear();

    await fireEvent.press(option('prayed'));
    expect(announce).toHaveBeenCalledWith('Maghrib marked as prayed');

    // The parent's half of a pick: apply it and close. The closing line must not talk over it.
    await view.rerender(<PrayerSeal {...props} status="prayed" isOpen={false} />);
    expect(announce).not.toHaveBeenCalledWith('Choices closed');
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('names late and missed in their own words, and says when a mark was cleared', async () => {
    for (const [status, expected] of [
      ['late', 'Maghrib marked as prayed late'],
      ['missed', 'Maghrib marked as missed'],
    ] as const) {
      const view = await renderSeal({ isOpen: true });
      announce.mockClear();
      await fireEvent.press(option(status));
      expect(announce).toHaveBeenCalledWith(expected);
      await view.unmount();
    }

    // Picking the status a prayer already has clears it — soft, never an accusation.
    const view = await renderSeal({ isOpen: true, status: 'prayed' });
    announce.mockClear();
    await fireEvent.press(option('prayed'));
    expect(announce).toHaveBeenCalledWith('Maghrib mark cleared');
    await view.unmount();
  });

  it('hands VoiceOver’s focus to the seal it just changed, rather than letting it die', async () => {
    // The button that was tapped stops existing, and with it the reader's place on the screen.
    const props = {
      prayer: 'maghrib',
      prayerName: 'Maghrib',
      status: 'unlogged',
      onToggleOpen,
      onPick,
    } as const;
    const view = await render(<PrayerSeal {...props} isOpen />);
    await fireEvent.press(option('prayed'));
    await view.rerender(<PrayerSeal {...props} status="prayed" isOpen={false} />);

    await waitFor(() => {
      expect(focusOn).toHaveBeenCalledTimes(1);
    });
    // Aimed at the face of this seal — the element that replaced the pill, now reading
    // "Maghrib, prayed" — and not at some ancestor that would drop the reader back at the top.
    // (Asserted through the target's testID rather than the instance itself: comparing React
    // instances makes a failure print a whole fiber.)
    const [target, event] = focusOn.mock.calls[0] as [{ props?: { testID?: string } }, string];
    expect(event).toBe('focus');
    expect(target.props?.testID).toBe('seal-maghrib-face');
  });

  it('offers every option a way out of the pill', async () => {
    await renderSeal({ isOpen: true });

    for (const status of ['prayed', 'late', 'missed'] as const) {
      expect(option(status).props.accessibilityActions).toEqual([
        { name: 'close', label: 'Close choices' },
      ]);
    }

    await act(async () => {
      fireEvent(option('missed'), 'accessibilityAction', {
        nativeEvent: { actionName: 'close' },
      });
    });
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('PrayerSeal — direct pick (the currently-due prayer)', () => {
  // Spec-today-interaction §3: on the prayer whose window is open, the face IS the interaction.
  // Late/Missed are not offered — a prayer whose window is open cannot yet be late or missed.

  it('marks the prayer prayed with a single tap on the face — no pill', async () => {
    await renderSeal({ directPick: true, isCurrent: true });

    await fireEvent.press(face());
    expect(onPick).toHaveBeenCalledWith('prayed', { clears: false, next: 'prayed', direct: true });
    expect(onToggleOpen).not.toHaveBeenCalled();
  });

  it('speaks the outcome of the one-tap mark too — it is the tap most people make', async () => {
    await renderSeal({ directPick: true, isCurrent: true });
    announce.mockClear();

    await fireEvent.press(face());
    expect(announce).toHaveBeenCalledWith('Maghrib marked as prayed');
    // Nothing vanished here, so nothing needs catching: focus stays on the face under the finger.
    expect(focusOn).not.toHaveBeenCalled();
  });

  it('undoes the mark with the same tap when already prayed', async () => {
    await renderSeal({ directPick: true, isCurrent: true, status: 'prayed' });

    await fireEvent.press(face());
    expect(onPick).toHaveBeenCalledWith('prayed', { clears: true, next: 'unlogged', direct: true });
    expect(onToggleOpen).not.toHaveBeenCalled();
  });

  it('teaches the gesture in its hints', async () => {
    const view = await renderSeal({ directPick: true, isCurrent: true });
    expect(face().props.accessibilityHint).toBe('Marks Maghrib as prayed');

    await view.rerender(
      <PrayerSeal
        prayer="maghrib"
        prayerName="Maghrib"
        status="prayed"
        isOpen={false}
        directPick
        isCurrent
        onToggleOpen={onToggleOpen}
        onPick={onPick}
      />
    );
    expect(face().props.accessibilityHint).toBe('Clears the mark');
  });

  it('never expands into the pill, even if told it is open', async () => {
    // A direct-pick seal has no pill and therefore never registers a dismiss region.
    await renderSeal({ directPick: true, isCurrent: true, isOpen: true });

    // Never expanded, so the three options are never even built.
    expect(screen.queryByTestId('seal-maghrib-options', HIDDEN)).toBeNull();
    expect(screen.queryByTestId('seal-maghrib-dismiss', HIDDEN)).toBeNull();
    expect(getAnimatedStyle(byId('seal-maghrib'))).toMatchObject({ width: SEAL_SIZE });
  });

  it('falls back to the pill for a deliberate mark (late/missed) even when told to direct-pick', async () => {
    // A single tap must never silently overwrite a deliberate mark. The parent never passes
    // `directPick` for these statuses; this pins that a race resolves to the pill, harmlessly.
    await renderSeal({ directPick: true, isCurrent: true, status: 'late' });

    await fireEvent.press(face());
    expect(onPick).not.toHaveBeenCalled();
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
  });
});

describe('PrayerSeal — states that refuse a tap', () => {
  it('blocks a prayer whose time has not arrived', async () => {
    await renderSeal({ disabled: true });

    await fireEvent.press(face());
    expect(onToggleOpen).not.toHaveBeenCalled();
    expect(face().props.accessibilityState).toMatchObject({ disabled: true, expanded: false });
    expect(face().props.accessibilityHint).toBe('You can mark this once the prayer time arrives');
  });

  it('stays collapsed even if a disabled seal is told it is open', async () => {
    await renderSeal({ disabled: true, isOpen: true });

    // Never expanded, so there is no option to reach — nothing to press, nothing to pick.
    expect(screen.queryByTestId('seal-maghrib-options', HIDDEN)).toBeNull();
    expect(screen.queryByTestId('seal-maghrib-option-prayed', HIDDEN)).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(getAnimatedStyle(byId('seal-maghrib'))).toMatchObject({
      width: SEAL_SIZE,
    });
  });

  it('cannot be changed on an exempt day', async () => {
    await renderSeal({ status: 'exempt' });

    await fireEvent.press(face());
    expect(onToggleOpen).not.toHaveBeenCalled();
    expect(face().props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('keeps an exempt seal shut even when asked to open', async () => {
    await renderSeal({ status: 'exempt', isOpen: true });

    // Never expanded, so there is no option to reach.
    expect(screen.queryByTestId('seal-maghrib-option-missed', HIDDEN)).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByTestId('seal-maghrib-dismiss', HIDDEN)).toBeNull();
  });
});

describe('PrayerSeal — reduce motion', () => {
  it('still opens fully when the system asks for less motion', async () => {
    reduceMotionEnabled = true;
    await renderSeal({ isOpen: true });

    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled();
    // The pill ends up open either way — reduced motion only removes the travel, and the two
    // layers still cross-fade so the change is visible.
    await waitFor(() => {
      expect(getAnimatedStyle(byId('seal-maghrib'))).toMatchObject({
        width: SEAL_OPEN_WIDTH,
      });
    });
    await waitFor(() => {
      expect(getAnimatedStyle(byId('seal-maghrib-options'))).toMatchObject({
        opacity: 1,
      });
    });
    await waitFor(() => {
      expect(getAnimatedStyle(face().parent!)).toMatchObject({ opacity: 0 });
    });
  });

  it('follows the setting while mounted and unsubscribes on unmount', async () => {
    // Counted as a delta, not an absolute: `removeSubscription` is cleared in beforeEach but the
    // shared `AccessibilityInfo.addEventListener` mock is not, so its calls accumulate across the
    // whole file. Comparing the two totals would measure the file's history, not this render's.
    const subscriptionsBefore = (AccessibilityInfo.addEventListener as jest.Mock).mock.calls.filter(
      ([event]) => event === 'reduceMotionChanged'
    ).length;

    const view = await renderSeal();
    expect(AccessibilityInfo.addEventListener).toHaveBeenCalledWith(
      'reduceMotionChanged',
      expect.any(Function)
    );

    await act(async () => {
      reduceMotionListener?.(true);
    });
    expect(byId('seal-maghrib')).toBeTruthy();

    await view.unmount();
    // One removal per subscription: the seal probes the flag itself AND every PressableScale in
    // its tree now carries its own probe (spec-accessibility §2.7 gave the press dip the flag
    // check), so the count is "as many as were added", not the literal 1 this test pinned when
    // the seal was the tree's only listener.
    const subscriptionsAdded =
      (AccessibilityInfo.addEventListener as jest.Mock).mock.calls.filter(
        ([event]) => event === 'reduceMotionChanged'
      ).length - subscriptionsBefore;

    expect(subscriptionsAdded).toBeGreaterThan(0);
    expect(removeSubscription).toHaveBeenCalledTimes(subscriptionsAdded);
  });
});

describe('PrayerSeal — simple tracking mode (D192)', () => {
  it('takes the one tap on a face showing missed, turning it prayed', async () => {
    await renderSeal({ status: 'missed', directPick: true, simple: true });

    await fireEvent.press(face());

    expect(onPick).toHaveBeenCalledWith('prayed', { clears: false, next: 'prayed', direct: true });
    expect(onToggleOpen).not.toHaveBeenCalled();
  });

  it('keeps guarding a deliberate miss in detailed mode', async () => {
    await renderSeal({ status: 'missed', directPick: true });

    await fireEvent.press(face());

    expect(onPick).not.toHaveBeenCalled();
  });
});

/**
 * The happy path must not require moving your thumb.
 *
 * The pill is pinned to the row's outer edge and grows inward, so whichever option is *last* in
 * the row sits under the finger that just opened it. That used to be `missed` — so the common
 * case meant crossing the whole pill, and the destructive one waited where an accidental second
 * tap would land. Both halves of the fix are pinned here because either one alone is not enough:
 * the order puts `prayed` under the thumb once the pill is open, and the end-anchoring keeps it
 * there *during* the morph, when a genuinely fast double tap arrives.
 */
describe('a double tap in one place marks a prayer prayed (owner, 2026-08-21)', () => {
  it('puts prayed last, nearest the thumb, and missed furthest away', async () => {
    await renderSeal({ isOpen: true, status: 'unlogged', directPick: false });

    const order = screen
      .getByTestId('seal-maghrib-options')
      .props.children.map((child: { props: { testID?: string } }) => child?.props?.testID)
      .filter(Boolean) as string[];

    expect(order).toEqual([
      'seal-maghrib-option-missed',
      'seal-maghrib-option-late',
      'seal-maghrib-option-prayed',
    ]);
  });

  it('anchors the options row to the edge the seal does not move away from', async () => {
    // `start: 0` would tie the row to the edge that travels during the morph, dragging all three
    // options with it — a second tap landing mid-animation would hit whichever was passing.
    await renderSeal({ isOpen: true, status: 'unlogged', directPick: false });
    const style = styleOf('seal-maghrib-options');
    expect(style).toMatchObject({ end: 0 });
    expect(style).not.toMatchObject({ start: 0 });
  });

  it('records prayed — never missed — when the second tap lands without moving', async () => {
    // The first tap opens; the screen re-renders it open; the second tap lands in the same place.
    await renderSeal({ isOpen: false, status: 'unlogged', directPick: false });
    fireEvent.press(screen.getByTestId('seal-maghrib-face'));
    expect(onToggleOpen).toHaveBeenCalled();

    await renderSeal({ isOpen: true, status: 'unlogged', directPick: false });
    fireEvent.press(screen.getByTestId('seal-maghrib-option-prayed'));

    // `onPick` carries its meta (see `meta.clears`, the undo half of D58), so match the status.
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0]).toBe('prayed');
  });
});
