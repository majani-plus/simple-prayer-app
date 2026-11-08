/**
 * The Settings → Data rows.
 *
 * The file itself is `services/export`'s problem and is tested there against a real database. What
 * is tested here is the *interaction*, and every case is a way the feature could look broken while
 * the export works perfectly:
 *
 * 1. **The screen stays alive and says so.** The running row shows a real percentage taken from
 *    the service's own progress stream — not an unmeasured spinner — and the other row goes inert,
 *    because two share sheets racing over one cache file is not a state worth supporting.
 * 2. **Every ending is spoken.** Shared, cancelled, no-share-sheet-on-this-device and failed each
 *    get their own sentence, on the row that ran and not on the other one. A dismissed share sheet
 *    is an ordinary choice and the copy treats it as one.
 * 3. **Nothing is colour-only.** Progress and outcome are words; the running row also carries
 *    `accessibilityState.busy` and the idle one `disabled`.
 *
 * The runner is injected through `useDataExport(run)` rather than mocked at the module level: the
 * seam exists for exactly this, it keeps each test's double local (a shared `jest.fn` reset
 * between tests is how one failing case takes the next four with it), and nothing here can reach
 * `expo-file-system` or SQLite.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { ExportRow, useDataExport, type RunExport } from '../DataExportRows';
import { initI18n } from '@/i18n';

import type { ExportOutcome, ExportProgress } from '@/services/export';

/** A finished export, as the service reports one. */
const SHARED: ExportOutcome = {
  status: 'shared',
  format: 'csv',
  fileName: 'simple-prayer-times-2026-08-19.csv',
  uri: 'file:///cache/simple-prayer-times-2026-08-19.csv',
  bytes: 2048,
  counts: { logs: 12, exemptPeriods: 1, qadaDebts: 5, qadaEvents: 3 },
};

/** Both rows over one controller, exactly as the Settings index composes them. */
function DataRows({ run }: { run: RunExport }) {
  const controller = useDataExport(run);
  return (
    <View>
      <ExportRow testID="row-csv" format="csv" controller={controller} />
      <ExportRow testID="row-json" format="json" controller={controller} />
    </View>
  );
}

/** A runner the test finishes by hand, plus the progress hook it was handed. */
function deferredRun() {
  let settle: (outcome: ExportOutcome) => void = () => {};
  let report: (progress: ExportProgress) => void = () => {};

  const calls = jest.fn((options: Parameters<RunExport>[0]) => {
    report = options.onProgress ?? (() => {});
    return new Promise<ExportOutcome>((resolve) => {
      settle = resolve;
    });
  });

  return {
    run: calls as unknown as RunExport,
    calls,
    progress: async (fraction: number) => {
      await act(async () => {
        report({ phase: 'reading', fraction });
      });
    },
    finish: async (outcome: ExportOutcome) => {
      await act(async () => {
        settle(outcome);
      });
    },
  };
}

/** A runner that resolves immediately. */
function immediateRun(outcome: ExportOutcome) {
  const calls = jest.fn(async (_options: Parameters<RunExport>[0]) => outcome);
  return { run: calls as unknown as RunExport, calls };
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  await initI18n().changeLanguage('en');
});

describe('the export rows', () => {
  it('offers both formats, each explained', async () => {
    await render(<DataRows run={immediateRun(SHARED).run} />);

    expect(screen.getByText('Export as a spreadsheet')).toBeTruthy();
    expect(screen.getByText('A CSV file any spreadsheet can open.')).toBeTruthy();
    expect(screen.getByText('Export as JSON')).toBeTruthy();
    expect(screen.getByText('The same record, exactly as it is stored.')).toBeTruthy();
  });

  it('asks the service for the format that was tapped, with a localized sheet title', async () => {
    const { run, calls } = immediateRun(SHARED);
    await render(<DataRows run={run} />);

    await press('row-json');

    expect(calls).toHaveBeenCalledTimes(1);
    const options = calls.mock.calls[0][0];
    expect(options).toMatchObject({ format: 'json', dialogTitle: 'Your prayer log' });
    // The file's header is stamped with a real instant and a version string, not placeholders.
    expect(options.now).toBeInstanceOf(Date);
    expect(typeof options.appVersion).toBe('string');
  });

  it('shows the service’s own progress rather than an unmeasured spinner', async () => {
    const deferred = deferredRun();
    await render(<DataRows run={deferred.run} />);

    await press('row-csv');
    await deferred.progress(0.45);

    expect(screen.getByText('Preparing… 45%')).toBeTruthy();
    expect(screen.getByTestId('row-csv').props.accessibilityState.busy).toBe(true);

    await deferred.finish(SHARED);
  });

  it('locks the other format while one export is running, and frees it afterwards', async () => {
    const deferred = deferredRun();
    await render(<DataRows run={deferred.run} />);

    await press('row-csv');
    await deferred.progress(0.2);

    expect(screen.getByTestId('row-json').props.accessibilityState.disabled).toBe(true);
    await press('row-json');
    expect(deferred.calls).toHaveBeenCalledTimes(1);

    await deferred.finish(SHARED);
    expect(screen.getByTestId('row-json').props.accessibilityState.disabled).toBe(false);
  });

  it('ignores a second tap on the row already running', async () => {
    const deferred = deferredRun();
    await render(<DataRows run={deferred.run} />);

    await press('row-csv');
    await press('row-csv');

    expect(deferred.calls).toHaveBeenCalledTimes(1);
    await deferred.finish(SHARED);
  });
});

describe('what the row says afterwards', () => {
  it('reports a shared export in words, on the row that ran', async () => {
    await render(<DataRows run={immediateRun(SHARED).run} />);

    await press('row-csv');

    expect(screen.getByText('Sent.')).toBeTruthy();
    // …and only on that row: the other one still offers itself.
    expect(screen.getByText('The same record, exactly as it is stored.')).toBeTruthy();
  });

  it('reports a cancelled share sheet without calling it an error', async () => {
    await render(<DataRows run={immediateRun({ ...SHARED, status: 'cancelled' }).run} />);

    await press('row-csv');

    expect(screen.getByText('Nothing was sent.')).toBeTruthy();
    expect(screen.queryByText('That did not finish. Please try again.')).toBeNull();
  });

  it('explains a device that cannot share at all', async () => {
    await render(<DataRows run={immediateRun({ ...SHARED, status: 'unavailable' }).run} />);

    await press('row-csv');

    expect(
      screen.getByText('This device has no share sheet, so the file was left on it.')
    ).toBeTruthy();
  });

  it('reports a failure in one sentence, and frees the rows again', async () => {
    const { run } = immediateRun({
      status: 'failed',
      format: 'csv',
      error: new Error('disk full'),
    });
    await render(<DataRows run={run} />);

    await press('row-csv');

    expect(screen.getByText('That did not finish. Please try again.')).toBeTruthy();
    // The error text itself never reaches the user — it would be untranslated and unactionable.
    expect(screen.queryByText(/disk full/)).toBeNull();
    expect(screen.getByTestId('row-csv').props.accessibilityState.busy).toBe(false);
    expect(screen.getByTestId('row-json').props.accessibilityState.disabled).toBe(false);
  });

  it('survives a rejection from the service, which should never happen', async () => {
    // `runExport` resolves rather than rejecting, so a rejection can only be a wiring bug — and a
    // wiring bug must not leave the row stuck saying "Preparing…" forever.
    const run = jest.fn(async () => {
      throw new Error('programming error');
    });
    await render(<DataRows run={run as unknown as RunExport} />);

    await press('row-csv');

    expect(screen.getByText('That did not finish. Please try again.')).toBeTruthy();
    expect(screen.getByTestId('row-csv').props.accessibilityState.busy).toBe(false);
  });

  it('clears the last sentence when a new export starts', async () => {
    // One runner whose behaviour is swapped between the two presses, so the component never
    // re-renders for a reason other than the state change under test.
    let settle: ((outcome: ExportOutcome) => void) | null = null;
    const run = jest.fn(async (_options: Parameters<RunExport>[0]) => {
      if (settle === null) return { ...SHARED, status: 'cancelled' as const };
      return new Promise<ExportOutcome>((resolve) => {
        settle = resolve;
      });
    });
    await render(<DataRows run={run as unknown as RunExport} />);

    await press('row-csv');
    expect(screen.getByText('Nothing was sent.')).toBeTruthy();

    settle = () => {};
    await press('row-csv');

    // The stale sentence is gone the moment the next export starts, replaced by its progress.
    expect(screen.queryByText('Nothing was sent.')).toBeNull();
    expect(screen.getByTestId('row-csv').props.accessibilityState.busy).toBe(true);
  });

  it('does not touch state after the screen is gone', async () => {
    const deferred = deferredRun();
    const view = await render(<DataRows run={deferred.run} />);

    await press('row-csv');
    view.unmount();

    // Resolving after unmount must be silent: no state update, no warning, no crash.
    await deferred.finish(SHARED);
  });

  /*
   * There is deliberately no "renders in Turkish" case here. Localization of these rows is
   * guarded where it is guarded for every other screen: `src/i18n/__tests__/locales.test.ts`
   * scans the literal `t('…')` calls out of this component and fails if any of the six keys is
   * missing from en/ar/tr, and `src/__tests__/settingsScreen.test.tsx` proves the Settings tab
   * repaints when the language preference changes. A duplicate assertion here would only be
   * testing react-i18next.
   */
});
