/**
 * Tests for the in-app adhan playback seam.
 *
 * The point of this module is that PRODUCT_SPEC §13's "never while the adhan is playing" was a
 * rule with nothing behind it for as long as it existed: no mount site passed `isAdhanPlaying`
 * and nothing called `adhanFinished()`, so the flag was permanently `false` and the quiet period
 * could never open (D89). What is worth pinning is therefore the wiring, not the boolean.
 */

import {
  isAdhanPlaying,
  observeAdhanStopped,
  resetAdhanPlayback,
  setAdhanPlaying,
} from './adhanPlayback';

beforeEach(() => {
  resetAdhanPlayback();
});

describe('adhanPlayback', () => {
  it('starts silent', () => {
    expect(isAdhanPlaying()).toBe(false);
  });

  it('reports what the player last said', () => {
    setAdhanPlaying(true);
    expect(isAdhanPlaying()).toBe(true);

    setAdhanPlaying(false);
    expect(isAdhanPlaying()).toBe(false);
  });

  it('announces the stop exactly once, so the quiet period opens once', () => {
    const stopped = jest.fn();
    observeAdhanStopped(stopped);

    setAdhanPlaying(true);
    expect(stopped).not.toHaveBeenCalled();

    setAdhanPlaying(false);
    expect(stopped).toHaveBeenCalledTimes(1);

    // The preview mirrors its state from an effect, so a repeated `false` is normal — a screen
    // unmounting after the recitation already ended sends one. It must not re-open the period.
    setAdhanPlaying(false);
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it('says whether a call was the stop, so a caller need not track it', () => {
    expect(setAdhanPlaying(true)).toBe(false);
    expect(setAdhanPlaying(true)).toBe(false);
    expect(setAdhanPlaying(false)).toBe(true);
    expect(setAdhanPlaying(false)).toBe(false);
  });

  it('lets the listener go, and never calls a stale one', () => {
    const first = jest.fn();
    const remove = observeAdhanStopped(first);
    remove();

    setAdhanPlaying(true);
    setAdhanPlaying(false);

    expect(first).not.toHaveBeenCalled();
  });
});
