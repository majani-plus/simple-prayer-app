import type { ViewStyle } from 'react-native';

/**
 * How wide the window is, in three named steps — the whole vocabulary for tablet, foldable and
 * split-screen layout (D123).
 *
 * Every layout decision in the app keys off the *window* width, never the device: `Platform.isPad`
 * cannot tell an iPad in a third-width Split View (a phone-shaped window) from an iPhone, and it
 * answers wrongly for a foldable, which is two devices in one shell. Deriving from the live window
 * means rotation, Split View drags and folding all arrive through the same door — `useLayout()`
 * re-renders and the layout follows, with nothing to keep in sync.
 *
 * The steps are the platform-conventional ones (Material window size classes; Apple's regular
 * width begins at the same place), which is also where the content actually stops fitting: below
 * 600 a single phone column IS the layout, from 600 the column has room to spare around it, and by
 * 840 two columns fit side by side without either falling under a phone's worth of width.
 *
 * Note for anyone writing a test: the jest environment's window is 750×1334, i.e. **medium** — a
 * screen test that does not spy on `Dimensions.get` is exercising the clamped column, not the
 * phone. `src/components/__tests__/PrayerSeal.test.tsx` shows the spy that pins a real phone width.
 */
export type WidthClass = 'compact' | 'medium' | 'expanded';

/** Where each width class begins, in points. Below `medium` is compact. */
export const breakpoints = {
  medium: 600,
  expanded: 840,
} as const;

/**
 * The widest a single reading column may grow, in points.
 *
 * The type scale is authored at a 390pt phone width and has been *raised* four times because the
 * audience skews older (D67, D74) — so a wide window must not turn into a wide column of the same
 * type. 600 keeps a comfortable measure at that scale (roughly 60–70 characters at the body size)
 * and, not by coincidence, keeps the paper sheet feeling like a page rather than a wall.
 */
export const maxContentWidth = 600;

/**
 * Which width class a window of this width belongs to.
 *
 * @param width - Window width in points, from `useWindowDimensions()`.
 */
export function widthClass(width: number): WidthClass {
  if (width >= breakpoints.expanded) return 'expanded';
  if (width >= breakpoints.medium) return 'medium';
  return 'compact';
}

/**
 * The width sizing maths should treat as "the screen": the window, or the content column once the
 * window is wider than one.
 *
 * The components that grow with the screen — the seal's option pill, the stats columns — were
 * written against a phone, where window and column are the same thing. Handing them the column
 * keeps their ratios meaning what they meant: 78% of the pill's room, not 78% of a 1024pt iPad.
 *
 * @param windowWidth - Window width in points.
 */
export function contentWidth(windowWidth: number): number {
  return Math.min(windowWidth, maxContentWidth);
}

/** Medium and up: one centred column. Frozen and shared so the identity is stable per class. */
const CLAMPED: ViewStyle = Object.freeze({
  width: '100%',
  maxWidth: maxContentWidth,
  alignSelf: 'center',
});

/** Compact: nothing at all, so a phone renders exactly what it rendered before D123. */
const UNCLAMPED: ViewStyle = Object.freeze({});

/**
 * The same clamp, for a **`ScrollView`'s `contentContainerStyle`** — where the one above does not
 * work.
 *
 * A scroll host sizes its own content container, so `alignSelf` on it means nothing and auto
 * margins have no free space to distribute (both measured on an iPad, not assumed). `maxWidth`
 * still applied, which is the worst of both: the column was the right width and sat against the
 * START edge — hard left in English and Turkish, hard right in Arabic — while a screen's footer,
 * an ordinary flex child, centred correctly. D123 says "one centred column"; on every screen that
 * scrolls, it was one column shoved to the side.
 *
 * Symmetric padding centres it with no dependence on flex semantics, and leaves the children
 * stretching exactly as they do on a phone. The floor keeps the screen's own gutter at widths
 * where the column is nearly the whole window.
 *
 * Only for a container whose width IS the window. A pane in a two-pane layout is narrower than the
 * window and already sits inside its own column, so it must keep using `contentClampStyle`, where
 * the clamp is a harmless no-op at pane widths.
 *
 * @param windowWidth - Window width in points.
 * @param gutter - The screen's own horizontal padding, used as the minimum.
 */
export function contentClampPadding(windowWidth: number, gutter: number): ViewStyle {
  if (widthClass(windowWidth) === 'compact') return UNCLAMPED;
  return { paddingHorizontal: Math.max(gutter, (windowWidth - maxContentWidth) / 2) };
}

/**
 * The clamp to spread into a screen's `contentContainerStyle` (or any block that would otherwise
 * span the whole window).
 *
 * Returns an empty style on a compact window — phones are untouched, byte for byte — and the
 * centred-column recipe from `breakpoints.medium` up. Both objects are frozen module constants, so
 * spreading this on every render costs nothing and never invalidates a memo.
 *
 * @param windowWidth - Window width in points.
 */
export function contentClampStyle(windowWidth: number): ViewStyle {
  return widthClass(windowWidth) === 'compact' ? UNCLAMPED : CLAMPED;
}
