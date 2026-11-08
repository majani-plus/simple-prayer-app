/**
 * Tests for the sync hook — what actually leaves the phone when somebody marks a prayer.
 *
 * `domain/buddies.test.ts` proves the *rule*; this proves the wiring obeys it, which is the part
 * that could drift. A change here that starts sending a missed prayer would be a privacy incident,
 * not a bug, so the fences are asserted against the real relay client interface rather than against
 * the domain function it calls.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { MARK_SETTLE_MS, useBuddySync } from './useBuddySync';
import { EMPTY_BUDDY_STATE, useBuddyStore } from '@/stores/buddyStore';
import { getTrackingActions, useTrackingStore } from '@/stores/trackingStore';
import type { BuddyRelay, RelayResult, SendMarkRequest } from '@/services/buddyRelay';
import { createBuddyCredentialStore, createMemorySecureStorage } from '@/services/buddyCredentials';
import type { PrayerDay, PrayerStatus } from '@/domain/types';
import { NO_BUDDY_MARKS } from '@/domain/buddies';
import i18n, { initI18n } from '@/i18n';
import { getBuddyPushToken, type BuddyPushPayload } from '@/services/buddyPush';

const mockSetNicknames = jest.fn(async (_nicknames: Record<string, string>) => undefined);
const mockWriteOutbox = jest.fn(async (_outbox: unknown) => undefined);
const mockClearOutbox = jest.fn(async () => undefined);
let mockWidgetSent: { day: string; prayer: string; state: string; at: number }[] = [];
jest.mock('@/services/buddyOutbox', () => ({
  buildOutbox: (input: { pairs: { pairId: string; notify: boolean }[]; lang: string; notify: boolean }) => ({
    v: 1,
    lang: input.lang,
    notify: input.notify,
    pairs: input.pairs.map((pair) => ({ pairId: pair.pairId, notify: pair.notify })),
  }),
  defaultCompose: () => null,
  writeBuddyOutbox: (outbox: unknown) => mockWriteOutbox(outbox),
  clearBuddyOutbox: () => mockClearOutbox(),
  takeWidgetSent: async () => {
    const taken = mockWidgetSent;
    mockWidgetSent = [];
    return taken;
  },
}));
const mockClearNicknames = jest.fn(async () => undefined);
jest.mock('../../modules/buddy-nicknames', () => ({
  setBuddyNicknames: (map: Record<string, string>) => mockSetNicknames(map),
  clearBuddyNicknames: () => mockClearNicknames(),
}));

const TODAY = '2026-09-15' as PrayerDay;
const PAIR = 'a'.repeat(32);
const AUTH = { deviceId: 'd'.repeat(32), secret: 'secret-secret-secret' };

const ok = <T,>(value: T): RelayResult<T> => ({ ok: true, value });

function fakeRelay(overrides: Partial<BuddyRelay> = {}) {
  const sent: SendMarkRequest[] = [];
  const acked: string[][] = [];
  const relay: BuddyRelay = {
    register: async () => ok(AUTH),
    setPushToken: async () => ok(null),
    createInvite: async () => ok({ code: 'ABCD2345', display: 'ABCD-2345', expiresAt: 0 }),
    redeem: async () => ok({ pairId: PAIR }),
    send: async (_auth, request) => {
      sent.push(request);
      return ok(null);
    },
    listPairs: async () => ok([PAIR]),
    sendPrefs: async () => ok(null),
    fetchInbox: async () => ok([]),
    ack: async (_auth, ids) => {
      acked.push([...ids]);
      return ok(null);
    },
    unpair: async () => ok(null),
    withdrawInvite: async () => ok(null),
    forgetDevice: async () => ok(null),
    ...overrides,
  };
  return { relay, sent, acked };
}

function credentials() {
  return createBuddyCredentialStore(
    createMemorySecureStorage({ buddyRelayCredentials: JSON.stringify(AUTH) })
  );
}

/** Put the tracking store into a known day with known statuses, without touching the database. */
function seedTracking(statuses: Partial<Record<string, PrayerStatus>>): void {
  getTrackingActions().setTodayDayResolver(() => TODAY);
  useTrackingStore.setState((state) => ({
    ...state,
    revision: state.revision + 1,
    dayRecords: {
      ...state.dayRecords,
      [TODAY]: {
        day: TODAY,
        statuses: {
          fajr: 'unlogged',
          dhuhr: 'unlogged',
          asr: 'unlogged',
          maghrib: 'unlogged',
          isha: 'unlogged',
          ...statuses,
        },
        madeUp: {},
        isExempt: false,
      },
    },
  }));
}

function enableBuddies(): void {
  useBuddyStore.setState((state) => ({
    ...state,
    enabled: true,
    notify: true,
    day: TODAY,
    marks: NO_BUDDY_MARKS,
    pairs: [
      {
        pairId: PAIR,
        icon: 'crescent',
        color: 'ocean',
        nickname: 'Amina',
        lang: 'en',
        notify: true,
        pending: false,
        addedAt: 0,
      },
    ],
  }));
}

let pushHandler: ((payload: BuddyPushPayload) => void) | null = null;
const mockNotifyAccepted = jest.fn(async (_title: string, _body: string) => undefined);
jest.mock('@/services/buddyPush', () => ({
  notifyInviteAccepted: (title: string, body: string) => mockNotifyAccepted(title, body),
  getBuddyPushToken: jest.fn(async () => null),
  configureBuddyNotifications: jest.fn(async () => undefined),
  composeBuddyNotification: jest.fn(() => ({ title: 'x', titleNamed: '{} z' })),
  subscribeToBuddyPushes: (handler: (payload: BuddyPushPayload) => void) => {
    pushHandler = handler;
    return () => {
      pushHandler = null;
    };
  },
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  // Reset the STATE only. Spreading a freshly built store in here would also replace `actions`
  // with another store's closures, so every write would land in a store nothing is reading.
  useBuddyStore.setState((state) => ({ ...state, ...EMPTY_BUDDY_STATE }));
  seedTracking({});
  mockSetNicknames.mockClear();
  mockClearNicknames.mockClear();
  mockNotifyAccepted.mockClear();
  mockWriteOutbox.mockClear();
  mockClearOutbox.mockClear();
  mockWidgetSent = [];
  jest.mocked(getBuddyPushToken).mockReset().mockResolvedValue(null);
});

describe('what leaves the phone when a prayer is marked', () => {
  it('sends "prayed" when a prayer is marked', async () => {
    const { relay, sent } = fakeRelay();
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'prayed' });

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ pairId: PAIR, prayer: 'maghrib', state: 'prayed', day: TODAY });
  });

  it('sends "prayed" for a late prayer too — a buddy is never told the difference', async () => {
    const { relay, sent } = fakeRelay();
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'late' });

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.state).toBe('prayed');
  });

  it('NEVER sends anything when a prayer is marked missed', async () => {
    // The fence the whole feature rests on, asserted at the wire. If this test fails, the privacy
    // policy and both stores' data-safety answers have become untrue.
    const { relay, sent } = fakeRelay();
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'missed' });
    seedTracking({ maghrib: 'missed', fajr: 'missed' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([]);
  });

  it('never sends anything about an exempt day', async () => {
    const { relay, sent } = fakeRelay();
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'exempt', fajr: 'exempt' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([]);
  });

  it('retracts when a mark is undone', async () => {
    const { relay, sent } = fakeRelay();
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'prayed' });
    await waitFor(() => expect(sent).toHaveLength(1));

    seedTracking({ maghrib: 'unlogged' });
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]?.state).toBe('cleared');
  });

  it('says nothing when prayed becomes late', async () => {
    const { relay, sent } = fakeRelay();
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'prayed' });
    await waitFor(() => expect(sent).toHaveLength(1));

    seedTracking({ maghrib: 'late' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(1);
  });

  it('says nothing again about a prayer a buddy has already been told about', async () => {
    // The cold-start case. `dayRecords` fills from empty on launch, which looks exactly like five
    // prayers being marked at once — so without the ledger every launch would re-push marks the
    // buddy was told about hours ago.
    const { relay, sent } = fakeRelay();
    enableBuddies();
    useBuddyStore.setState((state) => ({ ...state, sent: { maghrib: 'prayed' } }));
    useTrackingStore.setState((state) => ({ ...state, dayRecords: {} }));
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'prayed' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([]);
  });

  it('DOES announce a mark that arrives with the day cache still empty', async () => {
    // The other half, and the reason the ledger exists rather than a "was the day cached?" guess:
    // a mark written by the notification's Prayed button while the app was closed is drained on
    // startup, before the day is loaded. It looks identical to a cold start and must still go out.
    const { relay, sent } = fakeRelay();
    enableBuddies();
    useTrackingStore.setState((state) => ({ ...state, dayRecords: {} }));
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'prayed' });

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.state).toBe('prayed');
  });

  it('sends nothing at all while buddy mode is off', async () => {
    const { relay, sent } = fakeRelay();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'prayed' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([]);
  });

  it('carries notification words only for a buddy who wants to be told', async () => {
    const { relay, sent } = fakeRelay();
    enableBuddies();
    const compose = () => ({ title: 'Your buddy prayed Maghrib', titleNamed: '{} prayed Maghrib' });

    await renderHook(() =>
      useBuddySync(true, { relay, credentials: credentials(), composeNotification: compose })
    );
    seedTracking({ maghrib: 'prayed' });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.title).toBe('Your buddy prayed Maghrib');

    // The buddy has since asked their phone to stay quiet. Ours stops sending words, so the relay
    // never learns the preference and their tray stays empty.
    useBuddyStore.setState((state) => ({
      ...state,
      pairs: state.pairs.map((pair) => ({ ...pair, notify: false })),
    }));

    // Awaited one at a time on purpose. Sending is a reconciliation now, so a mark and an unmark
    // in the same breath settle to whatever the day's record ends up saying rather than firing
    // once each — which is the better behaviour and also means the steps have to be separated to
    // observe them.
    seedTracking({ maghrib: 'unlogged' });
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]?.state).toBe('cleared');

    seedTracking({ maghrib: 'prayed' });
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2]?.state).toBe('prayed');
    expect(sent[2]?.title).toBeUndefined();
  });

  it('sends the sentence twice — once plain, once with a hole for a name', async () => {
    // The relay never learns a nickname, so the sender cannot write one. It writes the sentence a
    // phone should show if it has no name for us, and the same sentence with `{}` where a name
    // goes; the receiving phone fills that in as the notification is delivered. The words
    // themselves are `buddyPush.test.ts`'s business — this is only that both reach the wire.
    const { relay, sent } = fakeRelay();
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'prayed' });
    await waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]?.title).toBe('x');
    expect(sent[0]?.titleNamed).toBe('{} z');
  });

  it('leaves the hole alone rather than filling it with a name we chose', async () => {
    // Our nickname for a buddy is ours. Putting it in what we send would tell them what we call
    // them, which is the one thing D174 promises never happens.
    const { relay, sent } = fakeRelay();
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'prayed' });
    await waitFor(() => expect(sent).toHaveLength(1));

    expect(JSON.stringify(sent[0])).not.toContain('Amina');
  });

  it('mirrors the nicknames where a notification can read them, and nothing else', async () => {
    const { relay } = fakeRelay();
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    await waitFor(() => expect(mockSetNicknames).toHaveBeenCalled());
    expect(mockSetNicknames.mock.calls.at(-1)?.[0]).toEqual({ [PAIR]: 'Amina' });
  });

  it('forgets the mirrored nicknames when buddy mode is switched off', async () => {
    const { relay } = fakeRelay();
    enableBuddies();
    const view = await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));
    await waitFor(() => expect(mockSetNicknames).toHaveBeenCalled());

    await act(async () => {
      useBuddyStore.setState((state) => ({ ...state, enabled: false }));
      view.unmount();
    });

    expect(mockClearNicknames).toHaveBeenCalled();
  });

  it('keeps them when the hook merely re-subscribes', async () => {
    // Unmounting is not leaving. This hook tears down and rebuilds for reasons that have nothing to
    // do with the person — and it does so at exactly the moment a notification is most likely to
    // arrive, so clearing the names here would quietly cost the next one its nickname.
    const { relay } = fakeRelay();
    enableBuddies();
    const view = await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));
    await waitFor(() => expect(mockSetNicknames).toHaveBeenCalled());

    await act(async () => {
      view.unmount();
    });

    expect(mockClearNicknames).not.toHaveBeenCalled();
  });

  it('never sends a retraction with words, whatever the buddy asked for', async () => {
    const { relay, sent } = fakeRelay();
    enableBuddies();
    await renderHook(() =>
      useBuddySync(true, {
        relay,
        credentials: credentials(),
        composeNotification: () => ({ title: 'x', titleNamed: '{} z' }),
      })
    );

    seedTracking({ maghrib: 'prayed' });
    await waitFor(() => expect(sent).toHaveLength(1));
    seedTracking({ maghrib: 'unlogged' });
    await waitFor(() => expect(sent).toHaveLength(2));

    expect(sent[1]?.state).toBe('cleared');
    expect(sent[1]?.title).toBeUndefined();
  });
});

describe('a mark that could not be sent is not forgotten', () => {
  it('retries a mark the relay refused, on the next sync', async () => {
    // Praying somewhere with no signal is ordinary, not an edge. Recording the ledger before the
    // send meant a failed send burned the entry and the buddy never heard about that prayer again.
    let online = false;
    const seen: SendMarkRequest[] = [];
    const { relay } = fakeRelay({
      send: async (_auth, request) => {
        if (!online) return { ok: false, reason: 'offline' };
        seen.push(request);
        return ok(null);
      },
    });
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'prayed' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen).toEqual([]);
    // Nothing was told to anybody, so nothing is recorded as told.
    expect(useBuddyStore.getState().sent.maghrib).toBeUndefined();

    // Any later sync retries it — here, the one a new mark triggers.
    online = true;
    seedTracking({ maghrib: 'prayed', fajr: 'prayed' });

    await waitFor(() => expect(seen.map((r) => r.prayer).sort()).toEqual(['fajr', 'maghrib']));
    expect(useBuddyStore.getState().sent.maghrib).toBe('prayed');
  });

  it('reads the ledger against the day it belongs to', async () => {
    // An app left open across the Fajr boundary — a countdown on a nightstand — would otherwise
    // read yesterday's entries against today's prayers and decide Fajr had already been announced.
    const { relay, sent } = fakeRelay();
    enableBuddies();
    useBuddyStore.setState((state) => ({
      ...state,
      day: '2026-09-14' as PrayerDay,
      sent: { fajr: 'prayed' },
    }));
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ fajr: 'prayed' });

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.prayer).toBe('fajr');
  });
});

describe('keeping a buddy up to date without a prayer', () => {
  it('tells every buddy when the app language changes', async () => {
    // Otherwise a buddy keeps writing to you in the old language until you next mark a prayer,
    // which is the gap the first tester noticed.
    const prefs: { pairId: string; lang: string; notify: boolean }[] = [];
    const { relay } = fakeRelay({
      sendPrefs: async (_auth, p) => {
        prefs.push(p);
        return ok(null);
      },
    });
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    await act(async () => {
      await i18n.changeLanguage('ar');
    });

    await waitFor(() => expect(prefs).toHaveLength(1));
    expect(prefs[0]).toMatchObject({ pairId: PAIR, lang: 'ar' });

    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('applies a buddy preference push without touching any prayer', async () => {
    const { relay } = fakeRelay();
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    pushHandler?.({ type: 'prefs', pairId: PAIR, lang: 'tr', notify: false });

    await waitFor(() => expect(useBuddyStore.getState().pairs[0]?.lang).toBe('tr'));
    expect(useBuddyStore.getState().pairs[0]?.notify).toBe(false);
    expect(useBuddyStore.getState().marks).toBe(NO_BUDDY_MARKS);
  });
});

describe('a first buddy is not greeted with the whole morning', () => {
  it('treats what is already logged as told, and sends none of it', async () => {
    // Pairing at noon having prayed Fajr and Dhuhr would otherwise land two flags and two
    // notifications at once, as a hello.
    const { relay, sent } = fakeRelay();
    seedTracking({ fajr: 'prayed', dhuhr: 'prayed' });
    useBuddyStore.setState((state) => ({ ...state, enabled: true, day: TODAY }));
    // A buddy arrives.
    useBuddyStore.getState().actions.addPair({ pairId: PAIR, nickname: 'Amina' }, 1_000);
    expect(useBuddyStore.getState().seedPending).toBe(true);

    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    await waitFor(() => expect(useBuddyStore.getState().seedPending).toBe(false));
    expect(sent).toEqual([]);
    expect(useBuddyStore.getState().sent).toMatchObject({ fajr: 'prayed', dhuhr: 'prayed' });
  });

  it('still announces the next prayer after that', async () => {
    const { relay, sent } = fakeRelay();
    seedTracking({ fajr: 'prayed' });
    useBuddyStore.setState((state) => ({ ...state, enabled: true, day: TODAY }));
    useBuddyStore.getState().actions.addPair({ pairId: PAIR, nickname: 'Amina' }, 1_000);
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));
    await waitFor(() => expect(useBuddyStore.getState().seedPending).toBe(false));

    seedTracking({ fajr: 'prayed', asr: 'prayed' });

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.prayer).toBe('asr');
  });
});

describe('learning that you have been paired', () => {
  it('adds a link the relay knows about and this phone does not', async () => {
    // The inviter's path. They redeemed nothing, so the only way they can learn the pair id is by
    // asking — and until they know it, every mark their new buddy sends is dropped as coming from
    // a stranger.
    const { relay } = fakeRelay({ listPairs: async () => ok([PAIR]) });
    useBuddyStore.setState((state) => ({ ...state, enabled: true }));

    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    await waitFor(() => expect(useBuddyStore.getState().pairs).toHaveLength(1));
    const added = useBuddyStore.getState().pairs[0]!;
    expect(added.pairId).toBe(PAIR);
    // Paired for real, and waiting to be given a name.
    expect(added.pending).toBe(true);
    expect(added.nickname).toBe('');
  });

  it('drops a link the relay no longer has, and says it ended', async () => {
    const { relay } = fakeRelay({ listPairs: async () => ok([]) });
    enableBuddies();

    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    await waitFor(() => expect(useBuddyStore.getState().pairs).toEqual([]));
    expect(useBuddyStore.getState().endedPairs).toEqual([PAIR]);
  });

  it('leaves the roster alone when the relay cannot be asked', async () => {
    // A network blip must never look like everybody unpairing.
    const { relay } = fakeRelay({ listPairs: async () => ({ ok: false, reason: 'offline' }) });
    enableBuddies();

    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useBuddyStore.getState().pairs).toHaveLength(1);
    expect(useBuddyStore.getState().endedPairs).toEqual([]);
  });
});

describe('what comes in', () => {
  it('collects the inbox and tells the relay to forget it', async () => {
    const rows = [{ id: 'f'.repeat(32), pairId: PAIR, day: TODAY, prayer: 'asr' as const, state: 'prayed' as const }];
    const { relay, acked } = fakeRelay({ fetchInbox: async () => ok(rows) });
    enableBuddies();

    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    await waitFor(() => expect(useBuddyStore.getState().marks.asr).toEqual([PAIR]));
    // Collected is deleted: acknowledging is what removes it from the relay.
    await waitFor(() => expect(acked).toEqual([[rows[0].id]]));
  });

  it('leaves a flag for another day on the relay rather than destroying it', async () => {
    // Acking is deleting. A buddy a timezone ahead sends a day string this phone has not reached
    // yet; `applyMarks` discards it, and acking it anyway would delete it before it could ever be
    // shown — every day, in one direction, silently. It stays on the relay for the next pull.
    const rows = [
      { id: 'f'.repeat(32), pairId: PAIR, day: '2026-09-16' as PrayerDay, prayer: 'asr' as const, state: 'prayed' as const },
    ];
    const { relay, acked } = fakeRelay({ fetchInbox: async () => ok(rows) });
    enableBuddies();

    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(acked).toEqual([]);
    expect(useBuddyStore.getState().marks.asr).toEqual([]);
  });

  it('acknowledges only the flags it applied, when a batch holds both', async () => {
    const rows = [
      { id: 'a'.repeat(32), pairId: PAIR, day: TODAY, prayer: 'asr' as const, state: 'prayed' as const },
      { id: 'b'.repeat(32), pairId: PAIR, day: '2026-09-16' as PrayerDay, prayer: 'isha' as const, state: 'prayed' as const },
    ];
    const { relay, acked } = fakeRelay({ fetchInbox: async () => ok(rows) });
    enableBuddies();

    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    await waitFor(() => expect(acked).toEqual([['a'.repeat(32)]]));
    expect(useBuddyStore.getState().marks.asr).toEqual([PAIR]);
    expect(useBuddyStore.getState().marks.isha).toEqual([]);
  });

  it('switches buddy mode off when the relay says this phone is unknown to it', async () => {
    const { relay } = fakeRelay({ fetchInbox: async () => ({ ok: false, reason: 'gone' }) });
    enableBuddies();

    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    await waitFor(() => expect(useBuddyStore.getState().enabled).toBe(false));
  });

  it('ends one link when a send says that pair is gone, and keeps the rest', async () => {
    // A pair the relay has forgotten is also absent from the roster — the fake has to agree with
    // itself, or the reconcile puts back what the failed send just removed.
    const { relay } = fakeRelay({
      send: async () => ({ ok: false, reason: 'gone' }),
      listPairs: async () => ok([]),
    });
    enableBuddies();

    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));
    seedTracking({ maghrib: 'prayed' });

    await waitFor(() => expect(useBuddyStore.getState().pairs).toEqual([]));
    expect(useBuddyStore.getState().endedPairs).toEqual([PAIR]);
    // Still on: one link ending is not a reason to tear the feature down.
    expect(useBuddyStore.getState().enabled).toBe(true);
  });
});

describe('waiting for an invite to be taken', () => {
  it('asks the roster every few seconds while an invite is out, not only the inbox', async () => {
    // The `paired` push is data-only and iOS does not promise to deliver it to an app in front, so
    // an inviter watching their code would otherwise see nothing happen. This is what makes the
    // code collapse into the new buddy within seconds rather than on the next foreground.
    jest.useFakeTimers();
    // The poll only runs for an app in front; Jest's AppState reports nothing until told.
    (AppState as { currentState: string }).currentState = 'active';
    try {
      const listPairs = jest.fn(async () => ok([] as string[]));
      const { relay } = fakeRelay({ listPairs });
      enableBuddies();
      useBuddyStore.getState().actions.setInvite({ code: 'ABCD2345', expiresAt: Date.now() + 86_400_000 });
      await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));
      await act(async () => {});
      const before = listPairs.mock.calls.length;

      await act(async () => {
        jest.advanceTimersByTime(4_100);
      });
      await act(async () => {});
      expect(listPairs.mock.calls.length).toBeGreaterThan(before);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves the roster alone on the timer once no invite is out', async () => {
    jest.useFakeTimers();
    (AppState as { currentState: string }).currentState = 'active';
    try {
      const listPairs = jest.fn(async () => ok([] as string[]));
      const { relay } = fakeRelay({ listPairs });
      enableBuddies();
      await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));
      await act(async () => {});
      const before = listPairs.mock.calls.length;

      await act(async () => {
        jest.advanceTimersByTime(4_100);
      });
      await act(async () => {});
      expect(listPairs.mock.calls.length).toBe(before);
    } finally {
      jest.useRealTimers();
    }
  });

  it('tells the inviter by notification only when the app is out of sight', async () => {
    // In front, the "new buddy" sheet says it; a notification on top would be the news twice.
    (AppState as { currentState: string }).currentState = 'active';
    const NEW = 'b'.repeat(32);
    const { relay } = fakeRelay({ listPairs: async () => ok([PAIR, NEW]) });
    enableBuddies();
    useBuddyStore.getState().actions.setInviteFor({ icon: 'star', color: 'brick', nickname: 'Yusuf' });
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    await waitFor(() => expect(useBuddyStore.getState().pairs.map((p) => p.pairId)).toContain(NEW));
    expect(useBuddyStore.getState().justPaired).toEqual([NEW]);
    expect(mockNotifyAccepted).not.toHaveBeenCalled();
  });

  it('does tell the inviter by notification when the app is in the background', async () => {
    (AppState as { currentState: string }).currentState = 'background';
    try {
      const NEW = 'c'.repeat(32);
      const { relay } = fakeRelay({ listPairs: async () => ok([PAIR, NEW]) });
      enableBuddies();
      useBuddyStore.getState().actions.setInviteFor({ icon: 'star', color: 'brick', nickname: 'Yusuf' });
      await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

      await waitFor(() => expect(mockNotifyAccepted).toHaveBeenCalled());
      expect(mockNotifyAccepted.mock.calls[0]?.[0]).toBe('Yusuf accepted');
    } finally {
      (AppState as { currentState: string }).currentState = 'active';
    }
  });
});

describe('what a widget needs in order to send by itself (D180)', () => {
  it('leaves the roster where the widget can read it, and keeps it current', async () => {
    const { relay } = fakeRelay();
    enableBuddies();
    const view = await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    await waitFor(() => expect(mockWriteOutbox).toHaveBeenCalled());
    expect(mockWriteOutbox.mock.calls.at(-1)?.[0]).toMatchObject({ pairs: [{ pairId: PAIR, notify: true }] });

    // Async, like every other act in this file: a synchronous act with async work still in flight
    // leaves React's act queue open, and nothing rendered by the tests after it ever mounts.
    await act(async () => {
      useBuddyStore.getState().actions.setNotify(false);
    });
    await waitFor(() => expect(mockWriteOutbox.mock.calls.at(-1)?.[0]).toMatchObject({ notify: false }));
    await act(async () => {
      view.unmount();
    });
  });

  it('does not tell the buddies twice about a prayer the widget already told them about', async () => {
    const { relay, sent } = fakeRelay();
    enableBuddies();
    // The widget sent Dhuhr while the app was closed and wrote it down; the app opens with the log
    // already showing Dhuhr prayed.
    mockWidgetSent = [{ day: TODAY, prayer: 'dhuhr', state: 'prayed', at: 1 }];
    seedTracking({ dhuhr: 'prayed' });
    useBuddyStore.setState((state) => ({ ...state, seedPending: false }));

    const view = await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));
    await waitFor(() => expect(useBuddyStore.getState().sent).toMatchObject({ dhuhr: 'prayed' }));
    // Let the reconciliation that follows the absorb finish before looking.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(sent.filter((request) => request.prayer === 'dhuhr')).toHaveLength(0);
    await act(async () => {
      view.unmount();
    });
  });

  it('ignores a widget line from another day, and still tells the buddies today', async () => {
    // A seal tapped on yesterday's widget row, discovered this morning: it must not mark today's
    // Dhuhr as already told. Yesterday's own send either happened in the widget or is gone.
    const { relay, sent } = fakeRelay();
    enableBuddies();
    mockWidgetSent = [{ day: '2026-09-14', prayer: 'dhuhr', state: 'prayed', at: 1 }];
    seedTracking({ dhuhr: 'prayed' });
    useBuddyStore.setState((state) => ({ ...state, seedPending: false }));

    const view = await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));
    await waitFor(() => expect(sent.some((request) => request.prayer === 'dhuhr')).toBe(true));
    await act(async () => {
      view.unmount();
    });
  });

  it('forgets the outbox when buddy mode is switched off', async () => {
    // The production path: the root layout passes `startup.done && buddyEnabled`, so switching the
    // feature off flips the argument to false and the effect winds down with the store already off.
    const { relay } = fakeRelay();
    enableBuddies();
    const auth = credentials();
    const view = await renderHook(
      (props: { on: boolean }) => useBuddySync(props.on, { relay, credentials: auth }),
      { initialProps: { on: true } }
    );
    await waitFor(() => expect(mockWriteOutbox).toHaveBeenCalled());

    await act(async () => {
      useBuddyStore.getState().actions.setEnabled(false);
    });
    await act(async () => {
      view.rerender({ on: false });
    });
    await waitFor(() => expect(mockClearOutbox).toHaveBeenCalled());
  });
});

describe('a slow network never holds a mark back (D194)', () => {
  it('sends a mark before it asks the roster or the inbox', async () => {
    const order: string[] = [];
    const { relay } = fakeRelay({
      send: async () => {
        order.push('send');
        return ok(null);
      },
      listPairs: async () => {
        order.push('roster');
        return ok([PAIR]);
      },
      fetchInbox: async () => {
        order.push('inbox');
        return ok([]);
      },
    });
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));
    await waitFor(() => expect(order).toContain('inbox'));
    order.length = 0;

    seedTracking({ maghrib: 'prayed' });

    await waitFor(() => expect(order).toContain('inbox'));
    expect(order[0]).toBe('send');
  });

  it('still sends when the push token never comes', async () => {
    // `getExpoPushTokenAsync` has no timeout of its own. When it hung inside the sync, nothing of
    // this phone's left again until the app was killed.
    jest.mocked(getBuddyPushToken).mockReturnValue(new Promise<string | null>(() => undefined));
    const { relay, sent } = fakeRelay();
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'prayed' });
    await waitFor(() => expect(sent).toHaveLength(1));
    seedTracking({ maghrib: 'prayed', isha: 'prayed' });
    await waitFor(() => expect(sent).toHaveLength(2));
  });

  it('gives up on a sync that never finishes, so the next one can run', async () => {
    jest.useFakeTimers();
    try {
      let hang = true;
      const { relay, sent } = fakeRelay({
        listPairs: () => (hang ? new Promise(() => undefined) : Promise.resolve(ok([PAIR]))),
      });
      enableBuddies();
      await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));
      await act(async () => {});
      hang = false;

      // Marked while the first sync is stuck: queued behind it, not lost.
      seedTracking({ maghrib: 'prayed' });
      await act(async () => {});
      expect(sent).toHaveLength(0);

      await act(async () => {
        jest.advanceTimersByTime(60_001);
      });
      await act(async () => {});
      expect(sent.map((request) => request.prayer)).toEqual(['maghrib']);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the push token (D194)', () => {
  const TOKEN = 'ExponentPushToken[abc]';

  it('asks for it once, not on every sync', async () => {
    jest.mocked(getBuddyPushToken).mockResolvedValue(TOKEN);
    const { relay, sent } = fakeRelay();
    enableBuddies();
    await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));

    seedTracking({ maghrib: 'prayed' });
    seedTracking({ maghrib: 'prayed', isha: 'prayed' });
    await waitFor(() => expect(sent).toHaveLength(2));

    expect(getBuddyPushToken).toHaveBeenCalledTimes(1);
  });

  it('hands an unchanged token to the relay once per launch, then once a day', async () => {
    // The relay forgets a token Expo calls dead, and cannot use one it can no longer decrypt. A
    // token that only went up when it changed was never sent again to heal either.
    jest.useFakeTimers();
    try {
      jest.mocked(getBuddyPushToken).mockResolvedValue(TOKEN);
      const setPushToken = jest.fn(async () => ok(null));
      const { relay } = fakeRelay({ setPushToken });
      enableBuddies();
      useBuddyStore.setState((state) => ({ ...state, pushToken: TOKEN }));
      await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));
      await act(async () => {});
      expect(setPushToken).toHaveBeenCalledTimes(1);

      // Another sync the same day: nothing to heal.
      await act(async () => {
        seedTracking({ maghrib: 'prayed' });
        jest.advanceTimersByTime(MARK_SETTLE_MS);
      });
      await act(async () => {});
      expect(setPushToken).toHaveBeenCalledTimes(1);

      // A day later, the process still alive.
      jest.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);
      await act(async () => {
        seedTracking({ maghrib: 'prayed', isha: 'prayed' });
        jest.advanceTimersByTime(MARK_SETTLE_MS);
      });
      await act(async () => {});
      expect(setPushToken).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('asks again after a minute when there was no token to be had', async () => {
    jest.useFakeTimers();
    try {
      const { relay } = fakeRelay();
      enableBuddies();
      await renderHook(() => useBuddySync(true, { relay, credentials: credentials() }));
      await act(async () => {});
      seedTracking({ maghrib: 'prayed' });
      await act(async () => {
        jest.advanceTimersByTime(MARK_SETTLE_MS);
      });
      expect(getBuddyPushToken).toHaveBeenCalledTimes(1);

      jest.setSystemTime(Date.now() + 60_001);
      seedTracking({ maghrib: 'prayed', isha: 'prayed' });
      await act(async () => {
        jest.advanceTimersByTime(MARK_SETTLE_MS);
      });
      expect(getBuddyPushToken).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
