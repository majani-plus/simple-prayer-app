/**
 * The outbox is read by a process with no JS in it, so everything about it is a shape agreement
 * (`modules/buddy-nicknames/android/.../BuddySender.kt`, `targets/widget/BuddySender.swift`). These
 * tests hold the JS half of that agreement, and the fence that matters most: no nickname, ever.
 */

import {
  BUDDY_OUTBOX_VERSION,
  buildOutbox,
  takeWidgetSent,
  type WidgetSent,
} from './buddyOutbox';
import type { BuddyPair } from '../stores/buddyStore';

const mockTakeWidgetSent = jest.fn<Promise<string>, []>();

jest.mock('../../modules/buddy-nicknames', () => ({
  setBuddyOutbox: jest.fn(async () => undefined),
  clearBuddyOutbox: jest.fn(async () => undefined),
  takeBuddyWidgetSent: () => mockTakeWidgetSent(),
}));

function pair(overrides: Partial<BuddyPair> = {}): BuddyPair {
  return {
    pairId: 'a'.repeat(32),
    icon: 'crescent',
    color: 'ocean',
    nickname: 'Leen',
    lang: 'ar',
    notify: true,
    pending: false,
    addedAt: 0,
    ...overrides,
  } as BuddyPair;
}

const compose = (lang: string, prayer: string) => ({
  title: `[${lang}] buddy prayed ${prayer}`,
  titleNamed: `[${lang}] {} prayed ${prayer}`,
});

describe('buildOutbox', () => {
  it('writes one entry per pair, with all five sentences in their language', () => {
    const outbox = buildOutbox({
      pairs: [pair()],
      lang: 'en',
      notify: true,
      compose,
    });

    expect(outbox.v).toBe(BUDDY_OUTBOX_VERSION);
    expect(outbox.lang).toBe('en');
    expect(outbox.notify).toBe(true);
    expect(outbox.pairs).toHaveLength(1);
    expect(outbox.pairs[0].pairId).toBe('a'.repeat(32));
    expect(Object.keys(outbox.pairs[0].titles ?? {})).toEqual([
      'fajr',
      'dhuhr',
      'asr',
      'maghrib',
      'isha',
    ]);
    expect(outbox.pairs[0].titles?.dhuhr).toEqual({
      title: '[ar] buddy prayed dhuhr',
      titleNamed: '[ar] {} prayed dhuhr',
    });
  });

  it('gives a buddy who asked not to be told no words at all', () => {
    const outbox = buildOutbox({
      pairs: [pair({ notify: false })],
      lang: 'en',
      notify: true,
      compose,
    });

    // Not an empty map: absent. The sender posts the flag alone, and their phone stays silent
    // without the relay ever learning that anybody preferred anything.
    expect(outbox.pairs[0].titles).toBeUndefined();
    expect('titles' in outbox.pairs[0]).toBe(false);
  });

  it('leaves out only the sentences that could not be written', () => {
    const outbox = buildOutbox({
      pairs: [pair()],
      lang: 'en',
      notify: true,
      compose: (lang, prayer) => (prayer === 'asr' ? null : compose(lang, prayer)),
    });

    expect(outbox.pairs[0].titles?.asr).toBeUndefined();
    expect(outbox.pairs[0].titles?.fajr).toBeDefined();
  });

  it('drops the titles entirely when nothing could be written', () => {
    const outbox = buildOutbox({ pairs: [pair()], lang: 'en', notify: true, compose: () => null });
    expect(outbox.pairs[0].titles).toBeUndefined();
  });

  it('carries no nickname, no icon and no colour', () => {
    const json = JSON.stringify(
      buildOutbox({
        pairs: [pair({ nickname: 'Leen', icon: 'crescent', color: 'ocean' })],
        lang: 'en',
        notify: true,
        compose,
      })
    );

    expect(json).not.toContain('Leen');
    expect(json.toLowerCase()).not.toContain('nickname');
    expect(json.toLowerCase()).not.toContain('icon');
    expect(json.toLowerCase()).not.toContain('color');
  });
});

describe('takeWidgetSent', () => {
  const good: WidgetSent = { day: '2026-09-16', prayer: 'dhuhr', state: 'prayed', at: 1_700_000 };

  beforeEach(() => {
    mockTakeWidgetSent.mockReset();
  });

  it('reads back what the widget left', async () => {
    mockTakeWidgetSent.mockResolvedValue(JSON.stringify([good]));
    await expect(takeWidgetSent()).resolves.toEqual([good]);
  });

  it('drops every malformed entry and keeps the rest', async () => {
    mockTakeWidgetSent.mockResolvedValue(
      JSON.stringify([
        good,
        { day: '2026-13-40', prayer: 'dhuhr', state: 'prayed', at: 1 },
        { day: '2026-09-16', prayer: 'tahajjud', state: 'prayed', at: 1 },
        { day: '2026-09-16', prayer: 'asr', state: 'missed', at: 1 },
        { day: '2026-09-16', prayer: 'asr', state: 'prayed', at: 'now' },
        { prayer: 'asr', state: 'prayed', at: 1 },
        null,
        'nonsense',
      ])
    );
    await expect(takeWidgetSent()).resolves.toEqual([good]);
  });

  it('reads an unparseable ledger as an empty one', async () => {
    mockTakeWidgetSent.mockResolvedValue('{not json');
    await expect(takeWidgetSent()).resolves.toEqual([]);
  });

  it('reads anything that is not a list as an empty one', async () => {
    mockTakeWidgetSent.mockResolvedValue('{"day":"2026-09-16"}');
    await expect(takeWidgetSent()).resolves.toEqual([]);
  });
});
