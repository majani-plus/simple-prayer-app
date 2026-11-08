/**
 * One rule, shared by every screen that hands off from one bottom sheet to another.
 *
 * ## The bug this exists to prevent
 *
 * `BottomSheet` unmounts when `visible` turns false, and the sheet library reports the dismissal
 * on the way out — so choosing "I'm travelling" in Today's ⋯ menu produced this order:
 *
 * 1. the menu item sets the open sheet to `travelBegin`;
 * 2. the ⋯ sheet's `visible` is now false, so it unmounts and calls its `onClose`;
 * 3. that handler set the open sheet to `none` — closing the sheet step 1 had just opened.
 *
 * The travel sheet appeared and vanished (owner, 2026-08-28). The exemption sheets reached from
 * the same menu had the same defect; nothing caught it, because under Jest the library does not
 * report a dismissal on unmount, only a real gesture does — so the screen tests stayed green.
 *
 * The rule: **a sheet's dismissal may only close that sheet.** A handler that arrives late, for a
 * sheet that is no longer the one on screen, changes nothing.
 */

/**
 * The open-sheet state after `closing` reports its dismissal.
 *
 * @param current - Which sheet the screen currently has open.
 * @param closing - Which sheet is reporting that it closed.
 * @param none - The value meaning "no sheet is open" (each screen names its own).
 * @returns `none` when the closing sheet is the one on screen; `current` untouched otherwise.
 */
export function afterSheetDismissed<T extends string>(current: T, closing: T, none: T): T {
  return current === closing ? none : current;
}
