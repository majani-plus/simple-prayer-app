import { act, configure, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, type TextStyle } from 'react-native';

import { CountdownHero } from '../CountdownHero';
import { initI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { ThemePreferenceContext, fonts, nightPaper, paperLight } from '@/theme';

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

// The calligraphy name and the hairlines are hidden from assistive technology on purpose; the
// tests still need to see them.
configure({ defaultIncludeHiddenElements: true });

const NOW = new Date(2025, 6, 11, 18, 39, 30);
/** 20:47 — the mockup's Maghrib, 2 h 07 m away. */
const MAGHRIB = new Date(2025, 6, 11, 20, 47, 0);
const MS_REMAINING = MAGHRIB.getTime() - NOW.getTime();

function styleOf(text: string): TextStyle {
  return StyleSheet.flatten(screen.getByText(text).props.style) as TextStyle;
}

/** Advances fake timers inside `act`, flushing the re-render each tick schedules. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

function hero(overrides: Partial<React.ComponentProps<typeof CountdownHero>> = {}) {
  return (
    <CountdownHero
      prayer="maghrib"
      name="Maghrib"
      arabicName="المغرب"
      time={MAGHRIB}
      msRemaining={MS_REMAINING}
      testID="hero"
      {...overrides}
    />
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  useSettingsStore.getState().setTimeFormat('12h');
  useSettingsStore.getState().setAllReminders({ adhanEnabled: false });
  // The hero consults reduced motion for its mode switch (same pattern as PaperSwitch).
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => Promise.resolve(false));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('CountdownHero', () => {
  it('renders the calligraphy name in Amiri at 30pt in the accent colour', async () => {
    await render(hero());
    expect(styleOf('المغرب')).toMatchObject({
      fontFamily: fonts.arabic,
      fontSize: 30,
      color: paperLight.accent,
    });
  });

  it('keeps the calligraphy and drops the repeat when the two names are one (Arabic UI)', async () => {
    await render(hero({ name: 'المغرب', arabicName: 'المغرب' }));
    expect(screen.getAllByText('المغرب')).toHaveLength(1);
    expect(styleOf('المغرب').fontSize).toBe(30);
    expect(screen.getByText('8:47 pm')).toBeTruthy();
  });

  it('pairs the Latin name at 23/600 with the time at 23/700, tabular', async () => {
    await render(hero());
    expect(styleOf('Maghrib')).toMatchObject({
      fontFamily: fonts.semiBold,
      fontSize: 23,
      color: paperLight.ink,
    });
    expect(styleOf('8:47 pm')).toMatchObject({
      fontFamily: fonts.bold,
      fontSize: 23,
      color: paperLight.inkStrong,
    });
    // Tabular figures ride on the digit run, not the whole node — see `AppText`.
    expect(styleOf('8:47')).toMatchObject({ fontVariant: ['tabular-nums'] });
  });

  it('follows the 24-hour preference for the time', async () => {
    useSettingsStore.getState().setTimeFormat('24h');
    await render(hero());
    expect(screen.getByText('20:47')).toBeTruthy();
  });

  it('writes the countdown out in full, a step above the caption role it borrows', async () => {
    // 15.5, not the caption's 14: this line carries the one number the screen exists to show,
    // and at 14 regular it read as a footnote to the prayer name above it (owner, 2026-08-21).
    await render(hero());
    expect(styleOf('in 2 hours 7 minutes')).toMatchObject({
      fontSize: 15.5,
      color: paperLight.header,
    });
  });

  it('ticks every second without re-rendering its parent', async () => {
    let parentRenders = 0;
    function Screen() {
      parentRenders += 1;
      return hero();
    }
    await render(<Screen />);
    expect(parentRenders).toBe(1);

    // 29 seconds in, the minute has not turned yet…
    await advance(29_000);
    expect(screen.getByText('in 2 hours 7 minutes')).toBeTruthy();
    // …and two seconds later it has.
    await advance(2_000);
    expect(screen.getByText('in 2 hours 6 minutes')).toBeTruthy();

    // The clock lives in the leaf: nothing above it re-rendered.
    expect(parentRenders).toBe(1);
  });

  it('falls back to the supplied msRemaining when the time is unusable', async () => {
    await render(hero({ time: new Date(NaN) }));
    expect(screen.getByText('in 2 hours 7 minutes')).toBeTruthy();
  });

  it('collapses to “now” once the prayer time arrives', async () => {
    await render(hero());
    await advance(MS_REMAINING);
    expect(screen.getByText('now')).toBeTruthy();
  });

  it('carries the reminder pill for that prayer', async () => {
    await render(hero());
    expect(screen.getByLabelText('Reminder for Maghrib')).toBeTruthy();
    expect(screen.getByText('Remind me')).toBeTruthy();
  });

  it('bounds the section with two hairlines, the ◆ riding the top one', async () => {
    await render(hero());
    expect(screen.getByText('◆')).toBeTruthy();
    expect(screen.getAllByText('◆', { includeHiddenElements: true }).length).toBe(1);
  });

  it('announces the next prayer and its time as one phrase', async () => {
    await render(hero());
    expect(screen.getByLabelText('Next prayer: Maghrib at 8:47 pm')).toBeTruthy();
  });

  describe('the two framings of one instant (spec-today-interaction, owner amendment)', () => {
    // Both modes count down to the SAME timestamp — a window ends exactly when the next prayer
    // starts — so the number on screen is identical and the framing carries the whole
    // distinction. These tests pin that the framing really does, and that carrying it costs
    // NO layout: the owner rejected the earlier chip row ("adding another row in the hero …
    // this jitter before and after it's there").

    it('DUE speaks the current prayer: accent deadline, "left to pray", the awaiting seal echoed inline', async () => {
      await render(hero({ prayer: 'asr', name: 'Asr', arabicName: 'العصر', mode: 'due' }));

      // The instant renders as a deadline, not a start — the word carries the state, the
      // accent gold underlines it…
      expect(styleOf('until 8:47 pm').color).toBe(paperLight.accent);
      // …the countdown says what the minutes are FOR, in the same accent register…
      expect(styleOf('2 hours 7 minutes left to pray').color).toBe(paperLight.accent);
      // …and the seal-echo glyph rides INSIDE the countdown line (icon + words, no chip row).
      expect(screen.getByTestId('hero-mode-due')).toBeTruthy();
      expect(screen.getByLabelText('Time to pray Asr — until 8:47 pm')).toBeTruthy();
    });

    it('WAITING names its subject: "Asr prayed · next in …", and carries no glyph', async () => {
      await render(hero({ mode: 'waiting', prayedName: 'Asr' }));

      // No glyph once the window has closed: the clock belongs to "left to pray", and WAITING is
      // not counting anything down that the user must act on (owner, 2026-08-21).
      expect(screen.queryByTestId('hero-mode-waiting')).toBeNull();
      expect(styleOf('8:47 pm').color).toBe(paperLight.inkStrong);
      expect(screen.queryByText(/until/)).toBeNull();
      // "prayed" carries its subject and "next" claims the countdown for the prayer named
      // above — a bare "prayed" under "Maghrib" was misread as Maghrib being prayed.
      expect(screen.getByText('Asr prayed · next in 2 hours 7 minutes')).toBeTruthy();
      expect(screen.getByLabelText('Next prayer: Maghrib at 8:47 pm')).toBeTruthy();
    });

    it('WAITING without a subject falls back to the plain framing — never a floating "prayed"', async () => {
      await render(hero({ mode: 'waiting' }));
      expect(screen.queryByTestId('hero-mode-waiting')).toBeNull();
      expect(screen.getByText('in 2 hours 7 minutes')).toBeTruthy();
      expect(screen.queryByText(/prayed/)).toBeNull();
    });

    it('PLAIN carries no mode glyph at all — it never claims a state it cannot know', async () => {
      await render(hero());
      expect(screen.queryByTestId('hero-mode-due')).toBeNull();
      expect(screen.queryByTestId('hero-mode-waiting')).toBeNull();
      expect(screen.getByText('in 2 hours 7 minutes')).toBeTruthy();
    });

    it('renders the identical row structure in every mode — no reflow when the mode flips', async () => {
      // The owner's jitter rule: the hero's height must not change between modes. True pixel
      // heights need a layout engine (proved on the simulator); what jest CAN pin is the
      // structure that determines them — the same children, the same text sizes, the pill in
      // every mode. The glyph is inline in the countdown line rather than a row of its own, so
      // whether it is present does not change the row count or the hero's height.
      const shape = () => {
        const children = screen.getByTestId('hero-content').children;
        return Array.isArray(children) ? children.length : 0;
      };

      const view = await render(hero({ mode: 'due' }));
      const dueShape = shape();
      expect(screen.getByLabelText('Reminder for Maghrib')).toBeTruthy();
      expect(styleOf('2 hours 7 minutes left to pray').fontSize).toBe(15.5);

      await view.rerender(hero({ mode: 'waiting', prayedName: 'Asr' }));
      expect(shape()).toBe(dueShape);
      expect(screen.getByLabelText('Reminder for Maghrib')).toBeTruthy();
      expect(styleOf('Asr prayed · next in 2 hours 7 minutes').fontSize).toBe(15.5);

      await view.rerender(hero({ mode: 'plain' }));
      expect(shape()).toBe(dueShape);
      expect(screen.getByLabelText('Reminder for Maghrib')).toBeTruthy();
      expect(styleOf('in 2 hours 7 minutes').fontSize).toBe(15.5);
    });

    it('both modes tick out the identical remaining time from the same target', async () => {
      // One countdown target, two sentences: "N left to pray" and "… next in N" must agree.
      const view = await render(hero({ mode: 'due' }));
      expect(screen.getByText('2 hours 7 minutes left to pray')).toBeTruthy();
      await advance(60_000);
      expect(screen.getByText('2 hours 6 minutes left to pray')).toBeTruthy();

      await view.rerender(hero({ mode: 'waiting', prayedName: 'Asr' }));
      expect(screen.getByText('Asr prayed · next in 2 hours 6 minutes')).toBeTruthy();
    });

    it('keeps the pill in DUE too, bound to the prayer the countdown ends on', async () => {
      // A pill that comes and goes is exactly the jitter the owner rejected. In DUE the hero
      // NAMES the current prayer, so the screen passes the next prayer for the pill — the one
      // whose arrival is the instant on screen.
      await render(
        hero({
          prayer: 'asr',
          name: 'Asr',
          arabicName: 'العصر',
          mode: 'due',
          reminderPrayer: 'maghrib',
          reminderName: 'Maghrib',
        })
      );
      expect(screen.getByLabelText('Reminder for Maghrib')).toBeTruthy();
    });

    it('still yields the pill to showReminder={false} (excused days)', async () => {
      await render(hero({ mode: 'waiting', showReminder: false }));
      expect(screen.queryByLabelText(/^Reminder for/)).toBeNull();
    });

    it('animates the switch a user is watching, honouring reduced motion', async () => {
      // Reanimated's test build settles `withTiming` once the microtask queue drains, so "the
      // fade began at opacity 0" is not observable here. What is: the mode changed under the
      // user's eyes, the new framing is fully present and settled, and the reduce-motion probe
      // ran — the branch that decides whether the switch rises or only cross-fades.
      const view = await render(hero({ mode: 'due' }));
      expect(screen.getByTestId('hero-mode-due')).toBeTruthy();

      await view.rerender(hero({ mode: 'waiting', prayedName: 'Asr' }));
      await advance(250);
      expect(screen.queryByTestId('hero-mode-due')).toBeNull();
      expect(screen.queryByTestId('hero-mode-waiting')).toBeNull();
      expect(screen.getByText('Asr prayed · next in 2 hours 7 minutes')).toBeTruthy();
      expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled();
    });
  });

  it('follows the night-paper palette in dark mode', async () => {
    await render(
      <ThemePreferenceContext.Provider value="dark">{hero()}</ThemePreferenceContext.Provider>
    );
    expect(styleOf('المغرب').color).toBe(nightPaper.accent);
    expect(styleOf('8:47 pm').color).toBe(nightPaper.inkStrong);
    expect(styleOf('in 2 hours 7 minutes').color).toBe(nightPaper.header);
  });
});

describe('the buddy line (D174, B2-9)', () => {
  const face = {
    pairId: 'a'.repeat(32),
    icon: 'initials' as const,
    color: 'ocean' as const,
    nickname: 'Amina',
    lang: 'en',
    notify: true,
    pending: false,
    addedAt: 0,
  };

  it('holds its height whether or not anybody has prayed yet', async () => {
    // D67: the three hero modes are layout-identical, so nothing may appear or disappear under
    // somebody's thumb. The slot is reserved by buddy mode being ON, not by a buddy praying —
    // otherwise the reminder pill jumps the moment a mark arrives.
    await render(
      <CountdownHero
        prayer="maghrib"
        name="Maghrib"
        arabicName="المغرب"
        time={new Date(Date.now() + 3_600_000)}
        msRemaining={3_600_000}
        reserveBuddies
        buddies={[]}
        showReminder={false}
      />
    );
    expect(screen.getByTestId('hero-buddies')).toBeTruthy();
  });

  it('shows a buddy who has prayed it', async () => {
    await render(
      <CountdownHero
        prayer="maghrib"
        name="Maghrib"
        arabicName="المغرب"
        time={new Date(Date.now() + 3_600_000)}
        msRemaining={3_600_000}
        reserveBuddies
        buddies={[face]}
        showReminder={false}
      />
    );
    expect(screen.getByTestId('hero-buddies')).toBeTruthy();
    expect(screen.getByText('AM')).toBeTruthy();
  });

  it('reserves nothing at all for somebody who never turned buddy mode on', async () => {
    await render(
      <CountdownHero
        prayer="maghrib"
        name="Maghrib"
        arabicName="المغرب"
        time={new Date(Date.now() + 3_600_000)}
        msRemaining={3_600_000}
        showReminder={false}
      />
    );
    expect(screen.queryByTestId('hero-buddies')).toBeNull();
  });
});
