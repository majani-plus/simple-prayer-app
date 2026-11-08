import { router } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { radius, spacing, useTheme } from '@/theme';

/**
 * The calm paper card the Today tab shows *instead of the hero* when there are no prayer times to
 * count down to yet.
 *
 * This is the only place in the app a location permission prompt can originate (PRODUCT_SPEC §10):
 * one card, one button, on the screen that actually needs the answer. It explains what is needed
 * and why before asking, states the privacy posture in the same breath, and — once refused —
 * changes its copy to point at the OS settings (or at choosing a city) instead of asking again.
 * Nothing about it repeats itself, blocks the screen, or scolds.
 *
 * Every location state also carries **"Choose a city"** — a tappable route to the manual path,
 * offered *alongside* the permission ask, never only after a refusal. Saying no to the device is
 * a free choice only if the alternative is reachable from the very card that asks (PRODUCT_SPEC
 * §10); copy that merely *mentions* choosing a city, with no way to tap it, is a dead end. The
 * two compass states do not carry it: they only ever appear when a location already exists and
 * the heading sensor wants the permission — a chosen city cannot turn the dial.
 *
 * It renders copy only; the caller owns the primary action, so the same card serves "not set
 * yet", "you said no", "the OS will not ask again" and "the fix failed". The choose-a-city route
 * is the card's own — it presents the city picker (`app/city`) over whatever screen this card is
 * on, and dismisses back to it — overridable via `onChooseCity` where a caller needs to.
 */

/** Which of the four situations the card is explaining. */
export type LocationPromptState =
  /** No location has ever been set. The first, friendly ask. */
  | 'idle'
  /** Permission was refused, but the OS will still show the dialog. */
  | 'denied'
  /** Permission was refused for good; only the system settings can change it. */
  | 'blocked'
  /** Permission is fine, but no position could be resolved. */
  | 'error'
  /**
   * The Qibla dial cannot turn because the heading needs the same permission. Its own copy, not
   * the location one: the bearing on that screen is already correct — telling someone "prayer
   * times need a location" while the screen is showing them a bearing is simply untrue.
   */
  | 'compass'
  /** As `compass`, but the OS will not ask again — only settings can change it. */
  | 'compassBlocked';

export interface LocationPromptCardProps {
  /** What to explain; see {@link LocationPromptState}. */
  state: LocationPromptState;
  /** `true` while a resolution is in flight — the button says so and stops accepting taps. */
  busy?: boolean;
  /** The primary action: request the location, retry, or open the system settings. */
  onPress: () => void;
  /**
   * Where "Choose a city" goes. Defaults to presenting the city picker (`app/city`) over the
   * current screen, which is what every caller wants; the prop exists for tests and for a caller
   * that already has a search on screen.
   */
  onChooseCity?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface Copy {
  icon: IconName;
  titleKey: string;
  bodyKey: string;
  actionKey: string;
}

const COPY: Record<LocationPromptState, Copy> = {
  idle: {
    icon: 'my_location',
    titleKey: 'today.noLocation.title',
    bodyKey: 'today.noLocation.body',
    actionKey: 'location.useMyLocation',
  },
  denied: {
    icon: 'location_on',
    titleKey: 'location.permissionDenied',
    bodyKey: 'location.permissionDeniedHelp',
    actionKey: 'location.useMyLocation',
  },
  blocked: {
    icon: 'settings',
    titleKey: 'location.permissionDenied',
    bodyKey: 'location.permissionDeniedHelp',
    actionKey: 'location.openSettings',
  },
  error: {
    icon: 'refresh',
    titleKey: 'today.noLocation.title',
    bodyKey: 'location.positionUnavailable',
    actionKey: 'location.retry',
  },
  compass: {
    icon: 'explore',
    titleKey: 'qibla.compassPermission.title',
    bodyKey: 'qibla.compassPermission.body',
    actionKey: 'location.useMyLocation',
  },
  compassBlocked: {
    icon: 'settings',
    titleKey: 'qibla.compassPermission.title',
    bodyKey: 'qibla.compassPermission.body',
    actionKey: 'location.openSettings',
  },
};

/**
 * The "prayer times need a location" card.
 *
 * @param state - Which situation to explain.
 * @param busy - Whether a resolution is already running.
 * @param onChooseCity - Overrides where "Choose a city" goes; see {@link LocationPromptCardProps}.
 * @returns A paper card with an icon, a heading, an explanation, the primary button, the manual
 * route (location states only) and the privacy note.
 */
export function LocationPromptCard({
  state,
  busy = false,
  onPress,
  onChooseCity,
  style,
  testID = 'location-prompt',
}: LocationPromptCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const copy = COPY[state];
  const label = busy ? t('location.resolving') : t(copy.actionKey);
  // The compass states appear only when a location is already set; a city cannot turn the dial.
  const offersCity = state !== 'compass' && state !== 'compassBlocked';

  const handleChooseCity = useCallback(() => {
    if (onChooseCity !== undefined) {
      onChooseCity();
      return;
    }
    // The picker, presented OVER this screen. It used to push Settings → Location with the
    // search focused, which answered the question by moving the user to a different tab and
    // leaving them to find their way back; choosing a city is the answer to what this card just
    // asked, so it belongs on top of it and dismisses straight back here.
    router.push('/city');
  }, [onChooseCity]);

  return (
    <Card
      testID={testID}
      variant="bright"
      border="mid"
      style={[
        {
          alignItems: 'center',
          gap: spacing.sm,
          paddingVertical: spacing.xl,
          paddingHorizontal: spacing.lg,
        },
        style,
      ]}
    >
      <Icon name={copy.icon} size={26} color={colors.accent} />
      {/* Heading and explanation are one spoken unit; the button announces itself separately. */}
      <View accessible accessibilityRole="text" style={{ alignItems: 'center', gap: 3 }}>
        <AppText variant="rowName" style={{ textAlign: 'center' }}>
          {t(copy.titleKey)}
        </AppText>
        <AppText variant="caption" tone="header" style={{ textAlign: 'center' }}>
          {t(copy.bodyKey)}
        </AppText>
      </View>
      <PressableScale
        testID={`${testID}-action`}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        haptics
        onPress={onPress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          marginTop: spacing.xs,
          paddingVertical: 10,
          paddingHorizontal: spacing.xl,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.accent,
          // The one primary action on the screen carries the accent fill; while it is working it
          // steps back to paper so nothing looks tappable that is not.
          backgroundColor: busy ? colors.card : colors.accent,
          opacity: busy ? 0.7 : 1,
        }}
      >
        <AppText
          variant="time"
          weight={600}
          tabularNums={false}
          color={busy ? colors.header : colors.sealFg}
        >
          {label}
        </AppText>
      </PressableScale>
      {offersCity ? (
        // The manual path, always tappable — never disabled by `busy`: refusing to wait for a
        // fix is exactly the moment someone reaches for typing their city instead.
        <PressableScale
          testID={`${testID}-choose-city`}
          accessibilityRole="button"
          accessibilityLabel={t('location.chooseCity')}
          haptics
          onPress={handleChooseCity}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 8,
            paddingHorizontal: spacing.lg,
          }}
        >
          <Icon name="search" size={15} color={colors.accent} />
          <AppText variant="time" weight={600} tabularNums={false} color={colors.accent}>
            {t('location.chooseCity')}
          </AppText>
        </PressableScale>
      ) : null}
      <AppText variant="hint" style={{ textAlign: 'center' }}>
        {t('location.privacyNote')}
      </AppText>
    </Card>
  );
}
