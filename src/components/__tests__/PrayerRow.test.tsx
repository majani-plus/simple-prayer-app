import { act, configure, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { PrayerRow } from '../PrayerRow';
import { initI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { ThemePreferenceContext, fonts, nightPaper, paperLight } from '@/theme';

import type { PrayerSealProps } from '../PrayerSeal';

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

// The seal is another component's business (and carries its own animations); the row is tested
// against the contract it hands over, not against the seal's internals.
const sealProps: { current: PrayerSealProps | null } = { current: null };
jest.mock('../PrayerSeal', () => ({
  __esModule: true,
  PrayerSeal: (props: PrayerSealProps) => {
    sealProps.current = props;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { View: MockView } = require('react-native') as typeof import('react-native');
    return <MockView testID="seal" />;
  },
}));

configure({ defaultIncludeHiddenElements: true });

const NOW = new Date(2025, 6, 11, 18, 39, 30);
const MAGHRIB = new Date(2025, 6, 11, 20, 47, 0);
const MS_REMAINING = MAGHRIB.getTime() - NOW.getTime();

function styleOf(text: string): TextStyle {
  return StyleSheet.flatten(screen.getByText(text).props.style) as TextStyle;
}

function rowStyle(): ViewStyle {
  return StyleSheet.flatten(screen.getByTestId('row').props.style) as ViewStyle;
}

function row(overrides: Partial<React.ComponentProps<typeof PrayerRow>> = {}) {
  return (
    <PrayerRow
      prayer="maghrib"
      name="Maghrib"
      arabicName="المغرب"
      time={MAGHRIB}
      status="unlogged"
      isOpen={false}
      onToggleOpen={jest.fn()}
      onPick={jest.fn()}
      testID="row"
      {...overrides}
    />
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  sealProps.current = null;
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  useSettingsStore.getState().setTimeFormat('12h');
  // The row consults reduced motion for the NEXT-tier reveal (same pattern as PaperSwitch).
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => Promise.resolve(false));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('PrayerRow', () => {
  it('puts the name and its calligraphy on one baseline, the time beneath', async () => {
    await render(row({ isFuture: true }));
    expect(screen.getByText('Maghrib')).toBeTruthy();
    expect(screen.getByText('المغرب')).toBeTruthy();
    expect(screen.getByText('8:47 pm')).toBeTruthy();
    expect(styleOf('المغرب')).toMatchObject({ fontFamily: fonts.arabic, fontSize: 16 });
  });

  it('prints the name once when the calligraphy IS the name (Arabic UI)', async () => {
    await render(row({ isFuture: true, name: 'المغرب', arabicName: 'المغرب' }));
    expect(screen.getAllByText('المغرب')).toHaveLength(1);
  });

  it('follows the 24-hour preference', async () => {
    useSettingsStore.getState().setTimeFormat('24h');
    await render(row({ isFuture: true }));
    expect(screen.getByText('20:47')).toBeTruthy();
  });

  describe('captions', () => {
    it.each([
      ['prayed', 'prayed'],
      ['late', 'prayed late'],
      ['missed', 'missed'],
      ['exempt', 'not required'],
    ] as const)('says “%s” as “%s”', async (status, caption) => {
      await render(row({ status }));
      expect(screen.getByText(caption)).toBeTruthy();
      // 15, not the global caption's 13.5: the rows' secondary line is raised for legibility
      // (`rowCaption` — the owner has reported it hard to read three times, hardest in Amiri).
      expect(styleOf(caption)).toMatchObject({
        fontFamily: fonts.regularItalic,
        fontSize: 15,
        color: paperLight.muted,
      });
    });

    it('calls a future prayer “upcoming”', async () => {
      await render(row({ isFuture: true }));
      expect(screen.getByText('upcoming')).toBeTruthy();
    });

    it('calls a passed, unlogged prayer “not marked” — never “missed”', async () => {
      await render(row({ isFuture: false }));
      expect(screen.getByText('not marked')).toBeTruthy();
      expect(screen.queryByText('missed')).toBeNull();
    });
  });

  describe('the current prayer (window open, unlogged) — the one loud row', () => {
    // Emphasis moved from `isNext` to `isCurrent && unlogged` (spec-today-interaction §1): the
    // hero answers "what's next"; the row emphasis answers "what is due NOW".
    const ISHA_START = new Date(2025, 6, 11, 22, 4, 0);

    it('grows its name and time and drops the rest of the scale', async () => {
      await render(row({ isCurrent: true, windowEnd: ISHA_START }));
      expect(styleOf('Maghrib')).toMatchObject({ fontSize: 20, fontFamily: fonts.semiBold });
      expect(styleOf('8:47 pm')).toMatchObject({
        fontSize: 19,
        fontFamily: fonts.bold,
        color: paperLight.inkStrong,
      });
      // Tabular figures ride on the digit run, not the whole node — see `AppText`.
      expect(styleOf('8:47')).toMatchObject({ fontVariant: ['tabular-nums'] });
    });

    it('brightens the card, takes the strong border and the gold glow', async () => {
      await render(row({ isCurrent: true, windowEnd: ISHA_START }));
      expect(rowStyle()).toMatchObject({
        backgroundColor: paperLight.cardBright,
        borderColor: paperLight.borderStrong,
        paddingVertical: 14,
      });
      expect(rowStyle().boxShadow).toBeDefined();
    });

    it('names the absolute deadline in the caption, in the accent colour', async () => {
      // Not a second countdown: the hero already ticks the identical remaining time.
      await render(row({ isCurrent: true, windowEnd: ISHA_START }));
      expect(styleOf('now · until 10:04 pm')).toMatchObject({
        fontFamily: fonts.regularItalic,
        color: paperLight.accent,
      });
      expect(screen.getByLabelText('Maghrib, 8:47 pm, now · until 10:04 pm')).toBeTruthy();
    });

    it('names sunrise as Fajr’s deadline while sunrise is still ahead', async () => {
      const SUNRISE = new Date(2025, 6, 11, 6, 14, 0);
      await render(
        row({ prayer: 'fajr', name: 'Fajr', arabicName: 'الفجر', isCurrent: true, sunrise: SUNRISE })
      );
      expect(screen.getByText('now · until sunrise 6:14 am')).toBeTruthy();
    });

    it('says just “now” for Fajr after sunrise — never “until Dhuhr”', async () => {
      // Claiming "until Dhuhr" would misstate fiqh; going silent would drop the register's word.
      await render(
        row({
          prayer: 'fajr',
          name: 'Fajr',
          arabicName: 'الفجر',
          isCurrent: true,
          windowEnd: new Date(2025, 6, 11, 13, 0, 0),
        })
      );
      expect(screen.getByText('now')).toBeTruthy();
      expect(screen.queryByText(/until/)).toBeNull();
    });

    it('keeps the primary register when logged — the weight says which window you are in', async () => {
      // The owner amendment: the current row does NOT drop to PAST when logged. The register
      // stays put for as long as the window is open; the seal (and the caption word) say
      // whether it is still owed. Only the deadline caption belongs to the unlogged state.
      await render(row({ isCurrent: true, windowEnd: ISHA_START, status: 'prayed' }));
      expect(rowStyle()).toMatchObject({
        backgroundColor: paperLight.cardBright,
        borderColor: paperLight.borderStrong,
        paddingVertical: 14,
      });
      expect(styleOf('Maghrib').fontSize).toBe(20);
      expect(screen.getByText('prayed')).toBeTruthy();
      expect(screen.queryByText(/now · until/)).toBeNull();
    });
  });

  describe('the next prayer — quiet card, countdown caption only', () => {
    it('stays on the quiet card: the emphasis belongs to the current prayer', async () => {
      await render(row({ isNext: true, isFuture: true, msRemaining: MS_REMAINING }));
      expect(rowStyle()).toMatchObject({
        backgroundColor: paperLight.cardQuiet,
        borderColor: paperLight.borderFaint,
        paddingVertical: 10,
      });
      expect(styleOf('Maghrib').fontSize).toBe(18);
    });

    it('counts down in the caption, compactly, in the accent colour', async () => {
      await render(row({ isNext: true, isFuture: true, msRemaining: MS_REMAINING }));
      expect(styleOf('in 2 h 07 m').color).toBe(paperLight.accent);

      await act(async () => {
        jest.advanceTimersByTime(31_000);
      });
      expect(screen.getByText('in 2 h 06 m')).toBeTruthy();
    });

    it('stops counting down once it is logged — what happened matters more', async () => {
      await render(
        row({ isNext: true, isFuture: true, msRemaining: MS_REMAINING, status: 'prayed' })
      );
      expect(screen.getByText('prayed')).toBeTruthy();
      expect(screen.queryByText(/in 2 h/)).toBeNull();
    });
  });

  describe('the NEXT tier — subtle secondary treatment once the current prayer is logged', () => {
    const nextUp = { isNext: true, isNextUp: true, isFuture: true, msRemaining: MS_REMAINING };

    it('carries no cue while the current prayer is unlogged — one emphasised row, ever', async () => {
      await render(row({ isNext: true, isFuture: true, msRemaining: MS_REMAINING }));
      expect(screen.queryByText('next ·')).toBeNull();
      expect(screen.queryByTestId('row-next-up-ring')).toBeNull();
    });

    it('gains the soft "next" word and the mid-weight ring, spoken as shown', async () => {
      await render(row(nextUp));
      // Never colour-only: the word is the cue, in the same accent caption as the countdown.
      expect(styleOf('next ·')).toMatchObject({
        fontFamily: fonts.regularItalic,
        fontSize: 15,
        color: paperLight.accent,
      });
      expect(screen.getByText('in 2 h 07 m')).toBeTruthy();
      const ring = StyleSheet.flatten(
        screen.getByTestId('row-next-up-ring').props.style
      ) as ViewStyle;
      expect(ring).toMatchObject({ borderWidth: 1, borderColor: paperLight.borderMid });
      expect(screen.getByLabelText('Maghrib, 8:47 pm, next · in 2 hours 7 minutes')).toBeTruthy();
    });

    it('stays unmistakably subordinate to CURRENT: quiet card, faint base border, base-size name', async () => {
      // Two rows carry emphasis at once now; the gap between the tiers must never make a viewer
      // hesitate. NEXT gets none of CURRENT's marks — no bright fill, no glow, no larger type.
      await render(row(nextUp));
      expect(rowStyle()).toMatchObject({
        backgroundColor: paperLight.cardQuiet,
        borderColor: paperLight.borderFaint,
        paddingVertical: 10,
      });
      expect(rowStyle().boxShadow).toBeUndefined();
      expect(styleOf('Maghrib').fontSize).toBe(18);
    });

    it('animates the cue in when the flag arrives while mounted, honouring reduced motion', async () => {
      // Reanimated's test build settles `withTiming` as soon as the microtask queue drains, so
      // "the word started at opacity 0" is not observable here. What is: the cue was absent,
      // the flag flipped, the cue is present and settled — and the reduce-motion probe ran, the
      // branch that decides whether the word travels or only fades.
      const view = await render(row({ isNext: true, isFuture: true, msRemaining: MS_REMAINING }));
      expect(screen.queryByText('next ·')).toBeNull();

      await view.rerender(row(nextUp));
      await act(async () => {
        jest.advanceTimersByTime(250);
      });
      expect(screen.getByText('next ·')).toBeTruthy();
      expect(screen.getByTestId('row-next-up-ring')).toBeTruthy();
      expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled();
    });

    it('the undo takes the cue away again', async () => {
      const view = await render(row(nextUp));
      expect(screen.getByText('next ·')).toBeTruthy();

      await view.rerender(row({ isNext: true, isFuture: true, msRemaining: MS_REMAINING }));
      expect(screen.queryByText('next ·')).toBeNull();
      expect(screen.queryByTestId('row-next-up-ring')).toBeNull();
    });
  });

  it('stays a quiet card when it is not the current prayer', async () => {
    await render(row({ status: 'prayed' }));
    expect(rowStyle()).toMatchObject({
      backgroundColor: paperLight.cardQuiet,
      borderColor: paperLight.borderFaint,
      paddingVertical: 10,
    });
    // The quiet time reads at 15.5 (`rowTimeQuiet`), raised from the design's 12.5 for
    // legibility — three owner reports (D67, D74, 2026-08-24).
    expect(styleOf('Maghrib').fontSize).toBe(18);
    expect(styleOf('8:47 pm')).toMatchObject({ fontSize: 15.5, color: paperLight.muted });
  });

  it('announces the row as one phrase, with the countdown spoken in full', async () => {
    await render(row({ isNext: true, isFuture: true, msRemaining: MS_REMAINING }));
    expect(screen.getByLabelText('Maghrib, 8:47 pm, in 2 hours 7 minutes')).toBeTruthy();
  });

  it('announces a logged row with its caption', async () => {
    await render(row({ status: 'late' }));
    expect(screen.getByLabelText('Maghrib, 8:47 pm, prayed late')).toBeTruthy();
  });

  it('hands the seal the status, the open flag and the callbacks', async () => {
    const onToggleOpen = jest.fn();
    const onPick = jest.fn();
    await render(row({ status: 'late', isOpen: true, onToggleOpen, onPick }));

    expect(screen.getByTestId('seal')).toBeTruthy();
    expect(sealProps.current).toMatchObject({
      prayer: 'maghrib',
      prayerName: 'Maghrib',
      status: 'late',
      isOpen: true,
      onToggleOpen,
      onPick,
    });
  });

  it('forwards the registers and the direct-pick mode to the seal', async () => {
    await render(row({ isCurrent: true, directPick: true }));
    expect(sealProps.current).toMatchObject({
      isCurrent: true,
      isFuture: false,
      directPick: true,
    });

    await render(row({ isFuture: true }));
    expect(sealProps.current).toMatchObject({ isCurrent: false, isFuture: true });
    expect(sealProps.current?.directPick).toBeUndefined();
  });

  it('locks the seal on a future prayer, and lets an explicit flag win', async () => {
    await render(row({ isFuture: true }));
    expect(sealProps.current?.disabled).toBe(true);

    await render(row({ isFuture: true, disabled: false }));
    expect(sealProps.current?.disabled).toBe(false);

    await render(row({ isFuture: false, disabled: true }));
    expect(sealProps.current?.disabled).toBe(true);
  });

  it('follows the night-paper palette in dark mode', async () => {
    await render(
      <ThemePreferenceContext.Provider value="dark">
        {row({ isCurrent: true, windowEnd: new Date(2025, 6, 11, 22, 4, 0) })}
      </ThemePreferenceContext.Provider>
    );
    expect(rowStyle()).toMatchObject({
      backgroundColor: nightPaper.cardBright,
      borderColor: nightPaper.borderStrong,
    });
    expect(styleOf('Maghrib').color).toBe(nightPaper.ink);
    expect(styleOf('8:47 pm').color).toBe(nightPaper.inkStrong);
    expect(styleOf('now · until 10:04 pm').color).toBe(nightPaper.accent);
  });
});
