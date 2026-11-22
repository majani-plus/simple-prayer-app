/**
 * The one rule the watch-install hint has: speak only when a paired watch is genuinely missing
 * the app, and never when the answer is unknown. Guessing here would tell somebody who owns no
 * watch to go and install something (owner, 2026-08-29).
 */

import { decideWatchOffer, shouldOfferWatchInstall } from './useWatchOffer';

describe('shouldOfferWatchInstall', () => {
  it('offers when a watch is paired and the app is not on it — the only actionable case', () => {
    expect(shouldOfferWatchInstall({ paired: true, appInstalled: false })).toBe(true);
  });

  it('says nothing when the app is already on the watch', () => {
    expect(shouldOfferWatchInstall({ paired: true, appInstalled: true })).toBe(false);
  });

  it('says nothing when no watch is paired — there is nothing to install onto', () => {
    expect(shouldOfferWatchInstall({ paired: false, appInstalled: false })).toBe(false);
  });

  it('says nothing while the answer is unknown (no bridge, Android, still activating)', () => {
    expect(shouldOfferWatchInstall(null)).toBe(false);
  });

  it('never offers on the nonsense state a broken bridge could report', () => {
    // "Installed on a watch that is not paired" cannot be acted on, so it stays quiet.
    expect(shouldOfferWatchInstall({ paired: false, appInstalled: true })).toBe(false);
  });
});

describe('decideWatchOffer', () => {
  const base = { foss: false, androidHasWatch: null, iosState: null } as const;

  it('offers the watch listings on Android when a watch is connected', () => {
    expect(decideWatchOffer({ ...base, platform: 'android', androidHasWatch: true })).toBe(
      'android'
    );
  });

  it('offers nothing on Android without a watch, or while the answer is unknown', () => {
    expect(decideWatchOffer({ ...base, platform: 'android', androidHasWatch: false })).toBeNull();
    expect(decideWatchOffer({ ...base, platform: 'android' })).toBeNull();
  });

  it('offers the iOS hint only for a paired watch missing the app', () => {
    const paired = { paired: true, appInstalled: false };
    expect(decideWatchOffer({ ...base, platform: 'ios', iosState: paired })).toBe('ios');
    expect(
      decideWatchOffer({ ...base, platform: 'ios', iosState: { ...paired, appInstalled: true } })
    ).toBeNull();
    expect(decideWatchOffer({ ...base, platform: 'ios' })).toBeNull();
  });

  it('never offers anything in the FOSS build, even with a watch connected', () => {
    // Owner, 2026-11-23: the FOSS build has no store links and no watch UI anywhere.
    expect(
      decideWatchOffer({ ...base, foss: true, platform: 'android', androidHasWatch: true })
    ).toBeNull();
    expect(
      decideWatchOffer({
        ...base,
        foss: true,
        platform: 'ios',
        iosState: { paired: true, appInstalled: false },
      })
    ).toBeNull();
  });

  it('offers nothing on a platform with no watch', () => {
    expect(decideWatchOffer({ ...base, platform: 'web', androidHasWatch: true })).toBeNull();
  });
});
