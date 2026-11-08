/**
 * Screen test for Settings → Exemption (`src/app/settings/exemption.tsx`) — the register behind
 * exemption mode (spec-exemption §2b/§2c): current status, the qada-estimate stepper, and the
 * list of recorded periods with add, edit and delete.
 *
 * The tracking store is mocked (the real one opens SQLite); the settings store, i18n and every
 * component are real. What is verified is the screen's composition: which store action each
 * gesture reaches, with which days — the refund arithmetic those actions perform is proven in
 * `stores/trackingStore.test.ts`.
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { act, configure, fireEvent, render, screen, within } from '@testing-library/react-native';

import ExemptionSettingsScreen from '../app/settings/exemption';
import { addDays } from '../domain/dates';
import { initI18n } from '../i18n';
import { useSettingsStore } from '../stores/settingsStore';

import type { ExemptPeriod } from '../domain/types';

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

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: mockBack,
    canGoBack: () => true,
    replace: jest.fn(),
  }),
}));

const TODAY = '2026-08-19';

const mockPeriods: { current: ExemptPeriod[] } = { current: [] };
const mockActions = {
  startExemptPeriod: jest.fn(() => mockPeriods.current),
  endExemptPeriod: jest.fn(() => mockPeriods.current),
  addExemptPeriod: jest.fn(() => true),
  updateExemptPeriod: jest.fn(() => true),
  deleteExemptPeriod: jest.fn(() => true),
};

jest.mock('../stores/trackingStore', () => ({
  useExemptPeriods: () => mockPeriods.current,
  useTrackingActions: () => mockActions,
  useTrackingStore: (selector: (state: { todayDay: () => string }) => unknown) =>
    selector({ todayDay: () => TODAY }),
}));

configure({ defaultIncludeHiddenElements: true });

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockPeriods.current = [];
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.getState().setExemptionModeEnabled(true);
  await initI18n().changeLanguage('en');
});

/** One closed record from earlier in the month. */
const CLOSED: ExemptPeriod = { id: 7, startDay: '2026-08-03', endDay: '2026-08-07', createdAt: 0 };

describe('the exemption register', () => {
  it('offers Begin while nothing is open, reaching startExemptPeriod with today', async () => {
    await render(<ExemptionSettingsScreen />);

    expect(screen.getByText('Not currently excused')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-row-status'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-today'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-until'));
    });

    expect(mockActions.startExemptPeriod).toHaveBeenCalledWith(TODAY);
  });

  it('turns the mode on when a period is begun here — a period always implies the switch', async () => {
    // This screen is reachable with the mode OFF: Today's ⋯ offers "Excused days" to everyone
    // (the owner's report was that the feature was unfindable) and its quiet second action opens
    // this register. Recording a period while the flag is off writes a range that nothing in the
    // app can see — `isExemptDay` answers `false` while the mode is off, so the rows stay due,
    // the reminders keep firing, the banner never appears and the qada refund never runs — while
    // THIS screen says "Excused since 19 August". Today's own begin handler already turns the
    // mode on as a side effect of *using* the feature; the same gesture must mean the same thing
    // here.
    useSettingsStore.getState().setExemptionModeEnabled(false);
    await render(<ExemptionSettingsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-row-status'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-today'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-until'));
    });

    expect(mockActions.startExemptPeriod).toHaveBeenCalledWith(TODAY);
    expect(useSettingsStore.getState().exemptionModeEnabled).toBe(true);
  });

  it('turns the mode on when a past record is added here, for the same reason', async () => {
    useSettingsStore.getState().setExemptionModeEnabled(false);
    await render(<ExemptionSettingsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-period-add'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-start'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-day-2026-08-10'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-end'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-day-2026-08-14'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-save'));
    });

    expect(mockActions.addExemptPeriod).toHaveBeenCalledWith('2026-08-10', '2026-08-14');
    expect(useSettingsStore.getState().exemptionModeEnabled).toBe(true);
  }, 20_000);

  it('does NOT turn the mode on when a period is merely ended or removed', async () => {
    // Only coverage *created* implies the switch. Ending or deleting reduces coverage, and
    // flipping the feature on for someone who is putting it away would be the switch implying a
    // period — the direction spec-exemption §2a forbids.
    useSettingsStore.getState().setExemptionModeEnabled(false);
    mockPeriods.current = [{ id: 1, startDay: '2026-08-16', endDay: null, createdAt: 0 }];
    await render(<ExemptionSettingsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-row-status'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-end-yesterday'));
    });

    expect(mockActions.endExemptPeriod).toHaveBeenCalledWith(addDays(TODAY, -1));
    expect(useSettingsStore.getState().exemptionModeEnabled).toBe(false);
  });

  it('offers End on the open period, reaching endExemptPeriod', async () => {
    mockPeriods.current = [{ id: 1, startDay: '2026-08-16', endDay: null, createdAt: 0 }];
    await render(<ExemptionSettingsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-row-status'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-end-yesterday'));
    });

    expect(mockActions.endExemptPeriod).toHaveBeenCalledWith(addDays(TODAY, -1));
  });

  describe('a period begun with an end date', () => {
    /** Begun yesterday, planned to run three more days: ongoing, not history. */
    const PLANNED = { id: 3, startDay: addDays(TODAY, -1), endDay: addDays(TODAY, 3), createdAt: 0 };

    it('reads as "until", and offers End rather than Begin', async () => {
      mockPeriods.current = [PLANNED];
      await render(<ExemptionSettingsScreen />);

      // Both the status row and the ongoing record row say it, exactly as they did for an
      // open-ended period.
      expect(screen.getAllByText(/Excused until/)).toHaveLength(2);
      // Ending a plan early is the same offer as ending an open period.
      await act(async () => {
        fireEvent.press(screen.getByTestId('exemption-row-status'));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId('exemption-end-yesterday'));
      });
      expect(mockActions.endExemptPeriod).toHaveBeenCalledWith(addDays(TODAY, -1));
    });

    it('is not filed under past records — it has not happened yet', async () => {
      mockPeriods.current = [PLANNED];
      await render(<ExemptionSettingsScreen />);

      // It appears once, as the ongoing row that can be ended; never as an editable record of
      // something that already happened.
      expect(screen.getByTestId('exemption-period-open')).toBeTruthy();
      expect(screen.queryByTestId('exemption-period-3')).toBeNull();
    });

    it('becomes a past record once its last day is behind us', async () => {
      mockPeriods.current = [{ id: 4, startDay: addDays(TODAY, -5), endDay: addDays(TODAY, -1), createdAt: 0 }];
      await render(<ExemptionSettingsScreen />);

      expect(screen.getByText('Not currently excused')).toBeTruthy();
      expect(screen.getByTestId('exemption-period-4')).toBeTruthy();
      expect(screen.queryByTestId('exemption-period-open')).toBeNull();
    });
  });

  // The days-per-month estimator input lives in the qada setup wizard now (asked in context, at
  // the moment it changes the estimate) — its stepper is covered by QadaSetupWizard.test.tsx.
  it('no longer carries the days-per-month stepper — that question belongs to the qada wizard', async () => {
    await render(<ExemptionSettingsScreen />);
    expect(screen.queryByTestId('exemption-row-days-per-month')).toBeNull();
  });

  it('lists a closed record by its dates and saves an edit through updateExemptPeriod', async () => {
    mockPeriods.current = [CLOSED];
    await render(<ExemptionSettingsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-period-7'));
    });

    // The editor opens seeded with the record; correcting only the end day keeps the start.
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-end'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-day-2026-08-08'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-save'));
    });

    expect(mockActions.updateExemptPeriod).toHaveBeenCalledWith(7, '2026-08-03', '2026-08-08');
    // Driving the native date picker is many sequential press-and-render cycles, and slower
    // again when Jest runs the whole suite in parallel workers — it passes in 2s alone and
    // timed out at the 5s default only under full-suite load. Assertions unchanged; only the
    // clock they are measured against is honest about the work (same remedy as historyScreen).
  }, 20_000);

  it('removes a record from inside its editor — the sheet is the confirmation', async () => {
    mockPeriods.current = [CLOSED];
    await render(<ExemptionSettingsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-period-7'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-remove'));
    });

    expect(mockActions.deleteExemptPeriod).toHaveBeenCalledWith(7);
    // Driving the native date picker is many sequential press-and-render cycles, and slower
    // again when Jest runs the whole suite in parallel workers — it passes in 2s alone and
    // timed out at the 5s default only under full-suite load. Assertions unchanged; only the
    // clock they are measured against is honest about the work (same remedy as historyScreen).
  }, 20_000);

  it('adds a period that already happened, first day and last day picked — never the future', async () => {
    await render(<ExemptionSettingsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-period-add'));
    });
    // No remove on a record that does not exist yet, and no save until both days are chosen.
    expect(screen.queryByTestId('exemption-editor-remove')).toBeNull();
    expect(screen.queryByTestId('exemption-editor-save')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-start'));
    });
    // Nothing after today is offerable: a period that has not begun cannot excuse anything.
    expect(screen.queryByTestId(`exemption-editor-day-${addDays(TODAY, 1)}`)).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-day-2026-07-10'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-end'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-day-2026-07-14'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-save'));
    });

    expect(mockActions.addExemptPeriod).toHaveBeenCalledWith('2026-07-10', '2026-07-14');
    // Driving the native date picker is many sequential press-and-render cycles, and slower
    // again when Jest runs the whole suite in parallel workers — it passes in 2s alone and
    // timed out at the 5s default only under full-suite load. Assertions unchanged; only the
    // clock they are measured against is honest about the work (same remedy as historyScreen).
  }, 20_000);

  it('explains an inverted range in words and withholds Save', async () => {
    await render(<ExemptionSettingsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-period-add'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-start'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-day-2026-07-14'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-end'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-editor-day-2026-07-10'));
    });

    expect(screen.getByText('The last day can’t come before the first.')).toBeTruthy();
    expect(screen.queryByTestId('exemption-editor-save')).toBeNull();
    expect(mockActions.addExemptPeriod).not.toHaveBeenCalled();
    // Driving the native date picker is many sequential press-and-render cycles, and slower
    // again when Jest runs the whole suite in parallel workers — it passes in 2s alone and
    // timed out at the 5s default only under full-suite load. Assertions unchanged; only the
    // clock they are measured against is honest about the work (same remedy as historyScreen).
  }, 20_000);

  it('goes back with the labelled back control', async () => {
    await render(<ExemptionSettingsScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-back'));
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('the switch (spec-exemption §2a, §4a) — moved here from the Settings index (D178)', () => {
  it('flipping the switch on immediately offers to begin — and "Not now" is a real answer', async () => {
    useSettingsStore.getState().setExemptionModeEnabled(false);
    await render(<ExemptionSettingsScreen />);
    const row = screen.getByTestId('exemption-row-mode');
    expect(within(row).getByText('Off')).toBeTruthy();

    await fireEvent.press(row);

    // The mode is on AND the begin sheet is up: the old dead-end (a switch that did nothing)
    // is gone, but enabling the feature still never implies a period.
    expect(useSettingsStore.getState().exemptionModeEnabled).toBe(true);
    expect(await within(row).findByText('On')).toBeTruthy();
    expect(screen.getByTestId('exemption-begin-sheet')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('exemption-begin-not-now'));
    expect(mockActions.startExemptPeriod).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().exemptionModeEnabled).toBe(true);
  });

  it('names what the feature is for under the switch, and nowhere else on the screen', async () => {
    await render(<ExemptionSettingsScreen />);

    // D62: the anatomical words appear in exactly one place — this body.
    expect(screen.getAllByText(/menstruation/)).toHaveLength(1);
    expect(
      within(screen.getByTestId('exemption-row-mode')).getByText(/menstruation/)
    ).toBeTruthy();
  });

  it('flipping off over an open period asks one question, then ends it as of yesterday', async () => {
    mockPeriods.current = [{ id: 1, startDay: '2026-08-01', endDay: null, createdAt: 0 }];
    await render(<ExemptionSettingsScreen />);

    await fireEvent.press(screen.getByTestId('exemption-row-mode'));

    // Not yet: the running exemption must never be silently stranded behind a disabled mode.
    expect(useSettingsStore.getState().exemptionModeEnabled).toBe(true);
    expect(screen.getByTestId('exemption-mode-off-sheet')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('exemption-mode-off-confirm'));

    expect(mockActions.endExemptPeriod).toHaveBeenCalledWith(addDays(TODAY, -1));
    expect(useSettingsStore.getState().exemptionModeEnabled).toBe(false);
  });

  it('flipping off over a period that has an end date asks the same one question', async () => {
    // Begun yesterday, planned to run three more days: running, so it must not be stranded
    // behind a disabled mode any more than an open-ended one.
    mockPeriods.current = [
      { id: 1, startDay: addDays(TODAY, -1), endDay: addDays(TODAY, 3), createdAt: 0 },
    ];
    await render(<ExemptionSettingsScreen />);

    await fireEvent.press(screen.getByTestId('exemption-row-mode'));

    expect(useSettingsStore.getState().exemptionModeEnabled).toBe(true);
    expect(screen.getByTestId('exemption-mode-off-sheet')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('exemption-mode-off-confirm'));

    expect(mockActions.endExemptPeriod).toHaveBeenCalledWith(addDays(TODAY, -1));
    expect(useSettingsStore.getState().exemptionModeEnabled).toBe(false);
  });

  it('cancelling the off-flip keeps the mode and the period untouched', async () => {
    mockPeriods.current = [{ id: 1, startDay: '2026-08-01', endDay: null, createdAt: 0 }];
    await render(<ExemptionSettingsScreen />);

    await fireEvent.press(screen.getByTestId('exemption-row-mode'));
    await fireEvent.press(screen.getByTestId('exemption-mode-off-cancel'));

    expect(mockActions.endExemptPeriod).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().exemptionModeEnabled).toBe(true);
  });

  it('turning off with nothing open needs no sheet at all', async () => {
    await render(<ExemptionSettingsScreen />);

    await fireEvent.press(screen.getByTestId('exemption-row-mode'));

    expect(useSettingsStore.getState().exemptionModeEnabled).toBe(false);
    expect(screen.queryByTestId('exemption-mode-off-sheet')).toBeNull();
  });

  it('flipping on over a period that has run out offers to begin again', async () => {
    useSettingsStore.getState().setExemptionModeEnabled(false);
    // A lapsed record is history, not a running exemption: re-enabling has nothing to resume.
    mockPeriods.current = [
      { id: 1, startDay: addDays(TODAY, -6), endDay: addDays(TODAY, -2), createdAt: 0 },
    ];
    await render(<ExemptionSettingsScreen />);

    await fireEvent.press(screen.getByTestId('exemption-row-mode'));

    expect(screen.getByTestId('exemption-begin-sheet')).toBeTruthy();
  });
});
