import {
  BottomSheetModal,
  BottomSheetScrollView,
  useBottomSheetTimingConfigs,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SealDismissBoundary } from './SealDismiss';
import { useLayout } from '@/hooks/useLayout';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { radius, spacing, useTheme } from '@/theme';

/**
 * The one bottom sheet every sheet in the app is made of — the day detail, and all the exemption,
 * travel and ⋯ sheets. Scrim, paper card, grabber, safe-area padding, and the three ways a native
 * sheet lets you leave: **drag it down**, tap the backdrop, or press Android back.
 *
 * A thin wrapper over `@gorhom/bottom-sheet` (D113): the library renders in-tree, in the
 * `BottomSheetModalProvider`'s portal host at the root of the app (see `app/_layout`), above the
 * navigator and inside the edge-to-edge root — so one absolute-fill scrim dims everything, tab bar
 * and system nav bar included, and its opacity is driven by the sheet's own animated index, which
 * means it fades in, fades out, and tracks the finger through a drag-dismiss.
 *
 * ## What is ours, and what is the library's
 *
 * Almost everything is the library's, and this file is deliberately short. Ours, because the
 * library has no answer for them:
 *
 * - **Android back.** The library ships no handler of its own; {@link BackHandler} below is it.
 * - **The backdrop.** {@link ScrimBackdrop} rather than the library's, which presses through a
 *   gesture handler with no test id: this one is a labelled `Pressable`, which is how a screen
 *   reader reaches the dismissal and how the suite asserts it.
 * - **Reduced motion**, honoured through the app's own {@link useReduceMotion} with
 *   `overrideReduceMotion` pinned to `Never`, so nothing under us can decide to skip the
 *   presentation entirely and leave a sheet that never appears.
 *
 * The library's, and therefore not re-implemented here: presentation and dismissal and their
 * animations, the drag and its thresholds, the sheet's height, and **mounting** — a dismissed
 * modal takes its own node out of the tree, so a closed sheet's content is genuinely gone and
 * cannot hold stale state between openings. `visible` only ever asks it to present or dismiss;
 * the exit animation always gets to play, and `onDismiss` reports the close once it has.
 *
 * ## Where the drag lives
 *
 * Everywhere on the card, which is the library's default and the platform's behaviour. The body is
 * the library's own scroll view, which is what makes the two gestures agree instead of fight: a
 * drag over a long list scrolls the list, and carries the sheet only once the list is already at
 * its top.
 *
 * The app ran the other way until 2026-08-30 — the pan was on the handle alone, kept from the
 * hand-built sheet this replaced (D113) — and it cost exactly what you would expect: *"in the
 * bottom sheets like the previous day, or history tab clicking on a day, I can't collapse the
 * sheet by scrolling on the content, only scrolling on the header bar"* (owner). See D141.
 *
 * ## How tall a sheet gets, and why the body always scrolls
 *
 * Dynamic: a sheet is as tall as its content and no taller, up to {@link MAX_HEIGHT_FRACTION} of
 * the window. Past that cap the body scrolls — which is not only for the sheets with lists in
 * them. A sheet whose content is comfortable at the default text size can easily outgrow the
 * window at the largest one, and before the body scrolled, whatever fell past the cap was simply
 * unreachable. So every sheet scrolls, and a body that fits looks and behaves exactly as it did.
 *
 * A caller whose content is a long list can cap the sheet lower than the default — see
 * {@link BottomSheetProps.maxHeightFraction}.
 *
 * Exactly ONE of the library's content containers may be in a sheet, because each reports its own
 * height as *the* content height. The scroll view here is it: a sheet body must never bring its
 * own, or the sheet's height and the drag hand-off both come apart.
 *
 * ## Accessibility
 *
 * The grabber is hidden from screen readers: dragging is not a gesture VoiceOver offers, and the
 * backdrop is a labelled "Close" button, which is the route assistive tech uses.
 */

/** The grabber. Wider and thicker than a hairline: it is an affordance, not an ornament. */
const HANDLE_WIDTH = 44;
const HANDLE_HEIGHT = 5;

/** How much of the window a sheet may fill before its content has to give. */
const MAX_HEIGHT_FRACTION = 0.88;

export interface BottomSheetProps {
  /** Presents the sheet; `false` dismisses it, exit animation and all. */
  visible: boolean;
  /** Dismissed by the user — by drag, backdrop tap, or Android back. Never fired for a close the
   * caller itself asked for by turning `visible` off. */
  onClose: () => void;
  /** Accessible label for the backdrop's dismiss button, e.g. "Close". */
  dismissLabel: string;
  /**
   * The sheet's header, rendered under the grabber. It stays put while the body scrolls under it,
   * so it is the place for a title or a title row — not for content.
   */
  header?: ReactNode;
  /** The sheet's body. Scrolls when it outgrows the sheet, so it never brings a scroll view. */
  children: ReactNode;
  /**
   * How much of the window this sheet may fill, if not {@link MAX_HEIGHT_FRACTION}. Lower it for a
   * body that *could* run the whole height but should not: a 30-day picker is newest-first, so a
   * full-height sheet would push the likeliest pick furthest from the thumb.
   */
  maxHeightFraction?: number;
  /**
   * Wraps the sheet's content in a {@link SealDismissBoundary} with this test id, for sheets that
   * render prayer seals — a tap on the sheet's own paper then closes an open pill without
   * closing the sheet.
   */
  sealDismissTestID?: string;
  /**
   * For a sheet with a text field: the sheet rises with the keyboard and settles back when it
   * goes, instead of the field vanishing under it. Off by default — most sheets have no field, and
   * the keyboard tracking has a cost on every frame it is on.
   */
  keyboard?: boolean;
  testID: string;
}

/**
 * The bottom sheet.
 *
 * @param visible - Whether the sheet should be on screen.
 * @returns The sheet, portalled to the app root. Renders nothing while dismissed.
 */
export function BottomSheet({
  visible,
  onClose,
  dismissLabel,
  header,
  children,
  maxHeightFraction = MAX_HEIGHT_FRACTION,
  sealDismissTestID,
  keyboard = false,
  testID,
}: BottomSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampStyle } = useLayout();
  const reduceMotion = useReduceMotion();
  const { height: windowHeight } = useWindowDimensions();

  const sheet = useRef<BottomSheetModal>(null);
  // What the caller last asked for. `onDismiss` fires for every dismissal, ours included, and only
  // the user's is news — see `handleDismiss`.
  const asked = useRef<'present' | 'dismiss'>('dismiss');
  // Bumped by every dismissal, only to run the effect below again: `visible` is what the sheet
  // should be, so a dismissal the caller does not act on has to be reconciled, not obeyed.
  const [dismissals, setDismissals] = useState(0);

  useEffect(() => {
    if (visible) {
      asked.current = 'present';
      sheet.current?.present();
    } else if (asked.current === 'present') {
      asked.current = 'dismiss';
      sheet.current?.dismiss();
    }
  }, [visible, dismissals]);

  // The library leaves the hardware button alone, so this is where "Android back closes the sheet"
  // lives. Only while this sheet is the open one: several sheets are mounted at once on a screen
  // that offers several, and a closed one must not answer the press.
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      sheet.current?.dismiss();
      return true;
    });
    return () => subscription.remove();
  }, [visible]);

  /**
   * Reported by the library once a dismissal has finished, however it started.
   *
   * A close the caller asked for by turning `visible` off is not told back to it — it knows, and
   * telling it would close a sheet it may have opened in between: that is exactly how choosing
   * "I'm travelling" from Today's ⋯ menu once flashed the travel sheet and shut it again (owner,
   * 2026-08-28). Flipping the intent here also makes a second dismissal — a flick that lands as
   * Android back fires — a no-op.
   *
   * Every dismissal then re-runs the effect above, because `visible` outranks the library: a
   * caller that does not act on `onClose` still means "open", and gets its sheet back rather than
   * a live `visible` with nothing on screen.
   */
  const handleDismiss = useCallback(() => {
    setDismissals((count) => count + 1);
    if (asked.current === 'dismiss') return;
    asked.current = 'dismiss';
    onClose();
  }, [onClose]);

  const dismiss = useCallback(() => {
    sheet.current?.dismiss();
  }, []);

  // Reduced motion: a 1ms timing rather than "no animation", because the sheet still has to end up
  // presented — and `ReduceMotion.Never` keeps the animation library from making that call itself.
  const jumpCut = useBottomSheetTimingConfigs({ duration: 1, reduceMotion: ReduceMotion.Never });
  // The library's own iOS default is a heavily overdamped spring (damping 500, mass 3): about half
  // a second before the sheet has covered two thirds of its travel, which reads as the app
  // hesitating. Its Android default — 250ms, exponential ease-out — arrives fast and settles soft,
  // so both platforms use that.
  const open = useBottomSheetTimingConfigs({
    duration: 250,
    easing: Easing.out(Easing.exp),
    reduceMotion: ReduceMotion.Never,
  });

  const renderBackdrop = useCallback(
    (backdropProps: BottomSheetBackdropProps) => (
      <ScrimBackdrop
        {...backdropProps}
        color={colors.scrim}
        dismissLabel={dismissLabel}
        onPress={dismiss}
        testID={`${testID}-backdrop`}
      />
    ),
    [colors.scrim, dismissLabel, dismiss, testID]
  );

  const renderHandle = useCallback(
    () => (
      // `collapsable={false}` keeps this a real view on Android, which the gesture handler needs
      // to attach to.
      <View testID={`${testID}-drag`} collapsable={false} style={styles.handle}>
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.handleRow}
        >
          <View
            style={{
              width: HANDLE_WIDTH,
              height: HANDLE_HEIGHT,
              borderRadius: radius.pill,
              backgroundColor: colors.borderMid,
            }}
          />
        </View>
        {header}
      </View>
    ),
    [colors.borderMid, header, testID]
  );

  const content = (
    <View
      testID={`${testID}-sheet`}
      style={{ paddingHorizontal: spacing.xl, paddingBottom: insets.bottom + spacing.xl }}
    >
      {children}
    </View>
  );

  return (
    <BottomSheetModal
      ref={sheet}
      // Clamped and centred on a window wider than a phone (D123). A sheet answers the page above
      // it, so it keeps that page's measure rather than spanning an iPad; it stays bottom-anchored
      // either way, and its bottom corners stay square because it still meets the screen's edge.
      style={contentClampStyle}
      enablePanDownToClose
      enableDynamicSizing
      maxDynamicContentSize={windowHeight * maxHeightFraction}
      overrideReduceMotion={ReduceMotion.Never}
      animationConfigs={reduceMotion ? jumpCut : open}
      onDismiss={handleDismiss}
      keyboardBehavior={keyboard ? 'interactive' : undefined}
      keyboardBlurBehavior={keyboard ? 'restore' : undefined}
      android_keyboardInputMode={keyboard ? 'adjustResize' : undefined}
      backdropComponent={renderBackdrop}
      handleComponent={renderHandle}
      // The `Card variant="elevated" border="mid"` paper, expressed as the sheet's own background
      // so the library owns one view instead of two: same fill, same hairline, the design's large
      // radius on the top corners only.
      backgroundStyle={{
        backgroundColor: colors.cardElevated,
        borderColor: colors.borderMid,
        borderWidth: 1,
        borderTopLeftRadius: radius.cardLarge,
        borderTopRightRadius: radius.cardLarge,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
      }}
    >
      <BottomSheetScrollView testID={testID} style={styles.body}>
        {sealDismissTestID === undefined ? (
          content
        ) : (
          <SealDismissBoundary testID={sealDismissTestID}>{content}</SealDismissBoundary>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

interface ScrimBackdropProps extends BottomSheetBackdropProps {
  /** The scrim colour, alpha included. */
  color: string;
  /** Accessible label for the dismiss button the scrim is. */
  dismissLabel: string;
  onPress: () => void;
  testID: string;
}

/**
 * The dim layer behind the sheet, and the app's "tap outside to close" target.
 *
 * Its opacity is interpolated from the sheet's own `animatedIndex` (−1 closed → 0 open), which is
 * what makes it **fade**: in on present, out on dismiss, and continuously while a drag carries the
 * sheet back down. The library's own `BottomSheetBackdrop` would do the same fade, but it presses
 * through a gesture handler rather than a `Pressable`, and this app's tests reach the dismissal by
 * pressing the backdrop — which is also how a screen reader reaches it.
 *
 * `colors.scrim`, not `colors.ink` at an opacity: a scrim has to darken in BOTH themes, and night
 * paper's ink is cream — it would wash the page pale behind the sheet. The token carries its own
 * alpha, so each palette chooses how hard it pushes back, and the opacity animated here runs from
 * nothing to exactly that.
 *
 * @param animatedIndex - The sheet's position, −1 when fully closed.
 * @returns The scrim, wrapping a full-bleed dismiss button.
 */
function ScrimBackdrop({
  animatedIndex,
  style,
  color,
  dismissLabel,
  onPress,
  testID,
}: ScrimBackdropProps) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(animatedIndex.get(), [-1, 0], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View style={[style, { backgroundColor: color }, animatedStyle]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={dismissLabel}
        onPress={onPress}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /**
   * The scroll view fills the sheet rather than growing to its content — which is what makes a
   * body past the cap scroll INSIDE the sheet instead of spilling out of it, rows painting over
   * the scrim above the card. The library applies exactly this itself, but only in
   * `ScrollableContainer.android`; its iOS container passes no style at all, so on iOS the scroll
   * view is content-sized and overflows. Applying it here covers both platforms identically.
   */
  body: { flex: 1 },
  handle: { paddingTop: spacing.xs, paddingHorizontal: spacing.xl },
  handleRow: {
    alignItems: 'center',
    // A generous, invisible grip: the visible line is 5pt, the pullable band is 20.
    paddingVertical: 8,
    marginBottom: spacing.xs,
  },
});
