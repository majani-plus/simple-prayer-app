/**
 * Tests for `services/widgetSnapshot` — the fully-resolved timeline the widgets render.
 *
 * Assertions are structural (ordering, contiguity, keys, flags) rather than about formatted
 * strings: the suite runs in whatever timezone the machine has, and times are adhan's business,
 * tested in `domain/prayerTimes`. The translator is an echo, so tests name i18n keys, not copy.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  buildWidgetSnapshot,
  parseWidgetSnapshot,
  segmentAt,
  widgetHeroAt,
  WIDGET_SNAPSHOT_DAYS,
  WIDGET_SNAPSHOT_VERSION,
  type WidgetSnapshotDeps,
} from './widgetSnapshot';
import type { TimesLocation } from '../domain/prayerTimes';
import { PRAYERS, type CalculationSettings, type Prayer, type PrayerDay, type PrayerStatus } from '../domain/types';

const AMSTERDAM: TimesLocation = { latitude: 52.3676, longitude: 4.9041, countryCode: 'NL' };

const CALCULATION: CalculationSettings = {
  method: 'muslimWorldLeague',
  madhab: 'shafi',
  highLatitudeRule: 'auto',
  offsets: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  hijriOffset: 0,
};

/** Echoes key + params, so assertions name keys rather than English copy. */
const echo = (key: string, params?: Record<string, unknown>): string =>
  params === undefined || Object.keys(params).length === 0
    ? key
    : `${key}(${Object.values(params).join(',')})`;

const allUnlogged: Record<Prayer, PrayerStatus> = {
  fajr: 'unlogged',
  dhuhr: 'unlogged',
  asr: 'unlogged',
  maghrib: 'unlogged',
  isha: 'unlogged',
};

function deps(overrides: Partial<WidgetSnapshotDeps> = {}): WidgetSnapshotDeps {
  return {
    translate: echo,
    language: 'en',
    numericLocale: 'en',
    rtl: false,
    timeFormat: '24h',
    theme: 'system',
    hijriOffset: 0,
    statusesFor: () => undefined,
    isExemptDay: () => false,
    ...overrides,
  };
}

/** A Tuesday, mid-Europe, well clear of DST edges. Noon UTC so the prayer day is unambiguous. */
const NOW = new Date('2026-08-25T12:00:00Z');

function build(overrides: Partial<WidgetSnapshotDeps> = {}, days?: number) {
  return buildWidgetSnapshot(
    { now: NOW, location: AMSTERDAM, calculation: CALCULATION, days },
    deps(overrides)
  );
}

describe('buildWidgetSnapshot', () => {
  it('covers the horizon plus yesterday, and stamps version and expiry', () => {
    const snapshot = build();

    expect(snapshot).not.toBeNull();
    expect(snapshot?.version).toBe(WIDGET_SNAPSHOT_VERSION);
    // Yesterday + today + the horizon's remaining days (the terminal day exists only to close
    // the last Isha window and is not itself rendered).
    expect(snapshot?.days.length).toBe(WIDGET_SNAPSHOT_DAYS + 1);
    expect(snapshot?.expiresAt).toBe(snapshot?.days[snapshot.days.length - 1].endsAt);
    expect(snapshot?.generatedAt).toBe(NOW.getTime());
  });

  it('renders each day with five prayers in canonical order and a sunrise', () => {
    const snapshot = build();
    const day = snapshot?.days[1];

    expect(day?.prayers.map((p) => p.prayer)).toEqual([...PRAYERS]);
    expect(day?.sunriseAt).not.toBeNull();
    // Sunrise closes Fajr's window (D71).
    expect(day?.prayers[0].windowEndAt).toBe(day?.sunriseAt);
    // Isha's window ends at the NEXT day's Fajr.
    const next = snapshot?.days[2];
    expect(day?.prayers[4].windowEndAt).toBe(next?.prayers[0].at);
    expect(day?.endsAt).toBe(next?.startsAt);
  });

  it('names Friday through the SHORT jumuah key, weekday resolved on the PRAYER day (D77)', () => {
    const snapshot = build();
    const friday = snapshot?.days.find((d) => new Date(`${d.day}T12:00:00`).getDay() === 5);

    expect(friday).toBeDefined();
    const dhuhr = friday?.prayers.find((p) => p.prayer === 'dhuhr');
    // The app says the pair ("Jumu'ah · Dhuhr"); every snapshot surface is too small for it,
    // so the snapshot carries the short single name (owner, 2026-08-28).
    expect(dhuhr?.name).toBe('prayers.jumuahShort');
    // Every other day keeps the plain name.
    const monday = snapshot?.days.find((d) => new Date(`${d.day}T12:00:00`).getDay() === 1);
    expect(monday?.prayers.find((p) => p.prayer === 'dhuhr')?.name).toBe('prayers.dhuhr');
  });

  it('drops the Arabic companion when it repeats the name (ar)', () => {
    const arabic = build({
      // In ar the localized name IS the calligraphy: both keys resolve to the same string.
      translate: (key: string) => (key.startsWith('prayers.') ? 'الفجر' : echo(key)),
      language: 'ar',
      rtl: true,
    });

    const fajr = arabic?.days[1].prayers[0];
    expect(fajr?.name).toBe('الفجر');
    expect(fajr?.arabicName).toBeNull();
    expect(arabic?.rtl).toBe(true);
  });

  it('captions Fajr against sunrise and the rest against their window end', () => {
    const snapshot = build();
    const day = snapshot?.days[1];

    expect(day?.prayers[0].dueCaption).toContain('today.caption.dueUntilSunrise');
    expect(day?.prayers[2].dueCaption).toContain('today.caption.dueUntil(');
  });

  it('carries statuses for logged days and defaults everything else to unlogged (D06)', () => {
    const today = getTodayOf(build());
    const snapshot = build({
      statusesFor: (day: PrayerDay) =>
        day === today ? { ...allUnlogged, fajr: 'prayed', dhuhr: 'late' } : undefined,
    });

    const day = snapshot?.days.find((d) => d.day === today);
    expect(day?.prayers.map((p) => p.status)).toEqual([
      'prayed',
      'late',
      'unlogged',
      'unlogged',
      'unlogged',
    ]);
    // A future day the log has never seen is plain unlogged — not missing, not an error.
    const future = snapshot?.days[snapshot.days.length - 1];
    expect(future?.prayers.every((p) => p.status === 'unlogged')).toBe(true);
  });

  it('overrides every status with exempt on an exempt day (D64) and flags the day', () => {
    const today = getTodayOf(build());
    const snapshot = build({
      statusesFor: (day: PrayerDay) => (day === today ? { ...allUnlogged, fajr: 'prayed' } : undefined),
      isExemptDay: (day: PrayerDay) => day === today,
    });

    const day = snapshot?.days.find((d) => d.day === today);
    expect(day?.isExempt).toBe(true);
    expect(day?.prayers.every((p) => p.status === 'exempt')).toBe(true);
  });

  it('builds contiguous segments with the sunrise gap as a designed null-current state', () => {
    const snapshot = build();
    const segments = snapshot?.segments ?? [];

    expect(segments.length).toBeGreaterThan(0);
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i].from).toBe(segments[i - 1].to);
    }

    const day = snapshot?.days[1];
    const gap = segments.find((s) => s.day === day?.day && s.current === null && s.next !== null);
    expect(gap).toBeDefined();
    expect(gap?.from).toBe(day?.sunriseAt);
    expect(gap?.next).toEqual({ day: day?.day, prayer: 'dhuhr' });

    // Isha's segment hands over to the NEXT day's Fajr.
    const isha = segments.find((s) => s.day === day?.day && s.current === 'isha');
    expect(isha?.to).toBe(day?.endsAt);
    expect(isha?.next).toEqual({ day: snapshot?.days[2].day, prayer: 'fajr' });
  });

  it('ends the timeline with an honest empty segment at the horizon', () => {
    const snapshot = build();
    const tail = snapshot?.segments[snapshot.segments.length - 1];

    expect(tail?.current).toBeNull();
    expect(tail?.next).toBeNull();
    expect(tail?.from).toBe(snapshot?.expiresAt);
  });

  it('segmentAt finds the active stretch and respects half-open bounds', () => {
    const snapshot = build();
    expect(snapshot).not.toBeNull();
    if (snapshot === null) return;

    const segment = segmentAt(snapshot, NOW.getTime());
    expect(segment).not.toBeNull();
    expect(NOW.getTime()).toBeGreaterThanOrEqual(segment?.from ?? Number.NaN);
    expect(NOW.getTime()).toBeLessThan(segment?.to ?? Number.NaN);
    // Exactly at a boundary belongs to the later segment.
    const boundary = segmentAt(snapshot, segment?.to ?? 0);
    expect(boundary?.from).toBe(segment?.to);
  });

  it('renders Hijri through the app tokens, never through Intl month names', () => {
    const snapshot = build();
    expect(snapshot?.days[1].hijriText).toContain('hijri.months.');
  });

  it('pre-renders the bare deadline through the hero phrase, sunrise-bounded for Fajr', () => {
    const snapshot = build();
    const day = snapshot?.days[1];
    for (const prayer of day?.prayers ?? []) {
      // Every prayer inside the horizon has a resolvable window end.
      expect(prayer.untilText).toMatch(/^today\.hero\.until/);
    }
    // Fajr's deadline IS sunrise: the instants must agree.
    const fajr = day?.prayers.find((p) => p.prayer === 'fajr');
    expect(fajr?.windowEndAt).toBe(day?.sunriseAt);
  });

  it('never groups the Hijri year — 1448, not 1,448', () => {
    const snapshot = build();
    // The year is a name, not a quantity; no grouping separator in any numbering system.
    expect(snapshot?.days[1].hijriText).not.toMatch(/[,٬  ]/u);
  });

  it('pre-translates the static strings, including the seal vocabulary', () => {
    const snapshot = build();
    expect(snapshot?.strings).toEqual({
      sunrise: 'today.sunrise.label',
      statusPrayed: 'seal.status.prayed',
      statusLate: 'seal.status.late',
      statusMissed: 'seal.status.missed',
      statusNotMarked: 'seal.status.unlogged',
      statusNotRequired: 'seal.status.exempt',
      statusUpcoming: 'today.caption.upcoming',
      now: 'today.caption.dueNow',
      next: 'today.caption.next',
      leftToPray: 'widgets.leftToPray',
    });
  });

  it('honors a shorter horizon for tests', () => {
    const snapshot = build({}, 3);
    expect(snapshot?.days.length).toBe(4);
  });
});

describe('parseWidgetSnapshot', () => {
  it('round-trips what the builder made', () => {
    const snapshot = build();
    const parsed = parseWidgetSnapshot(JSON.stringify(snapshot));
    expect(parsed).toEqual(snapshot);
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['not json', 'nope{'],
    ['not an object', '42'],
    ['wrong version', JSON.stringify({ version: 999, days: [], segments: [] })],
    ['missing arrays', JSON.stringify({ version: WIDGET_SNAPSHOT_VERSION })],
  ])('rejects %s rather than guessing', (_label, raw) => {
    expect(parseWidgetSnapshot(raw)).toBeNull();
  });
});

/** The day whose segments contain NOW — index 1 by construction, asserted not assumed. */
function getTodayOf(snapshot: ReturnType<typeof build>): PrayerDay {
  const segment = snapshot === null ? null : segmentAt(snapshot, NOW.getTime());
  expect(segment).not.toBeNull();
  return segment?.day ?? '';
}

// ---------------------------------------------------------------------------
// DST — the horizon spans the 2026-03-08 New York spring-forward. The snapshot
// is instants end to end, so the sun's own rhythm must survive the clock jump:
// consecutive Fajrs stay ~24 real hours apart (a wall-clock reconstruction
// would put a 23- or 25-hour gap on the transition day), windows stay
// contiguous, and the expiry stays the final boundary.
// ---------------------------------------------------------------------------

describe('DST — the snapshot horizon crosses a spring-forward intact', () => {
  const NEW_YORK: TimesLocation = { latitude: 40.7128, longitude: -74.006, countryCode: 'US' };
  const DST_NOW = new Date('2026-03-05T17:00:00Z'); // noon EST, three days before the jump

  function buildAcrossTransition() {
    return buildWidgetSnapshot(
      { now: DST_NOW, location: NEW_YORK, calculation: CALCULATION },
      deps()
    );
  }

  it('keeps consecutive Fajrs a solar day apart, never a wall-clock day', () => {
    const snapshot = buildAcrossTransition();
    expect(snapshot).not.toBeNull();
    const fajrs = snapshot!.days.map((day) => day.prayers[0].at);
    expect(fajrs.length).toBeGreaterThanOrEqual(WIDGET_SNAPSHOT_DAYS);
    for (let i = 1; i < fajrs.length; i += 1) {
      const gapMinutes = (fajrs[i] - fajrs[i - 1]) / 60_000;
      expect(gapMinutes).toBeGreaterThan(23.5 * 60);
      expect(gapMinutes).toBeLessThan(24.5 * 60);
    }
  });

  it('keeps windows contiguous and the expiry at the final boundary across the jump', () => {
    const snapshot = buildAcrossTransition();
    expect(snapshot).not.toBeNull();
    for (let i = 0; i < snapshot!.days.length; i += 1) {
      const day = snapshot!.days[i];
      // Each day's own markers stay strictly ordered as instants.
      const instants = day.prayers.map((p) => p.at);
      for (let j = 1; j < instants.length; j += 1) {
        expect(instants[j]).toBeGreaterThan(instants[j - 1]);
      }
      // Isha's window still hands over exactly at the next day's Fajr.
      const next = snapshot!.days[i + 1];
      if (next !== undefined) {
        expect(day.prayers[4].windowEndAt).toBe(next.prayers[0].at);
        expect(day.endsAt).toBe(next.prayers[0].at);
      }
    }
    expect(snapshot!.expiresAt).toBe(snapshot!.days[snapshot!.days.length - 1].endsAt);
  });
});

// ---------------------------------------------------------------------------
// Cross-language contract — the version pin lives in three languages and only
// convention kept them equal. This makes the convention a build failure.
// ---------------------------------------------------------------------------

describe('the native readers pin the same snapshot version', () => {
  const repoRoot = path.join(__dirname, '..', '..');

  function pinnedVersion(relativePath: string, pattern: RegExp): number {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const match = pattern.exec(source);
    expect(match).not.toBeNull();
    return Number(match?.[1]);
  }

  it('iOS (SnapshotReader.swift) matches WIDGET_SNAPSHOT_VERSION', () => {
    expect(
      pinnedVersion('targets/widget/SnapshotReader.swift', /static let supportedVersion = (\d+)/)
    ).toBe(WIDGET_SNAPSHOT_VERSION);
  });

  it('Android (Snapshot.kt) matches WIDGET_SNAPSHOT_VERSION', () => {
    expect(
      pinnedVersion(
        'modules/prayer-widgets/android/src/main/java/expo/modules/prayerwidgets/Snapshot.kt',
        /const val VERSION = (\d+)/
      )
    ).toBe(WIDGET_SNAPSHOT_VERSION);
  });
});

describe('widgetHeroAt — the widget state at time T (D190)', () => {
  // 2026-08-25 is a Tuesday; the Friday of that week is 2026-08-28.
  const snapshot = build();
  if (snapshot === null) throw new Error('fixture snapshot did not build');
  const today = snapshot.days[1];
  const tomorrow = snapshot.days[2];
  const at = (day: typeof today, prayer: Prayer) =>
    day.prayers.find((entry) => entry.prayer === prayer)?.at ?? Number.NaN;
  const end = (day: typeof today, prayer: Prayer) =>
    day.prayers.find((entry) => entry.prayer === prayer)?.windowEndAt ?? Number.NaN;
  const MIN = 60 * 1000;

  /** Everything unlogged except the given marks, for any day. */
  const statuses =
    (marks: Partial<Record<Prayer, PrayerStatus>> = {}) =>
    (_day: PrayerDay, prayer: Prayer): PrayerStatus =>
      marks[prayer] ?? 'unlogged';

  it('before Fajr: still yesterday’s Isha, counting the time left to pray it', () => {
    const t = at(today, 'fajr') - 30 * MIN;
    const hero = widgetHeroAt(snapshot, t, statuses());
    expect(hero).toEqual({
      kind: 'deadline',
      day: snapshot.days[0].day,
      current: 'isha',
      countdownTo: at(today, 'fajr'),
    });
  });

  it('Fajr → sunrise, unmarked: time left until sunrise', () => {
    const hero = widgetHeroAt(snapshot, at(today, 'fajr') + MIN, statuses());
    expect(hero).toMatchObject({ kind: 'deadline', current: 'fajr', countdownTo: today.sunriseAt });
  });

  it('Fajr → sunrise, marked: stays "prayed", counting calmly to Dhuhr', () => {
    const hero = widgetHeroAt(snapshot, at(today, 'fajr') + MIN, statuses({ fajr: 'prayed' }));
    expect(hero).toEqual({
      kind: 'upcoming',
      day: today.day,
      marked: { prayer: 'fajr', status: 'prayed' },
      next: { day: today.day, prayer: 'dhuhr' },
      countdownTo: at(today, 'dhuhr'),
    });
  });

  it('sunrise → Dhuhr on a weekday: the calm countdown to Dhuhr, nothing marked', () => {
    const t = (today.sunriseAt ?? 0) + 10 * MIN;
    const hero = widgetHeroAt(snapshot, t, statuses({ fajr: 'prayed' }));
    expect(hero).toEqual({
      kind: 'upcoming',
      day: today.day,
      marked: null,
      next: { day: today.day, prayer: 'dhuhr' },
      countdownTo: at(today, 'dhuhr'),
    });
    expect(today.prayers[1].name).toBe('prayers.dhuhr');
    expect(today.prayers[1].untilStartText).toBe('widgets.untilPrayer(prayers.dhuhr)');
  });

  it('sunrise → Dhuhr on a Friday: the same countdown, named Jumu’ah', () => {
    const friday = snapshot.days.find((entry) => entry.day === '2026-08-28');
    if (friday === undefined) throw new Error('Friday missing from the horizon');
    const t = (friday.sunriseAt ?? 0) + 10 * MIN;
    const hero = widgetHeroAt(snapshot, t, statuses());
    expect(hero).toMatchObject({ kind: 'upcoming', marked: null, next: { day: '2026-08-28', prayer: 'dhuhr' } });
    const dhuhr = friday.prayers.find((entry) => entry.prayer === 'dhuhr');
    expect(dhuhr?.name).toBe('prayers.jumuahShort');
    expect(dhuhr?.untilStartText).toBe('widgets.untilPrayer(prayers.jumuahShort)');
  });

  it.each(['dhuhr', 'asr', 'maghrib'] as const)(
    'inside %s’s window: deadline when unmarked, calm countdown to the next prayer when marked',
    (prayer) => {
      const t = at(today, prayer) + MIN;
      expect(widgetHeroAt(snapshot, t, statuses())).toEqual({
        kind: 'deadline',
        day: today.day,
        current: prayer,
        countdownTo: end(today, prayer),
      });
      const marked = widgetHeroAt(snapshot, t, statuses({ [prayer]: 'late' }));
      expect(marked).toMatchObject({ kind: 'upcoming', marked: { prayer, status: 'late' } });
      if (marked.kind !== 'upcoming') return;
      expect(marked.countdownTo).toBe(at(today, marked.next.prayer));
    }
  );

  it('Isha → midnight → next Fajr: deadline to Fajr unmarked; calm countdown to Fajr once marked', () => {
    const fajr = at(tomorrow, 'fajr');
    const beforeMidnight = at(today, 'isha') + 10 * MIN;
    const afterMidnight = fajr - 60 * MIN;

    for (const t of [beforeMidnight, afterMidnight]) {
      expect(widgetHeroAt(snapshot, t, statuses())).toEqual({
        kind: 'deadline',
        day: today.day,
        current: 'isha',
        countdownTo: fajr,
      });
      expect(widgetHeroAt(snapshot, t, statuses({ isha: 'prayed' }))).toEqual({
        kind: 'upcoming',
        day: today.day,
        marked: { prayer: 'isha', status: 'prayed' },
        next: { day: tomorrow.day, prayer: 'fajr' },
        countdownTo: fajr,
      });
    }

    // At Fajr the new day takes over.
    expect(widgetHeroAt(snapshot, fajr + MIN, statuses())).toMatchObject({
      kind: 'deadline',
      day: tomorrow.day,
      current: 'fajr',
    });
  });

  it('an exempt day shows the exempt state, never a countdown', () => {
    const exempt = build({ isExemptDay: (day) => day === today.day });
    if (exempt === null) throw new Error('fixture snapshot did not build');
    expect(widgetHeroAt(exempt, at(today, 'asr') + MIN, statuses())).toEqual({
      kind: 'exempt',
      day: today.day,
    });
  });

  it('past the horizon there is nothing to say', () => {
    expect(widgetHeroAt(snapshot, snapshot.expiresAt + MIN, statuses())).toEqual({ kind: 'none' });
  });
});

