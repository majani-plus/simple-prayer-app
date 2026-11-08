/**
 * The width-class system (D123). Everything tablet, foldable and split-screen keys off these four
 * pure functions, so the boundaries are pinned here rather than discovered on a device: an
 * off-by-one at 600 or 840 would silently give a phone the clamped column, or an unfolded foldable
 * the phone layout.
 *
 * The load-bearing case is `contentClampStyle` on a compact window returning an *empty* style —
 * that is the guarantee that adding the clamp to all thirteen screens left phones untouched.
 */

import {
  breakpoints,
  contentClampStyle,
  contentWidth,
  maxContentWidth,
  widthClass,
} from './layout';

describe('widthClass', () => {
  it('calls a phone compact', () => {
    expect(widthClass(320)).toBe('compact');
    expect(widthClass(390)).toBe('compact');
    expect(widthClass(430)).toBe('compact');
  });

  it('classes the boundaries themselves, inclusive', () => {
    expect(widthClass(breakpoints.medium - 1)).toBe('compact');
    expect(widthClass(breakpoints.medium)).toBe('medium');
    expect(widthClass(breakpoints.expanded - 1)).toBe('medium');
    expect(widthClass(breakpoints.expanded)).toBe('expanded');
  });

  it('calls a tablet in portrait medium and in landscape expanded', () => {
    expect(widthClass(834)).toBe('medium'); // 11" iPad, portrait
    expect(widthClass(1194)).toBe('expanded'); // the same iPad, landscape
  });

  it('follows a foldable through the hinge', () => {
    expect(widthClass(374)).toBe('compact'); // cover screen
    expect(widthClass(842)).toBe('expanded'); // unfolded
  });

  it('never answers below zero or above the classes it knows', () => {
    expect(widthClass(0)).toBe('compact');
    expect(widthClass(4000)).toBe('expanded');
  });
});

describe('contentWidth', () => {
  it('is the whole window on a phone', () => {
    expect(contentWidth(390)).toBe(390);
  });

  it('stops at the content column once the window is wider than one', () => {
    expect(contentWidth(maxContentWidth)).toBe(maxContentWidth);
    expect(contentWidth(1024)).toBe(maxContentWidth);
    expect(contentWidth(1366)).toBe(maxContentWidth);
  });
});

describe('contentClampStyle', () => {
  it('leaves a compact window completely alone', () => {
    expect(contentClampStyle(390)).toEqual({});
    expect(contentClampStyle(599)).toEqual({});
  });

  it('centres a clamped column from medium up', () => {
    const clamp = { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' };
    expect(contentClampStyle(600)).toEqual(clamp);
    expect(contentClampStyle(834)).toEqual(clamp);
    expect(contentClampStyle(1194)).toEqual(clamp);
  });

  it('returns one shared object per class, so spreading it never invalidates a memo', () => {
    expect(contentClampStyle(700)).toBe(contentClampStyle(1024));
    expect(contentClampStyle(390)).toBe(contentClampStyle(320));
  });

  it('is frozen — a caller cannot mutate the recipe for everyone else', () => {
    expect(Object.isFrozen(contentClampStyle(1024))).toBe(true);
    expect(Object.isFrozen(contentClampStyle(390))).toBe(true);
  });
});
