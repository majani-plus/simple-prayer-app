/**
 * The layout-direction wiring.
 *
 * These are the assertions that stop Arabic from being "English with Arabic words in it". The two
 * that matter most are the least obvious:
 *
 * - **`allowRTL` follows the app language, not the device.** RN resolves
 *   `isRTL = forced || (allowed && devicePreferredLanguageIsRTL)`. Leaving `allowRTL(true)`
 *   standing for an English UI mirrors the English UI on an Arabic phone.
 * - **`applyLayoutDirection` reports whether a reload is owed**, because `I18nManager.isRTL` is a
 *   constant captured when the bundle booted and nothing we write changes the running session.
 */

import { I18nManager } from 'react-native';

import {
  RTL_LANGUAGES,
  applyLayoutDirection,
  backChevron,
  directionFor,
  forwardChevron,
  isLayoutRTL,
  isRtlLanguage,
  layoutDirection,
  needsReloadFor,
} from '../direction';

/**
 * `I18nManager.isRTL` is a plain property on the module's default export (it is snapshotted from
 * native constants at bundle init), so a test can stand in for "this session booted mirrored".
 */
function renderedAs(direction: 'ltr' | 'rtl'): void {
  Object.defineProperty(I18nManager, 'isRTL', {
    value: direction === 'rtl',
    configurable: true,
    writable: true,
  });
}

const originalIsRTL = I18nManager.isRTL;

afterEach(() => {
  renderedAs(originalIsRTL ? 'rtl' : 'ltr');
  jest.restoreAllMocks();
});

describe('isRtlLanguage', () => {
  it('knows the app’s own language', () => {
    expect(isRtlLanguage('ar')).toBe(true);
    expect(isRtlLanguage('en')).toBe(false);
    expect(isRtlLanguage('tr')).toBe(false);
  });

  it('matches on the language subtag, so a region or an extension cannot hide it', () => {
    expect(isRtlLanguage('ar-EG')).toBe(true);
    expect(isRtlLanguage('AR')).toBe(true);
    expect(isRtlLanguage('ar-u-nu-arab')).toBe(true);
    expect(isRtlLanguage('en-GB')).toBe(false);
  });

  it('treats an unresolved language as left-to-right rather than throwing', () => {
    expect(isRtlLanguage(null)).toBe(false);
    expect(isRtlLanguage(undefined)).toBe(false);
    expect(isRtlLanguage('')).toBe(false);
  });

  it('is ready for the RTL languages the app does not ship yet', () => {
    // Adding Farsi or Urdu must be a locale file, not a direction bug.
    expect([...RTL_LANGUAGES].every((language) => isRtlLanguage(language))).toBe(true);
  });
});

describe('directionFor', () => {
  it('maps a language to a writing direction', () => {
    expect(directionFor('ar')).toBe('rtl');
    expect(directionFor('en')).toBe('ltr');
    expect(directionFor('tr')).toBe('ltr');
  });
});

describe('the direction actually on screen', () => {
  it('reports what the session booted with, not what the language wants', () => {
    renderedAs('rtl');
    expect(isLayoutRTL()).toBe(true);
    expect(layoutDirection()).toBe('rtl');

    renderedAs('ltr');
    expect(isLayoutRTL()).toBe(false);
    expect(layoutDirection()).toBe('ltr');
  });

  it('is read at call time, so a component picks up a flip on the next render', () => {
    renderedAs('ltr');
    const before = layoutDirection();
    renderedAs('rtl');
    expect(before).not.toBe(layoutDirection());
  });
});

describe('chevrons', () => {
  it('points "back" against the reading direction', () => {
    renderedAs('ltr');
    expect(backChevron()).toBe('chevron_left');
    renderedAs('rtl');
    expect(backChevron()).toBe('chevron_right');
  });

  it('points "forward" along it', () => {
    renderedAs('ltr');
    expect(forwardChevron()).toBe('chevron_right');
    renderedAs('rtl');
    expect(forwardChevron()).toBe('chevron_left');
  });

  it('never has the two agreeing', () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      renderedAs(direction);
      expect(backChevron()).not.toBe(forwardChevron());
    }
  });
});

describe('applyLayoutDirection', () => {
  it('sets BOTH switches from the app language, so the device locale never decides', () => {
    const allowRTL = jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => undefined);
    const forceRTL = jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => undefined);

    applyLayoutDirection('ar');
    expect(allowRTL).toHaveBeenLastCalledWith(true);
    expect(forceRTL).toHaveBeenLastCalledWith(true);

    // The important half: an English UI on an Arabic phone must come back to LTR, which
    // `allowRTL(true)` alone would not do.
    applyLayoutDirection('en');
    expect(allowRTL).toHaveBeenLastCalledWith(false);
    expect(forceRTL).toHaveBeenLastCalledWith(false);
  });

  it('reports that a reload is owed when the layout no longer matches the language', () => {
    jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => undefined);
    jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => undefined);
    renderedAs('ltr');

    expect(applyLayoutDirection('ar')).toBe(true);
    expect(applyLayoutDirection('en')).toBe(false);
    expect(applyLayoutDirection('tr')).toBe(false);
  });

  it('reports nothing owed when the session is already mirrored', () => {
    jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => undefined);
    jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => undefined);
    renderedAs('rtl');

    expect(applyLayoutDirection('ar')).toBe(false);
    expect(applyLayoutDirection('en')).toBe(true);
  });
});

describe('needsReloadFor', () => {
  it('is the question "are the strings and the layout disagreeing?"', () => {
    renderedAs('ltr');
    expect(needsReloadFor('ar')).toBe(true);
    expect(needsReloadFor('tr')).toBe(false);

    renderedAs('rtl');
    expect(needsReloadFor('ar')).toBe(false);
    expect(needsReloadFor('tr')).toBe(true);
  });
});
