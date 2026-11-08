/**
 * Tests for `services/watchEnvelope` — the pure wrapper that turns a widget snapshot into
 * everything a watch renders. Content of the snapshot itself is `widgetSnapshot.test.ts`'s
 * business; here the envelope's own promises are pinned: alert selection, final strings,
 * the qibla bearing, and the parse gate.
 */

import {
  buildWatchEnvelope,
  parseWatchEnvelope,
  WATCH_ENVELOPE_VERSION,
  type WatchEnvelopeInput,
} from './watchEnvelope';
import { WIDGET_SNAPSHOT_VERSION, type WidgetSnapshot, type WidgetDay } from './widgetSnapshot';
import type { Prayer } from '../domain/types';

const T0 = Date.UTC(2026, 7, 25, 12, 0, 0); // 2026-08-25T12:00:00Z

function day(dayString: string, offsetHours: number): WidgetDay {
  const base = T0 + offsetHours * 3_600_000;
  const at = (h: number) => base + h * 3_600_000;
  const names: Record<Prayer, string> = {
    fajr: 'Fajr',
    dhuhr: 'Dhuhr',
    asr: 'Asr',
    maghrib: 'Maghrib',
    isha: 'Isha',
  };
  const hours: Record<Prayer, number> = { fajr: -8, dhuhr: -1, asr: 3, maghrib: 6, isha: 8 };
  return {
    day: dayString,
    startsAt: at(-8),
    endsAt: at(16),
    dateText: 'Tuesday · Aug 25',
    hijriText: '11 Rabiʿ al-Awwal 1448',
    isExempt: false,
    sunriseAt: at(-6.5),
    sunriseText: '6:38 am',
    prayers: (Object.keys(names) as Prayer[]).map((prayer) => ({
      prayer,
      name: names[prayer],
      arabicName: prayer === 'asr' ? 'العصر' : null,
      at: at(hours[prayer]),
      timeText: `${prayer} time`,
      windowEndAt: at(hours[prayer] + 2),
      dueCaption: 'now',
      untilText: 'until',
      status: 'unlogged' as const,
    })),
  };
}

function snapshot(days: WidgetDay[]): WidgetSnapshot {
  return {
    version: WIDGET_SNAPSHOT_VERSION,
    generatedAt: T0,
    expiresAt: days[days.length - 1]?.endsAt ?? T0,
    language: 'en',
    rtl: false,
    theme: 'system',
    strings: {
      sunrise: 'Sunrise',
      statusPrayed: 'Prayed',
      statusLate: 'Late',
      statusMissed: 'Missed',
      statusNotMarked: 'Not marked',
      statusNotRequired: 'Not required',
      statusUpcoming: 'Upcoming',
      now: 'now',
      next: 'next',
      leftToPray: 'left to pray',
    },
    days,
    segments: [],
  };
}

const allOn: Record<Prayer, boolean> = {
  fajr: true,
  dhuhr: true,
  asr: true,
  maghrib: true,
  isha: true,
};

function input(overrides: Partial<WatchEnvelopeInput> = {}): WatchEnvelopeInput {
  return {
    snapshot: snapshot([day('2026-08-25', 0), day('2026-08-26', 24)]),
    now: new Date(T0),
    location: { latitude: 52.3676, longitude: 4.9041 },
    adhanEnabled: allOn,
    ...overrides,
  };
}

const echoTranslate = (key: string, params?: Record<string, unknown>) =>
  `${key}|${JSON.stringify(params ?? {})}`;

describe('buildWatchEnvelope', () => {
  it('plans an alert for every future enabled prayer, in time order, and none for the past', () => {
    const envelope = buildWatchEnvelope(input(), { translate: echoTranslate });

    // Day one: fajr (-8h) and dhuhr (-1h) are past; asr/maghrib/isha are future. Day two: all 5.
    expect(envelope.alerts.entries).toHaveLength(8);
    expect(envelope.alerts.entries[0].prayer).toBe('asr');
    const times = envelope.alerts.entries.map((entry) => entry.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times.every((at) => at > T0)).toBe(true);
  });

  it('skips prayers whose adhan is off', () => {
    const envelope = buildWatchEnvelope(
      input({ adhanEnabled: { ...allOn, asr: false, isha: false } }),
      { translate: echoTranslate }
    );

    const prayers = new Set(envelope.alerts.entries.map((entry) => entry.prayer));
    expect(prayers.has('asr')).toBe(false);
    expect(prayers.has('isha')).toBe(false);
    expect(prayers.has('maghrib')).toBe(true);
  });

  it('renders every alert string final, through the app translator, D111 keys', () => {
    const envelope = buildWatchEnvelope(input(), { translate: echoTranslate });
    const asr = envelope.alerts.entries[0];

    expect(asr.title).toBe('notifications.adhan.title|{"prayer":"Asr","arabic":"العصر"}');
    expect(asr.body).toBe('notifications.adhan.body|{"time":"asr time"}');
    expect(asr.markedTitle).toBe('notifications.marked.title|{"prayer":"Asr"}');
    expect(envelope.alerts.prayedLabel).toBe('notifications.actions.prayed|{}');
    expect(envelope.alerts.undoLabel).toBe('notifications.actions.undo|{}');
  });

  it('falls back to the display name when the Arabic companion is null', () => {
    const envelope = buildWatchEnvelope(input(), { translate: echoTranslate });
    const maghrib = envelope.alerts.entries.find((entry) => entry.prayer === 'maghrib');

    expect(maghrib?.title).toBe(
      'notifications.adhan.title|{"prayer":"Maghrib","arabic":"Maghrib"}'
    );
  });

  it('carries the qibla bearing for a real location, and null when it cannot be computed', () => {
    const amsterdam = buildWatchEnvelope(input(), { translate: echoTranslate });
    expect(amsterdam.qibla).not.toBeNull();
    // Amsterdam's qibla is south-east; the exact figure belongs to qibla.test.ts.
    expect(amsterdam.qibla?.bearing).toBeGreaterThan(90);
    expect(amsterdam.qibla?.bearing).toBeLessThan(180);
    // The page's own name rides along — the Today footer's scroll hint renders it.
    expect(amsterdam.qibla?.titleLabel).toBe('tabs.qibla|{}');
    // The dial's cardinal engravings ride too (owner, 2026-08-28).
    expect(amsterdam.qibla?.north).toBe('qibla.cardinal.n|{}');
    expect(amsterdam.qibla?.west).toBe('qibla.cardinal.w|{}');

    const noLocation = buildWatchEnvelope(input({ location: null }), {
      translate: echoTranslate,
    });
    expect(noLocation.qibla).toBeNull();

    const broken = buildWatchEnvelope(
      input({ location: { latitude: Number.NaN, longitude: 4.9 } }),
      { translate: echoTranslate }
    );
    expect(broken.qibla).toBeNull();
  });

  it('wraps the snapshot untouched', () => {
    const source = input();
    const envelope = buildWatchEnvelope(source, { translate: echoTranslate });

    expect(envelope.version).toBe(WATCH_ENVELOPE_VERSION);
    expect(envelope.snapshot).toBe(source.snapshot);
  });
});

describe('parseWatchEnvelope', () => {
  it('round-trips what the builder made', () => {
    const envelope = buildWatchEnvelope(input(), { translate: echoTranslate });
    const parsed = parseWatchEnvelope(JSON.stringify(envelope));

    expect(parsed).not.toBeNull();
    expect(parsed?.alerts.entries).toHaveLength(envelope.alerts.entries.length);
  });

  it('rejects the wrong envelope version, the wrong snapshot version, and garbage', () => {
    const envelope = buildWatchEnvelope(input(), { translate: echoTranslate });

    expect(parseWatchEnvelope(JSON.stringify({ ...envelope, version: 99 }))).toBeNull();
    expect(
      parseWatchEnvelope(
        JSON.stringify({ ...envelope, snapshot: { ...envelope.snapshot, version: 99 } })
      )
    ).toBeNull();
    expect(parseWatchEnvelope('not json')).toBeNull();
    expect(parseWatchEnvelope('')).toBeNull();
    expect(parseWatchEnvelope(null)).toBeNull();
    expect(parseWatchEnvelope(JSON.stringify({ version: WATCH_ENVELOPE_VERSION }))).toBeNull();
  });
});
