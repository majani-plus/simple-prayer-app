/**
 * Export service — "your data is yours", made literal.
 *
 * Every competitor in the category keeps your prayer history hostage: there is no export, and the
 * only way out is to stop using the app and lose the record (our market research; decision
 * D25). This module is the answer to that, and it is deliberately boring: it reads everything the
 * app has ever stored, writes it to a plain file, and hands the file to the system share sheet.
 * No account, no upload, no server — the bytes go where the user points them and nowhere else.
 *
 * ## What it produces
 *
 * Two formats over the *same* read, so neither is a lossy afterthought:
 *
 * - **CSV** — one rectangular table anyone can open in Excel, Numbers or pandas, preceded by a few
 *   `#` comment lines carrying the app version, the export instant and the schema version. Prayer
 *   logs, exempt periods, qada counters and qada events are four different shapes, so the table
 *   carries a `record` discriminator in its first column and a superset of columns; a cell that
 *   does not apply to a record type is empty. {@link CSV_COLUMNS} documents every column.
 * - **JSON** — the same data with its natural nesting, for another program to read back.
 *
 * The two formats differ on purpose in exactly one respect: **CSV renders timestamps as UTC
 * ISO-8601 strings** (a spreadsheet cannot do anything with epoch milliseconds) while **JSON keeps
 * the exact integers the database holds**, so a JSON export can be compared to — or one day read
 * back into — the database without a lossy round trip. Days are the stored local prayer days
 * (`YYYY-MM-DD`, Fajr→next Fajr) in both. Booleans are `true`/`false`, never localized: these
 * files are data, not UI, and a CSV whose meaning changes with the phone's language is a CSV
 * nobody can share with anyone.
 *
 * ## Not blocking the UI
 *
 * A user with five years of history has ~9,000 log rows. The read is therefore **paged**: the
 * logged range is split into {@link DEFAULT_PAGE_DAYS}-day windows ({@link logPages}) and each
 * window is a separate query, with a `yieldControl()` await between windows so React can paint the
 * progress the caller is showing. Nothing here holds the JS thread for more than one page's work,
 * and progress is reported as a single 0…1 `fraction` so the UI needs no arithmetic of its own.
 *
 * ## Failure model
 *
 * Nothing here throws for an outcome the user can cause. {@link runExport} always resolves to an
 * {@link ExportOutcome}: `shared`, `cancelled` (the share sheet was dismissed — every platform
 * reports this differently, so it is *classified*, see {@link isCancellation}), `unavailable` (the
 * device has no share sheet at all: the file still exists and its URI is returned), or `failed`
 * with the error. A dismissed share sheet is an ordinary choice, not an error, and must never
 * surface as one. The progress listener always ends on `{ phase: 'done', fraction: 1 }`, whatever
 * happened, so a spinner can never be left running.
 *
 * ## Injection
 *
 * Nothing native is touched at import time. Rows arrive through {@link ExportSource} — the app
 * fills it with {@link createDatabaseExportSource} (this is one of the two services
 * ARCHITECTURE.md lets read the database directly: the whole log is far more than the tracking
 * store's month-shaped cache is for, and the qada audit trail has no store read at all), and the
 * tests fill it with {@link createMemoryExportSource} or a real better-sqlite3 database. The file
 * system and the share sheet arrive through {@link ExportAdapter}, which is
 * {@link createExpoExportAdapter} in the app and {@link createFakeExportAdapter} in tests.
 *
 * This module only ever **reads**. Nothing here writes a row, and nothing here can.
 *
 * Dependency rule: `services → db → domain`. No React, no React Native, and no user-facing strings
 * — the only strings produced here are machine tokens, ISO timestamps and a file name; the share
 * sheet's title arrives already localized from the caller.
 */

import { getDb, type SyncDatabase } from '../db/client';
import * as queries from '../db/queries';
import { addDays, compareDays, isAfterDay, toDayString } from '../domain/dates';
import { PRAYERS } from '../domain/types';

import type {
  ExemptPeriod,
  Prayer,
  PrayerDay,
  PrayerLog,
  QadaDebts,
  QadaEvent,
} from '../domain/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Product name written into the file header. Not UI copy — it identifies the file's origin. */
export const APP_NAME = 'Simple Prayer';

/** Every exported file starts with this; the sweep in {@link runExport} uses it to find its own. */
export const FILE_PREFIX = 'simple-prayer-times-';

/** The file formats offered in Settings → Data. */
export const EXPORT_FORMATS = ['csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Version of the *file format* (not of the app). Bump it whenever a column or a JSON field changes
 * meaning, so a future importer can tell which layout it is looking at.
 */
export const EXPORT_SCHEMA_VERSION = 1;

/** MIME type + iOS Uniform Type Identifier per format, for the share sheet. */
export const FORMAT_TYPES: Record<ExportFormat, { mimeType: string; uti: string }> = {
  csv: { mimeType: 'text/csv', uti: 'public.comma-separated-values-text' },
  json: { mimeType: 'application/json', uti: 'public.json' },
};

/**
 * How many days of logs one query covers. 180 days ≈ 900 rows at five prayers a day: small enough
 * that a single page never noticeably stalls the JS thread, large enough that a decade of history
 * is ~20 queries rather than 3,650.
 */
export const DEFAULT_PAGE_DAYS = 180;

/** RFC 4180 line ending. Windows Excel is the least forgiving reader, so it sets the rule. */
const CSV_NEWLINE = '\r\n';

/**
 * The CSV columns, in order. This list *is* the documentation of the format.
 *
 * | column | `log` | `exempt_period` | `qada_debt` | `qada_event` |
 * |---|---|---|---|---|
 * | `record` | `log` | `exempt_period` | `qada_debt` | `qada_event` |
 * | `day` | the prayer day | first exempt day | — | — |
 * | `prayer` | `fajr`…`isha` | — | `fajr`…`isha` | the affected prayer, if any |
 * | `status` | `prayed` \| `late` \| `missed` \| `exempt` | — | — | — |
 * | `made_up` | `true` \| `false` | — | — | — |
 * | `made_up_at` | when it was made up | — | — | — |
 * | `logged_at` | when the log was first written | — | — | — |
 * | `updated_at` | when it was last edited | when the period was created | — | when the event happened |
 * | `exempt_end_day` | — | last exempt day (**empty = still ongoing**) | — | — |
 * | `qada_count` | — | — | prayers still owed | — |
 * | `event_type` | — | — | — | `tick` \| `add` \| `estimateSet` \| `manualSet` \| `forgive` \| `forgiveUndo` |
 * | `event_delta` | — | — | — | signed change to the debt (negative = paid off) |
 * | `event_meta` | — | — | — | the event's JSON payload, if any |
 *
 * Every timestamp cell is a UTC ISO-8601 instant; every day cell is a local `YYYY-MM-DD` prayer
 * day. Rows appear in that order: logs oldest-first, then periods, then the five counters, then
 * the audit trail oldest-first.
 */
export const CSV_COLUMNS = [
  'record',
  'day',
  'prayer',
  'status',
  'made_up',
  'made_up_at',
  'logged_at',
  'updated_at',
  'exempt_end_day',
  'qada_count',
  'event_type',
  'event_delta',
  'event_meta',
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** The four kinds of row a CSV export can contain, told apart by the `record` column. */
export const CSV_RECORD_TYPES = ['log', 'exempt_period', 'qada_debt', 'qada_event'] as const;
export type CsvRecordType = (typeof CSV_RECORD_TYPES)[number];

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

/** The inclusive span of days that has anything logged in it. */
export interface LogBounds {
  firstDay: PrayerDay;
  lastDay: PrayerDay;
}

/**
 * Everything the export needs to read, in domain types only.
 *
 * Five narrow reads rather than one "give me everything", because the log is the part that grows
 * without bound and has to be fetched a page at a time.
 */
export interface ExportSource {
  /** The logged range, or `null` when nothing has ever been logged. */
  bounds(): LogBounds | null;
  /** Stored logs in an inclusive day range, sparse and ascending. */
  logsBetween(firstDay: PrayerDay, lastDay: PrayerDay): PrayerLog[];
  /** Every exempt period, ascending by start day. */
  exemptPeriods(): ExemptPeriod[];
  /** The current outstanding debt per prayer. */
  qadaDebts(): QadaDebts;
  /** The full qada audit trail, in any order (the export sorts it oldest-first). */
  qadaEvents(): QadaEvent[];
}

/**
 * The real source: `src/db/queries.ts`, nothing else.
 *
 * The handle is resolved lazily on every call rather than captured, so creating a source never
 * opens SQLite — which is what keeps this module importable under Jest and from scripts.
 *
 * @param resolveDb - Handle provider; defaults to the app's lazily-opened singleton.
 * @returns A read-only view of the database.
 */
export function createDatabaseExportSource(resolveDb: () => SyncDatabase = getDb): ExportSource {
  return {
    bounds() {
      const firstDay = queries.firstLoggedDay(resolveDb());
      const lastDay = queries.lastLoggedDay(resolveDb());
      if (firstDay === null || lastDay === null) return null;
      return { firstDay, lastDay };
    },
    logsBetween: (firstDay, lastDay) => queries.listPrayerLogs(resolveDb(), firstDay, lastDay),
    exemptPeriods: () => queries.listExemptPeriods(resolveDb()),
    qadaDebts: () => queries.getQadaDebts(resolveDb()),
    qadaEvents: () => queries.listQadaEvents(resolveDb()),
  };
}

/** Zero counters — the shape `qadaDebts()` must return even on an empty database. */
export function emptyQadaDebts(): QadaDebts {
  return { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
}

/** Rows a {@link createMemoryExportSource} should serve. Everything defaults to empty. */
export interface MemoryExportSourceConfig {
  logs?: PrayerLog[];
  exemptPeriods?: ExemptPeriod[];
  qadaDebts?: Partial<QadaDebts>;
  qadaEvents?: QadaEvent[];
}

/**
 * An {@link ExportSource} over plain arrays.
 *
 * For the cases a database cannot produce — a status containing a quote and a newline, say — which
 * are precisely the cases the CSV writer has to survive.
 *
 * @param config - The rows to serve.
 */
export function createMemoryExportSource(config: MemoryExportSourceConfig = {}): ExportSource {
  const logs = [...(config.logs ?? [])].sort((a, b) =>
    a.day === b.day ? PRAYERS.indexOf(a.prayer) - PRAYERS.indexOf(b.prayer) : a.day < b.day ? -1 : 1
  );

  return {
    bounds() {
      const first = logs[0];
      const last = logs[logs.length - 1];
      if (first === undefined || last === undefined) return null;
      return { firstDay: first.day, lastDay: last.day };
    },
    logsBetween: (firstDay, lastDay) =>
      logs.filter((log) => log.day >= firstDay && log.day <= lastDay),
    exemptPeriods: () => [...(config.exemptPeriods ?? [])],
    qadaDebts: () => ({ ...emptyQadaDebts(), ...config.qadaDebts }),
    qadaEvents: () => [...(config.qadaEvents ?? [])],
  };
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/**
 * Splits the logged range into consecutive, non-overlapping pages.
 *
 * Walks the range rather than dividing day counts, so a calendar oddity (a DST-shifted day, a leap
 * day) cannot round a page past the end. Every page is `pageDays` long except the last.
 *
 * @param bounds - The logged range, or `null` when nothing is logged.
 * @param pageDays - Days per page; coerced to at least 1.
 * @returns Ascending pages covering exactly `bounds`, or `[]` when there is nothing to read.
 */
export function logPages(bounds: LogBounds | null, pageDays: number): LogBounds[] {
  if (bounds === null) return [];
  const size = Math.max(1, Math.trunc(pageDays));
  if (isAfterDay(bounds.firstDay, bounds.lastDay)) return [];

  const pages: LogBounds[] = [];
  let cursor = bounds.firstDay;
  while (compareDays(cursor, bounds.lastDay) <= 0) {
    const proposed = addDays(cursor, size - 1);
    const lastDay = isAfterDay(proposed, bounds.lastDay) ? bounds.lastDay : proposed;
    pages.push({ firstDay: cursor, lastDay });
    cursor = addDays(lastDay, 1);
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** The stages an export goes through. `done` is terminal and always the last event emitted. */
export const EXPORT_PHASES = ['reading', 'writing', 'sharing', 'done'] as const;
export type ExportPhase = (typeof EXPORT_PHASES)[number];

/** One progress tick: which stage, and how far along the whole job is (0…1). */
export interface ExportProgress {
  phase: ExportPhase;
  fraction: number;
}

export type ExportProgressListener = (progress: ExportProgress) => void;

/**
 * How much of {@link runExport}'s bar the read owns. The rest is split between writing the file
 * and waiting on the share sheet, which move the bar enough that a slow sheet still looks alive.
 */
const READ_SPAN = 0.7;
const WRITE_MARK = 0.8;
const SHARE_MARK = 0.9;

/** Rounds a fraction into 0…1, defensively — a listener should never see 1.0000000000000002. */
function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// CSV writing
// ---------------------------------------------------------------------------

/**
 * Fields that must be quoted: RFC 4180's comma, quote and line breaks — plus **leading or trailing
 * whitespace**, which the spec leaves undefined and which spreadsheets happily eat.
 */
const CSV_MUST_QUOTE = /[",\r\n]|^\s|\s$/;

/**
 * Escapes one CSV field.
 *
 * A value containing a comma, a double quote or a line break is wrapped in double quotes and its
 * own quotes are doubled — the whole of RFC 4180's rule, and the reason a status or a JSON payload
 * with a comma in it cannot shift every following column by one.
 *
 * @param value - Raw cell value; `undefined`/`null` become an empty cell.
 * @returns The field exactly as it should appear in the file.
 */
export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text === '') return '';
  if (!CSV_MUST_QUOTE.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Joins one row, escaping each cell and leaving unused columns empty. */
function csvRow(cells: Partial<Record<CsvColumn, string | number | boolean | null>>): string {
  return CSV_COLUMNS.map((column) => csvField(cells[column])).join(',');
}

/**
 * A UTC ISO-8601 instant, or an empty string when there is no timestamp.
 * Millisecond precision is preserved, so the value round-trips back to the stored epoch ms.
 */
export function isoInstant(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined || !Number.isFinite(epochMs)) return '';
  return new Date(epochMs).toISOString();
}

/** The device's IANA zone, or an empty string on a platform without a full ICU build. */
export function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** How many records of each kind a file carries; repeated inside the file itself. */
export interface ExportCounts {
  logs: number;
  exemptPeriods: number;
  qadaDebts: number;
  qadaEvents: number;
}

export interface RenderExportOptions {
  format: ExportFormat;
  source: ExportSource;
  /** The app version, written into the header. */
  appVersion: string;
  /** The export instant. Injected so a file name and a header are deterministic in tests. */
  now: Date;
  /** IANA zone for the header; read from the platform when omitted. */
  timeZone?: string;
  /** Days per query page. See {@link DEFAULT_PAGE_DAYS}. */
  pageDays?: number;
  onProgress?: ExportProgressListener;
  /** Awaited between pages so the UI can paint. Defaults to a macrotask. */
  yieldControl?: () => Promise<void>;
}

/** A rendered file, in memory, not yet written anywhere. */
export interface RenderedExport {
  format: ExportFormat;
  fileName: string;
  mimeType: string;
  uti: string;
  text: string;
  /** UTF-8 size, for the "shared 42 KB" style confirmation. */
  bytes: number;
  counts: ExportCounts;
}

/** Hands the JS thread back to React between pages. */
function defaultYield(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** UTF-8 byte length, falling back to the string length where TextEncoder is missing. */
function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length;
  }
}

/** Everything read, before it is turned into one format or the other. */
interface Collected {
  logs: PrayerLog[];
  periods: ExemptPeriod[];
  debts: QadaDebts;
  events: QadaEvent[];
  bounds: LogBounds | null;
  counts: ExportCounts;
}

/** Reads the whole record, one page of days at a time, reporting progress as it goes. */
async function collect(options: RenderExportOptions): Promise<Collected> {
  const { source } = options;
  const yieldControl = options.yieldControl ?? defaultYield;
  const report = options.onProgress;

  const bounds = source.bounds();
  const pages = logPages(bounds, options.pageDays ?? DEFAULT_PAGE_DAYS);

  const logs: PrayerLog[] = [];
  for (const [index, page] of pages.entries()) {
    logs.push(...source.logsBetween(page.firstDay, page.lastDay));
    report?.({ phase: 'reading', fraction: clampFraction((index + 1) / pages.length) });
    await yieldControl();
  }

  const periods = [...source.exemptPeriods()].sort((a, b) =>
    a.startDay === b.startDay ? (a.id ?? 0) - (b.id ?? 0) : a.startDay < b.startDay ? -1 : 1
  );
  const debts = source.qadaDebts();
  // The query layer returns events newest-first (what the qada screen wants); a file reads as a
  // history, so it is flipped to oldest-first here rather than in the source.
  const events = [...source.qadaEvents()].sort((a, b) =>
    a.at === b.at ? (a.id ?? 0) - (b.id ?? 0) : a.at - b.at
  );

  return {
    logs,
    periods,
    debts,
    events,
    bounds,
    counts: {
      logs: logs.length,
      exemptPeriods: periods.length,
      qadaDebts: PRAYERS.length,
      qadaEvents: events.length,
    },
  };
}

/**
 * The `#` comment block above the table: what wrote this file, when, and how to read it.
 *
 * Comment lines are the de-facto convention for CSV metadata (`pandas.read_csv(comment='#')`,
 * csvkit, R). Any line break inside a value is flattened, so a comment can never look like data.
 */
function csvHeaderComments(
  options: RenderExportOptions,
  collected: Collected,
  timeZone: string
): string[] {
  const { counts, bounds } = collected;
  const range = bounds === null ? '(nothing logged yet)' : `${bounds.firstDay} … ${bounds.lastDay}`;
  return [
    `${APP_NAME} — prayer log export`,
    `schema: ${EXPORT_SCHEMA_VERSION}`,
    `app version: ${options.appVersion}`,
    `exported: ${options.now.toISOString()}`,
    `time zone: ${timeZone}`,
    `days: ${range}`,
    `records: ${counts.logs} logs, ${counts.exemptPeriods} exempt periods, ` +
      `${counts.qadaDebts} qada counters, ${counts.qadaEvents} qada events`,
    'days are local prayer days (Fajr to next Fajr); timestamps are UTC ISO-8601',
    'the first column says what kind of record a row is; columns that do not apply are empty',
  ].map((line) => `# ${line.replaceAll(/[\r\n]+/g, ' ')}`);
}

/** `true` / `false` / empty when the user never expressed an opinion. */
function csvBoolean(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value ? 'true' : 'false';
}

/** Renders the collected record as CSV. */
function renderCsv(options: RenderExportOptions, collected: Collected, timeZone: string): string {
  const lines: string[] = [
    ...csvHeaderComments(options, collected, timeZone),
    CSV_COLUMNS.join(','),
  ];

  for (const log of collected.logs) {
    const madeUp = log.madeUpAt !== undefined && log.madeUpAt !== null;
    lines.push(
      csvRow({
        record: 'log',
        day: log.day,
        prayer: log.prayer,
        status: log.status,
        made_up: csvBoolean(madeUp),
        made_up_at: isoInstant(log.madeUpAt),
        logged_at: isoInstant(log.loggedAt),
        updated_at: isoInstant(log.updatedAt),
      })
    );
  }

  for (const period of collected.periods) {
    lines.push(
      csvRow({
        record: 'exempt_period',
        day: period.startDay,
        // Empty, never today's date: the export must not invent an end for a period the user has
        // not ended.
        exempt_end_day: period.endDay ?? '',
        updated_at: isoInstant(period.createdAt),
      })
    );
  }

  for (const prayer of PRAYERS) {
    lines.push(csvRow({ record: 'qada_debt', prayer, qada_count: collected.debts[prayer] ?? 0 }));
  }

  for (const event of collected.events) {
    lines.push(
      csvRow({
        record: 'qada_event',
        prayer: event.prayer ?? '',
        updated_at: isoInstant(event.at),
        event_type: event.type,
        event_delta: event.delta,
        event_meta: event.meta === undefined ? '' : JSON.stringify(event.meta),
      })
    );
  }

  return lines.join(CSV_NEWLINE) + CSV_NEWLINE;
}

/** The JSON document's shape — the contract another program reads. */
export interface ExportJsonDocument {
  app: string;
  appVersion: string;
  schemaVersion: number;
  exportedAt: string;
  timeZone: string;
  days: LogBounds | null;
  counts: ExportCounts;
  logs: {
    day: PrayerDay;
    prayer: Prayer;
    status: PrayerLog['status'];
    madeUpAt: number | null;
    loggedAt: number;
    updatedAt: number;
  }[];
  exemptPeriods: { startDay: PrayerDay; endDay: PrayerDay | null; createdAt: number }[];
  qadaDebts: QadaDebts;
  qadaEvents: {
    type: QadaEvent['type'];
    prayer: Prayer | null;
    delta: number;
    at: number;
    meta: Record<string, unknown> | null;
  }[];
}

/** Builds the JSON document object (exported so a caller can assert structure, not string shape). */
export function toJsonDocument(
  options: RenderExportOptions,
  collected: Collected,
  timeZone: string
): ExportJsonDocument {
  return {
    app: APP_NAME,
    appVersion: options.appVersion,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: options.now.toISOString(),
    timeZone,
    days: collected.bounds,
    counts: collected.counts,
    logs: collected.logs.map((log) => ({
      day: log.day,
      prayer: log.prayer,
      status: log.status,
      madeUpAt: log.madeUpAt ?? null,
      loggedAt: log.loggedAt,
      updatedAt: log.updatedAt,
    })),
    exemptPeriods: collected.periods.map((period) => ({
      startDay: period.startDay,
      endDay: period.endDay,
      createdAt: period.createdAt,
    })),
    qadaDebts: collected.debts,
    qadaEvents: collected.events.map((event) => ({
      type: event.type,
      prayer: event.prayer,
      delta: event.delta,
      at: event.at,
      meta: event.meta ?? null,
    })),
  };
}

/**
 * `simple-prayer-times-2026-08-19.csv` — the date is the *local* export date, because that is the
 * date the person will look for in their files app.
 *
 * @param format - Which file is being written.
 * @param at - The export instant.
 */
export function exportFileName(format: ExportFormat, at: Date): string {
  return `${FILE_PREFIX}${toDayString(at)}.${format}`;
}

/**
 * Reads everything and renders it, without touching the file system.
 *
 * @param options - Format, source, header values, paging and progress.
 * @returns The rendered file plus its name, type and record counts.
 */
export async function renderExport(options: RenderExportOptions): Promise<RenderedExport> {
  const timeZone = options.timeZone ?? resolveTimeZone();
  const collected = await collect(options);
  const text =
    options.format === 'csv'
      ? renderCsv(options, collected, timeZone)
      : `${JSON.stringify(toJsonDocument(options, collected, timeZone), null, 2)}\n`;

  options.onProgress?.({ phase: 'done', fraction: 1 });

  const { mimeType, uti } = FORMAT_TYPES[options.format];
  return {
    format: options.format,
    fileName: exportFileName(options.format, options.now),
    mimeType,
    uti,
    text,
    bytes: byteLength(text),
    counts: collected.counts,
  };
}

// ---------------------------------------------------------------------------
// The platform adapter
// ---------------------------------------------------------------------------

export interface ShareRequest {
  mimeType: string;
  uti: string;
  dialogTitle: string;
}

/** The file system and the share sheet, as the four calls an export actually makes. */
export interface ExportAdapter {
  /** Names of the files in the export directory, for the sweep. */
  list(): Promise<string[]>;
  /** Removes one file by name. Missing files are not an error. */
  delete(fileName: string): Promise<void>;
  /** Writes UTF-8 text, replacing any file of the same name. @returns the file's URI. */
  write(fileName: string, contents: string): Promise<string>;
  /** Whether this device can share at all (some Android builds and simulators cannot). */
  canShare(): Promise<boolean>;
  share(uri: string, options: ShareRequest): Promise<void>;
}

/**
 * The real adapter: the app's cache directory plus `expo-sharing`.
 *
 * Exports live in the **cache**, not in documents: the file exists to be handed to the share
 * sheet, and after that the OS may reclaim it whenever it likes. Each run sweeps the previous
 * one away (see {@link runExport}), so a year of exports cannot quietly accumulate.
 *
 * Both expo modules are required lazily, so importing this module stays safe under Jest and in
 * scripts — the same seam `services/location.ts` uses.
 */
export function createExpoExportAdapter(): ExportAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fileSystem = () => require('expo-file-system') as typeof import('expo-file-system');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharing = () => require('expo-sharing') as typeof import('expo-sharing');

  return {
    async list() {
      const { Directory, Paths } = fileSystem();
      return new Directory(Paths.cache).list().map((entry) => entry.name);
    },
    async delete(fileName) {
      const { File, Paths } = fileSystem();
      const file = new File(Paths.cache, fileName);
      if (file.exists) file.delete();
    },
    async write(fileName, contents) {
      const { File, Paths } = fileSystem();
      const file = new File(Paths.cache, fileName);
      file.create({ overwrite: true, intermediates: true });
      // SDK 58: `write` is async; awaited so `share()` never opens a half-written file.
      await file.write(contents);
      return file.uri;
    },
    async canShare() {
      return sharing().isAvailableAsync();
    },
    async share(uri, options) {
      await sharing().shareAsync(uri, {
        mimeType: options.mimeType,
        UTI: options.uti,
        dialogTitle: options.dialogTitle,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Running an export
// ---------------------------------------------------------------------------

/**
 * Words and codes the platforms use when the *user* dismissed the share sheet rather than
 * something going wrong. iOS usually resolves instead of rejecting, Android rejects on some OEM
 * builds, and the Expo module has changed its mind about this more than once — so the
 * classification is textual and deliberately generous. Misreading a real failure as a cancellation
 * only ever means the UI says "nothing was shared" instead of "that did not work", which is the
 * safe direction; the file is on disk either way.
 */
const CANCELLATION_PATTERN = /cancel|dismiss|abort|user\s*(closed|declined|denied)/i;

/** Whether a thrown value looks like "the user closed the sheet". */
export function isCancellation(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && CANCELLATION_PATTERN.test(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return CANCELLATION_PATTERN.test(message);
}

/** What happened, in the user's terms. Never an exception — see the module header. */
export type ExportOutcome =
  | {
      status: 'shared';
      format: ExportFormat;
      fileName: string;
      uri: string;
      bytes: number;
      counts: ExportCounts;
    }
  /** The share sheet was dismissed without choosing anything. The file was still written. */
  | {
      status: 'cancelled';
      format: ExportFormat;
      fileName: string;
      uri: string;
      bytes: number;
      counts: ExportCounts;
    }
  /** The device cannot share; the file exists at `uri` and the UI should say where. */
  | {
      status: 'unavailable';
      format: ExportFormat;
      fileName: string;
      uri: string;
      bytes: number;
      counts: ExportCounts;
    }
  | { status: 'failed'; format: ExportFormat; error: Error };

export interface RunExportOptions extends RenderExportOptions {
  adapter: ExportAdapter;
  /** Localized share-sheet title, supplied by the caller (this module has no strings). */
  dialogTitle: string;
}

/** Whatever was thrown, as an `Error` the UI can hold on to. */
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * The whole flow: read → render → sweep → write → share.
 *
 * @param options - Everything {@link renderExport} needs, plus the adapter and the sheet's title.
 * @returns An {@link ExportOutcome}. This never rejects, and the progress listener always ends on
 *   `{ phase: 'done', fraction: 1 }` — a spinner started by a caller can always be stopped.
 */
export async function runExport(options: RunExportOptions): Promise<ExportOutcome> {
  const { adapter, format, onProgress } = options;

  try {
    let rendered: RenderedExport;
    try {
      rendered = await renderExport({
        ...options,
        // The render's own bar is squeezed into the first stretch of this one, and its terminal
        // `done` is folded back into `reading` — only `runExport` may say an export is finished.
        onProgress: (progress) =>
          onProgress?.({
            phase: 'reading',
            fraction: clampFraction(progress.fraction * READ_SPAN),
          }),
      });
    } catch (error) {
      return { status: 'failed', format, error: asError(error) };
    }

    // Sweep our own leftovers before writing the next one. A failure here is not the user's
    // problem — an undeleted stale file costs a few kilobytes of cache — so it is swallowed.
    try {
      const existing = await adapter.list();
      for (const name of existing) {
        if (name.startsWith(FILE_PREFIX)) await adapter.delete(name);
      }
    } catch {
      // Ignored on purpose; see above.
    }

    let uri: string;
    try {
      onProgress?.({ phase: 'writing', fraction: READ_SPAN });
      uri = await adapter.write(rendered.fileName, rendered.text);
      onProgress?.({ phase: 'writing', fraction: WRITE_MARK });
    } catch (error) {
      return { status: 'failed', format, error: asError(error) };
    }

    const written = {
      format,
      fileName: rendered.fileName,
      uri,
      bytes: rendered.bytes,
      counts: rendered.counts,
    } as const;

    onProgress?.({ phase: 'sharing', fraction: SHARE_MARK });

    let shareable: boolean;
    try {
      shareable = await adapter.canShare();
    } catch {
      // A device that cannot even answer the question cannot share; the file is written, which is
      // the part that matters.
      shareable = false;
    }
    if (!shareable) return { status: 'unavailable', ...written };

    try {
      await adapter.share(uri, {
        mimeType: rendered.mimeType,
        uti: rendered.uti,
        dialogTitle: options.dialogTitle,
      });
    } catch (error) {
      if (isCancellation(error)) return { status: 'cancelled', ...written };
      return { status: 'failed', format, error: asError(error) };
    }

    return { status: 'shared', ...written };
  } finally {
    onProgress?.({ phase: 'done', fraction: 1 });
  }
}

// ---------------------------------------------------------------------------
// Test double
// ---------------------------------------------------------------------------

export interface FakeExportAdapterConfig {
  /** `false` makes the device look like one with no share sheet. */
  canShare?: boolean;
  /** Thrown from `share` — a cancellation error or a genuine failure. */
  shareError?: unknown;
  /** Thrown from `write`. */
  writeError?: unknown;
  /** Thrown from `list`, to prove a failed sweep does not fail the export. */
  listError?: unknown;
}

export interface FakeExportAdapter extends ExportAdapter {
  /** File name → contents, for what is currently "on disk". */
  files: Map<string, string>;
  /** Names passed to `delete`, in order. */
  deleted: string[];
  /** Everything handed to the share sheet. */
  shared: { uri: string; options: ShareRequest }[];
  calls: { list: number; delete: number; write: number; canShare: number; share: number };
}

/** An in-memory {@link ExportAdapter} that records what it was asked to do. */
export function createFakeExportAdapter(config: FakeExportAdapterConfig = {}): FakeExportAdapter {
  const files = new Map<string, string>();
  const deleted: string[] = [];
  const shared: { uri: string; options: ShareRequest }[] = [];
  const calls = { list: 0, delete: 0, write: 0, canShare: 0, share: 0 };

  return {
    files,
    deleted,
    shared,
    calls,
    async list() {
      calls.list += 1;
      if (config.listError !== undefined) throw config.listError;
      return [...files.keys()];
    },
    async delete(fileName) {
      calls.delete += 1;
      deleted.push(fileName);
      files.delete(fileName);
    },
    async write(fileName, contents) {
      calls.write += 1;
      if (config.writeError !== undefined) throw config.writeError;
      files.set(fileName, contents);
      return `file:///cache/${fileName}`;
    },
    async canShare() {
      calls.canShare += 1;
      return config.canShare ?? true;
    },
    async share(uri, options) {
      calls.share += 1;
      if (config.shareError !== undefined) throw config.shareError;
      shared.push({ uri, options });
    },
  };
}
