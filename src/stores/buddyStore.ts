/**
 * Buddy mode's state: who you are paired with, what you call them, and which of today's prayers
 * they have marked.
 *
 * ## Why this is its own store, and must stay its own store
 *
 * The obvious place for "which prayers have been marked" is `trackingStore`. It would be wrong.
 * `useWidgetSync` subscribes to the whole of that store and fans it out to the home-screen widgets,
 * the Apple Watch, the Wear tile and the Live Activity — so buddy state living there would reach a
 * lock screen automatically, without anybody deciding it should. D101 says a lock screen must never
 * carry a tracking mark, because it is read without unlocking; that goes double for a *second
 * person's* mark, which is not this phone's to display to whoever picks it up. Buddy state is Today
 * tab only (D174), and keeping it in a store nothing else subscribes to is what makes that true by
 * construction rather than by everybody remembering.
 *
 * ## What is here and what is not
 *
 * Here: the pair ids, the icon/colour/nickname **you** chose for each buddy, their cached language
 * and notification preference, today's marks, and the invite currently on screen. All of it is
 * local; none of it was given to us by the relay or by the buddy's phone, except the pair id.
 *
 * Not here: the device secret, which lives in the keychain (`services/buddyCredentials.ts`) because
 * it is the one value worth stealing. And no history: {@link BuddyState.day} is what today's marks
 * belong to, and a different day empties them rather than filing them.
 *
 * MMKV for the same reason as the settings (D13): the Today screen reads this during its first
 * render, and an async rehydrate would show empty rows and then pop the avatars in.
 */

import { useMemo } from 'react';

import { castDraft } from 'immer';
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/react/shallow';

import {
  BUDDY_COLORS,
  BUDDY_ICONS,
  BUDDY_LIMIT,
  NO_BUDDY_MARKS,
  applyMarks,
  canAddBuddy,
  firstFreeAvatar,
  forgetPair,
  marksForDay,
  type BuddyColor,
  type BuddyIcon,
  type BuddyInvite,
  type BuddyMark,
  type BuddyMarks,
  type MarkState,
} from '../domain/buddies';
import { isValidDay } from '../domain/dates';
import { PRAYERS, type Prayer, type PrayerDay, type PrayerStatus } from '../domain/types';

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** One buddy, as this phone sees them. Every field but `pairId` was chosen or cached locally. */
export interface BuddyPair {
  /** The relay's random id for this link. The only thing here the relay also knows. */
  pairId: string;
  icon: BuddyIcon;
  color: BuddyColor;
  /** What **you** call them. It never leaves this phone, and they never learn it. */
  nickname: string;
  /**
   * Their language and whether they want to be told, cached from the last flag they sent. We use
   * these to address the next notification we send them — which is why the relay needs to hold
   * neither.
   */
  lang: string;
  notify: boolean;
  /**
   * True for an inviter between the moment the link is made and the moment they name the person.
   * A pending buddy is fully paired and their marks arrive; they just have no nickname yet.
   */
  pending: boolean;
  addedAt: number;
}

export interface BuddyState {
  /** Off until somebody turns it on in Settings. Nothing in the app mentions it before that. */
  enabled: boolean;
  /** "Tell me when a buddy prays". Sent to buddies so their phones can stay quiet. */
  notify: boolean;
  /** This phone's relay id. The secret half is in the keychain. */
  deviceId: string | null;
  pairs: BuddyPair[];
  /** The prayer day {@link marks} belong to. A different day empties them. */
  day: PrayerDay | null;
  marks: BuddyMarks;
  /**
   * What this phone has already told its buddies about **its own** prayers today, per prayer.
   *
   * It exists because "did this just change?" cannot be answered by diffing the tracking store
   * alone. That store's day cache starts empty and fills on load, so a cold start looks identical
   * to five prayers being marked at once — but a mark written by the notification's Prayed button
   * while the app was closed *also* arrives with an empty cache, and that one has to be sent. The
   * two are indistinguishable by shape and distinguishable by this: if we never told anybody, it
   * is new.
   */
  sent: Partial<Record<Prayer, MarkState>>;
  /** The invite currently on screen, if any. */
  invite: BuddyInvite | null;
  /**
   * The face and name chosen for whoever accepts the invite on screen.
   *
   * The inviter is asked who they are inviting **before** the code is shown, because that is the
   * moment they know the answer — they are looking at the person, or about to message them. When
   * the acceptance comes back, this is applied and the pair arrives already named, instead of the
   * inviter being asked about a stranger some hours later.
   */
  inviteFor: { icon: BuddyIcon; color: BuddyColor; nickname: string } | null;
  /**
   * Links that ended while we were not looking, kept only until the Buddies screen has said so
   * once. Never says who ended it or why — there is nothing to say and nobody to appeal to.
   */
  endedPairs: string[];
  /**
   * Bumped by every local change to the roster.
   *
   * A roster fetched from the relay is a photograph, and `reconcilePairs` trusts it absolutely —
   * adding what is missing and removing what is absent. If the photograph was taken before a local
   * add or remove, applying it resurrects a buddy the user just removed (and then announces "a
   * link ended" for them on the pass after), or deletes one they just accepted. Carrying the epoch
   * through the fetch is how an answer that has been overtaken is recognised and dropped.
   */
  epoch: number;
  /**
   * The push token last handed to the relay, so a rotation can be noticed without asking the relay
   * on every sync. An Expo or FCM token that rotates and is never re-registered ends notifications
   * permanently and silently.
   */
  pushToken: string | null;
  /**
   * Set when the roster goes from empty to not — the moment a first buddy arrives.
   *
   * Without it, the next mark of the day announces every prayer already logged: up to five flags
   * and five notifications landing at once, as a greeting. The ledger is seeded from the day's
   * record instead, so a new buddy starts seeing marks from the moment you paired. An empty row
   * means nothing arrived, which is exactly what it means everywhere else in this feature.
   */
  seedPending: boolean;
  /**
   * An invite code that arrived before this install could accept it.
   *
   * The website sends `/b/*` to the install page, so the very first open after installing is often
   * the one carrying the code — and that is the open the onboarding redirect takes over. Without
   * somewhere to put it, the primary way people share this feature fails the first time it is used.
   */
  pendingCode: string | null;
  /**
   * Buddies who have just arrived through an invite this phone made, and have not been shown yet.
   *
   * An acceptance can be discovered at any moment — while the inviter watches their code, or on a
   * cold launch three days later — and it deserves a moment of its own either way: "Amina is your
   * buddy now". Persisted, so a launch that discovers it and is killed before the sheet is seen
   * shows it next time. Emptied by {@link BuddyActions.acknowledgePaired}.
   */
  justPaired: string[];
  /**
   * Whether the invite sheet is on screen. Not persisted — it is a fact about this run, kept here
   * only so the global "new buddy" sheet can stay out of the way while the invite sheet shows the
   * same moment in place.
   */
  inviteSheetOpen: boolean;
}

export const EMPTY_BUDDY_STATE: BuddyState = {
  enabled: false,
  notify: true,
  deviceId: null,
  pairs: [],
  day: null,
  marks: NO_BUDDY_MARKS,
  sent: {},
  invite: null,
  inviteFor: null,
  endedPairs: [],
  epoch: 0,
  pushToken: null,
  seedPending: false,
  pendingCode: null,
  justPaired: [],
  inviteSheetOpen: false,
};

export const BUDDY_STORAGE_ID = 'simple-prayer-times.buddies';
const STORAGE_KEY = 'buddyState';
const NICKNAME_MAX = 24;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface BuddyStorage {
  getItem(key: string): string | null | undefined;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryBuddyStorage(seed?: Record<string, string>): BuddyStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

export function createMmkvBuddyStorage(): BuddyStorage {
  let instance: ReturnType<typeof import('react-native-mmkv').createMMKV> | null = null;
  const mmkv = () => {
    if (instance === null) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
      instance = createMMKV({ id: BUDDY_STORAGE_ID });
    }
    return instance;
  };
  return {
    getItem: (key) => mmkv().getString(key) ?? null,
    setItem: (key, value) => mmkv().set(key, value),
    removeItem: (key) => void mmkv().remove(key),
  };
}

// ---------------------------------------------------------------------------
// Trusting nothing from storage
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickId(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) ? value : null;
}

function pickIcon(value: unknown): BuddyIcon {
  return (BUDDY_ICONS as readonly string[]).includes(value as string)
    ? (value as BuddyIcon)
    : BUDDY_ICONS[0];
}

function pickColor(value: unknown): BuddyColor {
  return (BUDDY_COLORS as readonly string[]).includes(value as string)
    ? (value as BuddyColor)
    : BUDDY_COLORS[0];
}

/** Trim, cap, and drop anything that would let a stored value break a row's layout. */
export function sanitizeNickname(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, NICKNAME_MAX);
}

function sanitizePair(value: unknown): BuddyPair | null {
  if (!isRecord(value)) return null;
  const pairId = pickId(value.pairId);
  if (!pairId) return null;
  return {
    pairId,
    icon: pickIcon(value.icon),
    color: pickColor(value.color),
    nickname: sanitizeNickname(value.nickname),
    lang: typeof value.lang === 'string' && value.lang.length <= 12 ? value.lang : 'en',
    notify: pickBoolean(value.notify, true),
    pending: pickBoolean(value.pending, false),
    addedAt: typeof value.addedAt === 'number' && value.addedAt > 0 ? value.addedAt : 0,
  };
}

function sanitizeMarks(value: unknown, pairs: readonly BuddyPair[]): BuddyMarks {
  if (!isRecord(value)) return NO_BUDDY_MARKS;
  const known = new Set(pairs.map((pair) => pair.pairId));
  const next: Record<Prayer, readonly string[]> = { ...NO_BUDDY_MARKS };
  for (const prayer of PRAYERS) {
    const list = value[prayer];
    next[prayer] = Array.isArray(list)
      ? list.filter((id): id is string => typeof id === 'string' && known.has(id))
      : [];
  }
  return next;
}

function sanitizeSent(value: unknown): Partial<Record<Prayer, MarkState>> {
  if (!isRecord(value)) return {};
  const next: Partial<Record<Prayer, MarkState>> = {};
  for (const prayer of PRAYERS) {
    const state = value[prayer];
    if (state === 'prayed' || state === 'cleared') next[prayer] = state;
  }
  return next;
}

/** Rebuild a whole state from whatever was in storage: an older shape, a partial write, garbage. */
export function sanitizeBuddyState(value: unknown): BuddyState {
  if (!isRecord(value)) return { ...EMPTY_BUDDY_STATE };

  const pairs = (Array.isArray(value.pairs) ? value.pairs : [])
    .map(sanitizePair)
    .filter((pair): pair is BuddyPair => pair !== null)
    .slice(0, BUDDY_LIMIT);

  const invite = isRecord(value.invite) ? value.invite : null;
  const day = typeof value.day === 'string' && isValidDay(value.day) ? (value.day as PrayerDay) : null;

  return {
    enabled: pickBoolean(value.enabled, false),
    notify: pickBoolean(value.notify, true),
    deviceId: pickId(value.deviceId),
    pairs,
    day,
    marks: day === null ? NO_BUDDY_MARKS : sanitizeMarks(value.marks, pairs),
    sent: day === null ? {} : sanitizeSent(value.sent),
    invite:
      invite && typeof invite.code === 'string' && typeof invite.expiresAt === 'number'
        ? { code: invite.code, expiresAt: invite.expiresAt }
        : null,
    inviteFor: isRecord(value.inviteFor)
      ? {
          icon: pickIcon(value.inviteFor.icon),
          color: pickColor(value.inviteFor.color),
          nickname: sanitizeNickname(value.inviteFor.nickname),
        }
      : null,
    endedPairs: (Array.isArray(value.endedPairs) ? value.endedPairs : [])
      .map(pickId)
      .filter((id): id is string => id !== null)
      // Capped like `pairs`: there can never be more ended links pending than buddies allowed.
      .slice(-BUDDY_LIMIT),
    // Deliberately not restored: an epoch only has meaning within one run, and a fetch cannot have
    // been in flight across a launch.
    epoch: 0,
    pushToken: typeof value.pushToken === 'string' ? value.pushToken : null,
    seedPending: pickBoolean(value.seedPending, false),
    pendingCode:
      typeof value.pendingCode === 'string' && /^[0-9A-Z]{8}$/.test(value.pendingCode)
        ? value.pendingCode
        : null,
    // Only ids that are still on the roster: a buddy removed before the sheet was seen is not news.
    justPaired: (Array.isArray(value.justPaired) ? value.justPaired : [])
      .map(pickId)
      .filter((id): id is string => id !== null && pairs.some((pair) => pair.pairId === id)),
    inviteSheetOpen: false,
  };
}

function jsonPersistStorage(storage: BuddyStorage): PersistStorage<BuddyState> {
  return {
    getItem: (name) => {
      let raw: string | null | undefined;
      try {
        raw = storage.getItem(name);
      } catch {
        return null;
      }
      if (typeof raw !== 'string' || raw.length === 0) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) return null;
        return { state: parsed.state as BuddyState, version: 0 };
      } catch {
        return null;
      }
    },
    setItem: (name, value: StorageValue<BuddyState>) => {
      try {
        storage.setItem(name, JSON.stringify(value));
      } catch {
        // A failed write must never break a mark. The value stays in memory for this session.
      }
    },
    removeItem: (name) => {
      try {
        storage.removeItem(name);
      } catch {
        // Already forgotten in memory, which is what the caller asked for.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface BuddyActions {
  /** Turning it off forgets everything: the pairs, the marks, the id. Nothing is kept "in case". */
  setEnabled(enabled: boolean): void;
  setNotify(notify: boolean): void;
  setDeviceId(deviceId: string | null): void;
  setInvite(invite: BuddyInvite | null): void;
  /** Who the invite on screen is for, chosen before it is shared. */
  setInviteFor(details: { icon: BuddyIcon; color: BuddyColor; nickname: string } | null): void;
  /**
   * Record a new link. `pending` means "we do not know what to call them yet" — true for the
   * inviter, who is told by a silent push and names them at the next opportunity.
   */
  addPair(pair: Pick<BuddyPair, 'pairId'> & Partial<BuddyPair>, at: number): void;
  /** Give a pending buddy their face and name. */
  namePair(pairId: string, details: { icon: BuddyIcon; color: BuddyColor; nickname: string }): void;
  /** Cache what a buddy's own phone told us about itself, so we can address them properly. */
  rememberBuddyPreferences(pairId: string, lang: string, notify: boolean): void;
  /** Remove a buddy, with their marks. Telling the relay is the caller's job. */
  removePair(pairId: string): void;
  /** The relay says this link is gone. Same as removing, but the screen says so once. */
  endPair(pairId: string): void;
  acknowledgeEnded(pairId: string): void;
  /** Hold an invite code that arrived before the app was ready to accept it. */
  setPendingCode(code: string | null): void;
  /** The "new buddy" moment for this pair has been seen. */
  acknowledgePaired(pairId: string): void;
  setInviteSheetOpen(open: boolean): void;
  /**
   * Fold in what a home-screen widget already told the buddies, so the next reconciliation does
   * not say it again. Entries for another day are ignored: the ledger belongs to `day`.
   */
  absorbSent(day: PrayerDay, marks: readonly { prayer: Prayer; state: MarkState }[]): void;
  /** Remember the push token the relay now has, so a rotation is noticed. */
  setPushToken(token: string | null): void;
  /**
   * Treat today's already-logged prayers as told, without telling anybody.
   *
   * Used once, when a first buddy arrives, so pairing at noon does not greet them with every
   * prayer of the morning at once.
   */
  seedSent(statuses: Readonly<Record<Prayer, PrayerStatus>>): void;
  /** Record that a buddy has been told this about one of *our* prayers today. */
  recordSent(prayer: Prayer, state: MarkState): void;
  /** Fold in flags from the inbox or a push. */
  receive(marks: readonly BuddyMark[], today: PrayerDay): void;
  /** Move to today, emptying yesterday's marks. Called on open and at the day boundary. */
  syncDay(today: PrayerDay): void;
  /**
   * Bring the roster into line with what the relay says this phone is linked to.
   *
   * A link the relay knows and this phone does not is one somebody just accepted — it arrives with
   * no name, because nobody has been asked yet. A link this phone shows and the relay does not has
   * been ended from the other side, and is reported as ended so the screen can say so once.
   */
  reconcilePairs(pairIds: readonly string[], at: number, epoch: number): void;
}

export type BuddyStore = BuddyState & { actions: BuddyActions };

export function createBuddyStore(storage: BuddyStorage = createMmkvBuddyStorage()) {
  return create<BuddyStore>()(
    persist(
      immer((set) => ({
        ...EMPTY_BUDDY_STATE,

        actions: {
          setEnabled(enabled) {
            set((state) => {
              state.enabled = enabled;
              if (!enabled) {
                // Off means off. Keeping the roster "for next time" would mean this phone still
                // held a list of who somebody prays with, after they asked it not to.
                state.pairs = [];
                state.marks = castDraft(NO_BUDDY_MARKS);
                state.sent = {};
                state.pushToken = null;
                state.seedPending = false;
                state.pendingCode = null;
                state.inviteFor = null;
                state.day = null;
                state.deviceId = null;
                state.invite = null;
                state.endedPairs = [];
                state.justPaired = [];
              }
            });
          },

          setNotify(notify) {
            set((state) => {
              state.notify = notify;
            });
          },

          setDeviceId(deviceId) {
            set((state) => {
              state.deviceId = deviceId;
            });
          },

          setInvite(invite) {
            set((state) => {
              state.invite = invite;
              if (invite === null) state.inviteFor = null;
            });
          },

          setInviteFor(details) {
            set((state) => {
              state.inviteFor = details;
            });
          },

          addPair(pair, at) {
            set((state) => {
              // Checked here as well as on rehydration: an id that passes at runtime but fails
              // `sanitizePair` would give somebody a buddy that works until they next open the app
              // and then disappears without explanation.
              if (pickId(pair.pairId) === null) return;
              if (state.pairs.some((entry) => entry.pairId === pair.pairId)) return;
              if (!canAddBuddy(state.pairs.length)) return;
              state.epoch += 1;
              if (state.pairs.length === 0) state.seedPending = true;
              state.pairs.push({
                pairId: pair.pairId,
                icon: pair.icon ?? BUDDY_ICONS[0],
                color: pair.color ?? BUDDY_COLORS[0],
                nickname: sanitizeNickname(pair.nickname),
                lang: pair.lang ?? 'en',
                notify: pair.notify ?? true,
                pending: pair.pending ?? false,
                addedAt: at,
              });
            });
          },

          namePair(pairId, details) {
            set((state) => {
              const pair = state.pairs.find((entry) => entry.pairId === pairId);
              if (!pair) return;
              pair.icon = details.icon;
              pair.color = details.color;
              pair.nickname = sanitizeNickname(details.nickname);
              pair.pending = false;
            });
          },

          rememberBuddyPreferences(pairId, lang, notify) {
            set((state) => {
              const pair = state.pairs.find((entry) => entry.pairId === pairId);
              if (!pair) return;
              pair.lang = lang;
              pair.notify = notify;
            });
          },

          removePair(pairId) {
            set((state) => {
              // Only a real membership change moves the epoch — but the rest runs regardless, so
              // that removing somebody also clears a "link ended" notice still queued for them.
              if (state.pairs.some((entry) => entry.pairId === pairId)) state.epoch += 1;
              state.pairs = state.pairs.filter((entry) => entry.pairId !== pairId);
              state.marks = castDraft(forgetPair(state.marks, pairId));
              state.endedPairs = state.endedPairs.filter((id) => id !== pairId);
              state.justPaired = state.justPaired.filter((id) => id !== pairId);
            });
          },

          endPair(pairId) {
            set((state) => {
              if (!state.pairs.some((entry) => entry.pairId === pairId)) return;
              state.epoch += 1;
              state.pairs = state.pairs.filter((entry) => entry.pairId !== pairId);
              state.marks = castDraft(forgetPair(state.marks, pairId));
              state.justPaired = state.justPaired.filter((id) => id !== pairId);
              if (!state.endedPairs.includes(pairId)) state.endedPairs.push(pairId);
            });
          },

          acknowledgeEnded(pairId) {
            set((state) => {
              state.endedPairs = state.endedPairs.filter((id) => id !== pairId);
            });
          },

          setPendingCode(code) {
            set((draft) => {
              draft.pendingCode = code;
            });
          },

          acknowledgePaired(pairId) {
            set((draft) => {
              draft.justPaired = draft.justPaired.filter((id) => id !== pairId);
            });
          },

          setInviteSheetOpen(open) {
            set((draft) => {
              draft.inviteSheetOpen = open;
            });
          },

          absorbSent(day, marks) {
            set((draft) => {
              if (draft.day !== day) return;
              for (const mark of marks) draft.sent[mark.prayer] = mark.state;
            });
          },

          setPushToken(token) {
            set((draft) => {
              draft.pushToken = token;
            });
          },

          seedSent(statuses) {
            set((draft) => {
              draft.seedPending = false;
              for (const prayer of PRAYERS) {
                const status = statuses[prayer];
                if (status === 'prayed' || status === 'late') draft.sent[prayer] = 'prayed';
              }
            });
          },

          recordSent(prayer, state) {
            set((draft) => {
              draft.sent[prayer] = state;
            });
          },

          receive(marks, today) {
            set((state) => {
              const carried = marksForDay(state.marks, state.day, today);
              if (state.day !== today) state.sent = {};
              state.day = today;
              state.marks = castDraft(
                applyMarks(
                  carried,
                  marks,
                  today,
                  state.pairs.map((pair) => pair.pairId)
                )
              );
            });
          },

          reconcilePairs(pairIds, at, epoch) {
            set((state) => {
              // The roster was overtaken by something the user did here. Applying it now would undo
              // that; the next pull carries a photograph taken after it instead.
              if (state.epoch !== epoch) return;

              const known = new Set(state.pairs.map((entry) => entry.pairId));

              for (const pairId of pairIds) {
                if (pickId(pairId) === null) continue;
                if (known.has(pairId)) continue;
                if (!canAddBuddy(state.pairs.length)) break;
                if (state.pairs.length === 0) state.seedPending = true;
                // Pending: paired for real, and waiting to be given a face and a name.
                const taken = state.pairs.map((entry) => ({ icon: entry.icon, color: entry.color }));
                const avatar = firstFreeAvatar(taken) ?? { icon: BUDDY_ICONS[0], color: BUDDY_COLORS[0] };
                // The code that made this pair is spent, and showing it beside "someone accepted
                // your invite" invites the user to share a code that can never work again.
                state.invite = null;

                // The inviter already said who this is, before they shared the code. Use it: being
                // asked to name a stranger hours after the fact is the thing that made pairing feel
                // one-directional.
                const chosen = state.inviteFor;
                state.inviteFor = null;
                state.pairs.push({
                  pairId,
                  icon: chosen?.icon ?? avatar.icon,
                  color: chosen?.color ?? avatar.color,
                  nickname: chosen?.nickname ?? '',
                  lang: 'en',
                  notify: true,
                  pending: chosen === null || chosen === undefined,
                  addedAt: at,
                });
                // Either way this is somebody accepting an invite this phone made — the only way
                // a pair can appear from the relay's side — and it gets its moment.
                state.justPaired.push(pairId);
              }

              const live = new Set(pairIds);
              const dropped = state.pairs.filter((entry) => !live.has(entry.pairId));
              for (const entry of dropped) {
                state.marks = castDraft(forgetPair(state.marks, entry.pairId));
                if (!state.endedPairs.includes(entry.pairId)) state.endedPairs.push(entry.pairId);
              }
              // Assigned only when something actually went. `filter` always returns a new array, so
              // an unconditional assignment made every sync a new root state — an MMKV write and a
              // Today re-render, several times a minute, for a roster that had not changed.
              if (dropped.length > 0) {
                state.pairs = state.pairs.filter((entry) => live.has(entry.pairId));
                state.justPaired = state.justPaired.filter((id) => live.has(id));
              }
            });
          },

          syncDay(today) {
            set((state) => {
              if (state.day === today) return;
              state.day = today;
              state.marks = castDraft(NO_BUDDY_MARKS);
              // A new day is a clean slate in both directions: nothing has been said about it yet.
              state.sent = {};
            });
          },
        },
      })),
      {
        name: STORAGE_KEY,
        storage: jsonPersistStorage(storage),
        version: 0,
        partialize: (state) => ({
          enabled: state.enabled,
          notify: state.notify,
          deviceId: state.deviceId,
          pairs: state.pairs,
          day: state.day,
          marks: state.marks,
          sent: state.sent,
          invite: state.invite,
          inviteFor: state.inviteFor,
          endedPairs: state.endedPairs,
          // Written so the persisted shape matches the state's; `sanitizeBuddyState` resets it to
          // zero on the way back in, because an epoch only means anything within a single run.
          epoch: state.epoch,
          pushToken: state.pushToken,
          seedPending: state.seedPending,
          pendingCode: state.pendingCode,
          justPaired: state.justPaired,
          // Written as `false` so the persisted shape matches the state's, like `epoch`: a sheet
          // cannot be open on a phone that has not launched yet.
          inviteSheetOpen: false,
        }),
        merge: (persisted, current) => ({ ...current, ...sanitizeBuddyState(persisted) }),
      }
    )
  );
}

export const useBuddyStore = createBuddyStore();

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const useBuddyActions = (): BuddyActions => useBuddyStore((state) => state.actions);

/** The same actions outside React — for the root layout, which runs before any screen mounts. */
export const getBuddyActions = (): BuddyActions => useBuddyStore.getState().actions;
export const useBuddyEnabled = (): boolean => useBuddyStore((state) => state.enabled);
export const useBuddyNotify = (): boolean => useBuddyStore((state) => state.notify);
export const useBuddyInvite = (): BuddyInvite | null => useBuddyStore((state) => state.invite);
export const useBuddyPairs = (): BuddyPair[] => useBuddyStore(useShallow((state) => state.pairs));
export const useEndedPairs = (): string[] => useBuddyStore(useShallow((state) => state.endedPairs));
export const useJustPaired = (): string[] => useBuddyStore(useShallow((state) => state.justPaired));
export const useInviteSheetOpen = (): boolean => useBuddyStore((state) => state.inviteSheetOpen);
/** Who the invite on screen is for — the face and name chosen before the code was made. */
export const useInviteFor = () => useBuddyStore((state) => state.inviteFor);

/**
 * The buddies to draw against each of today's prayers, resolved in one pass.
 *
 * One hook for the whole screen rather than one per row, because a hook cannot be called inside the
 * rows' `map`.
 *
 * **It selects stable references and derives afterwards, and it has to.** The obvious version —
 * building the table inside the selector and wrapping it in `useShallow` — renders the Today screen
 * unusable the first time any buddy mark exists: `useShallow` compares the returned object's values
 * with `Object.is`, `Array.prototype.filter` returns a new array every call, so no two snapshots
 * ever compare equal, `useSyncExternalStore` re-renders to chase a snapshot that never settles, and
 * React gives up with "Maximum update depth exceeded". It stayed invisible through a green test
 * suite because both empty paths return the same frozen object — the loop only starts once the
 * feature does something.
 *
 * So the selector returns only values immer keeps stable between changes, and `useMemo` builds the
 * table from them.
 */
const NONE: readonly BuddyPair[] = Object.freeze([]);
const NO_BUDDIES: Readonly<Record<Prayer, readonly BuddyPair[]>> = Object.freeze({
  fajr: NONE,
  dhuhr: NONE,
  asr: NONE,
  maghrib: NONE,
  isha: NONE,
});

export function useBuddiesByPrayer(
  day: PrayerDay | null
): Readonly<Record<Prayer, readonly BuddyPair[]>> {
  const { enabled, storedDay, marks, pairs } = useBuddyStore(
    useShallow((state) => ({
      enabled: state.enabled,
      storedDay: state.day,
      marks: state.marks,
      pairs: state.pairs,
    }))
  );

  return useMemo(() => {
    if (!enabled || pairs.length === 0) return NO_BUDDIES;
    if (storedDay === null || storedDay !== day) return NO_BUDDIES;

    let any = false;
    const table: Record<Prayer, readonly BuddyPair[]> = { ...NO_BUDDIES };
    for (const prayer of PRAYERS) {
      const ids = marks[prayer];
      if (ids.length === 0) continue;
      table[prayer] = pairs.filter((pair) => ids.includes(pair.pairId));
      any = true;
    }
    return any ? table : NO_BUDDIES;
  }, [enabled, storedDay, marks, pairs, day]);
}
