/**
 * Tests for the buddy store.
 *
 * Two themes run through these: state that is thrown away when it should be (a new day, a removed
 * buddy, buddy mode switched off), and storage being treated as hostile — a persisted payload can
 * be older than the app, half-written, or somebody's idea of a joke.
 */

import { NO_BUDDY_MARKS, type BuddyMark } from '../domain/buddies';
import type { PrayerDay } from '../domain/types';
import {
  createBuddyStore,
  createMemoryBuddyStorage,
  sanitizeBuddyState,
  sanitizeNickname,
  type BuddyStore,
} from './buddyStore';
import type { StoreApi, UseBoundStore } from 'zustand';

const TODAY = '2026-09-15' as PrayerDay;
const YESTERDAY = '2026-09-14' as PrayerDay;
const AMINA = 'a'.repeat(32);
const YUSUF = 'b'.repeat(32);

type Store = UseBoundStore<StoreApi<BuddyStore>>;

function freshStore(seed?: Record<string, string>): Store {
  return createBuddyStore(createMemoryBuddyStorage(seed));
}

function withPair(store: Store, pairId = AMINA): void {
  store.getState().actions.setEnabled(true);
  store.getState().actions.addPair({ pairId, nickname: 'Amina' }, 1_000);
}

function mark(overrides: Partial<BuddyMark> = {}): BuddyMark {
  return { pairId: AMINA, day: TODAY, prayer: 'maghrib', state: 'prayed', ...overrides };
}

describe('buddy mode is off until somebody asks for it', () => {
  it('starts off, with nothing in it', () => {
    const store = freshStore();
    expect(store.getState().enabled).toBe(false);
    expect(store.getState().pairs).toEqual([]);
    expect(store.getState().deviceId).toBeNull();
  });

  it('wants to notify by default, once it is on at all', () => {
    expect(freshStore().getState().notify).toBe(true);
  });

  it('forgets everything when it is switched off', () => {
    const store = freshStore();
    withPair(store);
    store.getState().actions.setDeviceId('c'.repeat(32));
    store.getState().actions.receive([mark()], TODAY);

    store.getState().actions.setEnabled(false);

    // Not "kept in case they come back". Somebody who turns this off has asked their phone to
    // stop holding a list of who they pray with.
    const state = store.getState();
    expect(state.pairs).toEqual([]);
    expect(state.deviceId).toBeNull();
    expect(state.marks).toBe(NO_BUDDY_MARKS);
    expect(state.day).toBeNull();
    expect(state.invite).toBeNull();
  });
});

describe('pairs', () => {
  it('adds a buddy, and never the same one twice', () => {
    const store = freshStore();
    withPair(store);
    store.getState().actions.addPair({ pairId: AMINA, nickname: 'Again' }, 2_000);
    expect(store.getState().pairs).toHaveLength(1);
  });

  it('stops at five', () => {
    const store = freshStore();
    store.getState().actions.setEnabled(true);
    for (let i = 0; i < 7; i += 1) {
      store.getState().actions.addPair({ pairId: String(i).repeat(32).slice(0, 32) }, i);
    }
    expect(store.getState().pairs).toHaveLength(5);
  });

  it('names a buddy who was added without one', () => {
    const store = freshStore();
    store.getState().actions.setEnabled(true);
    store.getState().actions.addPair({ pairId: AMINA, pending: true }, 1_000);
    expect(store.getState().pairs[0]?.pending).toBe(true);

    store.getState().actions.namePair(AMINA, { icon: 'star', color: 'plum', nickname: '  Amina  ' });

    const pair = store.getState().pairs[0];
    expect(pair).toMatchObject({ icon: 'star', color: 'plum', nickname: 'Amina', pending: false });
  });

  it('remembers what a buddy phone said about itself, so we can address it properly', () => {
    const store = freshStore();
    withPair(store);
    store.getState().actions.rememberBuddyPreferences(AMINA, 'ar', false);

    expect(store.getState().pairs[0]).toMatchObject({ lang: 'ar', notify: false });
  });

  it('takes a removed buddy off the rows at once, without waiting for a sync', () => {
    const store = freshStore();
    withPair(store);
    store.getState().actions.receive([mark()], TODAY);
    expect(store.getState().marks.maghrib).toEqual([AMINA]);

    store.getState().actions.removePair(AMINA);

    expect(store.getState().pairs).toEqual([]);
    expect(store.getState().marks.maghrib).toEqual([]);
  });

  it('a link the relay says is gone is remembered just long enough to say so once', () => {
    const store = freshStore();
    withPair(store);

    store.getState().actions.endPair(AMINA);
    expect(store.getState().pairs).toEqual([]);
    expect(store.getState().endedPairs).toEqual([AMINA]);

    store.getState().actions.acknowledgeEnded(AMINA);
    expect(store.getState().endedPairs).toEqual([]);
  });

  it('says nothing about a link that ended and was never ours', () => {
    const store = freshStore();
    store.getState().actions.setEnabled(true);
    store.getState().actions.endPair(YUSUF);
    expect(store.getState().endedPairs).toEqual([]);
  });

  it('removing a buddy also drops any pending "link ended" for them', () => {
    const store = freshStore();
    withPair(store);
    store.getState().actions.endPair(AMINA);
    store.getState().actions.removePair(AMINA);
    expect(store.getState().endedPairs).toEqual([]);
  });
});

describe('a roster photograph that has been overtaken', () => {
  it('is dropped rather than resurrecting a buddy the user just removed', async () => {
    const store = freshStore();
    withPair(store);
    // What the relay answered, fetched before the removal reached it.
    const epoch = store.getState().epoch;

    store.getState().actions.removePair(AMINA);
    store.getState().actions.reconcilePairs([AMINA], 2_000, epoch);

    expect(store.getState().pairs).toEqual([]);
    // And no "a buddy link ended" for somebody the user deliberately removed.
    expect(store.getState().endedPairs).toEqual([]);
  });

  it('is dropped rather than deleting a buddy who was just accepted', async () => {
    const store = freshStore();
    store.getState().actions.setEnabled(true);
    const epoch = store.getState().epoch;

    store.getState().actions.addPair({ pairId: YUSUF, nickname: 'Yusuf' }, 1_000);
    // An answer from before the pairing: it does not know about Yusuf yet.
    store.getState().actions.reconcilePairs([], 2_000, epoch);

    expect(store.getState().pairs.map((pair) => pair.pairId)).toEqual([YUSUF]);
  });

  it('gives a new pair the name the inviter chose before sharing the code', () => {
    const store = freshStore();
    store.getState().actions.setEnabled(true);
    store.getState().actions.setInviteFor({ icon: 'star', color: 'plum', nickname: 'Amina' });

    store.getState().actions.reconcilePairs([AMINA], 2_000, store.getState().epoch);

    const pair = store.getState().pairs[0]!;
    expect(pair).toMatchObject({ nickname: 'Amina', icon: 'star', color: 'plum' });
    // Already named, so the screen does not ask again.
    expect(pair.pending).toBe(false);
    expect(store.getState().inviteFor).toBeNull();
  });

  it('still asks about a pair that arrived without an invite of ours', () => {
    const store = freshStore();
    store.getState().actions.setEnabled(true);

    store.getState().actions.reconcilePairs([AMINA], 2_000, store.getState().epoch);

    expect(store.getState().pairs[0]?.pending).toBe(true);
  });

  it('is applied when nothing happened while it was in flight', () => {
    const store = freshStore();
    withPair(store);

    store.getState().actions.reconcilePairs([AMINA, YUSUF], 2_000, store.getState().epoch);

    expect(store.getState().pairs.map((pair) => pair.pairId)).toEqual([AMINA, YUSUF]);
    // The one it did not know about arrives unnamed, waiting to be asked about.
    expect(store.getState().pairs[1]?.pending).toBe(true);
  });

  it('removes a link the relay no longer lists, and says so once', () => {
    const store = freshStore();
    withPair(store);

    store.getState().actions.reconcilePairs([], 2_000, store.getState().epoch);

    expect(store.getState().pairs).toEqual([]);
    expect(store.getState().endedPairs).toEqual([AMINA]);
  });
});

describe('marks', () => {
  it('records a buddy on the prayer they marked', () => {
    const store = freshStore();
    withPair(store);
    store.getState().actions.receive([mark()], TODAY);
    expect(store.getState().marks.maghrib).toEqual([AMINA]);
    expect(store.getState().day).toBe(TODAY);
  });

  it('ignores a flag from somebody this phone is not paired with', () => {
    const store = freshStore();
    withPair(store);
    store.getState().actions.receive([mark({ pairId: YUSUF })], TODAY);
    expect(store.getState().marks.maghrib).toEqual([]);
  });

  it('empties yesterday rather than filing it', () => {
    const store = freshStore();
    withPair(store);
    store.getState().actions.receive([mark({ day: YESTERDAY })], YESTERDAY);
    expect(store.getState().marks.maghrib).toEqual([AMINA]);

    store.getState().actions.syncDay(TODAY);

    // There is no history in this feature, and this is where that is enforced at runtime.
    expect(store.getState().marks).toBe(NO_BUDDY_MARKS);
    expect(store.getState().day).toBe(TODAY);
  });

  it('a day that has not turned leaves the rows alone', () => {
    const store = freshStore();
    withPair(store);
    store.getState().actions.receive([mark()], TODAY);
    store.getState().actions.syncDay(TODAY);
    expect(store.getState().marks.maghrib).toEqual([AMINA]);
  });

  it('receiving on a new day drops what was carried from the old one', () => {
    const store = freshStore();
    withPair(store);
    store.getState().actions.receive([mark({ day: YESTERDAY })], YESTERDAY);

    store.getState().actions.receive([mark({ prayer: 'fajr' })], TODAY);

    expect(store.getState().marks.maghrib).toEqual([]);
    expect(store.getState().marks.fajr).toEqual([AMINA]);
  });
});

describe('storage is not trusted', () => {
  it('reads a rubbish payload as an empty state rather than throwing', () => {
    for (const rubbish of [null, 42, 'nope', [], { pairs: 'lots' }]) {
      const state = sanitizeBuddyState(rubbish);
      expect(state.enabled).toBe(false);
      expect(state.pairs).toEqual([]);
    }
  });

  it('drops a stored pair with no usable id', () => {
    const state = sanitizeBuddyState({ pairs: [{ nickname: 'Ghost' }, { pairId: 'short' }, { pairId: AMINA }] });
    expect(state.pairs.map((pair) => pair.pairId)).toEqual([AMINA]);
  });

  it('replaces an icon or colour the app no longer has with one it does', () => {
    const state = sanitizeBuddyState({ pairs: [{ pairId: AMINA, icon: 'dragon', color: 'neon' }] });
    // Initials is the first entry and the default face, so an unknown icon falls back to it.
    expect(state.pairs[0]?.icon).toBe('initials');
    expect(state.pairs[0]?.color).toBe('ocean');
  });

  it('never restores more than five buddies, however many were written', () => {
    const pairs = Array.from({ length: 9 }, (_, i) => ({ pairId: String(i).repeat(32).slice(0, 32) }));
    expect(sanitizeBuddyState({ pairs }).pairs).toHaveLength(5);
  });

  it('drops marks belonging to buddies that are no longer in the roster', () => {
    const state = sanitizeBuddyState({
      day: TODAY,
      pairs: [{ pairId: AMINA }],
      marks: { ...NO_BUDDY_MARKS, maghrib: [AMINA, YUSUF, 42] },
    });
    expect(state.marks.maghrib).toEqual([AMINA]);
  });

  it('drops every mark when the stored day is unusable', () => {
    const state = sanitizeBuddyState({
      day: 'not-a-day',
      pairs: [{ pairId: AMINA }],
      marks: { ...NO_BUDDY_MARKS, maghrib: [AMINA] },
    });
    expect(state.day).toBeNull();
    expect(state.marks).toBe(NO_BUDDY_MARKS);
  });

  it('survives a storage backend that throws', () => {
    const angry = {
      getItem() {
        throw new Error('keychain on fire');
      },
      setItem() {
        throw new Error('still on fire');
      },
      removeItem() {
        throw new Error('fire');
      },
    };

    const store = createBuddyStore(angry);
    expect(store.getState().enabled).toBe(false);
    expect(() => store.getState().actions.setEnabled(true)).not.toThrow();
    expect(store.getState().enabled).toBe(true);
  });

  it('restores what it wrote', () => {
    const storage = createMemoryBuddyStorage();
    const first = createBuddyStore(storage);
    first.getState().actions.setEnabled(true);
    first.getState().actions.addPair({ pairId: AMINA, nickname: 'Amina', icon: 'star' }, 1_000);

    const second = createBuddyStore(storage);
    expect(second.getState().enabled).toBe(true);
    expect(second.getState().pairs[0]).toMatchObject({ pairId: AMINA, nickname: 'Amina', icon: 'star' });
  });
});

describe('sanitizeNickname', () => {
  it('trims, collapses runs of space, and caps the length', () => {
    expect(sanitizeNickname('  Amina   Bint  ')).toBe('Amina Bint');
    expect(sanitizeNickname('x'.repeat(50))).toHaveLength(24);
  });

  it('answers empty for anything that is not a string', () => {
    expect(sanitizeNickname(undefined)).toBe('');
    expect(sanitizeNickname(42)).toBe('');
  });
});

describe('the moment an invite is accepted', () => {
  it('is remembered until it has been seen, and only while the buddy is still there', () => {
    const store = freshStore();
    store.getState().actions.setEnabled(true);
    store.getState().actions.setInviteFor({ icon: 'crescent', color: 'ocean', nickname: 'Amina' });
    store.getState().actions.reconcilePairs([AMINA], 1_000, store.getState().epoch);

    expect(store.getState().justPaired).toEqual([AMINA]);
    expect(store.getState().pairs[0]).toMatchObject({ nickname: 'Amina', pending: false });

    store.getState().actions.acknowledgePaired(AMINA);
    expect(store.getState().justPaired).toEqual([]);
  });

  it('is forgotten with the buddy, whichever side ends it', () => {
    const store = freshStore();
    store.getState().actions.setEnabled(true);
    store.getState().actions.reconcilePairs([AMINA], 1_000, store.getState().epoch);
    expect(store.getState().justPaired).toEqual([AMINA]);

    store.getState().actions.removePair(AMINA);
    expect(store.getState().justPaired).toEqual([]);
  });

  it('survives a relaunch, but not the buddy leaving in between', () => {
    const store = freshStore();
    store.getState().actions.setEnabled(true);
    store.getState().actions.reconcilePairs([AMINA], 1_000, store.getState().epoch);
    const raw = JSON.parse(
      JSON.stringify({ state: { ...store.getState(), actions: undefined } })
    ) as { state: Record<string, unknown> };

    const again = freshStore({ buddyState: JSON.stringify(raw) });
    expect(again.getState().justPaired).toEqual([AMINA]);

    raw.state.pairs = [];
    const gone = freshStore({ buddyState: JSON.stringify(raw) });
    expect(gone.getState().justPaired).toEqual([]);
  });
});

describe('what a widget already said', () => {
  it('is folded into the ledger for today, so the app does not say it again', () => {
    const store = freshStore();
    store.getState().actions.setEnabled(true);
    store.getState().actions.syncDay('2026-09-16' as PrayerDay);

    store.getState().actions.absorbSent('2026-09-16' as PrayerDay, [{ prayer: 'dhuhr', state: 'prayed' }]);
    expect(store.getState().sent).toEqual({ dhuhr: 'prayed' });
  });

  it('is ignored when it belongs to another day', () => {
    const store = freshStore();
    store.getState().actions.setEnabled(true);
    store.getState().actions.syncDay('2026-09-16' as PrayerDay);

    store.getState().actions.absorbSent('2026-09-15' as PrayerDay, [{ prayer: 'dhuhr', state: 'prayed' }]);
    expect(store.getState().sent).toEqual({});
  });
});
