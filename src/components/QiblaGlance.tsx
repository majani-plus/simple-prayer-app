import { router, useIsFocused } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { CompassDial } from './CompassDial';
import { PressableScale } from './PressableScale';
import { SectionDivider } from './SectionDivider';
import {
  cardinalKey,
  distanceToKaabaKm,
  isAligned,
  normalizeAngle,
  qiblaBearing,
  shortestAngleDelta,
} from '@/domain/qibla';
import { NativeNeedleSource } from '@/components/NativeNeedleSource';
import { useHeading } from '@/hooks/useHeading';
import { useLocation } from '@/stores/settingsStore';
import { spacing, useTheme } from '@/theme';

/**
 * The live qibla dial on the Today dashboard's glance pane (D124) — the owner's explicit choice
 * over a static bearing card.
 *
 * It is the real `CompassDial`, not a picture of one: it turns as the device turns and shows the
 * aligned state with all of its signals — the green, the badge's glyph, and the word underneath —
 * because alignment is never colour alone. What it deliberately does *not* carry is the Qibla tab's
 * apparatus: no recalibrate control, no calibration card, no accuracy readout, no haptic and no
 * spoken announcement. Those belong to the screen someone opened *to* point; this is a glance, and
 * the whole block is a press away from that screen.
 *
 * ## The sensor
 *
 * A magnetometer left watching is a battery complaint waiting to happen, so this subscribes only
 * while it is genuinely on screen: the component itself is mounted only at expanded width, and it
 * ANDs that with `useIsFocused` so a tablet sitting on the Settings tab is not reading the compass.
 * Phones and portrait tablets never mount it at all, and therefore never pay for it.
 *
 * ## Alignment without hysteresis
 *
 * The Qibla screen holds an engage/release band because it fires a haptic and speaks the change,
 * and a state that chatters would chatter out loud. This one only draws, so the plain tolerance is
 * right: a dial that flickers between gold and green while you hold the device still is a problem
 * the Qibla tab must not have, but a glance that briefly disagrees with the tab by a degree is not
 * worth a second state machine.
 */

/** The glance dial's diameter. Small enough to sit under a month, large enough to read (D125). */
export const MINI_DIAL_SIZE = 160;

export interface QiblaGlanceProps {
  /**
   * Which side of the block its ◆ rule sits on. The rule belongs to the block rather than to the
   * pane because this component can render *nothing at all* (no location, no compass) — a rule left
   * behind by the pane would then strand a second hairline against the next section's own. So the
   * side has to be told: `'trailing'` when the block leads the pane, `'leading'` when it follows
   * something.
   */
  divider?: 'leading' | 'trailing';
  testID?: string;
}

/**
 * @returns The dial, its caption and the press target — or nothing at all when there is no location
 *   to compute a bearing from, or no compass to turn it with. The pane simply omits it; the main
 *   pane already carries the one card that asks for a location.
 */
export function QiblaGlance({
  divider = 'leading',
  testID = 'today-glance-qibla',
}: QiblaGlanceProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const isFocused = useIsFocused();
  const location = useLocation();
  const compass = useHeading({ enabled: isFocused, location });

  // A property of the place, not of the moment.
  const qibla = useMemo(() => {
    if (location === null) return null;
    const bearing = qiblaBearing(location);
    if (!Number.isFinite(bearing)) return null;
    return { bearing, distanceKm: distanceToKaabaKm(location) };
  }, [location]);

  // No bearing to draw, or a device whose compass the platform has refused outright: the pane
  // simply omits the block rather than showing a dial that can never turn.
  if (qibla === null || compass.status === 'unavailable') return null;

  const heading = compass.heading;
  const delta = heading === null ? null : shortestAngleDelta(heading, qibla.bearing);
  const aligned = delta !== null && isAligned(delta);

  const headingDegrees = heading === null ? null : Math.round(normalizeAngle(heading)) % 360;
  const bearingDegrees = Math.round(qibla.bearing) % 360;
  const dialLabel =
    headingDegrees === null
      ? t('qibla.dial.a11yLabelNoFix', { bearing: bearingDegrees })
      : t('qibla.dial.a11yLabel', { heading: headingDegrees, bearing: bearingDegrees });

  // See `divider`: the rule travels with the block, on whichever side the pane needs it.
  const rule = <SectionDivider placement="top" />;

  return (
    <>
      {/* Renders nothing; mounting it is what runs the UI-thread rotation-vector stream, and
        unmounting it is what stops the sensor. `nativeNeedle` is null on iOS and whenever the
        sensor should be off, so this needs no gate of its own (D145). */}
      {compass.nativeNeedle ? <NativeNeedleSource source={compass.nativeNeedle} /> : null}
      {divider === 'leading' ? rule : null}
      <Card testID={`${testID}-card`} style={{ padding: spacing.lg, alignItems: 'center' }}>
        {/* A full-width card, so it dims rather than scales under the finger (D74). */}
        <PressableScale
          testID={testID}
          scale={1}
          pressedOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={dialLabel}
          accessibilityHint={t('today.glance.qiblaHint')}
          onPress={() => router.navigate('/qibla')}
          style={{ alignItems: 'center', gap: spacing.sm }}
        >
          {/* The dial is its own accessibility element (role "image"), and the press target above
            already states the same numbers — so it is hidden here rather than announced twice. */}
          <View
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <CompassDial
              testID={`${testID}-dial`}
              heading={compass.sharedHeading}
              bearing={qibla.bearing}
              aligned={aligned}
              live={compass.hasFix}
              size={MINI_DIAL_SIZE}
              accessibilityLabel={dialLabel}
            />
          </View>

          {/* The word, not only the green: the caption states the alignment as plainly as the dial
            draws it, and states the bearing when it is not aligned. */}
          <View style={{ alignItems: 'center' }}>
            <AppText
              testID={`${testID}-status`}
              variant="caption"
              italic={false}
              color={aligned ? colors.alignedText : undefined}
            >
              {aligned
                ? t('qibla.status.aligned')
                : t('qibla.value.bearing', {
                    degrees: bearingDegrees,
                    cardinal: t(cardinalKey(qibla.bearing)),
                  })}
            </AppText>
          </View>
        </PressableScale>
      </Card>
      {divider === 'trailing' ? rule : null}
    </>
  );
}
