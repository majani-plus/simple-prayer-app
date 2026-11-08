import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { CARDINAL_KEYS } from '@/domain/qibla';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { contentWidth, motion, spacing, useTheme, widthClass } from '@/theme';

/**
 * The compass dial (design 3a — docs/DESIGN.md §Qibla, PRODUCT_SPEC §9).
 *
 * A 288pt disc made of four rings of information: 36 ticks and the four cardinal letters on a ring
 * that turns with the device, a Makkah badge riding that ring at the Qibla bearing, a needle
 * showing the offset between the two, and — fixed to the screen, not to the ring — the pointer
 * triangle at the top and the centre pin.
 *
 * ## The one rule: the sensor never touches React
 *
 * `heading` is a Reanimated `SharedValue` written on **every** magnetometer sample (see
 * `hooks/useHeading`), and every rotation here is read from it inside `useAnimatedStyle`. Nothing
 * in this component re-renders as the phone turns: at 30–60 samples a second a state update per
 * sample is exactly the stutter this screen exists to avoid. It also means the dial keeps tracking
 * while the JS thread is busy.
 *
 * Three consequences worth knowing:
 *
 * - **The dial adds no curve of its own.** The smoothing already happened upstream: the shared
 *   value is spring-animated on the UI thread towards every sensor sample
 *   (`hooks/useHeading.HEADING_SPRING` — the spring PRODUCT_SPEC §9 and D15 call for). Layering a
 *   second curve here would only add lag, so every rotation reads the value directly. The one
 *   animation this component owns is {@link CompassDialProps.pulse}, for a discrete event like
 *   Recalibrate.
 * - **The heading is a *continuous* angle** (it may be 720° or −40°), which is precisely why the
 *   ring can never take the long way round at the 0/360 wrap — the value simply never wraps.
 * - **Everything that does not rotate is memoised.** The screen re-renders this component when
 *   its spoken label changes (once per whole degree, ~6.7 Hz while turning); the ticks, the face,
 *   the cardinals, the badge, the needle shapes and the fixed markers must not be rebuilt for
 *   that — only the thin outer view reconciles.
 *
 * ## Counter-rotation
 *
 * The ring turns by `−heading`, so anything that must stay upright turns back by `+heading`. The
 * cardinal letters and the Makkah label do exactly that, and because the counter-rotation is
 * applied to a child of the same rotating parent, the two cancel out on the UI thread rather than
 * in a layout pass.
 *
 * ## Alignment is never colour alone
 *
 * The palette shift (gold → green) is one of *four* signals, and the only one this component owns
 * by itself: the badge glyph also changes from a mosque to a check. The label, the status pill and
 * the guidance card — the ones a colour-blind or a screen-reader user actually relies on — are the
 * screen's job, and the accessibility label passed in here states the numbers outright.
 */

/** The mockup's dial diameter. Every other measurement is scaled from it. */
export const DIAL_SIZE = 288;

/**
 * How large the dial may grow once there is room for more than a phone's worth (D125).
 *
 * The old cap was `min(288, available)` — shrink-only, which left the dial marooned at its phone
 * size in the middle of a 600pt column. 380 is about two thirds of that column: dominant the way
 * 288-of-390 is on a phone, while leaving the guidance and info cards their share of the page.
 * Past roughly 400 the scaled ticks and cardinal letters start reading oversized against the body
 * type beside them, which is unscaled — so this is a ceiling, not a target.
 */
export const DIAL_SIZE_MAX = 380;

/**
 * The dial's diameter for a window this wide.
 *
 * On a compact window this is exactly the expression the Qibla screen has always used: the phone
 * dial, shrunk if the screen is narrower than it. From medium up the ceiling rises and the room is
 * measured against the *content column* rather than the window, so the dial stays inside the page
 * the rest of the screen is bounded by.
 *
 * @param windowWidth - Window width in points.
 * @param pageWidth - The width the dial actually sits in, when that is not the content column —
 *   an expanded layout's pane. Defaults to the column.
 */
export function dialSizeForWindow(windowWidth: number, pageWidth?: number): number {
  const room = (pageWidth ?? contentWidth(windowWidth)) - spacing.xl * 2;
  const ceiling = widthClass(windowWidth) === 'compact' ? DIAL_SIZE : DIAL_SIZE_MAX;
  return Math.min(ceiling, room);
}

/** The geometry, verbatim from the mockup at a 288pt dial; scaled by `size / DIAL_SIZE`. */
const TICK_COUNT = 36;
/** Every third tick is a major one — 12 majors, one per 30°. */
const TICK_MAJOR_EVERY = 3;
const TICK_MAJOR_WIDTH = 2;
const TICK_MAJOR_LENGTH = 14;
const TICK_MAJOR_OPACITY = 0.55;
const TICK_MINOR_WIDTH = 1;
const TICK_MINOR_LENGTH = 8;
const TICK_MINOR_OPACITY = 0.28;
const CARDINAL_INSET = 20;
const CARDINAL_BOX = 28;
const CARDINAL_SIZE_MAIN = 16;
const CARDINAL_SIZE = 13;
const BADGE_INSET = 2;
const BADGE_COLUMN = 64;
const BADGE_SIZE = 38;
const BADGE_ICON = 20;
const BADGE_LABEL = 10.5;
const NEEDLE_TOP = 66;
const NEEDLE_LENGTH = 78;
const NEEDLE_WIDTH = 4;

/**
 * The floor for word-carrying text, from DESIGN.md's rule of record: nothing that spells something
 * goes below 10pt. Every label here is scaled by `size / DIAL_SIZE`, so a small enough dial would
 * take the cardinals to 7pt and "Makkah" to 6 — unreadable, and against the rule.
 *
 * A shrunken dial therefore sheds its lettering instead of shrinking it, exactly as the mosque mark
 * sheds detail on its way down to 16pt. What survives is what carries the meaning without words:
 * the ticks, the needle, and the badge's own glyph (mosque, or a check when aligned). The caption
 * beneath a glance dial says the rest out loud.
 */
const MIN_LABEL_SIZE = 10;

/** Whether a label authored at `authoredSize` still clears the floor on a dial of `size`. */
function labelFits(authoredSize: number, size: number): boolean {
  return authoredSize * (size / DIAL_SIZE) >= MIN_LABEL_SIZE;
}
const PIN_SIZE = 16;
const PIN_HALO = 4;
const POINTER_WIDTH = 16;
const POINTER_HEIGHT = 12;
/** How far the fixed pointer triangle overhangs the ring. */
const POINTER_RISE = 4;

/** The quarter of the rose each cardinal sits on, clockwise from north. */
const CARDINALS = [
  { quarter: 0, key: CARDINAL_KEYS[0] },
  { quarter: 1, key: CARDINAL_KEYS[2] },
  { quarter: 2, key: CARDINAL_KEYS[4] },
  { quarter: 3, key: CARDINAL_KEYS[6] },
] as const;

// Before the first heading fix there is nothing to point at. A dimmed needle was tried and is
// worse than none: with no heading the ring sits unrotated, so `bearing − 0` parks the needle
// exactly on the Makkah badge — the picture of *being aligned* — while the status pill and the
// guidance card say the opposite. The dial says what it knows (where Makkah is on the rose) and
// stays silent about what it does not (which way you are facing).

export interface CompassDialProps {
  /**
   * The live, smoothed, **continuous** heading in degrees (`hooks/useHeading.sharedHeading`).
   * Read on the UI thread only — passing a plain number here would defeat the whole component.
   */
  heading: SharedValue<number>;
  /** The Qibla bearing in degrees clockwise from true north (`domain/qibla.qiblaBearing`). */
  bearing: number;
  /** Whether the device is facing the Qibla; swaps the badge glyph and the gold/green palette. */
  aligned?: boolean;
  /** `false` before the first heading fix: the needle dims instead of pointing confidently. */
  live?: boolean;
  /** Diameter in points. Defaults to {@link DIAL_SIZE}; smaller screens pass their own. */
  size?: number;
  /** A counter: every increment plays one spring pulse (the Recalibrate snap). */
  pulse?: number;
  /** Spoken description — the dial is one image, and the numbers must be in it. */
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The rotating compass dial.
 *
 * @param heading - Shared value carrying the continuous smoothed heading in degrees.
 * @param bearing - The Qibla bearing in degrees from true north.
 * @returns A square, self-contained dial that animates entirely on the UI thread.
 */
export function CompassDial({
  heading,
  bearing,
  aligned = false,
  live = true,
  size = DIAL_SIZE,
  pulse = 0,
  accessibilityLabel,
  style,
  testID = 'compass-dial',
}: CompassDialProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const centre = size / 2;

  // The one piece of state the dial animates *towards* rather than from: alignment is a discrete
  // event, so a 200ms ease reads as the ring "locking on" instead of flickering on sensor noise.
  // Reduced motion: cut straight to the end state (§2.7) — the glyph swap and the screen's words
  // carry the event; the tint needs no journey. (The dial's rotation itself is sensor-driven —
  // the user's own movement — and is exempt.)
  const alignment = useSharedValue(aligned ? 1 : 0);
  useEffect(() => {
    alignment.set(reduceMotion ? (aligned ? 1 : 0) : withTiming(aligned ? 1 : 0, { duration: motion.state }));
  }, [aligned, alignment, reduceMotion]);

  // Recalibrate: one spring, and only on a real change — never on mount, where it would look
  // like the dial was still settling when it is simply being shown. Under reduced motion the
  // pulse is skipped outright: it is pure flourish, and the status pill already announces the
  // recalibration in words.
  const pulseScale = useSharedValue(1);
  const lastPulse = useRef(pulse);
  useEffect(() => {
    if (pulse === lastPulse.current) return;
    lastPulse.current = pulse;
    if (reduceMotion) return;
    pulseScale.set(
      withSequence(
        withSpring(1.035, { damping: 14, stiffness: 240 }),
        withSpring(1, { damping: 16, stiffness: 180 })
      )
    );
  }, [pulse, pulseScale, reduceMotion]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.get() }],
  }));

  // The border is its own layer: a circle looks identical at every rotation, so keeping it out of
  // the rotating view lets the ticks sit flush against the edge instead of inside a 1pt inset.
  const borderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      alignment.get(),
      [0, 1],
      [colors.hairline, colors.alignedTintBorder]
    ),
  }));

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-heading.get()}deg` }],
  }));

  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      // `direction: 'ltr'`, pinned, on the dial and everything under it. The rose is a **map**,
      // not a layout: north stays at the top, east stays on the right of it, and the needle points
      // at the Kaaba — none of which becomes truer by mirroring (DESIGN.md §RTL is explicit that
      // the dial does not turn around). Every offset inside happens to be a symmetric centring, so
      // React Native's own RTL rewrite of `left` → `start` would leave it looking right today, but
      // by accident: one asymmetric marker added later and the compass would quietly start lying
      // in Arabic. Stating the direction here makes that impossible instead of unlikely.
      style={[{ width: size, height: size, direction: 'ltr' }, containerStyle, style]}
    >
      <DialFace size={size} color={colors.cardBright} />

      <Animated.View
        testID={`${testID}-rim`}
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: centre,
            borderWidth: 1,
            // The aligned halo from the mockup (`0 0 0 6px`), as a soft ring rather than a drop
            // shadow so it reads the same on both palettes.
            ...(aligned
              ? {
                  boxShadow: [
                    {
                      offsetX: 0,
                      offsetY: 0,
                      blurRadius: 0,
                      spreadDistance: 6,
                      color: colors.alignedTintBg,
                    },
                  ],
                }
              : null),
          },
          borderStyle,
        ]}
        pointerEvents="none"
      />

      {/* Everything that belongs to the world rather than to the phone. */}
      <Animated.View
        testID={`${testID}-ring`}
        style={[StyleSheet.absoluteFill, ringStyle]}
        pointerEvents="none"
      >
        <DialTicks size={size} color={colors.muted} />

        {/* The lettering is dropped rather than shrunk on a dial too small to set it at 10pt
            (`labelFits`); the ticks it names stay, and so does the badge's glyph. */}
        {labelFits(CARDINAL_SIZE, size)
          ? CARDINALS.map(({ quarter, key }) => (
              <DialCardinal
                key={key}
                heading={heading}
                quarter={quarter}
                label={t(key)}
                size={size}
                emphasised={quarter === 0}
                testID={`${testID}-cardinal-${quarter}`}
              />
            ))
          : null}

        <MakkahBadge
          heading={heading}
          bearing={bearing}
          alignment={alignment}
          aligned={aligned}
          size={size}
          label={labelFits(BADGE_LABEL, size) ? t('qibla.makkah') : null}
          testID={`${testID}-badge`}
        />
      </Animated.View>

      <DialNeedle
        heading={heading}
        bearing={bearing}
        alignment={alignment}
        size={size}
        live={live}
        testID={`${testID}-needle`}
      />

      <DialFixedMarkers size={size} pinHalo={colors.bg} ink={colors.inkStrong} />
    </Animated.View>
  );
}

/**
 * The paper face: a radial wash that fades to nothing at the rim, so the dial reads as light
 * falling on the parchment rather than as a disc pasted onto it. Memoised — it depends on nothing
 * that changes with the heading.
 */
const DialFace = memo(function DialFace({ size, color }: { size: number; color: string }) {
  const centre = size / 2;
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="compassFace" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={1} />
          <Stop offset="0.7" stopColor={color} stopOpacity={0.45} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={centre} cy={centre} r={centre} fill="url(#compassFace)" />
    </Svg>
  );
});

/**
 * The 36 ticks. They sit on the rotating ring but are themselves fixed geometry — only their
 * parent's transform changes with the heading — so the SVG must never be rebuilt per heading
 * publish. Memoised on size and palette alone.
 */
const DialTicks = memo(function DialTicks({ size, color }: { size: number; color: string }) {
  const scale = size / DIAL_SIZE;
  const centre = size / 2;
  return (
    <Svg width={size} height={size}>
      {Array.from({ length: TICK_COUNT }, (_, index) => {
        const major = index % TICK_MAJOR_EVERY === 0;
        const width = (major ? TICK_MAJOR_WIDTH : TICK_MINOR_WIDTH) * scale;
        const length = (major ? TICK_MAJOR_LENGTH : TICK_MINOR_LENGTH) * scale;
        return (
          <Rect
            key={index}
            x={centre - width / 2}
            y={0}
            width={width}
            height={length}
            fill={color}
            fillOpacity={major ? TICK_MAJOR_OPACITY : TICK_MINOR_OPACITY}
            transform={`rotate(${(index * 360) / TICK_COUNT} ${centre} ${centre})`}
          />
        );
      })}
    </Svg>
  );
});

/**
 * The two parts that belong to the phone rather than to the world, and so never turn: the centre
 * pin (on a paper halo so the needle's tail disappears under it) and the fixed pointer triangle —
 * "where you are pointing". Memoised on size and palette alone.
 */
const DialFixedMarkers = memo(function DialFixedMarkers({
  size,
  pinHalo,
  ink,
}: {
  size: number;
  pinHalo: string;
  ink: string;
}) {
  const scale = size / DIAL_SIZE;
  const centre = size / 2;
  return (
    <>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: centre - (PIN_SIZE / 2 + PIN_HALO) * scale,
          left: centre - (PIN_SIZE / 2 + PIN_HALO) * scale,
          width: (PIN_SIZE + PIN_HALO * 2) * scale,
          height: (PIN_SIZE + PIN_HALO * 2) * scale,
          borderRadius: (PIN_SIZE / 2 + PIN_HALO) * scale,
          backgroundColor: pinHalo,
          opacity: 0.9,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: PIN_SIZE * scale,
            height: PIN_SIZE * scale,
            borderRadius: (PIN_SIZE / 2) * scale,
            backgroundColor: ink,
          }}
        />
      </View>

      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -POINTER_RISE * scale,
          left: centre - (POINTER_WIDTH / 2) * scale,
          width: POINTER_WIDTH * scale,
          height: POINTER_HEIGHT * scale,
        }}
      >
        <Svg width={POINTER_WIDTH * scale} height={POINTER_HEIGHT * scale}>
          <Polygon
            points={`0,0 ${POINTER_WIDTH * scale},0 ${(POINTER_WIDTH / 2) * scale},${POINTER_HEIGHT * scale}`}
            fill={ink}
          />
        </Svg>
      </View>
    </>
  );
});

/**
 * One cardinal letter. Its wrapper turns with the ring to reach the right quarter of the rose;
 * the letter itself turns back by the same amount plus the heading, so it stays upright and
 * readable however the phone is held (the letters are geographic, and DESIGN.md §RTL is explicit
 * that the dial is never mirrored). Memoised: every prop is stable, so the letters never
 * reconcile on a heading publish — their rotation lives entirely on the UI thread.
 */
const DialCardinal = memo(function DialCardinal({
  heading,
  quarter,
  label,
  size,
  emphasised,
  testID,
}: {
  heading: SharedValue<number>;
  quarter: number;
  label: string;
  size: number;
  emphasised: boolean;
  testID: string;
}) {
  const scale = size / DIAL_SIZE;
  const box = CARDINAL_BOX * scale;
  const fontSize = (emphasised ? CARDINAL_SIZE_MAIN : CARDINAL_SIZE) * scale;

  const uprightStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${heading.get() - quarter * 90}deg` }],
  }));

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${quarter * 90}deg` }] }]}
    >
      <Animated.View
        testID={testID}
        style={[
          {
            position: 'absolute',
            top: CARDINAL_INSET * scale,
            left: size / 2 - box / 2,
            width: box,
            height: box,
            alignItems: 'center',
            justifyContent: 'center',
          },
          uprightStyle,
        ]}
      >
        {/* Deliberately frozen (spec-accessibility §2.4): the cardinals sit on the dial's fixed
            geometry, and the spoken dial duplicates everything they carry. */}
        <AppText
          variant="rowName"
          tone={emphasised ? 'strong' : 'muted'}
          weight={emphasised ? 700 : 500}
          allowFontScaling={false}
          style={{ fontSize, lineHeight: fontSize * 1.25 }}
        >
          {label}
        </AppText>
      </Animated.View>
    </View>
  );
});

/**
 * The Makkah marker: a badge riding the ring at the Qibla bearing, so it points at the Kaaba
 * whatever the phone is doing. Its glyph changes with alignment (mosque → check) — the colour is
 * the least of the four signals, not the signal. Memoised: it reconciles when `aligned` (the
 * glyph) or the bearing changes, never on a heading publish.
 */
const MakkahBadge = memo(function MakkahBadge({
  heading,
  bearing,
  alignment,
  aligned,
  size,
  label,
  testID,
}: {
  heading: SharedValue<number>;
  bearing: number;
  alignment: SharedValue<number>;
  aligned: boolean;
  size: number;
  /** `null` on a dial too small to set the word at the 10pt floor. */
  label: string | null;
  testID: string;
}) {
  const { colors } = useTheme();
  const scale = size / DIAL_SIZE;
  const column = BADGE_COLUMN * scale;
  const badge = BADGE_SIZE * scale;

  const uprightStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${heading.get() - bearing}deg` }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(alignment.get(), [0, 1], [colors.accent, colors.aligned]),
  }));

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${bearing}deg` }] }]}
    >
      <View
        style={{
          position: 'absolute',
          top: BADGE_INSET * scale,
          left: size / 2 - column / 2,
          width: column,
          alignItems: 'center',
        }}
      >
        <Animated.View
          testID={`${testID}-upright`}
          style={[{ alignItems: 'center', gap: 2 * scale }, uprightStyle]}
        >
          <Animated.View
            testID={`${testID}-face`}
            style={[
              {
                width: badge,
                height: badge,
                borderRadius: badge / 2,
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: [
                  {
                    offsetX: 0,
                    offsetY: 2,
                    blurRadius: 10,
                    spreadDistance: -3,
                    color: colors.shadowGold,
                  },
                ],
              },
              fillStyle,
            ]}
          >
            <Icon
              name={aligned ? 'check' : 'mosque'}
              size={BADGE_ICON * scale}
              color={colors.sealFg}
            />
          </Animated.View>
          {/* Deliberately frozen (spec-accessibility §2.4): the label rides the dial's fixed
              geometry, and the narrated dial (bearing/heading numbers + status pill) speaks
              everything it shows at any type size. `null` on a dial too small to set it at the
              10pt floor — the glyph above still says which way Makkah is. */}
          {label === null ? null : (
            <AppText
              variant="tabLabel"
              weight={600}
              allowFontScaling={false}
              color={aligned ? colors.aligned : colors.accent}
              style={{ fontSize: BADGE_LABEL * scale, letterSpacing: BADGE_LABEL * scale * 0.04 }}
            >
              {label}
            </AppText>
          )}
        </Animated.View>
      </View>
    </View>
  );
});

/**
 * The needle. It carries the *difference* — `bearing − heading` — so it rests under the fixed top
 * pointer exactly when the badge does. Two shapes are stacked and cross-faded rather than
 * recolouring one, because an SVG gradient cannot be interpolated on the UI thread and a hard
 * colour swap on a moving needle looks like a glitch. Memoised: it reconciles when `live` or the
 * bearing changes, never on a heading publish — the rotation is the UI thread's job.
 */
const DialNeedle = memo(function DialNeedle({
  heading,
  bearing,
  alignment,
  size,
  live,
  testID,
}: {
  heading: SharedValue<number>;
  bearing: number;
  alignment: SharedValue<number>;
  size: number;
  live: boolean;
  testID: string;
}) {
  const { colors } = useTheme();
  const scale = size / DIAL_SIZE;
  const width = NEEDLE_WIDTH * scale;
  const length = NEEDLE_LENGTH * scale;

  const rotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${bearing - heading.get()}deg` }],
  }));
  const goldStyle = useAnimatedStyle(() => ({ opacity: 1 - alignment.get() }));
  const alignedStyle = useAnimatedStyle(() => ({ opacity: alignment.get() }));

  if (!live) return null;

  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, rotationStyle]}
    >
      <View
        style={{
          position: 'absolute',
          top: NEEDLE_TOP * scale,
          left: size / 2 - width / 2,
          width,
          height: length,
        }}
      >
        <Animated.View style={[StyleSheet.absoluteFill, goldStyle]}>
          <NeedleShape
            width={width}
            height={length}
            color={colors.accent}
            gradientId="needleGold"
          />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, alignedStyle]}>
          <NeedleShape
            width={width}
            height={length}
            color={colors.aligned}
            gradientId="needleAligned"
          />
        </Animated.View>
      </View>
    </Animated.View>
  );
});

/** The needle itself: solid to 62% of its length, then fading into the paper (from the mockup). */
function NeedleShape({
  width,
  height,
  color,
  gradientId,
}: {
  width: number;
  height: number;
  color: string;
  gradientId: string;
}) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={1} />
          <Stop offset="0.62" stopColor={color} stopOpacity={1} />
          <Stop offset="1" stopColor={color} stopOpacity={0.15} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} rx={width / 2} fill={`url(#${gradientId})`} />
    </Svg>
  );
}
