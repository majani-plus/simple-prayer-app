/**
 * `@gorhom/bottom-sheet`, as a test run sees it. Picked up automatically for every suite, because
 * a `__mocks__` directory beside `node_modules` replaces a node module without anyone asking.
 *
 * ## Why the real library cannot run here
 *
 * The library is consumed from source (its package.json points `react-native` at `src/index.ts`),
 * so our Babel pass compiles its worklets, and CommonJS interop means a worklet that mentions one
 * thing from `react-native` captures the **whole module object**. Reanimated walks a worklet's
 * closure looking for shared values, so it enumerates that object — and `react-native`'s entry
 * point exposes its deprecated members as lazy getters that call
 * `TurboModuleRegistry.getEnforcing`. In the app they resolve; in a test run each one throws for a
 * different missing native module (`DevMenu`, then `SettingsManager`, then the next), and the
 * sheet's whole render dies with it. Stubbing them is an unbounded list, so the library itself is
 * stood in for instead.
 *
 * ## What this mock is, and what it therefore does NOT test
 *
 * It models the sheet as **slots and mounting**: the backdrop, the handle and the content,
 * rendered the way `components/BottomSheet` composes them, plus the two behaviours our code
 * depends on — that a modal holds its content only between `present()` and `dismiss()`, and that
 * dismissing reports back through `onDismiss`. That mounting is the real library's too (a
 * dismissed `BottomSheetModal` takes its node out of the tree), which is what keeps every "renders
 * nothing while closed" assertion in the suite meaning what it says.
 *
 * What is consequently NOT covered anywhere in jest: the entrance and exit animations, the backdrop
 * fade, dynamic sizing and its height cap, and the drag-to-dismiss gesture — including the one that
 * matters most since D141, a drag over a scrollable handing off between list and sheet. Those are
 * the library's own, they are asserted by its suite rather than ours, and the only honest check of
 * them is a device — see the sheet's own notes and D113.
 */

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

interface SlotProps {
  animatedIndex: SharedValue<number>;
  animatedPosition: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
}

interface ModalProps {
  children?: ReactNode;
  backdropComponent?: (props: SlotProps) => ReactNode;
  handleComponent?: (props: SlotProps) => ReactNode;
  backgroundStyle?: StyleProp<ViewStyle>;
  /** The sheet container's own style, as the real library applies it. */
  style?: StyleProp<ViewStyle>;
  onDismiss?: () => void;
}

/** The methods `components/BottomSheet` drives the sheet with. */
export interface BottomSheetModalMethods {
  present: () => void;
  dismiss: () => void;
}

/** Passthrough: the host has no behaviour worth modelling. */
export function BottomSheetModalProvider({ children }: PropsWithChildren) {
  return <>{children}</>;
}

/**
 * A sheet: nothing at all until presented, then scrim, paper, handle and content.
 *
 * @param onDismiss - Reported when a presented sheet is dismissed, as the library does after its
 * exit animation has played.
 * @returns The sheet's slots in the order they paint, or `null` while it is dismissed.
 */
export const BottomSheetModal = forwardRef<BottomSheetModalMethods, ModalProps>(
  function BottomSheetModal(
    { children, backdropComponent, handleComponent, backgroundStyle, style, onDismiss },
    ref
  ) {
    const [presented, setPresented] = useState(false);
    // The same fact as `presented`, readable the instant it changes: `onDismiss` is reported from
    // the call itself, as the library reports it from the end of its exit animation — never from
    // inside a state updater, which React is free to run twice or later.
    const isPresented = useRef(false);
    const animatedIndex = useSharedValue(0);
    const animatedPosition = useSharedValue(0);

    useImperativeHandle(ref, () => ({
      present: () => {
        isPresented.current = true;
        setPresented(true);
      },
      dismiss: () => {
        // A dismissed sheet dismisses no further, and reports nothing twice.
        if (!isPresented.current) return;
        isPresented.current = false;
        setPresented(false);
        onDismiss?.();
      },
    }));

    if (!presented) return null;

    const slots: SlotProps = { animatedIndex, animatedPosition };

    // `style` lands on the container, as it does in the real library — which is what makes the
    // sheet's width clamp (D123) observable from a test.
    return (
      <View style={style}>
        {backdropComponent?.({ ...slots, style: StyleSheet.absoluteFill })}
        <View style={backgroundStyle} />
        {handleComponent?.(slots)}
        {children}
      </View>
    );
  }
);

/**
 * The content container. The real one measures itself so the sheet can size to it; here it is a
 * plain view, and the props it is given (`testID`, padding) pass through unchanged.
 */
export function BottomSheetView({
  children,
  ...rest
}: PropsWithChildren<{ testID?: string; style?: StyleProp<ViewStyle> }>) {
  return <View {...rest}>{children}</View>;
}

/**
 * The scrolling content container — the one a sheet uses when its body is long (D141). The real one
 * also negotiates the drag with the sheet; here it is an ordinary scroll view, because that
 * hand-off is a gesture and a gesture is not something a test run can feel.
 */
export function BottomSheetScrollView({
  children,
  ...rest
}: PropsWithChildren<{ testID?: string; style?: StyleProp<ViewStyle> }>) {
  return <ScrollView {...rest}>{children}</ScrollView>;
}

/** The real hook memoises a Reanimated timing config; the config itself is all we pass on. */
export function useBottomSheetTimingConfigs<T>(config: T): T {
  return config;
}

export type BottomSheetBackdropProps = SlotProps;
export type BottomSheetHandleProps = SlotProps;
