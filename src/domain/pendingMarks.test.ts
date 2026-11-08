/**
 * Tests for `domain/pendingMarks` — the pure half of "Prayed" pressed on a notification.
 *
 * The cases that matter are all about *ordering and identity*, not about time zones, so every
 * `decidedAt` here is a plain number. The one place a real clock is involved — dating an entry
 * that arrived without a day — is exercised through an injected resolver, because that boundary
 * belongs to `domain/dates` and is tested there.
 */

import {
  isPendingMark,
  overlayPendingMarks,
  resolvePendingMarks,
  type PendingMark,
} from './pendingMarks';
import type { Prayer, PrayerStatus } from './types';

/** A well-formed queue entry, with the fields a test cares about overridden. */
function mark(overrides: Partial<PendingMark> & Pick<PendingMark, 'id'>): PendingMark {
  return {
    day: '2026-08-21',
    prayer: 'maghrib',
    decidedAt: 1_000,
    ...overrides,
  };
}

describe('isPendingMark', () => {
  it('accepts an entry with the fields this build needs', () => {
    expect(isPendingMark(mark({ id: 'a' }))).toBe(true);
  });

  it('accepts an entry with no day — the resolver exists for exactly that', () => {
    expect(isPendingMark({ id: 'a', prayer: 'fajr', decidedAt: 1 })).toBe(true);
  });

  it.each([
    ['not an object', 'nonsense'],
    ['no id', { prayer: 'fajr', decidedAt: 1 }],
    ['an empty id', { id: '', prayer: 'fajr', decidedAt: 1 }],
    ['a prayer we do not track', { id: 'a', prayer: 'sunrise', decidedAt: 1 }],
    ['no decidedAt', { id: 'a', prayer: 'fajr' }],
    ['a malformed day', { id: 'a', prayer: 'fajr', decidedAt: 1, day: '21/08/2026' }],
    ['a non-string annuls', { id: 'a', prayer: 'fajr', decidedAt: 1, annuls: 7 }],
  ])('rejects an entry with %s', (_label, value) => {
    expect(isPendingMark(value)).toBe(false);
  });
});

describe('resolvePendingMarks', () => {
  it('turns a single mark into one prayed intent, and consumes it', () => {
    const { intents, consumed } = resolvePendingMarks([mark({ id: 'a' })]);

    expect(intents).toEqual([
      { day: '2026-08-21', prayer: 'maghrib', intent: 'prayed', decidedAt: 1_000 },
    ]);
    expect(consumed).toEqual(['a']);
  });

  it('carries decidedAt through, so the applier never sees the drain time', () => {
    const [intent] = resolvePendingMarks([mark({ id: 'a', decidedAt: 1_755_800_000_000 })]).intents;

    expect(intent.decidedAt).toBe(1_755_800_000_000);
  });

  it('files a mark under the day its notification named, not the day it is drained on', () => {
    // Pressed on a notification for the 21st, drained on the 24th. Nothing here knows or cares
    // what "today" is — the day travelled with the entry.
    const { intents } = resolvePendingMarks([mark({ id: 'a', day: '2026-08-21' })], {
      resolveDay: () => '2026-08-24',
    });

    expect(intents[0].day).toBe('2026-08-21');
  });

  it('leaves an undo and its target cancelling each other, with nothing to write', () => {
    const { intents, consumed } = resolvePendingMarks([
      mark({ id: 'a', decidedAt: 1_000 }),
      mark({ id: 'b', decidedAt: 1_020, annuls: 'a' }),
    ]);

    expect(intents).toEqual([]);
    expect(consumed).toEqual(['a', 'b']);
  });

  it('resolves an undo whose target already drained into a real undo intent', () => {
    const { intents } = resolvePendingMarks([mark({ id: 'b', decidedAt: 1_020, annuls: 'a' })]);

    expect(intents).toEqual([
      { day: '2026-08-21', prayer: 'maghrib', intent: 'undo', decidedAt: 1_020 },
    ]);
  });

  it('takes the last decision when a prayer was marked, undone and marked again', () => {
    const { intents } = resolvePendingMarks([
      mark({ id: 'a', decidedAt: 1_000 }),
      mark({ id: 'b', decidedAt: 1_020, annuls: 'a' }),
      mark({ id: 'c', decidedAt: 1_040 }),
    ]);

    expect(intents).toEqual([
      { day: '2026-08-21', prayer: 'maghrib', intent: 'prayed', decidedAt: 1_040 },
    ]);
  });

  it('never emits two intents for the same prayer on the same day', () => {
    const { intents } = resolvePendingMarks([
      mark({ id: 'a', decidedAt: 1_000 }),
      mark({ id: 'b', decidedAt: 2_000 }),
    ]);

    expect(intents).toHaveLength(1);
    expect(intents[0].decidedAt).toBe(2_000);
  });

  it('keeps prayers on different days apart', () => {
    const { intents } = resolvePendingMarks([
      mark({ id: 'a', day: '2026-08-20', decidedAt: 1_000 }),
      mark({ id: 'b', day: '2026-08-21', decidedAt: 2_000 }),
    ]);

    expect(intents.map((intent) => intent.day)).toEqual(['2026-08-20', '2026-08-21']);
  });

  it('does not depend on the order the queue was read in', () => {
    const entries = [
      mark({ id: 'c', decidedAt: 1_040 }),
      mark({ id: 'a', decidedAt: 1_000 }),
      mark({ id: 'b', decidedAt: 1_020, annuls: 'a' }),
    ];

    const forwards = resolvePendingMarks(entries);
    const backwards = resolvePendingMarks(entries.slice().reverse());

    expect(forwards.intents).toEqual(backwards.intents);
    // Only the *order* of the acknowledgements is free to differ; the set is not.
    expect(forwards.consumed.slice().sort()).toEqual(backwards.consumed.slice().sort());
  });

  it('consumes an entry it cannot read, so it never lingers', () => {
    const { intents, consumed } = resolvePendingMarks([
      { id: 'junk', prayer: 'brunch', decidedAt: 1 },
      mark({ id: 'a' }),
    ]);

    expect(intents).toHaveLength(1);
    expect(consumed).toEqual(expect.arrayContaining(['junk', 'a']));
  });

  it('dates an entry that arrived without a day from when the user decided', () => {
    const seen: number[] = [];
    const { intents } = resolvePendingMarks(
      [{ id: 'a', prayer: 'isha', decidedAt: 1_755_800_000_000 }],
      {
        resolveDay: (instant) => {
          seen.push(instant.getTime());
          return '2026-08-21';
        },
      }
    );

    expect(seen).toEqual([1_755_800_000_000]);
    expect(intents[0]).toMatchObject({ day: '2026-08-21', prayer: 'isha' });
  });

  it('leaves an undatable entry in the queue rather than guessing or dropping it', () => {
    const { intents, consumed } = resolvePendingMarks([
      { id: 'a', prayer: 'isha', decidedAt: 1_000 },
    ]);

    expect(intents).toEqual([]);
    expect(consumed).toEqual([]);
  });

  it('leaves an undatable entry in the queue when the resolver throws', () => {
    const { consumed } = resolvePendingMarks([{ id: 'a', prayer: 'isha', decidedAt: 1_000 }], {
      resolveDay: () => {
        throw new Error('no location yet');
      },
    });

    expect(consumed).toEqual([]);
  });

  it('holds back an undo whose target could not be dated, so it cannot clear it first', () => {
    const { intents, consumed } = resolvePendingMarks([
      { id: 'a', prayer: 'isha', decidedAt: 1_000 },
      { id: 'b', prayer: 'isha', day: '2026-08-21', decidedAt: 1_020, annuls: 'a' },
    ]);

    expect(intents).toEqual([]);
    expect(consumed).toEqual([]);
  });
});

describe('clears — the widget seal-tap that toggles off (D26)', () => {
  it('rejects a non-boolean clears field', () => {
    expect(isPendingMark({ id: 'a', prayer: 'fajr', decidedAt: 1, clears: 'yes' })).toBe(false);
  });

  it('resolves a lone clears entry as an undo intent', () => {
    const { intents } = resolvePendingMarks([mark({ id: 'a', clears: true })]);

    expect(intents).toEqual([
      { day: '2026-08-21', prayer: 'maghrib', intent: 'undo', decidedAt: 1_000 },
    ]);
  });

  it('collapses a widget prayed-then-clears toggle to a single undo the drain will find idle', () => {
    // The widget never reads the queue to find an id to annul: last decision wins per prayer.
    const { intents, consumed } = resolvePendingMarks([
      mark({ id: 'tap1', decidedAt: 1_000 }),
      mark({ id: 'tap2', decidedAt: 2_000, clears: true }),
    ]);

    expect(intents).toEqual([
      { day: '2026-08-21', prayer: 'maghrib', intent: 'undo', decidedAt: 2_000 },
    ]);
    expect(consumed).toEqual(['tap1', 'tap2']);
  });

  it('lets a third tap win: prayed → clears → prayed means prayed', () => {
    const { intents } = resolvePendingMarks([
      mark({ id: 'tap1', decidedAt: 1_000 }),
      mark({ id: 'tap2', decidedAt: 2_000, clears: true }),
      mark({ id: 'tap3', decidedAt: 3_000 }),
    ]);

    expect(intents).toEqual([
      { day: '2026-08-21', prayer: 'maghrib', intent: 'prayed', decidedAt: 3_000 },
    ]);
  });

  it('a clears entry ignores decidedAt storage order — ordering is by decision instant', () => {
    const { intents } = resolvePendingMarks([
      mark({ id: 'tap2', decidedAt: 2_000, clears: true }),
      mark({ id: 'tap1', decidedAt: 1_000 }),
    ]);

    expect(intents.map((i) => i.intent)).toEqual(['undo']);
  });
});

describe('overlayPendingMarks — what the widget shows before the app drains', () => {
  const statuses = (over: Partial<Record<Prayer, PrayerStatus>>): Record<Prayer, PrayerStatus> => ({
    fajr: 'unlogged',
    dhuhr: 'unlogged',
    asr: 'unlogged',
    maghrib: 'unlogged',
    isha: 'unlogged',
    ...over,
  });

  it('shows a prayed intent over an unlogged prayer', () => {
    const result = overlayPendingMarks('2026-08-21', statuses({}), [
      { day: '2026-08-21', prayer: 'asr', intent: 'prayed', decidedAt: 1 },
    ]);

    expect(result.asr).toBe('prayed');
  });

  it('shows an undo over a prayed prayer — the in-app mark the widget is toggling off', () => {
    const result = overlayPendingMarks('2026-08-21', statuses({ asr: 'prayed' }), [
      { day: '2026-08-21', prayer: 'asr', intent: 'undo', decidedAt: 1 },
    ]);

    expect(result.asr).toBe('unlogged');
  });

  it('never repaints a hand-set late, missed, or exempt — exactly the drain guards', () => {
    const base = statuses({ fajr: 'late', dhuhr: 'missed', asr: 'exempt' });
    const result = overlayPendingMarks('2026-08-21', base, [
      { day: '2026-08-21', prayer: 'fajr', intent: 'prayed', decidedAt: 1 },
      { day: '2026-08-21', prayer: 'dhuhr', intent: 'undo', decidedAt: 2 },
      { day: '2026-08-21', prayer: 'asr', intent: 'prayed', decidedAt: 3 },
    ]);

    expect(result).toEqual(base);
  });

  it("ignores another day's intents and never mutates its input", () => {
    const base = statuses({});
    const result = overlayPendingMarks('2026-08-21', base, [
      { day: '2026-08-22', prayer: 'asr', intent: 'prayed', decidedAt: 1 },
    ]);

    expect(result.asr).toBe('unlogged');
    expect(base.asr).toBe('unlogged');
    expect(result).not.toBe(base);
  });
});
