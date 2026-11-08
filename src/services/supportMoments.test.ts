/**
 * Tests for the ask-referee (decision D29).
 *
 * The rule being defended is small and easy to break by accident: the app may ask for a review or
 * put the tip jar forward, but never both in one sitting. Everything here is about the *proactive*
 * card; the Settings and About jars are destinations and are deliberately outside this gate.
 */

import {
  MIN_LOGGED_PRAYERS_BEFORE_TIP_PROMPT,
  canOfferTipPrompt,
  hasSessionMoment,
  noteSessionMoment,
  resetSessionMoments,
} from './supportMoments';

const engaged = {
  loggedPrayerCount: MIN_LOGGED_PRAYERS_BEFORE_TIP_PROMPT,
  dismissed: false,
  hasTipped: false,
};

beforeEach(() => {
  resetSessionMoments();
});

describe('session moments', () => {
  it('starts empty and remembers what has been shown', () => {
    expect(hasSessionMoment('reviewPrompt')).toBe(false);
    noteSessionMoment('reviewPrompt');
    expect(hasSessionMoment('reviewPrompt')).toBe(true);
  });

  it('does not confuse one ask with the other', () => {
    noteSessionMoment('tipPrompt');
    expect(hasSessionMoment('reviewPrompt')).toBe(false);
  });
});

describe('offering the tip jar unprompted', () => {
  it('is allowed once the app has demonstrably been useful', () => {
    expect(canOfferTipPrompt(engaged)).toBe(true);
  });

  it('never happens in the same session as a review prompt', () => {
    noteSessionMoment('reviewPrompt');
    expect(canOfferTipPrompt(engaged)).toBe(false);
  });

  it('never happens before the user has got value out of the app', () => {
    expect(
      canOfferTipPrompt({ ...engaged, loggedPrayerCount: MIN_LOGGED_PRAYERS_BEFORE_TIP_PROMPT - 1 })
    ).toBe(false);
    expect(canOfferTipPrompt({ ...engaged, loggedPrayerCount: 0 })).toBe(false);
  });

  it('never happens twice: dismissed means dismissed', () => {
    expect(canOfferTipPrompt({ ...engaged, dismissed: true })).toBe(false);
  });

  it('never pesters someone who has already tipped', () => {
    expect(canOfferTipPrompt({ ...engaged, hasTipped: true })).toBe(false);
  });

  it('is a full week of five-a-day, not an arbitrary number', () => {
    expect(MIN_LOGGED_PRAYERS_BEFORE_TIP_PROMPT).toBe(7 * 5);
  });
});
