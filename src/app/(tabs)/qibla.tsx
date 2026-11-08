import * as Haptics from 'expo-haptics';
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { CompassDial, dialSizeForWindow } from '@/components/CompassDial';
import { Icon } from '@/components/Icon';
import { LocationPromptCard, type LocationPromptState } from '@/components/LocationPromptCard';
import { PaperBackground } from '@/components/PaperBackground';
import { PressableScale } from '@/components/PressableScale';
import { QiblaAccuracy } from '@/components/QiblaAccuracy';
import { QiblaCalibrationCard } from '@/components/QiblaCalibrationCard';
import { QiblaGuidance } from '@/components/QiblaGuidance';
import { QiblaInfoCards } from '@/components/QiblaInfoCards';
import { QiblaTiltHint } from '@/components/QiblaTiltHint';
import { SectionDivider } from '@/components/SectionDivider';
import {
  DEFAULT_ALIGNMENT_TOLERANCE_DEG,
  cardinalKey,
  distanceToKaabaKm,
  isAligned,
  normalizeAngle,
  qiblaBearing,
  shortestAngleDelta,
} from '@/domain/qibla';
import { useAnnounceChange } from '@/hooks/useAnnounceChange';
import { NativeNeedleSource } from '@/components/NativeNeedleSource';
import { useHeading } from '@/hooks/useHeading';
import { TwoPaneLayout, paneWidth } from '@/components/TwoPaneLayout';
import { useLayout } from '@/hooks/useLayout';
import { useTilt } from '@/hooks/useTilt';
import {
  useLocationActions,
  useLocationPermission,
  useLocationStatus,
} from '@/stores/locationStore';
import { useLocation } from '@/stores/settingsStore';
import { radius, spacing, useTheme } from '@/theme';

/**
 * The Qibla tab (mockup 3a, PRODUCT_SPEC §9).
 *
 * Header → calligraphy + status pill → the dial → three figures → the turn-by-turn card →
 * accuracy → footer hint, on the same paper as everywhere else. Like the Today tab it is a
 * *composition*: `domain/qibla` owns every angle, `hooks/useHeading` owns the sensor, and what is
 * left here is the small amount of judgement a screen has to make.
 *
 * There are four such judgements, and they are the whole screen:
 *
 * 1. **The needle is never driven by React.** The heading arrives as a Reanimated shared value
 *    that `CompassDial` reads on the UI thread; only the *numbers* (the readout, the turn
 *    instruction) come through state, at the ~6.7 Hz `useHeading` throttles them to. A compass
 *    that re-rendered a screen 30 times a second would feel exactly as bad as the ones this app
 *    is meant to replace.
 * 2. **Alignment has hysteresis.** It engages at ≤5° (the domain's tolerance) and only lets go
 *    past {@link ALIGNMENT_EXIT_TOLERANCE_DEG}. Standing on the boundary is the normal case — a
 *    hand is never still — and without the wider exit the pill, the icons and the haptic would
 *    chatter. The haptic therefore fires **once per entry**, never per sample. The band is kept
 *    as narrow as that buys, and the guidance card is told the exit figure rather than the entry
 *    one, so the sentence on screen is true for every degree it is shown at (D86).
 * 3. **Alignment is never colour alone.** The pill changes its word and its glyph, the badge's
 *    mosque becomes a check, the guidance card changes its sentence and its icon, and the haptic
 *    lands. Green is the least of it.
 * 4. **It says what it does not know.** No location → the same one calm card the Today tab uses,
 *    never a second invented empty state. Magnetic-only heading, poor accuracy, no compass at all
 *    → said quietly, in words, rather than hidden behind a confident needle.
 */

/** The mockup's rhythm between sections (18px, a touch looser than the 16pt scale). */
const SECTION_GAP = 18;

/**
 * How far off the Qibla the device may drift before the aligned state releases. Wider than the 5°
 * it engages at, on purpose: see the hysteresis note in the module comment.
 *
 * **One degree of buffer, and no more (D86).** It was 8°, and a user caught what that cost: the
 * card kept saying "Within 5° of the Kaaba" while they stood 8° off, and because the heading is
 * published in whole degrees the first correction they ever saw jumped straight to "Turn 9°" —
 * 6, 7 and 8 never appeared. One degree is the smallest buffer that survives that quantisation
 * (the delta walks in 1° steps, so there is exactly one sample between engaging and releasing),
 * which is enough to stop the chatter and narrow enough that the claim underneath stays honest.
 */
const ALIGNMENT_EXIT_TOLERANCE_DEG = 6;

/** The calligraphy's size in the mockup (26px Amiri, against Today's 30px hero). */
const CALLIGRAPHY_SIZE = 26;

/** Hoisted so the dial's memoised subtree is not reconciled over a new style object each render. */
const DIAL_STYLE = { alignSelf: 'center' } as const;

/**
 * The single tap that marks entering alignment. Medium rather than Light — the owner found Light
 * muffled, and this one must carry through a phone held out at arm's length — but still an impact
 * rather than a success notification: facing the right way is a confirmation, not a fanfare.
 */
function alignmentHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {
    // A device without a haptic engine (or with it switched off) must never break the screen.
  });
}

export default function QiblaScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampStyle, contentClampPadding, isExpanded } = useLayout();
  const { width, height } = useWindowDimensions();

  // The sensor runs only while this tab is on screen; `useHeading` ANDs this with the app's
  // foreground state. A magnetometer left watching is a battery complaint waiting to happen.
  const isFocused = useIsFocused();

  const location = useLocation();
  // The location is the compass's too: Android's rotation vector reads against magnetic north and
  // needs coordinates before it can offer a true one (D144).
  const compass = useHeading({ enabled: isFocused, location });

  const locationStatus = useLocationStatus();
  const { canAskAgain } = useLocationPermission();
  const { requestAndResolve, refresh } = useLocationActions();

  // A property of the place, not of the moment: recomputed when the location changes, never on a
  // heading sample.
  const qibla = useMemo(() => {
    if (location === null) return null;
    const bearing = qiblaBearing(location);
    if (!Number.isFinite(bearing)) return null;
    return { bearing, distanceKm: distanceToKaabaKm(location) };
  }, [location]);

  const heading = compass.heading;
  const delta =
    qibla !== null && heading !== null ? shortestAngleDelta(heading, qibla.bearing) : null;

  // The accelerometer runs only while there is a live needle to advise on — no bearing or no
  // compass stream means no posture worth hinting about, and no sensor left running for it.
  const tilt = useTilt({ enabled: isFocused && qibla !== null && compass.status === 'active' });

  const [aligned, setAligned] = useState(false);
  // Read inside the effect below, where the state value would always be one render behind.
  const alignedRef = useRef(false);
  useEffect(() => {
    const next =
      delta === null
        ? false
        : alignedRef.current
          ? isAligned(delta, ALIGNMENT_EXIT_TOLERANCE_DEG)
          : isAligned(delta, DEFAULT_ALIGNMENT_TOLERANCE_DEG);
    if (next === alignedRef.current) return;
    alignedRef.current = next;
    setAligned(next);
    if (next) alignmentHaptic();
  }, [delta]);

  // Recalibrate: one spring on the dial, the figure-8 instruction, and a forced re-resolution of
  // the position (the bearing is only as good as the fix it was computed from). It deliberately
  // does NOT prompt for permission — the prompt card below is the one place that may ask.
  const [pulse, setPulse] = useState(0);
  const [calibrationRequested, setCalibrationRequested] = useState(false);
  const [calibrationDismissed, setCalibrationDismissed] = useState(false);

  // `needsCalibration` already covers `low` AND `unavailable`, after the hook's 1.5 s grace —
  // re-adding `|| confidence === 'low'` here once bypassed that grace and flashed the card on
  // open whenever Android's first sample arrived before its first onAccuracyChanged.
  const calibrationNeeded = compass.needsCalibration;
  // A dismissal sticks for as long as the screen is up, even if the accuracy dips again: having
  // said "not now" once, being asked again by a card that reappears on its own is exactly the
  // nagging this app refuses to do. Recalibrate brings it straight back for anyone who wants it.
  const showCalibration = (calibrationNeeded || calibrationRequested) && !calibrationDismissed;

  const handleRecalibrate = useCallback(() => {
    setPulse((count) => count + 1);
    setCalibrationRequested(true);
    setCalibrationDismissed(false);
    void refresh({ force: true }).catch(() => {
      // Nothing to say: the screen keeps working off the position it already has.
    });
  }, [refresh]);

  const dismissCalibration = useCallback(() => {
    setCalibrationDismissed(true);
    setCalibrationRequested(false);
  }, []);

  const handleLocationAction = useCallback(() => {
    if (locationStatus === 'denied' && !canAskAgain) {
      void Promise.resolve(Linking.openSettings()).catch(() => {
        // Some OEM builds refuse to open settings; the copy already explains the manual route.
      });
      return;
    }
    void requestAndResolve();
  }, [locationStatus, canAskAgain, requestAndResolve]);

  const promptState: LocationPromptState =
    locationStatus === 'denied'
      ? canAskAgain
        ? 'denied'
        : 'blocked'
      : locationStatus === 'error'
        ? 'error'
        : 'idle';

  const unknown = t('qibla.value.unknown');
  const headingDegrees = heading === null ? null : Math.round(normalizeAngle(heading)) % 360;
  const bearingDegrees = qibla === null ? null : Math.round(qibla.bearing) % 360;

  // The split earns its keep only in LANDSCAPE (owner, 2026-08-28, second reading: "in
  // landscape keep the 2 panes; single column in landscape sucks" — and a portrait split was
  // two half-instruments). Portrait at any width is the phone's single centred column.
  const spread = isExpanded && width > height;
  const dialSize = dialSizeForWindow(width, spread ? paneWidth(width) : undefined);
  const statusLabel = aligned ? t('qibla.status.aligned') : t('qibla.status.searching');

  // **The one thing this screen must say out loud.** Alignment is the whole point of the tab, and
  // it happens while the user is turning — with the phone moving, nobody's VoiceOver focus is
  // sitting on the pill that changed, and the `accessibilityLiveRegion` below is Android-only. So
  // the pill's own words are announced on the platform the live region does not reach.
  //
  // Keyed on `aligned` rather than on the pill's presence, which is the difference between
  // reporting an event and reporting a render: a location resolving a beat after mount makes the
  // pill appear, and a pill appearing in its resting state is not news. What is news is the state
  // this screen exists to report, and it cannot chatter, because the screen owns the hysteresis
  // (engage ≤5°, release >6°) — so this speaks exactly when the haptic fires, including the
  // opening confirmation for someone who was already facing the right way.
  useAnnounceChange(statusLabel);

  const scrollShell = {
    paddingTop: insets.top + spacing.xxl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: SECTION_GAP,
  };

  /** "Qibla · City" and the recalibrate pill. */
  const headerRow = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <AppText variant="headerMeta" testID="qibla-header" style={{ flexShrink: 1 }}>
          {location === null
            ? t('qibla.headerNoCity')
            : t('qibla.header', { city: location.label })}
        </AppText>
        <PressableScale
          testID="qibla-recalibrate"
          accessibilityRole="button"
          accessibilityLabel={t('qibla.recalibrate')}
          accessibilityHint={t('qibla.recalibrateHint')}
          haptics
          onPress={handleRecalibrate}
          style={{
            // Logical, not physical: in Arabic the recalibrate pill has to push to the LEFT
            // edge, which `marginLeft` would pin to the wrong side of the row.
            marginStart: 'auto',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            paddingVertical: 8,
            paddingHorizontal: 13,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.borderMid,
            backgroundColor: colors.card,
          }}
        >
          <Icon name="my_location" size={16} color={colors.header} />
          <AppText variant="time" weight={600} tabularNums={false} color={colors.header}>
            {t('qibla.recalibrate')}
          </AppText>
        </PressableScale>
      </View>
    </>
  );

  /** The calligraphy that titles the screen, and the alignment pill under it. */
  const titleBlock = (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <SectionDivider style={{ alignSelf: 'stretch', marginBottom: spacing.lg }} />
      <AppText
        variant="heroArabic"
        // 1.3 em, not the 1.2 this was set at: «القِبلة» carries a kasra, and Amiri draws it from
        // −0.30 to −0.50 em, so at 1.2 the mark sat on the box's edge. The calligraphy variants are
        // exempt from AppText's Arabic leading floor (their leading is designed, not inherited), so
        // the one title that needs the room asks for it here.
        style={{ fontSize: CALLIGRAPHY_SIZE, lineHeight: CALLIGRAPHY_SIZE * 1.3 }}
      >
        {t('qibla.arabic')}
      </AppText>
      {/*
            Only once there is a place to face. Without a location there is no bearing, so
            "turn to find the Qibla" would be instructing the user to do something that cannot
            succeed — and sitting directly above the card that asks for the location, it reads as
            if the compass were already working. The calligraphy above stays: it is the screen's
            title, true whether or not we know where you are.
          */}
      {qibla === null ? null : (
        <View
          testID="qibla-status"
          accessible
          accessibilityRole="text"
          accessibilityLabel={statusLabel}
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginTop: spacing.xs,
            paddingVertical: 7,
            paddingHorizontal: 15,
            borderRadius: radius.pill,
            borderWidth: 1,
            backgroundColor: aligned ? colors.aligned : colors.card,
            borderColor: aligned ? colors.aligned : colors.borderMid,
          }}
        >
          <Icon
            name={aligned ? 'check_circle' : 'explore'}
            size={18}
            color={aligned ? colors.alignedFg : colors.header}
          />
          <AppText
            variant="time"
            weight={600}
            tabularNums={false}
            color={aligned ? colors.alignedFg : colors.header}
            style={{ fontSize: 14 }}
          >
            {statusLabel}
          </AppText>
        </View>
      )}
    </View>
  );

  /** The one card that may ask for a location, when there is none. */
  const locationPrompt = (
    <LocationPromptCard
      testID="qibla-location-prompt"
      state={promptState}
      busy={locationStatus === 'requesting'}
      onPress={handleLocationAction}
    />
  );

  /** The instrument itself. `null` until there is a place to point at. */
  const dialBlock =
    qibla === null ? null : (
      <CompassDial
        testID="qibla-dial"
        heading={compass.sharedHeading}
        bearing={qibla.bearing}
        aligned={aligned}
        live={compass.hasFix}
        size={dialSize}
        pulse={pulse}
        style={DIAL_STYLE}
        accessibilityLabel={
          headingDegrees === null
            ? t('qibla.dial.a11yLabelNoFix', { bearing: bearingDegrees })
            : t('qibla.dial.a11yLabel', {
                heading: headingDegrees,
                bearing: bearingDegrees,
              })
        }
      />
    );

  /** Everything that reads the dial out in numbers and words. `null` for the same reason. */
  const infoColumn =
    qibla === null ? null : (
      <>
        {/* The posture hint (D119) leads the readings: it says why the needle may be wrong before
            the figures state what it currently claims. A screen facing the floor (D172) is the
            worse of the two postures — the rose is mirrored there — so it speaks first. */}
        {tilt.isFaceDown ? (
          <QiblaTiltHint reason="faceDown" />
        ) : tilt.isTilted ? (
          <QiblaTiltHint />
        ) : null}

        <QiblaInfoCards
          aligned={aligned}
          heading={
            headingDegrees === null
              ? unknown
              : t('qibla.value.degrees', { degrees: headingDegrees })
          }
          bearing={t('qibla.value.bearing', {
            degrees: bearingDegrees,
            cardinal: t(cardinalKey(qibla.bearing)),
          })}
          distance={t('qibla.value.distance', { distance: Math.round(qibla.distanceKm) })}
        />

        {/*
              The EXIT tolerance, not the entry one. `aligned` is governed by the release band, so
              quoting the 5° it engages at made the card state a number the state machine had
              already stopped honouring — false on screen for every degree between (D86).
            */}
        <QiblaGuidance
          delta={delta}
          aligned={aligned}
          toleranceDeg={ALIGNMENT_EXIT_TOLERANCE_DEG}
        />

        {showCalibration ? <QiblaCalibrationCard onDismiss={dismissCalibration} /> : null}

        {compass.status === 'permissionRequired' ? (
          <LocationPromptCard
            testID="qibla-compass-permission"
            state={canAskAgain ? 'compass' : 'compassBlocked'}
            busy={locationStatus === 'requesting'}
            onPress={handleLocationAction}
          />
        ) : compass.status === 'unavailable' ? (
          <AppText variant="hint" testID="qibla-no-compass" style={{ textAlign: 'center' }}>
            {t('qibla.noCompass')}
          </AppText>
        ) : (
          <QiblaAccuracy confidence={compass.confidence} magnetic={compass.isMagneticFallback} />
        )}
      </>
    );

  const footer = (
    <AppText variant="hint" testID="qibla-footer" style={{ textAlign: 'center' }}>
      {t('qibla.footerHint')}
    </AppText>
  );

  // Landscape spread: the instrument leads, its readings trail (D124). Without a location
  // there is nothing to divide, so the single clamped column stays.
  // Renders nothing; mounting it is what runs the UI-thread rotation-vector stream that drives the
  // needle, and unmounting it is what stops the sensor. `nativeNeedle` is null on iOS and whenever
  // the sensor should be off, so this needs no gate of its own (D145). It is rendered by BOTH
  // layouts below: the two-pane branch used to omit it, so turning an Android tablet to landscape
  // unmounted the worklet while `alive` stayed 1, and the needle froze with the numbers still
  // moving (found in the 2026-09-14 review).
  const needleSource = compass.nativeNeedle ? (
    <NativeNeedleSource source={compass.nativeNeedle} />
  ) : null;

  if (spread && qibla !== null) {
    return (
      <PaperBackground>
        {needleSource}
        <TwoPaneLayout
          testID="qibla-panes"
          start={
            <ScrollView
              testID="qibla-scroll"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ ...scrollShell, ...contentClampStyle }}
            >
              {headerRow}
              {titleBlock}
              {dialBlock}
            </ScrollView>
          }
          end={
            <ScrollView
              testID="qibla-info-scroll"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ ...scrollShell, ...contentClampStyle }}
            >
              {infoColumn}
              {footer}
            </ScrollView>
          }
        />
      </PaperBackground>
    );
  }

  return (
    <PaperBackground>
      {needleSource}
      <ScrollView
        testID="qibla-scroll"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ ...scrollShell, ...contentClampPadding(spacing.xl) }}
      >
        {headerRow}
        {titleBlock}
        {qibla === null ? locationPrompt : dialBlock}
        {infoColumn}
        {footer}
      </ScrollView>
    </PaperBackground>
  );
}
