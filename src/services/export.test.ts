/**
 * The export service's contract.
 *
 * "Your data is yours" is only a promise if the file is *right*, so these tests are mostly about
 * fidelity rather than plumbing:
 *
 * 1. **Everything is in there.** A seeded database — logs with made-up markers, an
 *    open and a closed exempt period, debts and an audit trail — round-trips through both formats
 *    with nothing dropped. The database is the real one (better-sqlite3 + the shipped migrations),
 *    so what is exported here is what the query layer really stores.
 * 2. **The CSV cannot be corrupted.** Every field is fed back through a strict RFC 4180 parser
 *    written for this test, with values chosen to break a naive `join(',')`: a comma, a double
 *    quote, a newline, a leading space. If escaping ever regresses, the parsed table stops
 *    matching the values that went in.
 * 3. **Empty is a valid export.** A user who has logged nothing still gets a well-formed file.
 * 4. **Nothing throws.** A cancelled share sheet, a device with no share sheet, and a filesystem
 *    that refuses to create the file all resolve to outcomes.
 * 5. **It streams.** Progress is monotonic, ends at 1, and the thread is handed back between
 *    pages — the property that keeps a decade of history from freezing the settings screen.
 */

import {
  CSV_COLUMNS,
  EXPORT_SCHEMA_VERSION,
  FILE_PREFIX,
  createDatabaseExportSource,
  createFakeExportAdapter,
  createMemoryExportSource,
  csvField,
  exportFileName,
  logPages,
  renderExport,
  runExport,
  type ExportProgress,
} from './export';
import { createTestDb, type TestDb } from '../db/__tests__/testDb';
import * as queries from '../db/queries';

import type { PrayerLog } from '../domain/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A fixed export instant, so file names and headers are deterministic. */
const NOW = new Date('2026-08-19T09:30:00.000Z');

/** Shared build options: no waiting on timers, no device time zone in the assertions. */
const BUILD = {
  appVersion: '1.2.3',
  now: NOW,
  timeZone: 'Europe/Istanbul',
  yieldControl: async () => {},
} as const;

/**
 * A strict RFC 4180 reader. Deliberately hand-written rather than imported: the point of the
 * escaping tests is to check our writer against the *specification*, and a parser from the same
 * family of assumptions could agree with a bug.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (char === '\r' && text[index + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index += 2;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The data rows of a CSV export: comment lines and the header row removed. */
function dataRows(text: string): Record<string, string>[] {
  // Sliced at the header line rather than filtered line-by-line: a quoted field may itself
  // contain newlines, and splitting on them would rewrite the very data under test.
  const headerLine = CSV_COLUMNS.join(',');
  const at = text.indexOf(headerLine);
  expect(at).toBeGreaterThanOrEqual(0);
  const [header, ...rest] = parseCsv(text.slice(at));
  expect(header).toEqual([...CSV_COLUMNS]);
  return rest
    .filter((row) => row.some((value) => value !== ''))
    .map((row) => Object.fromEntries(CSV_COLUMNS.map((column, index) => [column, row[index] ?? ''])));
}

function rowsOfType(text: string, record: string): Record<string, string>[] {
  return dataRows(text).filter((row) => row.record === record);
}

/** Seeds a database with one of everything the export has to carry. */
function seed(db: TestDb['db']) {
  queries.setPrayerStatus(db, '2026-08-17', 'fajr', 'prayed', { now: 1_760_000_000_000 });
  queries.setPrayerStatus(db, '2026-08-17', 'dhuhr', 'late', { now: 1_760_000_100_000 });
  queries.setPrayerStatus(db, '2026-08-18', 'asr', 'missed', { now: 1_760_000_200_000 });
  queries.markMadeUp(db, '2026-08-18', 'asr', 1_760_000_300_000);
  // A day far enough back to force more than one page at the page size the tests use.
  queries.setPrayerStatus(db, '2025-01-05', 'isha', 'prayed', { now: 1_730_000_000_000 });

  queries.insertExemptPeriod(db, {
    startDay: '2026-07-01',
    endDay: '2026-07-06',
    createdAt: 1_750_000_000_000,
  });
  queries.insertExemptPeriod(db, { startDay: '2026-08-10', endDay: null, createdAt: 1_755_000_000_000 });

  queries.setQadaDebts(db, { fajr: 3, dhuhr: 0, asr: 1, maghrib: 0, isha: 12 }, { now: 1_756_000_000_000 });
  queries.appendQadaEvent(db, { type: 'add', prayer: 'asr', delta: 1, at: 1_756_000_100_000 });
  queries.appendQadaEvent(db, {
    type: 'forgive',
    prayer: null,
    delta: -16,
    at: 1_756_000_200_000,
    meta: { archived: { fajr: 3, dhuhr: 0, asr: 1, maghrib: 0, isha: 12 } },
  });
}

let test: TestDb;

beforeEach(() => {
  test = createTestDb();
});

afterEach(() => {
  test.close();
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('the CSV export', () => {
  it('opens with a header naming the app version, the export instant and the schema', async () => {
    const { text } = await renderExport({
      ...BUILD,
      format: 'csv',
      source: createDatabaseExportSource(() => test.db),
    });

    const comments = text.split('\r\n').filter((line) => line.startsWith('#'));
    expect(comments.join('\n')).toContain('app version: 1.2.3');
    expect(comments.join('\n')).toContain('exported: 2026-08-19T09:30:00.000Z');
    expect(comments.join('\n')).toContain(`schema: ${EXPORT_SCHEMA_VERSION}`);
  });

  it('writes the documented columns, once, as the first non-comment line', async () => {
    const { text } = await renderExport({
      ...BUILD,
      format: 'csv',
      source: createDatabaseExportSource(() => test.db),
    });

    const lines = text.split('\r\n').filter((line) => !line.startsWith('#') && line !== '');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines.filter((line) => line === CSV_COLUMNS.join(',')).length).toBe(1);
  });

  it('carries every logged prayer with its jama’ah and made-up markers', async () => {
    seed(test.db);
    const { text, counts } = await renderExport({
      ...BUILD,
      format: 'csv',
      source: createDatabaseExportSource(() => test.db),
    });

    const logs = rowsOfType(text, 'log');
    expect(counts.logs).toBe(4);
    expect(logs).toHaveLength(4);

    expect(logs.find((row) => row.day === '2026-08-17' && row.prayer === 'fajr')).toMatchObject({
      status: 'prayed',
      made_up: 'false',
      made_up_at: '',
      logged_at: new Date(1_760_000_000_000).toISOString(),
    });
    expect(logs.find((row) => row.day === '2026-08-17' && row.prayer === 'dhuhr')).toMatchObject({
      status: 'late',
    });
    expect(logs.find((row) => row.day === '2026-08-18' && row.prayer === 'asr')).toMatchObject({
      status: 'missed',
      made_up: 'true',
      made_up_at: new Date(1_760_000_300_000).toISOString(),
    });
  });

  it('carries the exempt periods, and says which one is still open', async () => {
    seed(test.db);
    const { text } = await renderExport({
      ...BUILD,
      format: 'csv',
      source: createDatabaseExportSource(() => test.db),
    });

    const periods = rowsOfType(text, 'exempt_period');
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ day: '2026-07-01', exempt_end_day: '2026-07-06' });
    // An open-ended period is an EMPTY end day, never today's date — the export must not invent
    // an end for something the user has not ended.
    expect(periods[1]).toMatchObject({ day: '2026-08-10', exempt_end_day: '' });
  });

  it('carries every qada counter and every audit event', async () => {
    seed(test.db);
    const { text } = await renderExport({
      ...BUILD,
      format: 'csv',
      source: createDatabaseExportSource(() => test.db),
    });

    const debts = rowsOfType(text, 'qada_debt');
    expect(debts).toHaveLength(5);
    expect(debts.find((row) => row.prayer === 'isha')?.qada_count).toBe('12');

    const events = rowsOfType(text, 'qada_event');
    expect(events.map((row) => row.event_type)).toEqual(['add', 'forgive']);
    expect(events[1]).toMatchObject({ prayer: '', event_delta: '-16' });
    // The archived snapshot survives as JSON inside one field — the value most likely to break
    // a naive writer, since it is full of quotes and commas.
    expect(JSON.parse(events[1].event_meta)).toEqual({
      archived: { fajr: 3, dhuhr: 0, asr: 1, maghrib: 0, isha: 12 },
    });
  });
});

describe('CSV escaping', () => {
  it('quotes commas, quotes, newlines and edge whitespace', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(' padded ')).toBe('" padded "');
    expect(csvField(undefined)).toBe('');
    expect(csvField(0)).toBe('0');
  });

  it('survives a status and a payload that try to break the table', async () => {
    // Values SQL would never store, which is exactly why the source is in memory here: the export
    // must be safe against whatever ends up in the columns, not only against what we write today.
    const hostile: PrayerLog = {
      day: '2026-08-17',
      prayer: 'fajr',
      status: 'prayed, "in congregation"\nsort of' as PrayerLog['status'],
      loggedAt: 1_760_000_000_000,
      updatedAt: 1_760_000_000_000,
    };

    const { text } = await renderExport({
      ...BUILD,
      format: 'csv',
      source: createMemoryExportSource({
        logs: [hostile],
        qadaEvents: [
          {
            type: 'manualSet',
            prayer: 'isha',
            delta: 4,
            at: 1_760_000_400_000,
            meta: { note: 'commas, "quotes" and\nnewlines' },
          },
        ],
      }),
    });

    const rows = dataRows(text);
    // The hostile value comes back byte-for-byte, and it did NOT add a column or a row.
    const log = rows.find((row) => row.record === 'log');
    expect(log?.status).toBe('prayed, "in congregation"\nsort of');
    expect(Object.keys(log ?? {})).toHaveLength(CSV_COLUMNS.length);
    expect(rows.filter((row) => row.record === 'log')).toHaveLength(1);

    const event = rows.find((row) => row.record === 'qada_event');
    expect(JSON.parse(event?.event_meta ?? '')).toEqual({
      note: 'commas, "quotes" and\nnewlines',
    });
  });
});

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

describe('the JSON export', () => {
  it('is parseable and carries the whole record', async () => {
    seed(test.db);
    const { text, counts } = await renderExport({
      ...BUILD,
      format: 'json',
      source: createDatabaseExportSource(() => test.db),
    });

    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({
      app: 'Simple Prayer',
      appVersion: '1.2.3',
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-08-19T09:30:00.000Z',
      timeZone: 'Europe/Istanbul',
    });

    expect(parsed.logs).toHaveLength(4);
    expect(parsed.logs).toContainEqual({
      day: '2026-08-18',
      prayer: 'asr',
      status: 'missed',
      madeUpAt: 1_760_000_300_000,
      loggedAt: 1_760_000_200_000,
      updatedAt: 1_760_000_300_000,
    });
    expect(parsed.exemptPeriods).toEqual([
      { startDay: '2026-07-01', endDay: '2026-07-06', createdAt: 1_750_000_000_000 },
      { startDay: '2026-08-10', endDay: null, createdAt: 1_755_000_000_000 },
    ]);
    expect(parsed.qadaDebts).toEqual({ fajr: 3, dhuhr: 0, asr: 1, maghrib: 0, isha: 12 });
    expect(parsed.qadaEvents.map((event: { type: string }) => event.type)).toEqual([
      'add',
      'forgive',
    ]);
    expect(parsed.counts).toEqual(counts);
  });

  it('keeps timestamps as the exact integers the database holds', async () => {
    seed(test.db);
    const { text } = await renderExport({
      ...BUILD,
      format: 'json',
      source: createDatabaseExportSource(() => test.db),
    });

    const parsed = JSON.parse(text);
    // Lossless on purpose: the CSV renders ISO strings for spreadsheets, the JSON stays exact so
    // an export can be compared to — or one day read back into — the database.
    expect(parsed.logs.every((log: { loggedAt: number }) => Number.isInteger(log.loggedAt))).toBe(
      true
    );
  });

  it('escapes a payload that would otherwise break the document', async () => {
    const { text } = await renderExport({
      ...BUILD,
      format: 'json',
      source: createMemoryExportSource({
        qadaEvents: [
          {
            type: 'manualSet',
            prayer: null,
            delta: 1,
            at: 1_760_000_400_000,
            meta: { note: '"}], evil": 1' },
          },
        ],
      }),
    });

    expect(JSON.parse(text).qadaEvents[0].meta).toEqual({ note: '"}], evil": 1' });
  });
});

// ---------------------------------------------------------------------------
// The empty database
// ---------------------------------------------------------------------------

describe('an empty database', () => {
  it('still produces a well-formed CSV with no log rows', async () => {
    const { text, counts } = await renderExport({
      ...BUILD,
      format: 'csv',
      source: createDatabaseExportSource(() => test.db),
    });

    expect(counts.logs).toBe(0);
    expect(rowsOfType(text, 'log')).toEqual([]);
    expect(rowsOfType(text, 'exempt_period')).toEqual([]);
    // The five counters are always present, at zero: "you owe nothing" is information too.
    expect(rowsOfType(text, 'qada_debt').map((row) => row.qada_count)).toEqual([
      '0',
      '0',
      '0',
      '0',
      '0',
    ]);
  });

  it('still produces parseable JSON with empty collections', async () => {
    const { text } = await renderExport({
      ...BUILD,
      format: 'json',
      source: createDatabaseExportSource(() => test.db),
    });

    const parsed = JSON.parse(text);
    expect(parsed.logs).toEqual([]);
    expect(parsed.exemptPeriods).toEqual([]);
    expect(parsed.qadaEvents).toEqual([]);
    expect(parsed.qadaDebts).toEqual({ fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 });
  });
});

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

describe('paging', () => {
  it('covers the logged range exactly, in ascending non-overlapping pages', () => {
    expect(logPages(null, 30)).toEqual([]);
    expect(logPages({ firstDay: '2026-01-01', lastDay: '2026-01-01' }, 30)).toEqual([
      { firstDay: '2026-01-01', lastDay: '2026-01-01' },
    ]);
    expect(logPages({ firstDay: '2026-01-01', lastDay: '2026-01-10' }, 4)).toEqual([
      { firstDay: '2026-01-01', lastDay: '2026-01-04' },
      { firstDay: '2026-01-05', lastDay: '2026-01-08' },
      { firstDay: '2026-01-09', lastDay: '2026-01-10' },
    ]);
  });

  it('hands the thread back between pages and reports monotonic progress', async () => {
    seed(test.db);
    const progress: ExportProgress[] = [];
    let yields = 0;

    await renderExport({
      ...BUILD,
      format: 'csv',
      source: createDatabaseExportSource(() => test.db),
      // 30-day pages over a 2025-01-05 → 2026-08-18 range: many pages, so the yielding is real.
      pageDays: 30,
      onProgress: (value) => progress.push(value),
      yieldControl: async () => {
        yields += 1;
      },
    });

    expect(yields).toBeGreaterThan(15);
    expect(progress.length).toBeGreaterThan(15);
    const fractions = progress.map((value) => value.fraction);
    expect(fractions.every((value, index) => index === 0 || value >= fractions[index - 1])).toBe(
      true
    );
    expect(fractions[fractions.length - 1]).toBe(1);
    expect(progress[progress.length - 1].phase).toBe('done');
  });

  it('reads one page at a time rather than the whole history at once', async () => {
    seed(test.db);
    const ranges: string[] = [];
    const real = createDatabaseExportSource(() => test.db);

    await renderExport({
      ...BUILD,
      format: 'csv',
      pageDays: 60,
      source: {
        ...real,
        logsBetween: (from, to) => {
          ranges.push(`${from}..${to}`);
          return real.logsBetween(from, to);
        },
      },
    });

    expect(ranges.length).toBeGreaterThan(5);
    expect(ranges[0]).toBe('2025-01-05..2025-03-05');
  });
});

// ---------------------------------------------------------------------------
// Running the whole thing
// ---------------------------------------------------------------------------

describe('runExport', () => {
  const options = (extra: Record<string, unknown> = {}) => ({
    ...BUILD,
    format: 'csv' as const,
    source: createDatabaseExportSource(() => test.db),
    dialogTitle: 'Export prayer log',
    ...extra,
  });

  it('names the file after the export date', () => {
    expect(exportFileName('csv', new Date('2026-08-19T22:00:00'))).toBe(
      `${FILE_PREFIX}2026-08-19.csv`
    );
    expect(exportFileName('json', new Date('2026-08-19T22:00:00'))).toBe(
      `${FILE_PREFIX}2026-08-19.json`
    );
  });

  it('writes the file, offers it to the share sheet and reports what it sent', async () => {
    seed(test.db);
    const adapter = createFakeExportAdapter();

    const outcome = await runExport({ ...options(), adapter });

    expect(outcome.status).toBe('shared');
    if (outcome.status !== 'shared') return;
    expect(outcome.fileName).toBe(`${FILE_PREFIX}2026-08-19.csv`);
    expect(outcome.bytes).toBeGreaterThan(0);
    expect(outcome.counts.logs).toBe(4);
    expect(adapter.shared).toHaveLength(1);
    expect(adapter.shared[0].options).toMatchObject({
      mimeType: 'text/csv',
      dialogTitle: 'Export prayer log',
    });
    expect(adapter.files.get(outcome.fileName)).toContain('2026-08-17');
  });

  it('sweeps the previous export away before writing the next one', async () => {
    const adapter = createFakeExportAdapter();
    adapter.files.set(`${FILE_PREFIX}1999-01-01.json`, 'stale');
    adapter.files.set('something-else.txt', 'not ours');

    await runExport({ ...options(), adapter });

    expect(adapter.deleted).toContain(`${FILE_PREFIX}1999-01-01.json`);
    // Only our own leftovers; the cache belongs to the whole app.
    expect(adapter.files.has('something-else.txt')).toBe(true);
  });

  it('treats a cancelled share sheet as a cancellation, not an error', async () => {
    const adapter = createFakeExportAdapter({
      shareError: Object.assign(new Error('The operation was cancelled'), {
        code: 'ERR_SHARING_CANCELLED',
      }),
    });

    const outcome = await runExport({ ...options(), adapter });

    expect(outcome.status).toBe('cancelled');
    // The file was still written — nothing was lost by dismissing the sheet.
    if (outcome.status === 'cancelled') expect(adapter.files.has(outcome.fileName)).toBe(true);
  });

  it('says so when the device cannot share at all', async () => {
    const adapter = createFakeExportAdapter({ canShare: false });

    const outcome = await runExport({ ...options(), adapter });

    expect(outcome.status).toBe('unavailable');
    expect(adapter.calls.share).toBe(0);
    if (outcome.status === 'unavailable') expect(outcome.uri).toContain(FILE_PREFIX);
  });

  it('reports a genuine share failure as a failure', async () => {
    const adapter = createFakeExportAdapter({ shareError: new Error('no activity found') });

    const outcome = await runExport({ ...options(), adapter });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error.message).toBe('no activity found');
  });

  it('leaves no half-written file behind when writing fails', async () => {
    const adapter = createFakeExportAdapter();
    const outcome = await runExport({
      ...options({
        source: {
          bounds: () => ({ firstDay: '2026-08-01', lastDay: '2026-08-02' }),
          logsBetween: () => {
            throw new Error('database is locked');
          },
          exemptPeriods: () => [],
          qadaDebts: () => ({ fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 }),
          qadaEvents: () => [],
        },
      }),
      adapter,
    });

    expect(outcome.status).toBe('failed');
    expect(adapter.files.size).toBe(0);
  });

  it('never leaves the progress indicator running, whatever happened', async () => {
    const progress: ExportProgress[] = [];
    await runExport({
      ...options({ onProgress: (value: ExportProgress) => progress.push(value) }),
      adapter: createFakeExportAdapter({ shareError: new Error('boom') }),
    });

    expect(progress[progress.length - 1]).toEqual({ phase: 'done', fraction: 1 });
  });
});
