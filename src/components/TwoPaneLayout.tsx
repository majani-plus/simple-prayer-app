import { View } from 'react-native';

import { DIVIDER_WIDTH, VerticalDivider } from './VerticalDivider';

import type { ReactNode } from 'react';

/**
 * Two panes side by side, with the ◆ seam between them — the expanded-width layout every adapting
 * tab is built from (D124).
 *
 * **Direction is never stated.** The row is a plain `flexDirection: 'row'`, so in Arabic the panes
 * swap sides by themselves and the reading order stays leading-to-trailing. Nothing here says
 * left or right, and nothing should: a hand-mirrored layout is the one that gets it wrong.
 *
 * **The panes are independent.** Each side owns its own scroll view, because the two columns have
 * genuinely different natural heights — five prayer rows and a hero against a month grid and its
 * stats — and a shared scroll would drag one pane's blank paper past the other's content. It also
 * means the Today hero, which is the thing that ticks, stays put while the other pane is read.
 */

/** The default split: the primary pane keeps the larger share. */
const START_FLEX = 55;
const END_FLEX = 45;

export interface TwoPaneLayoutProps {
  /** The leading pane — the trailing one in a right-to-left language, automatically. */
  start: ReactNode;
  end: ReactNode;
  /** Flex weights, if the default 55/45 is wrong for a screen. */
  startFlex?: number;
  endFlex?: number;
  /** Panes get `${testID}-start` and `${testID}-end`; the seam gets `${testID}-seam`. */
  testID?: string;
}

/**
 * @param start - Content for the leading pane.
 * @param end - Content for the trailing pane.
 * @returns A full-height row of two panes divided by a `VerticalDivider`.
 */
export function TwoPaneLayout({
  start,
  end,
  startFlex = START_FLEX,
  endFlex = END_FLEX,
  testID,
}: TwoPaneLayoutProps) {
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <View testID={testID === undefined ? undefined : `${testID}-start`} style={{ flex: startFlex }}>
        {start}
      </View>
      <VerticalDivider testID={testID === undefined ? undefined : `${testID}-seam`} />
      <View testID={testID === undefined ? undefined : `${testID}-end`} style={{ flex: endFlex }}>
        {end}
      </View>
    </View>
  );
}

/**
 * The share of the window a pane gets, for the few things that must size themselves before layout
 * can tell them — the compass dial, which has to be a square of a known side.
 *
 * @param windowWidth - Window width in points.
 * @param flex - That pane's flex weight (default: the start pane's).
 * @param totalFlex - Both weights added (default 100).
 * @returns The pane's width in points.
 */
export function paneWidth(
  windowWidth: number,
  flex: number = START_FLEX,
  totalFlex: number = START_FLEX + END_FLEX
): number {
  return ((windowWidth - DIVIDER_WIDTH) * flex) / totalFlex;
}
