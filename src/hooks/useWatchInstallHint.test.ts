/**
 * The one rule the watch-install hint has: speak only when a paired watch is genuinely missing
 * the app, and never when the answer is unknown. Guessing here would tell somebody who owns no
 * watch to go and install something (owner, 2026-08-29).
 */

import { shouldOfferWatchInstall } from './useWatchInstallHint';

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
