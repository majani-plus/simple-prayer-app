/**
 * Tests for buddy mode's rules.
 *
 * Most of these are about refusal rather than behaviour: the fences in D174 are what make this
 * feature admissible at all, and a fence that is not pinned by a test is a fence that a future
 * change walks through without noticing.
 */

import { PRAYERS, type Prayer, type PrayerDay, type PrayerStatus } from './types';
import {
  BUDDY_COLORS,
  BUDDY_ICONS,
  BUDDY_LIMIT,
  MARK_STATES,
  buddyInitials,
  NO_BUDDY_MARKS,
  applyMarks,
  canAddBuddy,
  firstFreeAvatar,
  forgetPair,
  formatInviteCode,
  isAvatarTaken,
  isInviteLive,
  markStateFor,
  marksForDay,
  sameAvatar,
  type BuddyAvatar,
  type BuddyMark,
  type BuddyMarks,
} from './buddies';

const TODAY = '2026-09-15' as PrayerDay;
const YESTERDAY = '2026-09-14' as PrayerDay;
const AMINA = 'a'.repeat(32);
const YUSUF = 'b'.repeat(32);
const ROSTER = [AMINA, YUSUF];

function mark(overrides: Partial<BuddyMark> = {}): BuddyMark {
  return { pairId: AMINA, day: TODAY, prayer: 'maghrib', state: 'prayed', ...overrides };
}

function apply(marks: readonly BuddyMark[], from: BuddyMarks = NO_BUDDY_MARKS): BuddyMarks {
  return applyMarks(from, marks, TODAY, ROSTER);
}

// ===========================================================================
// The vocabulary
// ===========================================================================

describe('MARK_STATES', () => {
  it('has exactly two values, and neither of them is a judgement', () => {
    // If this ever grows, D174's central fence — a buddy is told that you prayed and nothing
    // else — has been breached, and the privacy policy and store declarations are now wrong.
    expect([...MARK_STATES]).toEqual(['prayed', 'cleared']);
  });

  it('cannot express missed, not-yet, exempt or a count', () => {
    for (const forbidden of ['missed', 'unlogged', 'exempt', 'qada', 'late']) {
      expect(MARK_STATES as readonly string[]).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
// markStateFor — what leaves this phone
// ===========================================================================

describe('markStateFor', () => {
  it('speaks when a prayer becomes prayed', () => {
    expect(markStateFor('unlogged', 'prayed')).toBe('prayed');
  });

  it('treats late as prayed — a buddy is never told the difference', () => {
    expect(markStateFor('unlogged', 'late')).toBe('prayed');
    expect(markStateFor('missed', 'late')).toBe('prayed');
  });

  it('says nothing when prayed and late swap, because nothing a buddy sees has changed', () => {
    expect(markStateFor('prayed', 'late')).toBeNull();
    expect(markStateFor('late', 'prayed')).toBeNull();
  });

  it('retracts when a mark is undone', () => {
    expect(markStateFor('prayed', 'unlogged')).toBe('cleared');
    expect(markStateFor('late', 'unlogged')).toBe('cleared');
  });

  it('NEVER tells a buddy that a prayer was missed', () => {
    // The single most important line in this file. A missed prayer is between a person and God,
    // and the whole feature is admissible only because it cannot travel.
    expect(markStateFor('unlogged', 'missed')).toBeNull();
    expect(markStateFor('missed', 'unlogged')).toBeNull();
  });

  it('never tells a buddy about an exempt day', () => {
    expect(markStateFor('unlogged', 'exempt')).toBeNull();
    expect(markStateFor('exempt', 'unlogged')).toBeNull();
    expect(markStateFor('missed', 'exempt')).toBeNull();
  });

  it('says NOTHING when a prayed prayer becomes exempt', () => {
    // Retracting would be the tidy answer and the wrong one: a period starting would pull every
    // mark of that day at once, and five avatars vanishing together announces the period more
    // plainly than any message this app would send. The marks were true when they were made.
    expect(markStateFor('prayed', 'exempt')).toBeNull();
    expect(markStateFor('late', 'exempt')).toBeNull();
  });

  it('retracts when a prayed prayer becomes missed, and says no more than that', () => {
    expect(markStateFor('prayed', 'missed')).toBe('cleared');
  });

  it('says nothing when nothing changed', () => {
    const statuses: PrayerStatus[] = ['unlogged', 'prayed', 'late', 'missed', 'exempt'];
    for (const status of statuses) expect(markStateFor(status, status)).toBeNull();
  });

  it('answers something or nothing for every pair of statuses, and never throws', () => {
    const statuses: PrayerStatus[] = ['unlogged', 'prayed', 'late', 'missed', 'exempt'];
    for (const from of statuses) {
      for (const to of statuses) {
        const answer = markStateFor(from, to);
        expect(answer === null || answer === 'prayed' || answer === 'cleared').toBe(true);
      }
    }
  });
});

// ===========================================================================
// applyMarks — what the rows show
// ===========================================================================

describe('applyMarks', () => {
  it('puts a buddy on the prayer they prayed', () => {
    expect(apply([mark()]).maghrib).toEqual([AMINA]);
  });

  it('leaves every other prayer untouched', () => {
    const result = apply([mark()]);
    for (const prayer of PRAYERS.filter((entry) => entry !== 'maghrib')) {
      expect(result[prayer]).toEqual([]);
    }
  });

  it('takes a buddy off again when they undo it', () => {
    const after = apply([mark(), mark({ state: 'cleared' })]);
    expect(after.maghrib).toEqual([]);
  });

  it('records nothing for a retraction that arrives on its own', () => {
    // A `cleared` removes; it never writes a negative. There is no state in this module that a
    // screen could render as "they did not pray".
    expect(apply([mark({ state: 'cleared' })])).toBe(NO_BUDDY_MARKS);
  });

  it('collapses a repeated flag instead of showing a buddy twice', () => {
    expect(apply([mark(), mark(), mark()]).maghrib).toEqual([AMINA]);
  });

  it('keeps buddies in roster order however they arrive', () => {
    const yusufFirst = apply([mark({ pairId: YUSUF }), mark({ pairId: AMINA })]);
    expect(yusufFirst.maghrib).toEqual([AMINA, YUSUF]);
  });

  it('discards a flag for another day — there is nowhere to put it', () => {
    expect(apply([mark({ day: YESTERDAY })])).toBe(NO_BUDDY_MARKS);
  });

  it('discards a flag from a pair this phone no longer has', () => {
    expect(apply([mark({ pairId: 'c'.repeat(32) })])).toBe(NO_BUDDY_MARKS);
  });

  it('discards a flag naming something that is not one of the five prayers', () => {
    expect(apply([mark({ prayer: 'tahajjud' as Prayer })])).toBe(NO_BUDDY_MARKS);
  });

  it('returns the same object when nothing applied, so no screen re-renders for nothing', () => {
    const before = apply([mark()]);
    expect(applyMarks(before, [], TODAY, ROSTER)).toBe(before);
    expect(applyMarks(before, [mark()], TODAY, ROSTER)).toBe(before);
  });

  it('applies a batch in order, so the last word about one prayer wins', () => {
    const marks = [mark(), mark({ state: 'cleared' }), mark()];
    expect(apply(marks).maghrib).toEqual([AMINA]);
  });

  it('holds several buddies on one prayer and one buddy across several prayers', () => {
    const result = apply([
      mark({ pairId: AMINA, prayer: 'fajr' }),
      mark({ pairId: YUSUF, prayer: 'fajr' }),
      mark({ pairId: AMINA, prayer: 'asr' }),
    ]);
    expect(result.fajr).toEqual([AMINA, YUSUF]);
    expect(result.asr).toEqual([AMINA]);
  });
});

// ===========================================================================
// marksForDay — why there is no history
// ===========================================================================

describe('marksForDay', () => {
  it('keeps what was stored when the day has not turned', () => {
    const stored = apply([mark()]);
    expect(marksForDay(stored, TODAY, TODAY)).toBe(stored);
  });

  it('empties everything when the day has turned', () => {
    // Yesterday's buddy marks are not history — they are stale. This is what makes "no buddy
    // history" true even for a phone that was not opened for a week.
    const stored = apply([mark()]);
    expect(marksForDay(stored, YESTERDAY, TODAY)).toBe(NO_BUDDY_MARKS);
  });

  it('empties everything when nothing was stored at all', () => {
    expect(marksForDay(NO_BUDDY_MARKS, null, TODAY)).toBe(NO_BUDDY_MARKS);
  });
});

describe('forgetPair', () => {
  it('takes a removed buddy off every row at once', () => {
    const marks = apply([
      mark({ pairId: AMINA, prayer: 'fajr' }),
      mark({ pairId: YUSUF, prayer: 'fajr' }),
      mark({ pairId: AMINA, prayer: 'isha' }),
    ]);

    const after = forgetPair(marks, AMINA);
    expect(after.fajr).toEqual([YUSUF]);
    expect(after.isha).toEqual([]);
  });

  it('does nothing, and says so, for a buddy who was not on any row', () => {
    const marks = apply([mark()]);
    expect(forgetPair(marks, YUSUF)).toBe(marks);
  });
});

// ===========================================================================
// Avatars
// ===========================================================================

describe('avatars', () => {
  it('names colours rather than carrying them, so the theme stays the only place colour lives', () => {
    for (const color of BUDDY_COLORS) expect(color).not.toMatch(/^#|rgb|hsl/);
  });

  it('offers enough combinations that five buddies can always look different', () => {
    expect(BUDDY_ICONS.length * BUDDY_COLORS.length).toBeGreaterThan(BUDDY_LIMIT);
  });

  it('has no duplicate icon or colour name', () => {
    expect(new Set(BUDDY_ICONS).size).toBe(BUDDY_ICONS.length);
    expect(new Set(BUDDY_COLORS).size).toBe(BUDDY_COLORS.length);
  });

  it('counts a combination as taken only when both halves match', () => {
    const taken: BuddyAvatar[] = [{ icon: 'star', color: 'plum' }];
    expect(isAvatarTaken({ icon: 'star', color: 'plum' }, taken)).toBe(true);
    // Sharing one half is fine — that is what keeps twelve icons and eight colours useful.
    expect(isAvatarTaken({ icon: 'star', color: 'teal' }, taken)).toBe(false);
    expect(isAvatarTaken({ icon: 'moon' as never, color: 'plum' }, taken)).toBe(false);
  });

  it('suggests a free combination, and a different one each time', () => {
    const taken: BuddyAvatar[] = [];
    for (let i = 0; i < BUDDY_LIMIT; i += 1) {
      const suggestion = firstFreeAvatar(taken);
      expect(suggestion).not.toBeNull();
      expect(isAvatarTaken(suggestion!, taken)).toBe(false);
      taken.push(suggestion!);
    }
    expect(new Set(taken.map((avatar) => `${avatar.icon}/${avatar.color}`)).size).toBe(BUDDY_LIMIT);
  });

  it('defaults every buddy to initials, in a colour of their own', () => {
    // Letters already say who somebody is, so two buddies wearing initials are told apart by the
    // name as well as the colour. That is why this one default can be shared where a picture's
    // could not.
    const taken: BuddyAvatar[] = [];
    for (let i = 0; i < BUDDY_LIMIT; i += 1) taken.push(firstFreeAvatar(taken)!);

    expect(taken.every((avatar) => avatar.icon === 'initials')).toBe(true);
    expect(new Set(taken.map((avatar) => avatar.color)).size).toBe(BUDDY_LIMIT);
  });

  it('varies BOTH halves once somebody picks pictures instead', () => {
    // The failure this guards against is subtle and would have shipped: walking colours within an
    // icon gives five buddies five colours of one icon, which is identity by colour alone — the
    // thing this app never does.
    // Every initials combination spoken for, so the walk falls through to the pictures.
    const taken: BuddyAvatar[] = BUDDY_COLORS.map((color) => ({ icon: 'initials' as const, color }));
    const picked: BuddyAvatar[] = [];
    for (let i = 0; i < BUDDY_LIMIT; i += 1) {
      const next = firstFreeAvatar(taken)!;
      picked.push(next);
      taken.push(next);
    }

    expect(new Set(picked.map((avatar) => avatar.icon)).size).toBe(BUDDY_LIMIT);
    expect(new Set(picked.map((avatar) => avatar.color)).size).toBe(BUDDY_LIMIT);
  });

  it('answers null rather than repeating itself when everything is taken', () => {
    const everything = BUDDY_ICONS.flatMap((icon) => BUDDY_COLORS.map((color) => ({ icon, color })));
    expect(firstFreeAvatar(everything)).toBeNull();
  });

  it('compares two avatars on both halves', () => {
    expect(sameAvatar({ icon: 'star', color: 'plum' }, { icon: 'star', color: 'plum' })).toBe(true);
    expect(sameAvatar({ icon: 'star', color: 'plum' }, { icon: 'star', color: 'teal' })).toBe(false);
  });
});

// ===========================================================================
// Invites and limits
// ===========================================================================

describe('buddyInitials', () => {
  it('takes one letter from each of two words', () => {
    expect(buddyInitials('Amina Bint')).toBe('AB');
    expect(buddyInitials('  ahmed   yusuf  ')).toBe('AY');
  });

  it('takes the first two letters of a single name', () => {
    expect(buddyInitials('Amina')).toBe('AM');
  });

  it('works for a name that is not written in Latin letters', () => {
    // Characters, not Latin letters: an Arabic or Turkish name has initials too, and the whole
    // point of this feature is people writing their family's names in their own script.
    expect(buddyInitials('أمينة')).toBe('أم');
    expect(buddyInitials('محمد علي')).toBe('مع');
    expect(buddyInitials('İbrahim')).toBe('İB');
  });

  it('never returns a single letter from a one-letter name', () => {
    expect(buddyInitials('A')).toBe('A');
  });

  it('shows the sample while nothing has been typed', () => {
    expect(buddyInitials('')).toBe('••');
    expect(buddyInitials('   ')).toBe('••');
    expect(buddyInitials('', 'AB')).toBe('AB');
  });
});

describe('invites', () => {
  it('groups a code for reading aloud', () => {
    expect(formatInviteCode('ABCD2345')).toBe('ABCD-2345');
  });

  it('leaves anything that is not a code alone', () => {
    expect(formatInviteCode('SHORT')).toBe('SHORT');
  });

  it('is live until it expires, and not a moment after', () => {
    const invite = { code: 'ABCD2345', expiresAt: 1_000 };
    expect(isInviteLive(invite, 999)).toBe(true);
    expect(isInviteLive(invite, 1_000)).toBe(false);
    expect(isInviteLive(invite, 1_001)).toBe(false);
    expect(isInviteLive(null, 0)).toBe(false);
  });
});

describe('canAddBuddy', () => {
  it('allows up to five and no more', () => {
    expect(canAddBuddy(0)).toBe(true);
    expect(canAddBuddy(BUDDY_LIMIT - 1)).toBe(true);
    expect(canAddBuddy(BUDDY_LIMIT)).toBe(false);
    expect(canAddBuddy(BUDDY_LIMIT + 1)).toBe(false);
  });
});
