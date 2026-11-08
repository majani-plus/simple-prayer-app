import type { ViewStyle } from 'react-native';
import { useWindowDimensions } from 'react-native';

import {
  contentClampPadding,
  contentClampStyle,
  contentWidth,
  widthClass,
  type WidthClass,
} from '@/theme';

export interface Layout {
  /** Which of the three width steps the window is in (D123). */
  widthClass: WidthClass;
  /** True at `'expanded'` — the two-pane layouts. Spelled out because every screen asks. */
  isExpanded: boolean;
  /** The window, or the content column when the window is wider than one. */
  contentWidth: number;
  /** Spread into a `contentContainerStyle` to centre and clamp the column; `{}` on a phone. */
  contentClampStyle: ViewStyle;
  /** Centres a ScrollView's content container; pass the screen's own horizontal padding. */
  contentClampPadding: (gutter: number) => ViewStyle;
  /** The raw window width, for the sizing functions that take it. */
  windowWidth: number;
}

/**
 * The window's width class and the layout values derived from it.
 *
 * One hook so a screen never re-derives the breakpoints itself, and so every consumer re-renders
 * on the same signal: `useWindowDimensions()` fires on rotation, on an iPad Split View drag and on
 * a foldable folding, which is exactly the set of events that should change a layout.
 *
 * Everything here is a plain derivation of one number — safe under the React Compiler, and cheap
 * enough that memoising it would cost more than it saves.
 */
export function useLayout(): Layout {
  const { width } = useWindowDimensions();
  const currentClass = widthClass(width);
  return {
    widthClass: currentClass,
    isExpanded: currentClass === 'expanded',
    contentWidth: contentWidth(width),
    contentClampStyle: contentClampStyle(width),
    contentClampPadding: (gutter: number) => contentClampPadding(width, gutter),
    windowWidth: width,
  };
}
