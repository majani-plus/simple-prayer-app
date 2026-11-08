/**
 * Buddy mode's rules — what a buddy's flag means, what may be sent, and what a buddy may look
 * like. Pure TypeScript: no store, no clock of its own, no strings anybody reads.
 *
 * The feature (D174) is one sentence: someone you paired with can see, on today's rows only, that
 * you prayed. Everything in this file exists to keep that sentence true, and most of it is about
 * what is *not* expressible:
 *
 * - **There are two states and there will never be a third.** {@link MARK_STATES} is `prayed` and
 *   `cleared`. Missed, not-yet, exempt and qada have no representation here, so no future caller
 *   can accidentally send one. Late is folded into `prayed` before it ever reaches this module —
 *   a buddy is not told the difference, because the difference is nobody else's business.
 * - **Absence means nothing.** A prayer with no buddies against it is a prayer nothing arrived
 *   for. It is not "they did not pray", and the UI must not render it as anything at all. Since
 *   `cleared` *removes* rather than recording a negative, there is no value this module can
 *   produce that a screen could mistake for an accusation.
 * - **Today only.** {@link applyMarks} discards any flag that is not for the prayer day it is
 *   given. There is no buddy history in the app and nowhere for one to accumulate.
 *
 * The day boundary is Fajr→next Fajr and is resolved by `domain/dates.ts` — this module is handed
 * the day and never works one out.
 */

import { PRAYERS, type Prayer, type PrayerDay, type PrayerStatus } from './types';

// ---------------------------------------------------------------------------
// The wire vocabulary
// ---------------------------------------------------------------------------

/**
 * Everything one phone can tell another. `prayed` covers late as well; `cleared` retracts a
 * `prayed` that was undone.
 *
 * This is duplicated in the relay repo (`src/protocol.ts`) on purpose — twenty lines that change
 * about once a year, against tying a store release to an npm version. Add fields, never repurpose
 * them: an older app is still installed on somebody's phone.
 */
export const MARK_STATES = ['prayed', 'cleared'] as const;
export type MarkState = (typeof MARK_STATES)[number];

/** A flag as it arrives from the relay's inbox, or rides in a push payload. */
export interface BuddyMark {
  /** The pair it came from. The relay has no idea who that is, and neither does this module. */
  pairId: string;
  day: PrayerDay;
  prayer: Prayer;
  state: MarkState;
}

/** How many buddies one phone may have. Small on purpose: this is not a network. */
export const BUDDY_LIMIT = 5;

// ---------------------------------------------------------------------------
// What the rows show
// ---------------------------------------------------------------------------

/** Which buddies have prayed which of today's prayers. Pair ids, in roster order. */
export type BuddyMarks = Readonly<Record<Prayer, readonly string[]>>;

/** The state of a phone that has heard nothing — which is also the state of every new day. */
export const NO_BUDDY_MARKS: BuddyMarks = Object.freeze({
  fajr: Object.freeze([]),
  dhuhr: Object.freeze([]),
  asr: Object.freeze([]),
  maghrib: Object.freeze([]),
  isha: Object.freeze([]),
}) as BuddyMarks;

function withoutPair(list: readonly string[], pairId: string): readonly string[] {
  return list.includes(pairId) ? list.filter((id) => id !== pairId) : list;
}

/**
 * Fold a batch of flags into what the rows show.
 *
 * Four things are dropped on the floor, all of them deliberately and none of them an error worth
 * reporting: a flag for another day (there is no history to put it in), a flag from a pair this
 * phone no longer has (they were removed while it was in flight), a flag naming a prayer that is
 * not one of the five, and a duplicate.
 *
 * Order is the roster's, not the arrival order, so a row's avatars do not rearrange themselves as
 * marks come in — `knownPairs` is the roster, and the answer follows it.
 *
 * @param current - What the rows show now.
 * @param incoming - Flags from the relay's inbox or a push payload, in any order.
 * @param today - The current prayer day, from `domain/dates.ts`.
 * @param knownPairs - The pair ids this phone still has, in the order they should be drawn.
 * @returns The new state, or `current` unchanged when nothing applied.
 */
export function applyMarks(
  current: BuddyMarks,
  incoming: readonly BuddyMark[],
  today: PrayerDay,
  knownPairs: readonly string[]
): BuddyMarks {
  let changed = false;
  const next: Record<Prayer, readonly string[]> = { ...current };

  for (const mark of incoming) {
    if (mark.day !== today) continue;
    if (!knownPairs.includes(mark.pairId)) continue;
    if (!(PRAYERS as readonly string[]).includes(mark.prayer)) continue;

    const before = next[mark.prayer];
    const after =
      mark.state === 'prayed'
        ? before.includes(mark.pairId)
          ? before
          : knownPairs.filter((id) => id === mark.pairId || before.includes(id))
        : withoutPair(before, mark.pairId);

    if (after !== before) {
      next[mark.prayer] = after;
      changed = true;
    }
  }

  return changed ? next : current;
}

/**
 * What the rows should show for `today`, given what was stored for `storedDay`.
 *
 * A new prayer day empties everything: yesterday's buddy marks are not history, they are stale.
 * This is what makes "no buddy history" true even across an app that was not opened for a week.
 */
export function marksForDay(
  stored: BuddyMarks,
  storedDay: PrayerDay | null,
  today: PrayerDay
): BuddyMarks {
  return storedDay === today ? stored : NO_BUDDY_MARKS;
}

/** Drop a removed buddy from every row at once, so unpairing takes effect before any sync. */
export function forgetPair(marks: BuddyMarks, pairId: string): BuddyMarks {
  let changed = false;
  const next: Record<Prayer, readonly string[]> = { ...marks };
  for (const prayer of PRAYERS) {
    const after = withoutPair(next[prayer], pairId);
    if (after !== next[prayer]) {
      next[prayer] = after;
      changed = true;
    }
  }
  return changed ? next : marks;
}

// ---------------------------------------------------------------------------
// What this phone sends
// ---------------------------------------------------------------------------

/**
 * Whether a change to one of *your* prayers is worth telling a buddy about, and what to say.
 *
 * The only transitions that speak are into and out of "prayed or late". Everything else is
 * silence, and the list of what that covers is the fences of D174 written as code:
 *
 * | change                          | sent      | why                                            |
 * | ------------------------------- | --------- | ---------------------------------------------- |
 * | unlogged → prayed / late        | `prayed`  | the whole feature                              |
 * | prayed ↔ late                   | nothing   | a buddy is never told the difference            |
 * | prayed / late → anything else   | `cleared` | you undid it; the flag has to come back         |
 * | → missed                        | nothing   | never. This is the fence that matters most      |
 * | → exempt                        | nothing   | exempt days are nobody else's business          |
 * | unlogged → unlogged             | nothing   | there was nothing to say                        |
 *
 * @returns What to send, or `null` when the answer is to say nothing.
 */
export function markStateFor(previous: PrayerStatus, next: PrayerStatus): MarkState | null {
  // Becoming exempt says nothing, in either direction — the row the buddy already sees simply
  // stays as it is. The alternative is worse than it sounds: an excused period starting would
  // retract every mark of that day at once, and five avatars disappearing together is a clearer
  // announcement of a period than anything this app would ever choose to send. The marks are
  // honest anyway — she did pray them — and the app keeps them on the period's first day for
  // exactly that reason.
  if (next === 'exempt') return null;

  const was = previous === 'prayed' || previous === 'late';
  const is = next === 'prayed' || next === 'late';
  if (was === is) return null;
  return is ? 'prayed' : 'cleared';
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

/**
 * The faces a buddy can wear. Chosen by **you**, on **your** phone, for each buddy: nothing about
 * how a person looks to you ever leaves the device, and the person themselves never learns what
 * you picked. Two people who paired with each other may picture each other completely differently,
 * which is correct and is the reason there is no "profile" anywhere in this feature.
 *
 * Names only. The actual colours live in `src/theme/tokens.ts`, because `architecture.test.ts`
 * fails the build on a colour literal outside the theme — and because the same buddy must be
 * recognisable in both light and night paper, which only the theme can arrange.
 */
/**
 * Semantic names, not glyph names: the drawing is chosen in `components/BuddyAvatar.tsx`, and
 * every one of these maps to a glyph already in the bundled Material Symbols subset, so adding
 * buddy mode costs the app no font weight. Semantic here rather than `bedtime`/`workspace_premium`
 * because these names are *persisted* against each buddy — swapping which glyph draws a crescent
 * must not rename anybody's buddy.
 *
 * No person or group figure, on purpose. A little human icon would make this a profile, and a
 * buddy is not a profile: there is no name on the wire, no photo, and nothing to look at but a
 * mark on a row.
 */
/**
 * The face a buddy wears when you have not chosen a picture: the first letters of the name you gave
 * them. It is the default because it is the one that needs no decision — a name is already typed by
 * the time the question is asked, and two letters of it identify a person better than a crescent.
 */
export const INITIALS_ICON = 'initials' as const;

export const BUDDY_ICONS = [
  INITIALS_ICON,
  'crescent',
  'star',
  'mosque',
  'rosette',
  'leaf',
  'drop',
  'sun',
  'book',
  'heart',
  'dawn',
] as const;
export type BuddyIcon = (typeof BUDDY_ICONS)[number];

/**
 * Ordered on purpose: {@link firstFreeAvatar} walks this list, so the sequence is what makes the
 * first five buddies somebody adds land on hues that are far apart. The actual colours, and why
 * there is no green and no gold among them, are in `src/theme/tokens.ts`.
 */
export const BUDDY_COLORS = [
  'ocean',
  'brick',
  'violet',
  'teal',
  'rose',
  'stone',
  'plum',
  'clay',
] as const;
export type BuddyColor = (typeof BUDDY_COLORS)[number];

/** Icon **and** colour, always both: a state or an identity is never carried by colour alone. */
export interface BuddyAvatar {
  icon: BuddyIcon;
  color: BuddyColor;
}

export function sameAvatar(one: BuddyAvatar, two: BuddyAvatar): boolean {
  return one.icon === two.icon && one.color === two.color;
}

/**
 * Whether a combination is already in use on this phone. Uniqueness is on the pair, not on either
 * half: two buddies may share a colour or share an icon, but never both, so no two are ever
 * mistaken for each other at a glance.
 */
export function isAvatarTaken(avatar: BuddyAvatar, taken: readonly BuddyAvatar[]): boolean {
  return taken.some((other) => sameAvatar(other, avatar));
}

/**
 * The letters to draw for a buddy, from the name this phone gave them.
 *
 * Two letters, because one is not a person and three do not fit. A name with a space in it gives
 * the first letter of each half (Amina Bint → AB); a single word gives its first two (Amina → AM).
 * The letters are taken as characters rather than as Latin letters on purpose: an Arabic or Turkish
 * name has initials too, and "أمينة" should read as أم, not as nothing.
 *
 * @param nickname - What you call them. Empty while somebody is still typing.
 * @param fallback - Shown in place of an empty name, so the preview is never a blank disc.
 */
export function buddyInitials(nickname: string, fallback = '••'): string {
  const words = nickname.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallback;

  const first = [...words[0]];
  if (words.length === 1) {
    return first.slice(0, 2).join('').toLocaleUpperCase();
  }
  const second = [...words[1]];
  return (first[0] + second[0]).toLocaleUpperCase();
}

/**
 * A free combination to open the picker on, so adding a buddy is one tap for anyone who does not
 * care which face they get.
 *
 * It walks the two lists **diagonally** — one step down the icons and one step down the colours
 * each time — rather than exhausting the colours within an icon. Nested loops would hand the first
 * five buddies five colours of the same icon, which is identity by colour alone in everything but
 * name: unusable to a colour-blind eye and gone entirely in a grey screenshot. Stepping both lists
 * means consecutive buddies differ in *both* halves. The lists are ten and eight long, so the
 * diagonal visits forty pairs before it repeats, which is eight times the limit.
 *
 * @returns A free combination, or `null` when every one is taken — which cannot happen under
 *          {@link BUDDY_LIMIT}, and is handled rather than asserted.
 */
export function firstFreeAvatar(taken: readonly BuddyAvatar[]): BuddyAvatar | null {
  // Initials first, in a colour nobody else has.
  //
  // The diagonal below exists so that consecutive buddies differ in *both* halves, because a
  // picture carries no information of its own — five crescents in five colours is identity by
  // colour alone. Letters are different: they already say who the person is, so two buddies both
  // wearing initials are told apart by the letters as well as the colour, and defaulting everybody
  // to initials is the right answer rather than a shortcut.
  for (const color of BUDDY_COLORS) {
    const candidate = { icon: INITIALS_ICON, color };
    if (!isAvatarTaken(candidate, taken)) return candidate;
  }

  for (let step = 0; step < BUDDY_ICONS.length * BUDDY_COLORS.length; step += 1) {
    const candidate = {
      icon: BUDDY_ICONS[step % BUDDY_ICONS.length],
      color: BUDDY_COLORS[step % BUDDY_COLORS.length],
    };
    if (!isAvatarTaken(candidate, taken)) return candidate;
  }

  // The diagonal cannot reach every pair when the two lengths share a factor, so fall back to the
  // exhaustive walk before admitting defeat.
  for (const icon of BUDDY_ICONS) {
    for (const color of BUDDY_COLORS) {
      const candidate = { icon, color };
      if (!isAvatarTaken(candidate, taken)) return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

/** A pairing code this phone created and is showing, until it is used or it runs out. */
export interface BuddyInvite {
  code: string;
  expiresAt: number;
}

/** Codes are shown as ABCD-EFGH and stored without the dash. Presentation only. */
export function formatInviteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * Whether an invite is still worth showing. An expired one is not an error to report — the screen
 * simply offers a new one.
 */
export function isInviteLive(invite: BuddyInvite | null, at: number): invite is BuddyInvite {
  return invite !== null && invite.expiresAt > at;
}

/** Whether there is room for another buddy. */
export function canAddBuddy(current: number): boolean {
  return current < BUDDY_LIMIT;
}
