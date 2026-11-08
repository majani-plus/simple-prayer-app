/**
 * Component test for the qada setup wizard.
 *
 * The wizard is where the feature's one irreversible-feeling decision is made, so what is tested
 * is the shape of the choice rather than the pixels (PRODUCT_SPEC §7):
 *
 * 1. **Two ways in, neither of them a trap.** The blank slate saves zeroes and marks the setup
 *    done; the backtrack path leads to a date range.
 * 2. **The estimate is the domain's**, not the wizard's: the numbers it puts on screen are
 *    exactly what `domain/qada.estimateDebt` returns for the chosen range.
 * 3. **It is an estimate.** Every counter can be edited before it is saved, and what is saved is
 *    the edited value.
 * 4. **The exemption deduction is offered only inside exemption mode** (PRODUCT_SPEC §6) — and
 *    when it is taken, the saved number is the deducted one.
 * 5. **Skipping is a normal exit**, not a failure: nothing is written, and the wizard is done.
 *
 * The tracking store is mocked (SQLite); the settings store is the real one over an in-memory
 * MMKV, because "is exemption mode on" is precisely what decides step 2's contents.
 */

import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';

import { QadaSetupWizard } from '../QadaSetupWizard';
import { toDayString } from '@/domain/dates';
import { estimateDebt } from '@/domain/qada';
import type { QadaDebts } from '@/domain/types';
import { initI18n } from '@/i18n';
import { MAX_EXEMPT_DAYS_PER_MONTH, useSettingsStore } from '@/stores/settingsStore';

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

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

/**
 * The native picker is replaced by a plain view that still carries its `onChange`, so a date can
 * be chosen deterministically without a platform dialog.
 */
jest.mock('@react-native-community/datetimepicker', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => <View {...props} />,
  };
});

const setQadaDebts = jest.fn((debts: QadaDebts) => debts);

jest.mock('@/stores/trackingStore', () => {
  const qada = jest.requireActual<typeof import('@/domain/qada')>('@/domain/qada');
  const state = {
    debts: qada.emptyDebts(),
    revision: 0,
    hydrated: true,
    tickQada: () => false,
    forgiveQada: () => false,
    undoForgive: () => false,
    qadaProgress: () => ({
      debts: qada.emptyDebts(),
      total: 0,
      paidInWindow: 0,
      perDay: 0,
      projectedClearDay: null,
    }),
    undoableForgive: () => null,
    // Recorded exempt periods, mutable per test: the wizard prefills its days-per-month
    // stepper from these via `domain/exemptions.averageExemptDaysPerMonth`.
    periods: [] as unknown[],
    // Filled in below so the spy declared in the test file can be reached from the factory.
    setQadaDebts: (debts: unknown) => debts,
  };
  return {
    __state: state,
    useTrackingHydrated: () => true,
    useQadaDebts: () => state.debts,
    useExemptPeriods: () => state.periods,
    useTrackingActions: () => state,
    useTrackingStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

const mockState = (
  jest.requireMock('@/stores/trackingStore') as { __state: Record<string, unknown> }
).__state;
mockState.setQadaDebts = setQadaDebts;

configure({ defaultIncludeHiddenElements: true });

const TODAY = '2026-08-19';

/** Chooses a date in one of the two fields, through the (mocked) native picker. */
async function pickDate(which: 'from' | 'to', date: Date) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(`qada-wizard-${which}`));
  });
  await act(async () => {
    fireEvent(screen.getByTestId('qada-wizard-picker'), 'change', { type: 'set' }, date);
  });
}

async function renderWizard() {
  const onDone = jest.fn();
  await render(<QadaSetupWizard onDone={onDone} today={TODAY} />);
  return { onDone };
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 19, 12, 0, 0));
  jest.clearAllMocks();
  useSettingsStore.getState().setQadaSetupCompleted(false);
  useSettingsStore.getState().setExemptionModeEnabled(false);
  useSettingsStore.getState().setExemptDaysPerMonth(7);
  mockState.periods = [];
});

afterEach(() => {
  jest.useRealTimers();
});

describe('QadaSetupWizard — the choice', () => {
  it('offers both ways in, and a way out', async () => {
    await renderWizard();

    expect(screen.getByText('Count what I missed')).toBeTruthy();
    expect(screen.getByText('Begin at zero')).toBeTruthy();
    expect(screen.getByTestId('qada-wizard-skip')).toBeTruthy();
  });

  it('starts a blank slate at zero and marks the setup done', async () => {
    const { onDone } = await renderWizard();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-choice-blank'));
    });

    expect(setQadaDebts).toHaveBeenCalledWith(
      { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
      'manual'
    );
    expect(useSettingsStore.getState().qadaSetupCompleted).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the wizard is skipped, but never asks again', async () => {
    const { onDone } = await renderWizard();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-skip'));
    });

    expect(setQadaDebts).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().qadaSetupCompleted).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('QadaSetupWizard — backtracking', () => {
  async function goToEstimate(from = new Date(2026, 7, 1), to = new Date(2026, 7, 10)) {
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-choice-backtrack'));
    });
    await pickDate('from', from);
    await pickDate('to', to);
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-next'));
    });
  }

  it('shows exactly the estimate the domain computes for the range', async () => {
    await renderWizard();
    await goToEstimate();

    const expected = estimateDebt({
      startDay: '2026-08-01',
      endDay: '2026-08-10',
      deductExemptions: false,
      exemptDaysPerMonth: 7,
    });
    // Ten days inclusive: ten of each prayer, fifty in all.
    expect(expected.fajr).toBe(10);
    for (const prayer of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
      expect(screen.getByTestId(`qada-wizard-count-${prayer}`).props.value).toBe(
        String(expected[prayer])
      );
    }
    expect(screen.getByTestId('qada-wizard-total').props.children).toBe('50 prayers in all');
  });

  it('lets every number be edited before it is saved', async () => {
    const { onDone } = await renderWizard();
    await goToEstimate();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('qada-wizard-count-fajr'), '3');
    });
    // …and the steppers move the same draft the field does.
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-minus-isha'));
    });
    expect(screen.getByTestId('qada-wizard-total').props.children).toBe('42 prayers in all');

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-save'));
    });

    expect(setQadaDebts).toHaveBeenCalledWith(
      { fajr: 3, dhuhr: 10, asr: 10, maghrib: 10, isha: 9 },
      'estimate'
    );
    expect(useSettingsStore.getState().qadaSetupCompleted).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('refuses to estimate a range that runs backwards, and says so', async () => {
    await renderWizard();
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-choice-backtrack'));
    });
    await pickDate('from', new Date(2026, 7, 10));
    await pickDate('to', new Date(2026, 7, 1));

    expect(screen.getByTestId('qada-wizard-range-error')).toBeTruthy();
    expect(screen.getByTestId('qada-wizard-next').props.accessibilityState.disabled).toBe(true);
  });
});

/**
 * The range step, after a user was shown ~372 prayers *per prayer* for a stretch he meant to be
 * four days. The estimate itself was right; the range it was given was a year long, because the
 * step pre-filled a year and the picker therefore opened a year in the past.
 */
describe('QadaSetupWizard — the range it starts from', () => {
  async function openRange() {
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-choice-backtrack'));
    });
  }

  it('pre-fills no stretch of time at all, and will not move on without one', async () => {
    await renderWizard();
    await openRange();

    // Nothing is claimed about when the user started missing prayers.
    expect(screen.getByTestId('qada-wizard-from').props.accessibilityLabel).toBe(
      'From: Choose a day'
    );
    expect(screen.queryByTestId('qada-wizard-summary')).toBeNull();
    // …and an unchosen start is not an error, it is just unfinished.
    expect(screen.queryByTestId('qada-wizard-range-error')).toBeNull();
    expect(screen.getByTestId('qada-wizard-next').props.accessibilityState.disabled).toBe(true);

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-next'));
    });
    expect(screen.queryByTestId('qada-wizard-count-fajr')).toBeNull();
  });

  it('opens the start picker on the end of the range, never a year in the past', async () => {
    await renderWizard();
    await openRange();
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-from'));
    });

    // Yesterday: today's prayers belong to the Today screen, not to a backtrack.
    const picker = screen.getByTestId('qada-wizard-picker');
    expect(toDayString(picker.props.value as Date)).toBe('2026-08-18');
    expect(toDayString(picker.props.maximumDate as Date)).toBe('2026-08-18');
  });

  it('says how long the range is and what it comes to, before it is applied', async () => {
    await renderWizard();
    await openRange();
    await pickDate('from', new Date(2026, 7, 1));
    await pickDate('to', new Date(2026, 7, 10));

    expect(screen.getByTestId('qada-wizard-summary').props.children).toBe(
      '10 days — about 50 prayers'
    );

    // A four-day stretch is twenty prayers, and the step says so before the counters exist.
    await pickDate('from', new Date(2026, 7, 15));
    await pickDate('to', new Date(2026, 7, 18));
    expect(screen.getByTestId('qada-wizard-summary').props.children).toBe(
      '4 days — about 20 prayers'
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-next'));
    });
    expect(screen.getByTestId('qada-wizard-count-fajr').props.value).toBe('4');
    expect(screen.getByTestId('qada-wizard-total').props.children).toBe('20 prayers in all');
  });

  it('never charges for today, however the picker answers', async () => {
    await renderWizard();
    await openRange();
    await pickDate('from', new Date(2026, 7, 18));
    // A picker that hands back today (or later) is clamped to yesterday rather than believed.
    await pickDate('to', new Date(2026, 7, 19));

    expect(screen.getByTestId('qada-wizard-to').props.accessibilityLabel).toBe(
      'Until: August 18, 2026'
    );
    expect(screen.getByTestId('qada-wizard-summary').props.children).toBe(
      '1 day — about 5 prayers'
    );
  });
});

describe('QadaSetupWizard — numbers it will not produce', () => {
  async function goToEstimate(from = new Date(2026, 7, 1), to = new Date(2026, 7, 10)) {
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-choice-backtrack'));
    });
    await pickDate('from', from);
    await pickDate('to', to);
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-next'));
    });
  }

  it('will not step a counter below zero, however often the minus is pressed', async () => {
    await renderWizard();
    await goToEstimate(new Date(2026, 7, 10), new Date(2026, 7, 11));

    expect(screen.getByTestId('qada-wizard-count-fajr').props.value).toBe('2');
    for (let press = 0; press < 6; press += 1) {
      await act(async () => {
        fireEvent.press(screen.getByTestId('qada-wizard-minus-fajr'));
      });
    }
    expect(screen.getByTestId('qada-wizard-count-fajr').props.value).toBe('0');

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-save'));
    });
    expect(setQadaDebts).toHaveBeenCalledWith(
      { fajr: 0, dhuhr: 2, asr: 2, maghrib: 2, isha: 2 },
      'estimate'
    );
  });

  it('refuses a minus sign, a decimal point and any other typed nonsense', async () => {
    await renderWizard();
    await goToEstimate();

    for (const typed of ['-5', '3.5', '−4', 'abc', '1e6']) {
      await act(async () => {
        fireEvent.changeText(screen.getByTestId('qada-wizard-count-fajr'), typed);
      });
      expect(Number(screen.getByTestId('qada-wizard-count-fajr').props.value || '0')).toBeGreaterThanOrEqual(0);
    }

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('qada-wizard-count-fajr'), '');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-save'));
    });

    // An empty field is nothing owed, never a NaN and never a negative.
    const [saved] = setQadaDebts.mock.calls.at(-1) as [Record<string, number>];
    for (const value of Object.values(saved)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(saved.fajr).toBe(0);
  });

  it('stays positive under the largest exemption figure the settings allow', async () => {
    useSettingsStore.getState().setExemptionModeEnabled(true);
    // More than the settings permit: they clamp it, so the wizard cannot be handed a figure that
    // would eat a whole range — and the domain clamps at zero even if it were.
    useSettingsStore.getState().setExemptDaysPerMonth(99);
    expect(useSettingsStore.getState().exemptDaysPerMonth).toBe(MAX_EXEMPT_DAYS_PER_MONTH);

    await renderWizard();
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-choice-backtrack'));
    });
    // A one-day range: the shortest thing that can be deducted from at all.
    await pickDate('from', new Date(2026, 7, 19));
    await pickDate('to', new Date(2026, 7, 19));
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-deduct'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-next'));
    });

    for (const prayer of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
      const value = Number(screen.getByTestId(`qada-wizard-count-${prayer}`).props.value);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('QadaSetupWizard — the exemption deduction', () => {
  it('is not offered at all while exemption mode is off', async () => {
    await renderWizard();
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-choice-backtrack'));
    });

    expect(screen.queryByTestId('qada-wizard-deduct')).toBeNull();
  });

  it('is offered when exemption mode is on, and takes the days off the estimate', async () => {
    useSettingsStore.getState().setExemptionModeEnabled(true);
    useSettingsStore.getState().setExemptDaysPerMonth(7);
    await renderWizard();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-choice-backtrack'));
    });
    await pickDate('from', new Date(2026, 7, 1));
    await pickDate('to', new Date(2026, 7, 10));

    const toggle = screen.getByTestId('qada-wizard-deduct');
    expect(toggle.props.accessibilityState.checked).toBe(false);
    await act(async () => {
      fireEvent.press(toggle);
    });
    expect(screen.getByTestId('qada-wizard-deduct').props.accessibilityState.checked).toBe(true);

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-next'));
    });

    // Ten days is a third of a month, so two exempt days come off EVERY counter — the domain's
    // arithmetic, not the wizard's.
    const expected = estimateDebt({
      startDay: '2026-08-01',
      endDay: '2026-08-10',
      deductExemptions: true,
      exemptDaysPerMonth: 7,
    });
    expect(expected.fajr).toBe(8);
    expect(screen.getByTestId('qada-wizard-count-fajr').props.value).toBe('8');
    expect(screen.getByTestId('qada-wizard-total').props.children).toBe('40 prayers in all');
  });

  it('asks the days-each-month figure in context — only once the deduction is chosen — and remembers it', async () => {
    useSettingsStore.getState().setExemptionModeEnabled(true);
    await renderWizard();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-choice-backtrack'));
    });
    await pickDate('from', new Date(2026, 7, 1));
    await pickDate('to', new Date(2026, 7, 10));

    // No stepper until the deduction is actually wanted: the question explains itself or is absent.
    expect(screen.queryByTestId('qada-wizard-days-per-month')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-deduct'));
    });
    expect(screen.getByTestId('qada-wizard-days-per-month')).toBeTruthy();

    // Nudge 7 → 9; the estimate must be the domain's answer for 9, not for the stored 7.
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-days-per-month-increase'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-days-per-month-increase'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-next'));
    });

    const expected = estimateDebt({
      startDay: '2026-08-01',
      endDay: '2026-08-10',
      deductExemptions: true,
      exemptDaysPerMonth: 9,
    });
    expect(screen.getByTestId('qada-wizard-count-fajr').props.value).toBe(String(expected.fajr));
    // The figure that fed the estimate is remembered for the next run.
    expect(useSettingsStore.getState().exemptDaysPerMonth).toBe(9);
  });

  it('prefills the figure from her own recorded days when the range holds enough history', async () => {
    useSettingsStore.getState().setExemptionModeEnabled(true);
    // Stored setting says 7, but the records say ~5 a month: five days in each of six months.
    mockState.periods = [1, 2, 3, 4, 5, 6].map((month) => ({
      id: month,
      startDay: `2026-0${month}-10`,
      endDay: `2026-0${month}-14`,
      createdAt: 0,
    }));
    await renderWizard();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-choice-backtrack'));
    });
    await pickDate('from', new Date(2026, 0, 1));
    await pickDate('to', new Date(2026, 5, 30));
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-deduct'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-next'));
    });

    // 30 exempt days over 181 → 5.04/month → 5. Her records beat the stored default of 7.
    const fromRecords = estimateDebt({
      startDay: '2026-01-01',
      endDay: '2026-06-30',
      deductExemptions: true,
      exemptDaysPerMonth: 5,
    });
    const fromSetting = estimateDebt({
      startDay: '2026-01-01',
      endDay: '2026-06-30',
      deductExemptions: true,
      exemptDaysPerMonth: 7,
    });
    expect(fromRecords.fajr).not.toBe(fromSetting.fajr);
    expect(screen.getByTestId('qada-wizard-count-fajr').props.value).toBe(
      String(fromRecords.fajr)
    );
  });
});
