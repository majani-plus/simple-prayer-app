import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
  type RefObject,
} from 'react';
import {
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewInstance,
  type ViewStyle,
} from 'react-native';

import { motion } from '@/theme';

/**
 * Tap-outside dismissal for the seal's open pill: "I opened the choices, decided not to change
 * anything, and tapped away" must close the pill without logging (PRODUCT_SPEC §2's calm rule —
 * the app never traps a decision).
 *
 * The boundary is a **pass-through listener, not an overlay**. It watches every touch that starts
 * inside it via the *capture* phase of the responder negotiation and always answers "no" — it
 * never claims the gesture — so nothing else changes: scrolling still scrolls, the back gesture
 * still works, and tapping a different row's seal still opens it (the same touch closes the first
 * pill on its way down). An overlay would have swallowed that first tap, making every dismissal
 * cost an extra one.
 *
 * Who knows what, and why it is split this way:
 *
 * - The **boundary** wraps a screen's content and hears every touch, but has no idea whether a
 *   pill is open or where it is.
 * - The **open pill** knows exactly that, so it registers itself (frame + close callback) through
 *   context while it is open — `PrayerRow` wires this via {@link useSealDismissRegion}, which is
 *   how every screen that renders prayer rows inherits the behaviour without wiring of its own.
 *
 * A touch *inside* the registered frame is left entirely to the pill's own controls (the three
 * options and the internal dismiss surface). While the frame is still
 * unmeasured the touch dismisses: closing one beat early is a calmer failure than a pill that
 * cannot be tapped away.
 */

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What an open pill tells the boundary: where it is, and how to close it. */
interface OpenSealRegion {
  /** Window-space frame of the pill; `null` until the async measurement lands. */
  frame: Frame | null;
  /** Guards against a second finger re-toggling the pill before React applies the first close. */
  dismissed: boolean;
  dismiss: () => void;
}

interface SealDismissRegistry {
  /** Registers the one open pill. Returns the matching unregister. */
  register: (region: OpenSealRegion) => () => void;
}

const SealDismissContext = createContext<SealDismissRegistry | null>(null);

export interface SealDismissBoundaryProps {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The listening surface. Wrap it around everything a stray "never mind" tap could land on —
 * the Today tab wraps its scroll view, the day-detail sheet wraps its whole modal.
 *
 * @returns A plain `View` (layout comes from `style`) that watches touches without claiming them.
 */
export function SealDismissBoundary({
  children,
  style,
  testID,
}: PropsWithChildren<SealDismissBoundaryProps>) {
  const regionRef = useRef<OpenSealRegion | null>(null);

  const register = useCallback((region: OpenSealRegion) => {
    regionRef.current = region;
    return () => {
      if (regionRef.current === region) regionRef.current = null;
    };
  }, []);
  const registry = useMemo(() => ({ register }), [register]);

  const handleCaptureStart = useCallback((event: GestureResponderEvent) => {
    const region = regionRef.current;
    if (region !== null && !region.dismissed) {
      const { pageX, pageY } = event.nativeEvent;
      const frame = region.frame;
      const insidePill =
        frame !== null &&
        pageX >= frame.x &&
        pageX <= frame.x + frame.width &&
        pageY >= frame.y &&
        pageY <= frame.y + frame.height;
      if (!insidePill) {
        region.dismissed = true;
        region.dismiss();
      }
    }
    // Never the responder: the touch continues to whatever it was aimed at.
    return false;
  }, []);

  return (
    <SealDismissContext.Provider value={registry}>
      <View style={style} testID={testID} onStartShouldSetResponderCapture={handleCaptureStart}>
        {children}
      </View>
    </SealDismissContext.Provider>
  );
}

/**
 * Registers `viewRef`'s frame as the open pill while `active`, so any touch outside it closes it.
 *
 * @param active - Whether this pill is the open one (the parent's `isOpen`).
 * @param viewRef - The view whose window-space frame bounds "inside the pill".
 * @param onDismiss - Close callback; called at most once per open, and only for outside touches.
 * @returns A remeasure callback, for a view whose frame can change while it stays open. The pill's
 * own morph needs none: the frame is measured on open and again once the morph has finished.
 */
export function useSealDismissRegion(
  active: boolean,
  viewRef: RefObject<ViewInstance | null>,
  onDismiss: () => void
): () => void {
  const registry = useContext(SealDismissContext);
  const regionRef = useRef<OpenSealRegion | null>(null);

  // Kept in a ref so a re-render with a new callback identity never re-registers mid-touch.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  const measure = useCallback(() => {
    const region = regionRef.current;
    if (region === null) return;
    viewRef.current?.measureInWindow((x, y, width, height) => {
      region.frame = { x, y, width, height };
    });
  }, [viewRef]);

  useEffect(() => {
    // Outside a boundary (or while closed) there is nothing to register — the hook is inert.
    if (!active || registry === null) return;
    const region: OpenSealRegion = {
      frame: null,
      dismissed: false,
      dismiss: () => dismissRef.current(),
    };
    regionRef.current = region;
    const unregister = registry.register(region);
    measure();
    // Once more when the 48→160 morph has landed, so "inside the pill" is the pill's final shape
    // and not the circle it grew from. This used to ride the slot's `onLayout`, which fires on
    // every frame of the morph and made each frame a JS round trip plus a native measure.
    const settled = setTimeout(measure, motion.morph);
    return () => {
      clearTimeout(settled);
      regionRef.current = null;
      unregister();
    };
  }, [active, registry, measure]);

  return measure;
}
