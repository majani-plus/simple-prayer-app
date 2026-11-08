/**
 * The sheet hand-off rule — the fix for the travel sheet that opened and closed itself
 * (owner, 2026-08-28). See `sheetTransition.ts` for the full sequence.
 */

import { afterSheetDismissed } from './sheetTransition';

type TodaySheet = 'none' | 'overflow' | 'begin' | 'end' | 'travelBegin';

const after = (current: TodaySheet, closing: TodaySheet) =>
  afterSheetDismissed<TodaySheet>(current, closing, 'none');

describe('afterSheetDismissed', () => {
  it('closes the sheet that is on screen', () => {
    expect(after('overflow', 'overflow')).toBe('none');
    expect(after('travelBegin', 'travelBegin')).toBe('none');
  });

  it('IGNORES a dismissal from a sheet that has already been replaced — the bug', () => {
    // The ⋯ menu reports its dismissal after "I'm travelling" opened the travel sheet. The
    // travel sheet must survive it.
    expect(after('travelBegin', 'overflow')).toBe('travelBegin');
    // Same hand-off, the exemption sheets reached from the same menu.
    expect(after('begin', 'overflow')).toBe('begin');
    expect(after('end', 'overflow')).toBe('end');
  });

  it('leaves an already-closed screen closed, however late a handler arrives', () => {
    expect(after('none', 'overflow')).toBe('none');
    expect(after('none', 'travelBegin')).toBe('none');
  });

  it('never opens a sheet, whatever it is told', () => {
    const kinds: TodaySheet[] = ['none', 'overflow', 'begin', 'end', 'travelBegin'];
    for (const current of kinds) {
      for (const closing of kinds) {
        const next = after(current, closing);
        expect(next === current || next === 'none').toBe(true);
      }
    }
  });
});
