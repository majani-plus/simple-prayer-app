import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingRow } from './SettingRow';
import { formatNumber } from '@/i18n/numerals';
import { appVersion } from '@/services/appInfo';
import {
  createDatabaseExportSource,
  createExpoExportAdapter,
  runExport,
  type ExportFormat,
  type ExportOutcome,
} from '@/services/export';

/**
 * Settings → Data: the two rows that hand the user their own record back.
 *
 * PRODUCT_SPEC §12 asks for "export CSV/JSON (share sheet)", and our market research explains
 * why it is worth a section of its own: nobody else in the category offers it, and the category's
 * trust problem is precisely that people's data has gone places they did not choose. Two rows, no
 * dialog, no options screen — pick a format and the share sheet opens.
 *
 * Three behaviours matter more than the layout:
 *
 * 1. **The UI stays alive.** `runExport` reads the log a page of days at a time and yields between
 *    pages; this hook turns its progress into a percentage in the row's own subtitle, so a user
 *    with years of history sees "Preparing… 40%" rather than a frozen screen. The percentage is
 *    only committed to state when it has moved by at least {@link PROGRESS_STEP}, so a long export
 *    costs a handful of renders rather than one per page.
 * 2. **Every ending is spoken.** Shared, cancelled, no-share-sheet-on-this-device and failed each
 *    have their own sentence, shown in place of the row's description. A dismissed share sheet is
 *    an ordinary choice and says so quietly — it is not an error.
 * 3. **State is never colour-only.** Progress and outcome are words in the row, not a tint, and
 *    the running row carries `accessibilityState.busy` so a screen reader says so too.
 *
 * The rows are exported separately from the hook that drives them so the Settings index can place
 * them in its `Data` group while a single controller keeps them in step: while one format is
 * exporting the other row is disabled, because two share sheets racing over one cache file is not
 * a state worth supporting.
 */

/** Minimum change in the 0…1 fraction before a re-render is worth it. */
const PROGRESS_STEP = 0.02;

/** The one function this hook needs from the service, named so a test can replace it. */
export type RunExport = typeof runExport;

/** What {@link useDataExport} hands to the rows. */
export interface DataExportController {
  /** The format currently exporting, or `null` when idle. */
  running: ExportFormat | null;
  /** Progress of the running export, 0…1. */
  fraction: number;
  /** The last outcome's sentence, already localized, or `null` when nothing has run yet. */
  message: string | null;
  /** The format that produced {@link message}, so only the row that ran shows it. */
  messageFor: ExportFormat | null;
  /** Starts an export. Ignored while one is already running. */
  start: (format: ExportFormat) => void;
}

/**
 * Runs exports and keeps the rows in step.
 *
 * The source and the adapter are built per run rather than held in a ref: an export is a rare,
 * explicit action, and a freshly-built adapter cannot outlive the screen that asked for it.
 * Neither constructor touches anything native or opens the database until the export actually
 * reads or writes, which is what keeps this hook mountable in a plain test render.
 *
 * @param run - The export runner. Only tests pass one; the app uses the real service.
 * @returns A {@link DataExportController} for {@link ExportRow}.
 */
export function useDataExport(run: RunExport = runExport): DataExportController {
  const { t } = useTranslation();
  const [running, setRunning] = useState<ExportFormat | null>(null);
  const [fraction, setFraction] = useState(0);
  // The sentence and the row it belongs to move together, so "Sent." can never appear over the
  // format the user did not choose.
  const [result, setResult] = useState<{ text: string; format: ExportFormat } | null>(null);

  // An export outlives a fast tab switch; setting state on an unmounted screen is a leak and a
  // warning, so every update goes through this guard.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const sentenceFor = useCallback(
    (outcome: ExportOutcome): string => {
      switch (outcome.status) {
        case 'shared':
          return t('settings.home.data.result.shared');
        case 'cancelled':
          return t('settings.home.data.result.cancelled');
        case 'unavailable':
          return t('settings.home.data.result.saved');
        default:
          return t('settings.home.data.result.failed');
      }
    },
    [t]
  );

  const start = useCallback(
    (format: ExportFormat) => {
      if (running !== null) return;
      setRunning(format);
      setFraction(0);
      setResult(null);

      let lastReported = 0;
      void run({
        format,
        source: createDatabaseExportSource(),
        adapter: createExpoExportAdapter(),
        appVersion: appVersion(),
        now: new Date(),
        dialogTitle: t('settings.home.data.shareTitle'),
        onProgress: (progress) => {
          if (!mounted.current) return;
          if (progress.fraction < lastReported + PROGRESS_STEP && progress.fraction < 1) return;
          lastReported = progress.fraction;
          setFraction(progress.fraction);
        },
      })
        .then((outcome) => {
          if (!mounted.current) return;
          setResult({ text: sentenceFor(outcome), format });
        })
        .catch(() => {
          // `runExport` resolves rather than rejecting, so this can only be a programming error
          // in the wiring above. The user still gets a sentence instead of a stuck row.
          if (!mounted.current) return;
          setResult({ text: t('settings.home.data.result.failed'), format });
        })
        .finally(() => {
          if (!mounted.current) return;
          setRunning(null);
          setFraction(0);
        });
    },
    [running, run, sentenceFor, t]
  );

  return {
    running,
    fraction,
    message: result?.text ?? null,
    messageFor: result?.format ?? null,
    start,
  };
}

export interface ExportRowProps {
  format: ExportFormat;
  controller: DataExportController;
  testID?: string;
}

/**
 * One export row.
 *
 * @param format - Which file this row produces.
 * @param controller - The shared {@link DataExportController}.
 * @returns A settings row that exports and shares, showing its own progress and outcome.
 */
export function ExportRow({ format, controller, testID }: ExportRowProps) {
  const { t, i18n } = useTranslation();
  const { running, fraction, message, messageFor, start } = controller;

  const isRunning = running === format;
  const busyElsewhere = running !== null && !isRunning;

  // Spelled out rather than built from `format` so the locale guard's scanner can see both keys.
  const label =
    format === 'csv' ? t('settings.home.data.csv.label') : t('settings.home.data.json.label');
  const idle =
    format === 'csv'
      ? t('settings.home.data.csv.description')
      : t('settings.home.data.json.description');

  const percent = formatNumber(fraction, i18n.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  });

  const description = isRunning
    ? t('settings.home.data.working', { percent })
    : messageFor === format && message !== null
      ? message
      : idle;

  return (
    <SettingRow
      testID={testID}
      icon="file_download"
      label={label}
      description={description}
      chevron={false}
      disabled={busyElsewhere}
      accessibilityRole="button"
      accessibilityHint={t('settings.home.data.a11yHint')}
      accessibilityState={{ busy: isRunning, disabled: busyElsewhere }}
      onPress={() => start(format)}
    />
  );
}
